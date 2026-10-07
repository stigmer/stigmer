# query/ — the CQRS read-side services

The two cross-aggregate query services (Go `pkg/query/`):

- `search/` — the SearchService over the store's search index: criteria value object, the
  searchable-extractor registry (9 kinds, `kind_meta`-derived set), the
  query store over `Store.querySearchIndex`, and boot-time RebuildIndex.
- `activity/` — the ActivityQueryController recents feed: the caller's
  sessions, newest first (stigmer#461).

Neither is a domain: no `api_resource_kind` service option, no pipeline
lifecycle — plain CQRS handlers over the store, registered in
`boot/compose.ts` between plugin and github (Go server.go:493–522's
order). Domain `search-extractor.ts` files implement `search/extractor.ts`'s
`SearchableExtractor` contract; growing the searchable surface is one
registry entry plus the domain's extractor file.
