---
title: "DTO sınırı güvenlik sınırıdır — çıktıyı gizlemek girdiyi korumaz"
rule_id: "RULE-ARCH-006"
category: "security"
scope: "all"
applies_to: "Any API endpoint that binds a client-supplied body to an object"
last_updated: "2026-10-01"
source: "https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html"
---

# DTO sınırı güvenlik sınırıdır — çıktıyı gizlemek girdiyi korumaz

Bir DTO'nun yaptığı iş veri taşımak değil, **hangi alanların istemci tarafından yazılabilir
olduğunu bildirmektir.** OWASP bunu CWE-915 (Mass Assignment) olarak sınıflandırır ve API'lerde
sömürülebilirliğin temel nedeni olarak şunu verir:

> Exploitation of mass assignment is easier in APIs, since by design they expose the underlying
> implementation of the application along with the properties' names.
> — https://owasp.org/API-Security/editions/2019/en/0xa6-mass-assignment/

Bir alanı **serialize ederken gizlemek**, onu **binding'den korumaz.** Bu, kuralın tamamı:
`JsonIgnore`, `[BindNever]`, `ReferenceHandler` — hiçbiri bir alanın `POST` ile yazılıp
yazılamayacağını belirlemez.

## Neden bu ayrım önemli

OWASP'ın çözümü allow-list'i **DTO üzerinde** tanımlar; hassas alan orada yoktur, korunması
yokluğundan gelir:

```java
public class UserRegistrationFormDTO {
    private String userid;
    private String password;
    private String email;
    //NOTE: isAdmin field is not present
    //Getters & Setters
}
```

OWASP alanları sahipliklerine göre üçe ayırır, ve hangi alanın hangi kovada durması gerektiği
bundan çıkar:

| Kategori | Örnek | Kim yazar |
|---|---|---|
| Permission-related | `user.is_admin`, `user.is_vip` | yalnızca admin |
| Process-dependent | `user.cash` | yalnızca ödeme doğrulamasından sonra |
| Internal | `article.created_time` | yalnızca uygulama |

OWASP'ın API Top 10 senaryosu, korumanın neden allow-list olması gerektiğini de gösteriyor:
saldırgan `GET /users/me` ile gördüğü `credit_balance` alanını `PUT`'a geri yazıyor ve ödeme
olmadan kredi alıyor. **Saldırgan için yeni alan keşfetmeye gerek yok** — response'ta
görünen her şey yazılabilirdir.

## ASP.NET Core'da somut biçim

