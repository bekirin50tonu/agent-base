---
title: "Atomic Design Methodology"
category: "design-systems"
applies_to: "Any React or component-based frontend building a UI component hierarchy"
last_updated: "2026-09-30"
source: "https://bradfrost.com/blog/post/atomic-web-design/"
---

# Atomic Design Methodology

A reference for the Atomic Design methodology introduced by Brad Frost: a five-stage model for building UI component hierarchies from smallest to largest, where each level is composed from the level below.

## When to Use

- The target project builds any UI component hierarchy — a design system, a component library, or a feature built from components.
- A review proposes adding a new component and the question is which level it belongs to, or whether it duplicates one that exists.
- A component tree has grown so tangled that "which component owns this markup" has stopped being answerable.

## Usage Example

The five stages, smallest to largest:

1. **Atoms** — the basic building blocks: HTML tags like `<label>`, `<input>`, `<button>`, or abstract elements like color tokens and fonts. An atom is not further decomposable within the system.
2. **Molecules** — groups of atoms bonded together, the smallest units that do something: a search form (label + input + button), a navigation item.
3. **Organisms** — groups of molecules forming a distinct, relatively complex interface section: header, product grid, modal dialog.
4. **Templates** — page-level objects that place components into a layout and articulate the design's underlying content structure; they focus on structure, not final content.
5. **Pages** — specific instances of templates with real representative content in place; the highest-fidelity stage, and where the system is tested.

Building a user-management feature looks like:

1. Define atoms (input, button, label) in the design system.
2. Combine them into molecules (form fields, action buttons).
3. Create organisms (user profile card, user list item).
4. Assemble templates (user profile page, user management dashboard).
5. Fill templates into pages with real content.

## Caveats

- The five stages are a *thinking tool* for placement decisions, not a rule that every codebase must have five directory levels named after them. Mapping the taxonomy onto folder structure verbatim tends to produce ceremony without better placement decisions.
- Not every component fits exactly one stage, and Frost's own writing says so. When a component argues with the taxonomy, the taxonomy loses.
- This file covers only the frontend methodology. GoF design patterns, backend architecture patterns, and anti-patterns live under the backend-architecture hub — do not consult this file for those.
