SearchService provides unified search and discovery across API resources.
A single `search` method handles listing, full-text search, and cross-kind
discovery depending on the combination of `kinds`, `query`, and `org` parameters.

```json
// List all agents in an organization
{ "kinds": ["agent"], "org": "acme" }

// Full-text search across agents and skills
{ "kinds": ["agent", "skill"], "query": "code review" }

// Discover all resource kinds matching a query
{ "query": "kubernetes" }
```
