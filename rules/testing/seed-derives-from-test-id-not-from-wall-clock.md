---
title: "Seed Derives from Test ID, Not from Wall Clock"
rule_id: "RULE-TESTING-002"
category: "correctness"
scope: "all"
applies_to: "Test frameworks, random seed management, flaky test mitigation tools"
last_updated: "2026-10-04"
source: "https://github.com/pytest-dev/pytest-randomly"
---

# Seed Derives from Test ID, Not from Wall Clock
## 2. Seed Test ID'sinden Türetilir, Duvardan Değil — ve Quarantine Kalıcı Bir Durum Değildir

### Core Concept & Paradigm Shift

"Her testi deterministik yap" kuralının sezgisel uygulaması her teste `seed(...)` koymaktır. Bu
çalışır ama **gözetim** ister: yeni yazilan her test unutur, ve unutulan test sessizce flake olur.

pytest-randomly bunu tersine cevirir: seed testin içine yazılmaz, **çalışma anında base seed + test
ID'sinden turetilir**. Yani reproducibility koda degil, koşullara baglanir — ve hicbir test
kendisini seed'leyi unutamaz, cunku seed'leyen sey test yazimi degil koşudur.

### Evidence

> The fixed value is derived from the base random seed, the pytest test ID, and an offset for setup or teardown. This ensures each test gets a different but repeatable random seed.
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> The base random seed is printed at the start of the test run, and can be passed in to repeat a failure caused by test ordering or random data.
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> By resetting the random seed to a repeatable number for each test, tests can create data based on random numbers and yet remain repeatable
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> This is good for ensuring that tests specify the data they need and that the tested system is not affected by any data that is filled in randomly due to not being specified.
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> Randomly shuffles the order of test items. This is done first at the level of modules, then at the level of test classes (if you have them), then at the order of functions.
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> Or more conveniently, use the special value last
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

> (This only works if pytest's cacheprovider plugin has not been disabled.)
> ([pytest-randomly](https://github.com/pytest-dev/pytest-randomly))

### Why It Matters

Depo neredeyse deterministik olur ama tam degil — siralama hala rastgele, ki bu **bagimlilik
teshisini** mumkun kilar. Iki ayri sey tek knob ile cozuluyor: ayni veri (tekrar uretilebilir) ve
farkli siralama (bagimlilik yakalanir). Elle seed koymak bu ikisinden yalnizca birini alir.

Uyari: bu bir plugin'in kendi tasarim tercihidir, pytest'in spesifikasyon gerekliligi degil. Kurul
degilse hicbir sey saglamaz.

### Counter-Arguments Considered

*"Shuffle surekli acik kalirsa surekli kirmizidir"* — dogru, ve plugin'in kendi cevabi seed'i
raporlamak: basarisizlik aninda hangi tohumun hangi testi kirlirdigi okunur. Quarantine'nin kalici
kullanilmasi ise ayrica bir tuzak:

> This could be considered like a manual quarantine, and is rather dangerous to use permanently
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

### Source Attribution

- Source: https://github.com/pytest-dev/pytest-randomly
- Source: https://docs.pytest.org/en/stable/explanation/flaky.html