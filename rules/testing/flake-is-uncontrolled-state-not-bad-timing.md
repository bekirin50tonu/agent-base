---
title: "Flake Is Uncontrolled State, Not a Timing Error"
rule_id: "RULE-TESTING-001"
category: "correctness"
scope: "all"
applies_to: "Test suites, test frameworks, CI systems, flaky test detection tools"
last_updated: "2026-10-04"
source: "https://docs.pytest.org/en/stable/explanation/flaky.html"
---

# Flake Is Uncontrolled State, Not a Timing Error
## 1. Flake Kontrol Edilmeyen State'tir, Zamanlama Hatası Değil

### Core Concept & Paradigm Shift

Flaky test tanımı, çoğu ekosistemin dokümanında bir *belirti* listesi olarak değil, bir **neden**
cümlesi olarak verilir. pytest bunu en açık ifade ediyor: bir testin flake olması, kontrol altında
olmayan bir sistem durumuna dayandığı anlamına gelir. Zamanlama bunun yalnızca bir alt türüdür — ve
tam da bu yüzden "testi biraz daha yavaşlat" çözümü yanlış yere gider.

### Evidence

> a flaky test indicates that the test relies on some system state that is not being appropriately controlled
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

> tests that modify global state typically cannot be run in parallel
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

> pytest is single-threaded, executing its tests always in the same thread, sequentially, never spawning any threads itself
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

> Avoid using primitives provided by pytest (pytest.warns(), pytest.raises(), etc) from multiple threads, as they are not thread-safe
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

> Overly strict assertions can cause problems with floating point comparison as well as timing issues
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

### Why It Matters

Üç ayrı bağımlılık kaynağı var ve üçü de sessiz: **global state**, **zamanlayıcılar**, **assertion
genişliği**. Üçüncüsü en sinsi — `assert elapsed > 0` gibi bir assertion başarısız olduğunda hata
"zamanlama" der, ama kök neden testin kendi state'ini izole etmemiş olmasıdır.

### Counter-Arguments Considered

*"Sadece yavaslatarak cozulur"* — Go'nun kendi blogu bunu acikca reddediyor, ve reddedilmekte hakli:
cift yonlu bir trade-off var, tek yonlu bir cözum degil.

> Tests that use real time are always slow or flaky. Usually they’re both. If the test waits longer than necessary, it is slow. If it doesn’t wait long enough, it is flaky. You can make the test more slow and less flaky, or less slow and more flaky, but you can’t make it fast and reliable.
> ([Testing Time (and other asynchronicities)](https://go.dev/blog/testing-time))

Quarantine de cozum degil, sadece etiket:

> This could be considered like a manual quarantine, and is rather dangerous to use permanently
> ([Flaky pytest and @flaky](https://docs.pytest.org/en/stable/explanation/flaky.html))

### Source Attribution

- Source: https://docs.pytest.org/en/stable/explanation/flaky.html
- Source: https://go.dev/blog/testing-time