# query/ — the CQRS read-side services

The two cross-aggregate query services (D4 #14; Go `pkg/query/`):

- `search/` — the FTS5-backed SearchService: criteria value object, the
  searchable-extractor registry (13 kinds, `kind_meta`-derived set), the
  query store over `Store.querySearchIndex`, and boot-time RebuildIndex.
- `activity/` — the ActivityQueryController recents feed: sessions +
  workflow executions merged newest-first (stigmer#461).

Neither is a domain: no `api_resource_kind` service option, no pipeline
lifecycle — plain CQRS handlers over the store, registered in
`boot/compose.ts` between artifact and github (Go server.go:493–522's
order). Domain `search-extractor.ts` files implement `search/extractor.ts`'s
`SearchableExtractor` contract; growing the searchable surface is one
registry entry plus the domain's extractor file.
