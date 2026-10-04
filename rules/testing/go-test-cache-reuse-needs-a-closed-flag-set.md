---
title: "Go Test Cache Reuses PASS Results Only Outside a Closed Flag Set"
rule_id: "RULE-TESTING-003"
category: "performance"
scope: "all"
applies_to: "Go test suites, CI systems, benchmarking tools, test caching mechanisms"
last_updated: "2026-10-04"
source: "https://pkg.go.dev/cmd/go"
---

# Go Test Cache Reuses PASS Results Only Outside a Closed Flag Set
## 3. `go test` Cache'i PASS'i Yalnızca Kapalı Bir Bayrak Seti Dışında Yeniden Kullanır

### Core Concept & Paradigm Shift

Determinizm kurali cogu yerde "testin deterministik olmasi" olarak yazilir. Go'nun belgeleri bunu
**hic** soylemez — "deterministic" kelimesi cache tartismasinda gecimez. Buna karsilik cache'in
giris kurali çok daha keskin ve **sayisallaştirilabilir** bir sey: ayni test binary'si + yalnizca
kapali bir listedeki bayraklar.

Bu, kurali bir niyetten bir *protokole* cevirir: "testin deterministik mi oldugunu bilmiyoruz, ama
bu bayraklardan biri degisse sonucu tekrar hesaplariz."

### Evidence

> In package list mode only, go test caches successful package test results to avoid unnecessary repeated running of tests. When the result of a test can be recovered from the cache, go test will redisplay the previous output instead of running the test binary again. When this happens, go test prints '(cached)' in place of the elapsed time in the summary line.
> ([go command - cmd/go](https://pkg.go.dev/cmd/go))

> The rule for a match in the cache is that the run involves the same test binary and the flags on the command line come entirely from a restricted set of 'cacheable' test flags, defined as -benchtime, -coverprofile, -cpu, -failfast, -fullpath, -list, -outputdir, -parallel, -run, -short, -skip, -timeout and -v. If a run of go test has any test or non-test flags outside this set, the result is not cached. To disable test caching, use any test flag or argument other than the cacheable flags. The idiomatic way to disable test caching explicitly is to use -count=1. Tests that open files within the package's module or that consult environment variables only match future runs in which the files and environment variables are unchanged. A cached test result is treated as executing in no time at all, so a successful package test result will be cached and reused regardless of -timeout setting.
> ([go command - cmd/go](https://pkg.go.dev/cmd/go))

> Randomize the execution order of tests and benchmarks.
> It is off by default. If -shuffle is set to on, then it will seed the randomizer using the system clock. If -shuffle is set to an integer N, then N will be used as the seed value. In both cases, the seed will be reported for reproducibility.
> ([go command - cmd/go](https://pkg.go.dev/cmd/go))

> Run each test, benchmark, and fuzz seed n times (default 1).
> If -cpu is set, run n times for each GOMAXPROCS value.
> Examples are always run once. -count does not apply to fuzz tests matched by -fuzz.
> ([go command - cmd/go](https://pkg.go.dev/cmd/go))

### Why It Matters

Kritik cift yonlu ifade: **"Tests that open files within the package's module or that consult
environment variables only match future runs in which the files and environment variables are
unchanged."** Yani Go kendi girdilerini kismen sayiyor — ama bu girdilerin *tam listesi* yok. Bu
yuzden kural "Go deterministik testi cache'ler" degil, "Go yalnizca bayrak degismediginde cache'ler"
olmalidir. Ikincisi dogrulanabilir; birincisi iddia.

Ayrica: `Setenv` paralel testte kullanilamaz, ve bu tek bir cümleyle yasaklaniyor — fixture izolasyonu
burada bir stil tercihi degil, bir API kisiti.

### Counter-Arguments Considered

Testin ortam degiskeni okudugunu biliyorsunuz, o zaman manuel olarak kapatilir — ama **kapatilan
sey sonucu degil, guveni kaldirir**. `-count=1` her zaman calisir, bedeli test suresi.

### Source Attribution

- Source: https://pkg.go.dev/cmd/go