`[BindNever]` JSON model binding sırasında hiçbir şey yapmıyor. ASP.NET Core'un kendi
maintainer'ı bunu issue'da doğruluyor ([aspnetcore#39337](https://github.com/dotnet/aspnetcore/issues/39337)):

> BindNever only works for model binding and not for JSON / XML serialization as noted in our
> docs.

Arızi biçim — ve kuralın var oluş sebebi:

1. `POST` ile kaynak oluşturuluyor; `isAdmin` bağlanmamalı → `JsonIgnore` ile önlüyor.
2. Ardından endpoint oluşturulan entity'yi döndürmek zorunda — ama `JsonIgnore` aynı zamanda
   **serileştirmeyi** de öldürüyor.
3. Sonuç: ya alan cevaptan düşer, ya POST'tan kabul edilir. İkisi de kırık.

Maintainer'ın yönlendirmesi ve kuralın çözümü aynı cümlede:

> System.Text.Json also does not deserialize read-only properties or properties with private
> setters by default. You could rely on that. In general though, our guidance is to use a view
> model to prevent over-binding, it's reliable regardless of how the model is being bound.

`reliable regardless of how the model is being bound` ifadenin tamamı: ayrı bir tip,
binding formatından bağımsız çalışır. Serileştirme ayarı çalışma anına bağlı bir kaçırmadır,
tip yapısal bir sınırdır.

## Do

- **Girdi tipini çıktı tipinden ayır.** Tek tip kullanıyorsan bile binding yönünü ayrı
  kıl: `[BindNever]` yerine DTO kullan, veya `BindNever`'ı **form/query binding** ile
  JSON gövdelerinin bulunduğu action'larda birlikte kullan.
- **DTO'yu endpoint'in girdi sözleşmesi olarak yaz**, entity olarak değil. Entity'nin
  navigation property'lerini (`Include`, `[JsonIgnore]`) cevapta gezdirmeye çalışma.
- **Eksik alanları bilinçli bırak.** OWASP'ın `isAdmin` örneğinde alan yoktur ve bu bir
  eksik değil, sözleşmin bir parçasıdır.
- **Enum'ları string olarak kabul et.** Mass assignment'ın klasik varyantı, string'i enum'a
  cast edip sunucunun yazamadığı bir değere erişmektir (`isAdmin` yerine `role`).
- **Sadece HTTP method'una göre karar verme.** `GET` DTO'su ile `POST` DTO'su farklı olmalıdır;
  `PATCH` için ayrı bir alan kümesi yaz.

## Don't

- **Serileştirme ayarını güvenlik sınırı sanma.** `[JsonIgnore]`, `[BindNever]`,
  `ReferenceHandler.IgnoreCycles` — hiçbiri binding'i kısıtlamaz. Bunlar çıktı tarafını
  düzenler.
- **`role`, `permissions`, `is_staff`, `balance`, `created_at`** gibi alanları entity üzerinde
  tutup response'a gizlemeye çalışma. Gizlemek sözleşmeyi değil çıktıyı düzenler.
- **Entity'yi doğrudan response olarak döndürme.** EF Core navigation property'lerini otomatik
  fix-up eder ve nesne grafiğinde döngü oluşturur
  ([EF Core](https://learn.microsoft.com/en-us/ef/core/querying/related-data/serialization)):
  > Because EF Core automatically does fix-up of navigation properties, you can end up with
  > cycles in your object graph.
- **`JsonIgnore` ile iki yönü birden öldürme.** Alanı hem girdi hem çıktıdan düşürmek,
  endpoint'in cevap döndürme sözleşmesini bozar — kısa vadede güvenli görünür, sonra alan
  geri gelir ve bu sefer bağlanabilir.
- **DTO varlığını güvenlik kanıtı sayma.** Fowler'ın kataloğundaki DTO'nun amacı N uzak çağrıyı
  1'e indirmektir
  ([Fowler](https://martinfowler.com/eaaCatalog/dataTransferObject.html)) — "reduce the number
  of method calls." Aynı tip iki işe yarar, ama birinin varlığı diğerinin garantisi değildir.

## Kod örneği

```csharp
// Do: binding sınırı tipte tanımlı — isAdmin alanı hiç yok
public sealed record CreateUserRequest(string UserName, string Email);

// entity'den ayrı çıktı sözleşmesi; createdAt sunucu alanı
public sealed record UserResponse(string Id, string UserName, string Email, DateTimeOffset CreatedAt);

[HttpPost]
public async Task<UserResponse> Create(CreateUserRequest request, CancellationToken ct)
{
    // isAdmin burada set edilebilir değil — tipte alan yok
    var user = new User { UserName = request.UserName, Email = request.Email };
    db.Users.Add(user);
    await db.SaveChangesAsync(ct);
    return new UserResponse(user.Id, user.UserName, user.Email, user.CreatedAt);
}

// Don't: entity'yi doğrudan bind et — isAdmin bağlanabilir
public async Task<User> Create(User user)
{
    db.Users.Add(user);   // {"userName":"x","isAdmin":true} kabul edilir
    await db.SaveChangesAsync();
    return user;         // ve entity'nin tüm alanları dönüyor
}
```

## Fowler'ın DTO'su ile OWASP'ın DTO'su aynı şey değil

İki kaynak aynı terimi kullanır ve bu karışıklık kuralın gerekçesi:

| | Fowler (katalog) | OWASP (cheat sheet + API Top 10) |
|---|---|---|
| Amaç | Uzak çağrı sayısını azaltmak | Binding yüzeyini kısıtlamak |
| Sorun | N çağrı pahalı, N parametre awkwardly | Saldırgan alan tahmin edebiliyor |
| Çözüm | DTO + assembler | Allow-list, DTO'da alan bulunmaması |
| Garanti | Performans | Güvenlik |

İkisi aynı kodu paylaşır — bir API'de tek tip hem az çağrıyı toplar hem binding sınırı
kurar — ama birinin varlığı diğerini garanti etmez. "Zaten DTO kullanıyoruz" cümlesi, ikisinden
hangisinin kastedildiğini söylemez; güvenlik iddiası için ikincisi gerekir.

## Failure modes

| Belirti | Neden | Çözüm |
|---|---|---|
| `isAdmin` POST ile set edilebiliyor | Entity doğrudan bind ediliyor | Ayrı girdi tipi; alanı tipte hiç tanımlama |
| `[BindNever]` çalışıyor ama alan yine set ediliyor | JSON binding `BindNever`'ı yok sayıyor | JSON gövdelerinde view model kullan |
| `JsonIgnore` sonrası response alanı eksik | Aynı tip iki yönde kullanılıyor | Ayrı çıktı tipi |
| `Self referencing loop detected` | Entity doğrudan serialize ediliyor | Navigation'ları response modeline taşıma |
| Role enum'u string cast ile yazılabiliyor | Enum binding güvenlik sınırı değil | Enum'u string kabul et, sunucuda map et |

## Doğrulama

```bash
# Binding yüzeyini gör: her endpoint'in parametre tiplerini listele
grep -rn "public async Task<.*> \(Create\|Update\|Post\|Patch\)" --include=*.cs .

# Entity tipleri doğrudan bind veya döndürülüyor mu?
grep -rn "Task<[A-Z][A-Za-z]*> Create(\([A-Z][A-Za-z]* \|Entity\)" --include=*.cs .
```

İkinci komut eşleşirse entity bir HTTP sınırında görünüyor demektir; o sınırda DTO yok.