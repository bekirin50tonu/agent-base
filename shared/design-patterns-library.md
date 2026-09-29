# Design Patterns & Atomic Design Library

This document serves as a reference library for common design patterns, atomic design methodology, and anti-patterns to avoid. Use it as a guide when architecting applications across different stacks.

## Atomic Design Methodology

Atomic Design is a methodology for creating design systems introduced by Brad Frost. It breaks down interfaces into fundamental building blocks and builds up from there.

### The Five Stages

1. **Atoms** - The basic building blocks of matter. In UI, atoms are HTML tags like `<label>`, `<input>`, `<button>`, or abstract elements like color palettes, fonts, and animations.

2. **Molecules** - Groups of atoms bonded together and are the smallest fundamental units of a compound. Molecules take on their own properties and serve as the backbone of a design system. Examples: a search form (label + input + button), a navigation item.

3. **Organisms** - Groups of molecules joined together to form a distinct, relatively complex section of an interface. Organisms can consist of similar and/or disparate molecule types. Examples: header, product grid, modal dialog.

4. **Templates** - Page-level objects that place components into a layout and articulate the design's underlying content structure. Templates focus on content structure rather than final content. Example: a homepage template with header, hero, features, footer placeholders.

5. **Pages** - Specific instances of templates that show what a UI looks like with real representative content in place. Pages are the highest-fidelity stage and are essential for testing the effectiveness of the design system.

### Benefits
- Consistency across UI
- Reusability of components
- Scalability of design systems
- Clear separation of concerns
- Easier maintenance and updates

### Implementation Guidelines
- Start with atoms (basic HTML elements styled via CSS/CSS-in-JS)
- Build molecules by combining atoms with clear responsibilities
- Create organisms that represent distinct UI sections
- Develop templates as layout containers
- Craft pages with real content for testing
- Document each level with usage examples and guidelines
- Use storybook or similar tools for component isolation and testing

## Common Design Patterns

### Creational Patterns
- **Singleton**: Ensure a class has only one instance and provide a global point of access.
- **Factory Method**: Define an interface for creating an object, but let subclasses decide which class to instantiate.
- **Abstract Factory**: Provide an interface for creating families of related or dependent objects without specifying their concrete classes.
- **Builder**: Separate the construction of a complex object from its representation.
- **Prototype**: Create new objects by copying an existing prototype instance.

### Structural Patterns
- **Adapter**: Convert the interface of a class into another interface clients expect.
- **Bridge**: Decouple an abstraction from its implementation so that the two can vary independently.
- **Composite**: Compose objects into tree structures to represent part-whole hierarchies.
- **Decorator**: Attach additional responsibilities to an object dynamically.
- **Facade**: Provide a unified interface to a set of interfaces in a subsystem.
- **Flyweight**: Use sharing to support large numbers of fine-grained objects efficiently.
- **Proxy**: Provide a surrogate or placeholder for another object to control access to it.

### Behavioral Patterns
- **Chain of Responsibility**: Pass a request along a chain of handlers.
- **Command**: Encapsulate a request as an object, thereby allowing parameterization of clients with queues, requests, and operations.
- **Interpreter**: Given a language, define a representation for its grammar along with an interpreter.
- **Iterator**: Provide a way to access elements of an aggregate object sequentially without exposing its underlying representation.
- **Mediator**: Define an object that encapsulates how a set of objects interact.
- **Memento**: Capture and externalize an object's internal state so that the object can be restored later.
- **Observer**: Define a one-to-many dependency between objects so that when one object changes state, all its dependents are notified.
- **State**: Allow an object to alter its behavior when its internal state changes.
- **Strategy**: Define a family of algorithms, encapsulate each one, and make them interchangeable.
- **Template Method**: Define the skeleton of an algorithm in an operation, deferring some steps to subclasses.
- **Visitor**: Represent an operation to be performed on the elements of an object structure.

## Anti-Patterns to Avoid

