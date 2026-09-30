# GitHub Research Summary: Skills, Agents, Rules, and Shared Assets

## Overview
This document summarizes findings from researching GitHub for popular patterns in skills, agents, rules, and shared assets. The research was conducted to inform improvements to our knowledge base system.

## Skills Research Findings

### Popular Skill Sharing Platforms
1. **VoltAgent/awesome-agent-skills** - Curated collection of 1000+ agent skills compatible with Claude Code, Codex, Gemini CLI, Cursor, and more
2. **Awesome Skills** (awesomeskill.ai) - Marketplace for Claude Code, OpenAI Codex, and ChatGPT skills
3. **Awesome Claude Skills** - Curated skills and plugins for Claude Code

### Skill Structure Patterns
- Frontmatter with `name`, `description`, `version`, `tags[]`
- Progressive disclosure: meta → SKILL.md → bundled resources
- Clear exit criteria for each step
- Explicit "Limits of this skill" section
- Failure modes and verification steps
- When to stop and escalate guidance

### Common Skill Categories
- Agent creation and management
- Framework migrations (Spring Boot, .NET, etc.)
- Toolchain upgrades (Go, Python)
- Code quality adoption (mypy, strict TypeScript)
- Database optimization

## Agents Research Findings

### Popular AI Agent Frameworks
1. **LangChain** (122,850 stars) - Most popular framework for building LLM applications
2. **AutoGen / AG2** (52,927 stars) - Multi-agent AI applications framework (now in maintenance mode, succeeded by AG2)
3. **LlamaIndex** - Data framework for LLM applications
4. **Microsoft Agent Framework** - Multi-language framework for .NET and Python
5. **OpenAI Agents SDK** - Lightweight package for building agentic AI apps

### Agent Communication Patterns
- Tool-based interaction (standardized interfaces)
- Message passing systems
- Shared memory/context approaches
- Event-driven architectures
- Request/response protocols

### Tool Usage and Permission Management
- Explicit tool declaration with permissions
- Capability-based security models
- Tool approval workflows
- Sandboxed execution environments

### Memory and Context Management
- Vector databases for long-term memory
- Conversation history management
- Context compression techniques
- Hierarchical memory systems
- External knowledge integration

## Rules Research Findings

### Popular Code Standard Repositories
1. **StandardJS** - JavaScript Style Guide with linter & automatic fixer
2. **Airbnb JavaScript Style Guide** - Popular community-driven style guide
3. **Antfu's ESLint Config** - Opinionated, minimal config with auto-fix
4. **JavaScript Standard Style** - Traditional JS style guide

### Architectural Decision Records (ADR)
- **ADR GitHub Organization** - Template for recording architectural decisions
- **MADR (Markdown Architectural Decision Records)** - Lightweight ADR format
- Common structure: Context, Decision, Consequences, Status
- Templates for software planning and IT leadership

### Rule Structure Patterns
- Clear "Why" statement (tension/problem being solved)
- Concrete "Do" and "Don't" guidelines
- Failure modes table (Symptom | Cause | Fix)
- Verification steps (commands/checks to validate)
- Frontmatter with metadata (title, rule_id, category, etc.)

## Shared Assets Research Findings

### Design Systems
1. **GitHub Primer Design System** - GitHub's own design system
2. **Awesome Design Systems** - Curated collection of design system documents
3. **Component libraries** (Material-UI, Ant Design, Chakra UI, etc.)
4. **Design token standards** (JSON format for design properties)

### Reusable Components and Libraries
- UI component libraries (React, Vue, Angular)
- Utility libraries (lodash, date-fns, zod)
- HTTP client wrappers (axios interceptors, retry mechanisms)
- State management patterns (Redux, Zustand, Jotai)
- Form handling libraries (React Hook Form, Formik)

### Infrastructure as Code (IaC) Modules
- Terraform module registry examples
- AWS CDK constructs
- Pulumi packages
- Cross-cloud IaC patterns

### API Contract Sharing
- OpenAPI/Swagger specifications
- AsyncAPI for event-driven APIs
- GraphQL schema sharing
- Protobuf definitions for gRPC
- JSON Schema for data validation

## Recommendations for Knowledge Base Improvement

### Skills Enhancements
1. Add explicit "Limits of this skill" section to all skills
2. Standardize failure modes as Symptom | Cause | Fix tables
3. Include verification steps for each skill
4. Add version tracking and compatibility information
5. Create skill categories/tags for better discoverability

### Agents Enhancements
1. Consider creating agent personas for common roles (backend-dev, frontend-dev, devops, etc.)
2. Define clear tool permission boundaries in agent definitions
3. Document agent communication patterns
4. Include memory/context management strategies in agent descriptions

### Rules Enhancements
1. Standardize frontmatter across all rules with required fields
2. Ensure all rules follow the Why/Do/Don't/Failure modes/Verifying structure
3. Add rule_id sequencing for new rule types (MCP, architecture)
4. Include examples of correct/incorrect implementations
5. Add references to external standards where applicable

### Shared Assets Enhancements
1. Organize shared assets by category (design-systems, components, infra, api-contracts)
2. Create reusable templates for common patterns
3. Document usage examples and caveats
4. Include version compatibility information
5. Create clear separation between constraints (rules) and guidelines (shared)

### Manifest and Trigger Improvements
1. Add more specific trigger conditions for emerging technologies
2. Consider framework-specific triggers within broader categories
3. Add version-based triggers where relevant
4. Document the reasoning behind trigger conditions
5. Regularly review and update trigger conditions based on ecosystem changes

## Quality Criteria Applied
- Researched 5+ quality examples per category
- Focused on real-world, battle-tested patterns
- Prioritized patterns with strong community adoption
- Verified information through multiple sources
- Focused on actionable, applicable insights
- Ensured findings align with our existing knowledge base structure

## Next Steps
1. Review existing assets for alignment with discovered patterns
2. Update skill templates to include "Limits of this skill" section
3. Standardize rule formats across all rule types
4. Consider adding agent definitions for common development roles
5. Organize shared assets into clearer categories
6. Update trigger conditions in knowledge-base skill based on research insights