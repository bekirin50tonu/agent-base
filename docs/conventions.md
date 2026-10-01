---
language: "Code & Naming Conventions"
tag: "conventions"
ecosystem: "agnostic"
last_updated: "2026-10-01"
summary: "Cross-cutting hub for naming, identifier charset, and data-key rules that apply to every language."
---

# Documentation Hub: Code & Naming Conventions

> **Agent Directive (Phase 4)**: This hub is **cross-cutting** and the most language-agnostic
> in the repository — evaluate it for **any** target project, in addition to whichever language
> hub the project resolves to. There is no dependency to match on; if a repository contains
> source files, this hub applies. Judge its entries individually: a project can need the
> identifier rules and not the data-key ones.
>
> **Triggers**: any project with source files at all. The specific rules narrow — the
> identifier-charset rule triggers on non-ASCII characters found in an identifier, and the
> data-key rule triggers on a JSON/OpenAPI surface, a cross-service payload, or a config file
> read by more than one component.
>
> **Status**: one shared asset. It is deliberately a **shared** asset rather than a rule
> because most of it is a project-level policy with a documented exception clause, not a
> correctness constraint — the asset's job is to state what the standards actually require so
> a project can decide its own policy knowingly, rather than to impose one silently.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

_Empty — naming policy is a project-level decision; the shared asset below exists so the
decision is made with the standards in view._

## 2. Skills (`skills/`)

_Empty._

## 3. Agents (`agents/`)

_Empty._

## 4. Shared Assets (`shared/`)

- **Path**: `shared/conventions/naming-and-identifiers.md`
  - **Why**: The common house rule — "identifiers and dict keys must be English" — is usually
    enforced for the wrong reason and relaxes for the wrong one, and the asset shows why by
    reading the primary sources against each other. **PEP 8** states ASCII + English as project
    policy with an explicit escape clause ("wherever feasible … abbreviations and technical
    terms are used which aren't English"). **Rust** allows `Москва` and `東京` as valid
    identifiers, restricting ASCII only to ABI-facing surfaces — `extern crate`, filesystem
    module names, `#[no_mangle]` — which is a real restriction with a real reason. **.NET's
    CLS Rule 10** goes the other way entirely and requires *NFC normalization*, not ASCII:
    composed `café` (U+00E9) and decomposed `café` (`e`+U+0301) are two distinct identifiers to
    a compiler and one name to a reader, which is the defect worth catching. **JSON:API**
    supplies the data-key rules and, unusually, the reason for them — standardization matters
    "when mixing profiles authored by different parties", which is the interop argument, not
    an English-language one. The asset separates the three constraints (ASCII / NFC / English)
    that are routinely conflated, and has a dedicated section on **homoglyph** attacks so the
    Trojan Source literature — which is about visually identical cross-script characters, not
    about non-English identifiers — does not get cited as justification for a rule it does not
    support.
  - **When**: Target project contains a non-ASCII character in an identifier, a symbol, a JSON
    key, a config key, or a database column; or a cross-service/JSON contract has key-casing
    drift between producer and consumer; or a team is writing a naming policy and wants to know
    which parts are non-negotiable and which are preference.
  - **Target Location**: `docs/conventions/naming-and-identifiers.md`

<!-- ASSET_MANIFEST_END -->

---

## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must commit the file in the
same push that updates this hub — otherwise consumers get a 404. Run `node scripts/check-manifests.mjs`.
