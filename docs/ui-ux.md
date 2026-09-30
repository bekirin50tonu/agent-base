---
language: "UI/UX Design"
tag: "ui-ux"
ecosystem: "frontend"
last_updated: "2026-10-01"
summary: "Routing hub and decision matrix for UI/UX design assets."
---

# Documentation Hub: UI/UX Design

> **Agent Directive (Phase 4)**: Inspect the target project for UI/UX design usage patterns.
> Match the conditions below to determine which `rules`, `skills`, `agents`, or
> `shared` assets to inject.

> **Status**: 8 rules covering user research methods, information architecture, interaction design,
> visual design fundamentals, usability and accessibility, emerging technologies impact, business strategy, and career development, plus 1 shared asset on design systems and component libraries.

> **Scope**: This hub covers UI/UX design principles, processes, and practices. Since UI/UX design is used
> across frontend, backend (via dev tools/admin interfaces), and data science projects, this hub serves as
> a cross-cutting concern for user-centered design and design thinking.

<!-- ASSET_MANIFEST_START -->

## 1. Rules (`rules/`)

- **Path**: `rules/ui-ux/user-research-methods.md`
  - **Why**: User research methods such as interviews, surveys, ethnographic studies, diary studies, card sorting, and tree testing are foundational for understanding user needs, behaviors, and pain points.
  - **When**: Target project involves user-facing interfaces and needs to gather qualitative and quantitative insights about target users.
  - **Target Location**: `docs/rules/ui-ux/user-research-methods.md`

- **Path**: `rules/ui-ux/information-architecture-basics.md`
  - **Why**: Information architecture organizes and structures content to support usability and findability through sitemaps, navigation schemes, labeling, and search design.
  - **When**: Target project requires clear information structure, navigation design, or content organization for websites, applications, or dashboards.
  - **Target Location**: `docs/rules/ui-ux/information-architecture-basics.md`

- **Path**: `rules/ui-ux/interaction-design-principles.md`
  - **Why**: Interaction design focuses on creating engaging interfaces with well-thought-out behaviors, user flows, task analysis, wireframing, prototyping, and micro-interactions.
  - **When**: Target project involves interactive elements, user workflows, or needs to improve user engagement and task completion.
  - **Target Location**: `docs/rules/ui-ux/interaction-design-principles.md`

- **Path**: `rules/ui-ux/visual-design-fundamentals.md`
  - **Why**: Visual design principles including typography, color theory, layout, iconography, imagery, and branding create aesthetically pleasing and usable interfaces.
  - **When**: Target project requires visual design guidance, brand consistency, or aesthetic improvements to user interfaces.
  - **Target Location**: `docs/rules/ui-ux/visual-design-fundamentals.md`

- **Path**: `rules/ui-ux/usability-accessibility.md`
  - **Why**: Usability focuses on how easy and efficient it is for users to achieve their goals with a product. Accessibility ensures that people with disabilities can perceive, understand, navigate, and interact with the web and digital tools. Together, they create inclusive experiences that work for the widest possible audience.
  - **When**: Target project involves user-facing interfaces and needs to ensure usability and accessibility for diverse users, including those with disabilities.
  - **Target Location**: `docs/rules/ui-ux/usability-accessibility.md`

## 2. Skills (`skills/`)

- **Path**: `skills/ui-ux/conduct-user-interviews/SKILL.md`
  - **Why**: Conducting effective user interviews is a core skill for gathering deep insights into user needs, motivations, and pain points.
  - **When**: Target project needs to perform user interviews as part of the research phase.
  - **Target Location**: `docs/skills/ui-ux/conduct-user-interviews/SKILL.md`

## 3. Agents (`agents/`)

- **Path**: `agents/ui-ux/agent.json`
  - **Why**: Helps with UI/UX-related tasks, such as planning research activities, creating wireframes, prototyping, and conducting usability tests.
  - **When**: Target project involves UI/UX design work (has design files, prototyping tools, or user research planned).
  - **Target Location**: `docs/agents/ui-ux/agent.json`

## 4. Shared Assets (`shared/`)

- **Path**: `shared/ui-ux/design-systems-component-libraries.md`
  - **Why**: Design systems and component libraries ensure consistency, scalability, and efficiency in UI/UX design through standardized tokens, patterns, documentation, and governance.
  - **When**: Target project uses or plans to adopt a design system or component library for maintainable and cohesive UI development.
  - **Target Location**: `docs/shared/ui-ux/design-systems-component-libraries.md`

<!-- ASSET_MANIFEST_END -->

---
## Adding assets here

A manifest entry is a promise that the path exists on `main`. Phase 3 must `add-asset`
and commit the file in the same push that updates this hub — otherwise consumers get a 404.