### Architectural Anti-Patterns
- **God Object**: A class that knows too much or does too much.
- **Spaghetti Code**: Code with complex and tangled control structure.
- **Golden Hammer**: Assuming that a favorite solution is universally applicable.
- **Big Ball of Mud**: A system with no recognizable architecture.
- **Stovepipe System**: A system where components are tightly coupled and lack reusability.
- **Vendor Lock-in**: Over-dependence on proprietary technologies that hinder migration.

### Design Anti-Patterns
- **Anemic Domain Model**: Domain models with no business logic, only getters/setters.
- **Magic Numbers/String Literals**: Using unexplained numeric or string values in code.
- **Hardcoded Values**: Embedding environment-specific values directly in source code.
- **Copy and Paste Programming**: Duplicating code instead of abstracting reusable components.
- **Premature Optimization**: Optimizing code before identifying actual bottlenecks.
- **Inner-platform Effect**: Designing a system so customizable that it becomes a poor replica of the platform it's built upon.

### Code Smells
- **Duplicated Code**: Identical or very similar code in multiple places.
- **Long Method**: Methods that try to do too much.
- **Large Class**: Classes with too many responsibilities.
- **Feature Envy**: A method that uses data from another class more than its own.
- **Data Clumps**: Groups of variables that frequently appear together.
- **Primitive Obsession**: Overuse of primitives instead of small objects for simple tasks.
- **Switch Statements**: Long switch statements that could be replaced with polymorphism.
- **Temporary Field**: Fields that are only set under certain conditions.
- **Refused Bequest**: A subclass that doesn't use the methods or data of its superclass.
- **Comments**: Overuse of comments to explain bad code (self-documenting code preferred).

## Stack-Specific Considerations

### .NET
- Prefer composition over inheritance
- Use interfaces for abstraction
- Leverage dependency injection containers
- Consider records for immutable data transfer objects
- Use MediatR for CQRS to avoid anti-patterns in service layers

### Go
- Favor clear, simple structs over complex inheritance hierarchies
- Use interfaces for polymorphism
- Avoid global state
- Embrace the standard library before adding dependencies
- Use context propagation for cancellation and timeouts

### React/Next.js
- Create reusable, composable components following atomic design
- Avoid prop drilling by using context or state management libraries judiciously
- Separate concerns between presentational and container components
- Use custom hooks for extracting component logic
- Leverage server components for data fetching to reduce client-side JavaScript

### Laravel
- Use service classes and repositories to keep controllers thin
- Leverage Eloquent relationships instead of manual joins
- Use form requests for validation instead of putting rules in controllers
- Utilize events and listeners for decoupling side effects
- Avoid putting business logic in blade templates

### Python
- Use dataclasses or pydantic models for data structures
- Prefer composition over inheritance
- Use async/await appropriately for I/O-bound operations
- Leverage dependency injection containers for complex applications
- Use abstract base classes for defining interfaces

### OpenAPI/MCP
- Define exhaustive input schemas to prevent invalid requests
- Provide explicit error schemas for machine-readable error handling
- Use versioning in API endpoints and MCP tool definitions
- Avoid tight coupling between API version and implementation
- Implement proper security schemas (OAuth2, API keys, etc.)

## ponytail: Focus on essential patterns that solve real problems. Avoid implementing patterns just for the sake of using them.

## Usage Example
When building a new user management feature:
1. Start by defining atoms (input, button, label) in your design system
2. Combine them into molecules (form fields, action buttons)
3. Create organisms (user profile card, user list item)
4. Assemble templates (user profile page, user management dashboard)
5. Apply creational patterns like Factory for creating different user types
6. Use Observer pattern for real-time updates to user lists
7. Avoid anti-patterns like God Objects by separating concerns into services, repositories, and controllers
8. Follow stack-specific guidelines for implementation

This library should be consulted alongside the stack-specific rules and skills in this repository to ensure consistent, maintainable, and scalable application development.