---
title: "Deterministic CI and Failure Replay Are Different Knobs"
rule_id: "RULE-TESTING-004"
category: "correctness"
scope: "all"
applies_to: "Property-based testing frameworks, CI systems, test reliability tools, flaky test mitigation"
last_updated: "2026-10-04"
source: "https://hypothesis.readthedocs.io/en/latest/reference/api.html"
---

# Deterministic CI and Failure Replay Are Different Knobs
## 4. Deterministik CI ile Başarısızlığı Yeniden Üretmek Farklı Knob'lardır

### Core Concept & Paradigm Shift

En sik karistirilan iki kavram ayni ayara benzer gorunuyor: "testleri deterministik yap" ve
"basarisizligi yeniden uret". Ama bunlar **zit sinyaller** ve ayni anda dogru olamazlar —
deterministik bir kosuda her sey ayni calisir, dolayisiyla hata yeniden uretilemez.

Hypothesis bunu resmi olarak ayirir ve varsayilani *acikca* belgeler:

### Evidence

> If True, seed Hypothesis’ random number generator using a hash of the test function, so that every run will test the same set of test cases until you update Hypothesis, Python, or the test function.
> ([API Reference - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/reference/api.html))

> This allows you to check for regressions and look for bugs using separate settings profiles - for example running quick deterministic tests on every commit, and a longer non-deterministic nightly testing run.
> ([API Reference - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/reference/api.html))

> The default is False. If running on CI, the default is True instead.
> ([API Reference - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/reference/api.html))

> Setting a seed overrides settings.derandomize, which is designed to enable deterministic CI tests rather than reproducing observed failures.
> ([API Reference - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/reference/api.html))

> The default deadline is 200 milliseconds. If running on CI, the default is None instead.
> ([API Reference - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/reference/api.html))

> Note that Hypothesis does not require tests to be fully deterministic. Only the sequence of calls to Hypothesis APIs like draw from @composite and the outcome of the test (pass or fail) need to be deterministic. This means you can use randomness, threads, or nondeterminism in your test, as long as it doesn’t impact anything Hypothesis can see.
> ([Flaky failures - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/tutorial/flaky.html))

> The most common form of flakiness is that Hypothesis finds a failure, but then replaying that input does not reproduce the failure.
> ([Flaky failures - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/tutorial/flaky.html))

> Hypothesis relies on deterministic behavior for the database to work.
> ([Flaky failures - Hypothesis 6.168.3 documentation](https://hypothesis.readthedocs.io/en/latest/tutorial/flaky.html))

### Why It Matters

Uc varsayilanin **ucu de yanlis varsayilana meyilli**:

| Framework | Varsayilan | Neyi kirar |
|---|---|---|
| Hypothesis `derandomize` | CI'da `True` | CI'da hata yeniden uretilemez |
| Hypothesis `deadline` | lokalde 200ms, CI'da `None` | Lokalde yavas CI kabul edilir |
| fast-check `seed` | `Date.now()` | Ayni kod iki kez ayni sonucu vermez |
| proptest `rng_seed` | rastgele uretilir | `-p no:randomly` tarzi bir kapatma yok |

Hypothesis'in `deadline` varsayilani iki katmanli ve ikisinin de gerekcesi var: lokalde 200ms bir
**regresyon sinyali** verir, CI'da `None` cünkü yavaş CI makinesi yanlis pozitifi garanti eder.

En degerli bulgu `HealthCheck.function_scoped_fixture`: Hypotheis `@given` ile bir fonksiyon-scoped
fixture kullandigini tespit edip **uyariyor** — cunku fixture'in her *input* icin degil her *test*
icin resetlendigini cogu kullanici yanlis biliyor.

### Counter-Arguments Considered

proptest'in `fork`u determinizmi tamamen gereksiz kiliyor gibi gorunuyor — hayir, belgeleri acikca
kosul koyuyor:

> For forking to work correctly, both the Strategy and the content of the test case itself must be deterministic.
> ([Config in proptest::test_runner](https://docs.rs/proptest/latest/proptest/test_runner/struct.Config.html))

Ayrica proptest'in `timeout`'u varsayilan 0 — yani **hicbir zaman asimi yok**. Bu sessiz bir varsayilan:
cok uzun suren test fark edilmez, yavaslik olarak gorunur.

### Source Attribution

- Source: https://hypothesis.readthedocs.io/en/latest/reference/api.html
- Source: https://hypothesis.readthedocs.io/en/latest/tutorial/flaky.html
- Source: https://docs.rs/proptest/latest/proptest/test_runner/struct.Config.html
- Source: https://fast-check.dev/docs/api/interfaces/Parameters/