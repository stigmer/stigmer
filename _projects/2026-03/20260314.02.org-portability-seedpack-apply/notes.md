# Notes: 20260314.02.org-portability-seedpack-apply

**Created**: 2026-03-14

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-14 — Problem Analysis & Key Decisions

### 🎯 Decision: `stigmer` replaces `default` as the system org

The seedpack currently bootstraps a `default` org. This creates migration friction when
moving to Cloud (where the target org is `stigmer`). By naming the system org `stigmer`
everywhere — OSS and Cloud — there is nothing to migrate. The backend (SQLite vs Cloud API)
changes, but the org name stays the same.

### 🎯 Decision: Agent-fleet uses `planton` org

Agent-fleet resources (infra-chart-composer, mcp-server-planton) are Planton-domain-specific.
They belong to the `planton` org, not `stigmer`. This is a separate project with a separate
org binding in its `stigmer.yaml` manifest.

### 🎯 Decision: Org is a contextual concern, not a resource attribute

Modeled after Kubernetes namespace resolution. Resources should NOT hardcode `metadata.org`.
Instead, org is inherited from the project manifest (`stigmer.yaml`), overridable by CLI flag.
This is the single most important architectural decision — it makes all YAML files org-portable.

### 🐛 Gotcha: Seedpack is embedded and immutable

`seedpack/embed.go` compiles the YAML into the binary via `embed.FS`. You can't patch
`metadata.org` in an embedded file at deploy time. The org override MUST come from the
apply flow (CLI flag or server config), not from editing YAML.

### 🐛 Gotcha: Inconsistent org placement in existing YAMLs

Current state is already contradictory:
- Seedpack agents: NO `org` field in metadata
- Seedpack project manifest: `org: default`
- Agent-fleet agents: `org: default` on individual resources
- Agent-fleet project manifest: NO `org` field at all

This project fixes all four to follow the consistent pattern: org lives in the project
manifest only, individual resources omit it.

### 🎯 Decision: Cross-org references need explicit `org` field

When an agent in `planton` org references `mcp-server-stigmer` in `stigmer` org, the
reference schema needs an optional `org` field. Omitting `org` = same-org lookup. Setting
`org` = cross-org reference. Mirrors Kubernetes cross-namespace references.

### ✅ Cross-org reference support already exists (T03 cancelled)

`ApiResourceReference` in `apis/ai/stigmer/commons/apiresource/io.proto` already has `org`
with the exact semantics needed. Empty = same-org (server resolves at write time), explicit =
cross-org. All stored refs are absolute. Convention: omit `org` when ref and parent share the
same org. This was proposed as T03 but was already built — no work needed.

### 💡 Rejected Approaches

- **YAML templating (`{{ .Values.org }}`)** — turns declarative YAML into templates, breaks `stigmer get` round-trips
- **Post-extraction patching of embedded seedpack** — `sed` in a Go binary, fragile and invisible
- **Separate seedpack per org** — forks source of truth, O(n) maintenance burden

---

*Add your timestamped notes below as you work*

---

