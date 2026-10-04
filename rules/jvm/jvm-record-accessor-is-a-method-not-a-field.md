---
title: "A record's component is accessed by a method, and equals/hashCode freeze what it returns"
rule_id: "RULE-JVM-010"
category: "api-design"
scope: "backend"
applies_to: "records, accessors, equals, hashCode, compact constructor, canonical constructor, java.lang.Record"
last_updated: "2026-10-04"
source: "https://docs.oracle.com/en/java/javase/25/language/records.html"
---

# A record's component is accessed by a method, and equals/hashCode freeze what it returns

`r.length` does not compile when `r` is a record. `r.length()` does. Every component gets a
`private final` field *and* a public accessor method — and the access path is the method. This is
why records do not interoperate with reflection, ORMs and serializers written for field access.

The second half is quieter: the immutability is shallow, and a mutable component silently breaks
the generated `hashCode`.

## Why

> A public accessor method with the same name and type of the component; in the Rectangle record
> class example, these methods are Rectangle::length() and Rectangle::width().
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

> A record declaration specifies in a header a description of its contents; the appropriate
> accessors, constructor, equals, hashCode, and toString methods are created automatically. A
> record's fields are final because the class is intended to serve as a simple "data carrier".
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

`final` refers to the reference. A component of mutable type holds a mutable object, so the
record's own observable state can change with no assignment to a record member — and the generated
`hashCode` is derived from component values:

> Implementations of the equals and hashCode methods, which specify that two record classes are
> equal if they are of the same type and contain equal component values.
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

A `List` component that is mutated after insertion changes the hash. A `HashMap` that already holds
the record can no longer find it. Nothing throws.

The compact constructor is the enforcement point, and its two spellings differ:

> Note that the statements this.length = length; and this.width = width; which appear in the
> canonical constructor do not appear in the compact constructor. At the end of a compact
> constructor, its implicit formal parameters are assigned to the record class's private fields
> corresponding to its components.
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

Implicit assignment at the end means validation code cannot leave a field half-assigned — and it
also means a field you assign yourself is overwritten. Alternative constructors are constrained to
a single path:

> You can define alternative, noncanonical constructors whose argument list doesn't match the
> record's type parameters. However, these constructors must invoke the record's canonical
> constructor.
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

Two limits generate the practical bugs. A record cannot be subclassed:

> A record class is implicitly final, so you cannot explicitly extend a record class.
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

And overriding the generated methods is allowed with a documented caveat:

> If you implement your own accessor methods, then ensure that they have the same characteristics as
> implicitly derived accessors (for example, they're declared public and have the same return type
> as the corresponding record class component). Similarly, if you implement your own versions of
> the equals, hashCode, and toString methods, then ensure that they have the same characteristics
> and behavior as those in the java.lang.Record class, which is the common superclass of all record
> classes.
> ([10 Record Classes](https://docs.oracle.com/en/java/javase/25/language/records.html))

## Do

- Call accessors with `()` everywhere — including inside the record itself.
- Defensive-copy mutable components in the compact constructor, and prefer immutable types
  (`List.copyOf`, `Map.copyOf`, `Instant`, `BigDecimal`) as component types.
- Keep records out of hash-based collections if any component is mutable, or freeze the component
  first.
- Use the compact constructor for validation; assign nothing there and let the implicit assignment
  do the work.
- Reach for a record when the type really is a data carrier with no behaviour. It is not a
  subclassable DTO.

## Don't

- Don't access a record component as a field. It does not compile, and reflection against
  `Field` finds only the private one.
- Don't put a mutable collection, array, `Date`, or `StringBuilder` in a record and then use the
  record as a `HashMap` key or in a `HashSet`.
- Don't assign fields in the compact constructor — the implicit assignment overwrites them.
- Don't subclass a record. It is implicitly final.
- Don't override an accessor to return something other than the component. You have created a type
  that satisfies `Object`'s contract by name and violates it in behaviour.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `get()` returns null for a key you inserted | Mutable component changed the record's `hashCode` | Use immutable components; defensive-copy in the compact constructor |
| ORM or serializer sees no value | Field access expected; records expose accessors | Configure the library for accessor access |
| `NoSuchFieldException` under reflection | Components are `private final` fields plus accessors | Use `Method.invoke`, not `Field.get` |
| Constructor validation appears to do nothing | Compact constructor assigns implicitly at the end | Assign only in the canonical constructor |
| Framework cannot proxy the type | Record is implicitly final | Use a class |
| Subclassing attempt rejected | Implicitly final | Composition |

## Verifying

```bash
# 1. Every record declaration in the tree
grep -rnE '^\s*(public\s+)?record\s+\w+\s*\(' src/main/java/

# 2. Field-style access on a record -- these do not compile, and show up in templates/reflection
grep -rnE '\.\w+\s*;' src/main/java/ | grep -iE 'generated|\.length|\.count|\.value'

# 3. Mutable component types -- the hashCode hazard
grep -rnE 'record\s+\w+\s*\([^)]*\b(List|ArrayList|Map|HashMap|Date|StringBuilder|\[\])\b' src/main/java/

# 4. Assignments inside a compact constructor body
grep -rn -A12 'record .*(' src/main/java/ | grep -E 'this\.[a-zA-Z]+ ='

# 5. Records used as map/set keys with mutable components
grep -rn 'HashMap\|HashSet' src/main/java/ | grep -i record
```

What this check cannot see: step 2 cannot tell a genuine field access from one that happens to look
like it, and step 5 only finds adjacent code. The hashCode hazard has no static signature at all —
it is a runtime event, and the instrument that catches it is a test that inserts the record into a
map, mutates the component, and asserts the lookup still works. See `RULE-JVM-011`'s Verifying block
for the same reasoning about compile-time versus run-time obligations.