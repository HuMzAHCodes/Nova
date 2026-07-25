# Notes: MongoDB vs MySQL

Deep-dive companion to `mongodb-vs-mysql.md`.

## Definition
**MySQL** is a relational database management system (RDBMS) — data lives in tables with a strictly enforced schema, and relationships between tables are modeled explicitly via foreign keys, queried together using JOIN operations. **MongoDB** is a document-oriented NoSQL database — data lives in collections of documents (structurally similar to JSON objects), and while Mongoose (the ODM Nova uses) enforces a schema in application code, MongoDB itself doesn't require every document in a collection to share the same shape.

## Generalization
"SQL vs NoSQL" is one of the most fundamental and recurring decisions in backend system design — it comes up in almost every system-design interview, and the right answer is always "it depends on the data and access patterns," never a blanket preference. Document databases (MongoDB, Firestore, CouchDB), key-value stores (Redis, DynamoDB), and relational databases (MySQL, PostgreSQL) each represent different tradeoffs between flexibility, consistency guarantees, and query patterns. Understanding *why* Nova chose MongoDB — not just *that* it did — is what separates "I used MongoDB because the course said to" from a defensible engineering decision.

## Walking through a concrete example: fetching a user's dashboard

**In MySQL**, imagine a `users` table, a `projects` table, and a `user_project_roles` join table. To display "Aisha's dashboard, showing her role on every project she's involved in":
```sql
SELECT u.name, p.name AS project_name, upr.role
FROM users u
JOIN user_project_roles upr ON upr.user_id = u.id
JOIN projects p ON p.id = upr.project_id
WHERE u.id = 'aisha_id';
```
This requires the database to join three tables together at query time.

**In MongoDB**, since `projectRoles` is embedded directly in the User document:
```js
const user = await User.findById('aisha_id');
// user.projectRoles is already right there — no second query, no join
```
One query, no join — because the data was deliberately shaped to avoid needing one for this exact access pattern.

**The tradeoff surfaces the moment the access pattern changes.** Suppose a new feature needs: "show me every user across the entire organization who is a Manager on any project." In MySQL, this is a straightforward query against the join table:
```sql
SELECT u.name, p.name
FROM user_project_roles upr
JOIN users u ON u.id = upr.user_id
JOIN projects p ON p.id = upr.project_id
WHERE upr.role = 'manager';
```
In MongoDB, this is much more awkward, since `projectRoles` is buried inside every individual User document rather than being its own queryable collection:
```js
const managers = await User.find({ 'projectRoles.role': 'manager' });
// works, but you're now querying INTO an array field across every user —
// less natural, and harder to index/optimize than a dedicated table would be
```
This is exactly the kind of tradeoff embedding makes: fast and simple for the access pattern it was designed for (fetching one user's own data), awkward for an access pattern it wasn't designed for (querying across all users' embedded data). This is precisely why `ClientAccess` was kept as its own collection instead of also being embedded — "all clients on Project X" is a cross-cutting query pattern from the start, so embedding it inside User would have created exactly this same awkwardness immediately, not just as a hypothetical future feature.

## Referencing in MongoDB, and what `.populate()` actually does
When data is referenced rather than embedded (like `ownerId` on Organization pointing to a User), Mongoose's `.populate()` can resolve that reference for you:
```js
const org = await Organization.findById('org_001').populate('ownerId');
// org.ownerId is now the actual User document, not just an ObjectId
```
It's important to understand this is **not** a database-level JOIN — MongoDB itself doesn't do this. `.populate()` runs a second, separate query behind the scenes and stitches the results together in application code. This matters for interview understanding: it explains why heavy use of `.populate()` across many references can be slower than a single well-indexed SQL JOIN, and why MongoDB schema design generally favors embedding over referencing wherever the access pattern allows it — referencing is available, but it's not "free" the way a JOIN in a well-indexed SQL database can be.

## Transactions — why MongoDB needing them is the exception, not the rule
In MySQL, wrapping multiple related writes in a transaction is extremely common, because data that belongs together is usually spread across multiple tables (e.g., inserting an order row and several order_item rows together, wanting both to succeed or both to fail). In MongoDB, if that same related data were modeled as an embedded array inside one Order document, a single `save()` call is already atomic by nature — no transaction needed, because it was never split across multiple documents in the first place. Multi-document transactions in MongoDB become necessary specifically when an operation must atomically touch **multiple separate documents or collections** — e.g., in Nova's case, reassigning a Project's owner might need to update the Project document and write to an Activity Log collection together, atomically. This is a case flagged in `FURTHER_IMPLEMENTATION.md` as a gap worth adding — a good concrete example of when MongoDB transactions are actually the right tool, rather than a MySQL habit applied out of reflex.

## A word of caution: don't assume "no schema" means "no design discipline"
A common misconception coming from SQL is that MongoDB being "schema-less" means data modeling doesn't matter as much. In practice, the opposite is often true: SQL's foreign keys and JOINs give you some flexibility to change your mind about access patterns later (you can always write a new JOIN). MongoDB's embedding decisions are much more "baked in" to the shape of the data — as shown above, switching from "embedded" to "needs its own collection" after the fact (once real data exists) is a genuine migration, not just a new query. This is exactly why the Organization/User/ClientAccess schema design happened as its own dedicated concept and discussion before any code was written, rather than being treated as a quick, low-stakes decision.