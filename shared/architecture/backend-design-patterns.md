---
title: "Design Patterns and Anti-Patterns Library"
category: "architecture"
applies_to: "Any backend project choosing between patterns or reviewing a pattern proposal"
last_updated: "2026-09-30"
source: "https://refactoring.guru/design-patterns, https://sourcemaking.com/design_patterns"
---

# Design Patterns and Anti-Patterns Library

A reference catalogue of the Gang of Four patterns, the anti-patterns that show up in real
codebases, and per-stack considerations. This is a **reference to consult**, not a constraint —
a pattern is worth using when the situation calls for one, and adopting one because it is
available is the Golden Hammer anti-pattern listed below.

## When to Use

- A review proposes a design pattern and the question is whether it fits the situation.
- Code is being diagnosed and a named anti-pattern is suspected (God Object, Anemic Domain
  Model, Inner-Platform Effect).
- A new service or library is being designed and the pattern choice is being made explicitly.

## Usage Example

### Creational Patterns

- **Singleton** — Ensure a class has only one instance and provide a global point of access.
- **Factory Method** — Define an interface for creating an object; let subclasses decide which
  class to instantiate.
- **Abstract Factory** — Provide an interface for creating families of related objects without
  specifying their concrete classes.
- **Builder** — Separate the construction of a complex object from its representation.
- **Prototype** — Create new objects by copying an existing prototype instance.

### Structural Patterns

- **Adapter** — Convert the interface of a class into another interface clients expect.
- **Bridge** — Decouple an abstraction from its implementation so the two vary independently.
- **Composite** — Compose objects into tree structures to represent part-whole hierarchies.
- **Decorator** — Attach additional responsibilities to an object dynamically.
- **Facade** — Provide a unified interface to a set of interfaces in a subsystem.
- **Flyweight** — Use sharing to support large numbers of fine-grained objects efficiently.
- **Proxy** — Provide a surrogate or placeholder for another object to control access.

### Behavioral Patterns

- **Chain of Responsibility** — Pass a request along a chain of handlers.
- **Command** — Encapsulate a request as an object, allowing parameterization with queues and
  operations.
- **Interpreter** — Given a language, define a representation for its grammar with an
  interpreter.
- **Iterator** — Access elements of an aggregate sequentially without exposing its underlying
  representation.
- **Mediator** — Define an object that encapsulates how a set of objects interact.
- **Memento** — Capture and externalize an object's internal state so it can be restored later.
- **Observer** — Define a one-to-many dependency so dependents are notified when state changes.
- **State** — Allow an object to alter its behavior when its internal state changes.
- **Strategy** — Define a family of algorithms, encapsulate each, make them interchangeable.
- **Template Method** — Define the skeleton of an algorithm, deferring some steps to subclasses.
- **Visitor** — Represent an operation to be performed on the elements of an object structure.

### Architectural Anti-Patterns

- **God Object** — A class that knows too much or does too much.
- **Spaghetti Code** — Code with complex, tangled control structure.
- **Golden Hammer** — Assuming a favorite solution is universally applicable.
- **Big Ball of Mud** — A system with no recognizable architecture.
- **Stovepipe System** — Components tightly coupled with no reusability.
- **Vendor Lock-in** — Over-dependence on proprietary technologies that hinder migration.

### Design Anti-Patterns

- **Anemic Domain Model** — Domain models with no business logic, only getters/setters.
- **Magic Numbers/String Literals** — Unexplained numeric or string values in code.
- **Hardcoded Values** — Environment-specific values embedded directly in source.
- **Copy-Paste Programming** — Duplicating code instead of abstracting reusable components.
- **Premature Optimization** — Optimizing before identifying actual bottlenecks.
- **Inner-platform Effect** — A system so customizable it becomes a poor replica of the
  platform it is built upon.

### Code Smells

- **Duplicated Code** — Identical or very similar code in multiple places.
- **Long Method** — Methods that try to do too much.
- **Large Class** — Classes with too many responsibilities.
- **Feature Envy** — A method that uses another class's data more than its own.
- **Data Clumps** — Groups of variables that frequently appear together.
- **Primitive Obsession** — Overuse of primitives instead of small objects.
- **Switch Statements** — Long switches that could be polymorphism.
- **Temporary Field** — Fields only set under certain conditions.
- **Refused Bequest** — A subclass that does not use its superclass's methods or data.

### Stack-Specific Considerations

**.NET**
- Prefer composition over inheritance; use interfaces for abstraction.
- Leverage dependency injection containers.
- Consider records for immutable data transfer objects.
- Use MediatR for CQRS to avoid anti-patterns in service layers.

**Go**
- Favor clear, simple structs over complex inheritance hierarchies.
- Use interfaces for polymorphism; avoid global state.
- Embrace the standard library before adding dependencies.
- Use context propagation for cancellation and timeouts.

**Laravel**
- Use service classes and repositories to keep controllers thin.
- Leverage Eloquent relationships instead of manual joins.
- Use form requests for validation instead of rules in controllers.
- Use events and listeners for decoupling side effects.
- Avoid business logic in Blade templates.

**Python**
- Use dataclasses or Pydantic models for data structures.
- Prefer composition over inheritance.
- Use async/await appropriately for I/O-bound operations.
- Leverage dependency injection containers for complex applications.

## Caveats

- **A pattern is not a default.** The library's own Golden Hammer entry is the warning: a
  pattern applied where it does not fit is worse than no pattern at all.
- **Catalogue, not prescription.** GoF patterns describe known shapes; they do not tell you
  which one your situation calls for. That judgment is yours.
- **Modern alternatives exist for some entries.** Several classic patterns have cheaper
  replacements in current language features — iterators and closures often displace Visitor and
  Command, and dependency injection containers have absorbed parts of Abstract Factory's
  motivation. Check before reaching for the classic.
- **Not a substitute for the architecture rules.** This library names patterns; the
  architecture hub's rules constrain when to adopt them and when to split a service.