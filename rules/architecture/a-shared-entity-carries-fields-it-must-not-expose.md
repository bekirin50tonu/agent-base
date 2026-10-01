---
title: "Paylaşılan entity, taşımaması gereken alanları da taşır"
rule_id: "RULE-ARCH-007"
category: "security"
scope: "all"
applies_to: "Any project that shares one entity type between the persistence layer and an API boundary"
last_updated: "2026-10-01"
source: "https://owasp.org/API-Security/editions/2019/en/0xa6-mass-assignment/"
---

# Paylaşılan entity, taşımaması gereken alanları da taşır

Bir DTO'nun alanları sınırlı, ama entity'nin alanları geniş — buna rağmen DTO kullanıldığını
söylemek, sözleşmenin sadece yarısını tanımlamaktır. Entity'yi paylaşan katmanlar aynı tipi
farklı sorumluluklarla görür ve her biri kendi sınırını varsayar.

## Neden bu ayrı bir kural

`RULE-ARCH-006` binding yüzeyini tanımlar. Bu kural onun **diğer yarısını** tanımlar:
aynı tip hangi yönde kullanılıyor.

OWASP'ın çözümü allow-list'i DTO üzerinde kurar ve hassas alanı orada yok sayar — bu doğru
ve yeterli. Ama aynı entity tipi başka yerlerde yaşamaya devam eder:

```text
User (entity)  ──┬── GET /users/me        → response, tüm alanlar görünür
                 ├── POST /users          → yalnızca UserName + Email bağlanabilir
                 ├── domain service       → Role, Balance, CreatedAt okur/yazar
                 └── background job       → tüm alanlar
```

Girdi yönünde koruma gerçek (DTO'da `isAdmin` yok). Çıktı yönünde ise tip hâlâ `User` ve
dolayısıyla alanlar sızar. OWASP'ın API Top 10 senaryosu tam olarak bu sızıntıyı kullanıyor:
saldırgan `credit_balance` alanını bir **okuma** endpoint'inden görüyor, sonra onu bir **yazma**
endpoint'ine geri gönderiyor. Okuma tarafındaki sızıntı tek başına saldırı değil, saldırıya
harita.

Bu yüzden bir sınır **iki yönde** tanımlanmalıdır: hangi alanların bağlanabilir olduğu ve
hangi alanların yayınlanabileceği. OWASP'ın "How To Prevent" listesinin son maddesi ayrı bir
gereklilik olarak bunu ister:

> If applicable, explicitly define and enforce schemas for the input data payloads.
> — https://owasp.org/API-Security/editions/2019/en/0xa6-mass-assignment/

`explicitly define **and enforce**` — tip sistemi tanımlar, sözleşme uygular. Serileştirme
ayarı (`IgnoreCycles`, view, `[JsonIgnore]`) uygulamanın bir çıktısıdır, tanımın kendisi
değildir; endpoint'i değiştirdiğinizde o davranış da değişir.

## Do

- **Entity tipini HTTP sınırına hiç taşıma.** İki taraf zaten farklı sorumluluk: entity
  ilişkileri ve değişmezleri bilir, DTO sözleşmeyi bilir. Paylaşım ikisini de bozar.
- **Yanıt modelini endpoint'e göre yaz.** `GET /users/me` ile `GET /internal/users/{id}`
  farklı alanlar döndürür; tek bir `UserResponse` ikisini de karşılamaz.
- **DTO dönüşümünü entity grafiğini gezmeden yap.** `Include` zincirinin hangi alanları
  dolduracağı çıktı sözleşmesini sessizce belirler — ve alan listesinden fazlasını da
  doldurabilir.
- **Hassas alanları entity'de tutuyorsan**, response modelinde karşılıklarını açıkça yaz ve
  eşlemediğini doğrula. Yoksa çıktı sözleşmesi "henüz yazılmadı" demektir.

## Don't

- **Entity'yi response olarak döndürme.** EF Core navigation property'lerini otomatik fix-up
  eder, nesne grafiğinde döngü oluşur
  ([EF Core](https://learn.microsoft.com/en-us/ef/core/querying/related-data/serialization)):
  > Because EF Core automatically does fix-up of navigation properties, you can end up with
  > cycles in your object graph.
  `ReferenceHandler.IgnoreCycles` bu döngüyü susturur, sızan alanı değil.
- **`[JsonIgnore]` ile alan gizlemeyi sözleşme sayma.** Gizlenen alan cevaptan düşer, tipte
  durur. `isAdmin` bir sonraki endpoint'te tekrar görünür.
- **Tek bir çıktı tipini tüm endpoint'lerde kullanma.** "UserResponse her yerde çalışıyor"
  genellikle hiçbir endpoint'in ihtiyacını karşılamıyorsa duyulan bir kolaylıktır.
- **DTO'nun alan sayısını güvenlik ölçütü yapma.** Beş alanlı bir DTO, entity'nin beş
  hassas alanını taşıyan bir DTO'dan daha güvenli değildir.

## Kod örneği

```csharp
// Don't: entity bir HTTP sınırında — sözleşme tanımlanmamış
[HttpGet("{id}")]
public async Task<User> Get(Guid id, CancellationToken ct)
    => await db.Users.Include(u => u.Orders).FirstOrDefaultAsync(u => u.Id == id, ct);

// Do: sözleşme açıkça tanımlı; dahili alanlar dışarıda
public sealed record UserResponse(string Id, string UserName, string Email);

[HttpGet("{id}")]
public async Task<UserResponse> Get(Guid id, CancellationToken ct)
{
    var user = await db.Users.AsNoTracking()
        .FirstOrDefaultAsync(u => u.Id == id, ct)
        ?? throw new NotFoundException();
    return new UserResponse(user.Id, user.UserName, user.Email);
}
```

`AsNoTracking` de burada bir güvenlik kararıdır: entity döndürmüyorsanız değişiklik izleme
yine de ek yük demektir; döngü sorunu ve gereksiz izleme aynı kökten gelir.

## Failure modes

| Belirti | Neden | Çözüm |
|---|---|---|
| `Self referencing loop detected` | Entity serialize ediliyor | Response modeline map et |
| `JsonIgnore` eklendi, alan başka endpoint'te görünüyor | Gizleme tipten çıkmadı | Ayrı çıktı tipi |
| Response beklenmedik alan içeriyor | `Include` zinciri sözleşmeyi genişletmiş | Açık projection kullan |
| Yeni endpoint sızıntı yaratıyor | Entity tipi yeniden HTTP'ye taşındı | Tipin boundary'de olmadığını gözden geçir |

## Doğrulama

```bash
# Entity tipleri bir HTTP sınırında görünüyor mu?
grep -rn "Task<[A-Z][A-Za-z]*\( \|>\)\(Get\|Create\|Update\|Delete\)(" --include=*.cs .
```

Eşleşme, o endpoint'te sözleşmenin yazılmadığını gösterir. `Rules/ARCH-006` ile birlikte
okunmalı — biri binding'i, bu ikisi çıktıyı tanımlar.