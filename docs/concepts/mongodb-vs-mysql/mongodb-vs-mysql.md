# Concept: MongoDB vs MySQL

## What this concept is
A comparison of MongoDB (document/NoSQL database, used in Nova) against MySQL (relational/SQL database) — the structural differences, and how design habits from one translate (or don't) to the other.

## The core difference
MySQL stores data in **tables**, with a fixed schema of columns, and relationships between tables are modeled via **foreign keys**, resolved at query time with **JOINs**. MongoDB stores data in **collections** of **documents** (JSON-like objects), and relationships can be modeled either by **embedding** related data directly inside a document, or by **referencing** another document's ID (similar to a foreign key) — but without native JOIN support the way SQL has it.

## Key differences

| Aspect | MySQL | MongoDB |
|---|---|---|
| Structure | Tables, rows, columns | Collections, documents (JSON-like) |
| Schema | Fixed — every row in a table has the same columns | Flexible — documents in the same collection can technically differ, though Mongoose enforces a schema in application code |
| Relationships | Foreign keys, resolved via JOIN | Embedding (nested data) or referencing (manual lookup, or `.populate()` in Mongoose) |
| Joins | Native, built into SQL | No native JOIN — `$lookup` in aggregation pipelines exists but is less common and less performant than SQL JOINs |
| Transactions | ACID transactions are the default, deeply built-in | Multi-document ACID transactions exist (since MongoDB 4.0) but are used more selectively, not by default |
| Scaling | Traditionally vertical (bigger server); horizontal scaling (sharding) is possible but more complex to set up | Built with horizontal scaling (sharding) in mind from the start |
| Best fit | Data with rigid structure and lots of complex relational queries (e.g., financial systems, inventory with many interlocking tables) | Data that's naturally hierarchical/document-shaped, or where read patterns benefit from having related data embedded together (e.g., a user profile with embedded settings) |

## Where "no JOIN" actually shows up in Nova
Our own schema design is the clearest example: `projectRoles` lives embedded directly inside the User document instead of being a separate `user_project_roles` table joined at query time. We embed it because a user's project-role overrides are *always* read together with the rest of that user's data — there's rarely a reason to query "roles" independent of "whose roles." In MySQL, you'd almost certainly make that a separate table with a foreign key and JOIN it in; in MongoDB, embedding avoids that JOIN entirely, at the cost of that data no longer being independently, efficiently queryable across all users (e.g., "find every user who is a Manager on any project" is a much more awkward query against an embedded array than it would be against a proper joined table).

`ClientAccess`, on the other hand, stayed a **separate collection** rather than being embedded — specifically because it *is* queried independently in ways `projectRoles` isn't (e.g., "all clients with access to Project X"). This is the core skill this concept is really testing: knowing when to embed and when to reference/keep separate, based on how the data will actually be queried — not a universal rule.

## Likely interview questions on this concept (with answers)

**Q: When would you choose MongoDB over MySQL, and vice versa?**
A: MongoDB fits well when data is naturally document-shaped, schema needs flexibility, or the app's read patterns benefit from embedding related data together to avoid joins. MySQL fits well when data has many complex, interlocking relationships that benefit from JOINs and strict referential integrity, or when strong multi-table transactional consistency is a constant requirement rather than an occasional need. Neither is universally "better" — the choice follows the shape of the data and how it's queried, not a general preference.

**Q: How do you model relationships in MongoDB without JOINs?**
A: Two approaches: embedding (nesting related data directly inside the parent document, read together in a single query) or referencing (storing another document's ObjectId and resolving it separately, either manually or via Mongoose's `.populate()`, which does a secondary query behind the scenes — not a true database-level JOIN). The choice depends on whether the related data is always read together with its parent (favors embedding) or needs to be queried independently / avoid duplication (favors referencing).

**Q: Does MongoDB support transactions like MySQL does?**
A: Yes, since MongoDB 4.0, multi-document ACID transactions are supported when running as a replica set (which MongoDB Atlas provides by default). They're used more selectively than in MySQL though — MongoDB's document model often avoids the need for a transaction in the first place, since related data embedded in one document is updated atomically by nature, without needing an explicit transaction wrapping multiple statements.

**Q: What's a concrete downside of embedding data, versus referencing it?**
A: Embedded data can't be efficiently queried independently of its parent, and if the same data needs to appear in multiple places (denormalization), updates have to be applied everywhere it's duplicated, rather than in one place. In Nova's case, `projectRoles` embedded in User makes sense because we never need "all project role overrides" independent of "whose they are" — but if that ever changed (e.g., a feature needing to query overrides across all users efficiently), embedding would become a limitation.