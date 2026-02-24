# Agent YAML Validation Checklist

Run every item before presenting a final YAML to the user. Fix all failures.

---

## 1. Top-Level Structure

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1` (no variations)
- [ ] `kind` is exactly `Agent` (capital A, no other value)
- [ ] `metadata` block is present
- [ ] `spec` block is present
- [ ] `status` block is **absent** (never authored by users)
- [ ] YAML is syntactically valid (correct indentation, no tab characters, no duplicate keys)

---

## 2. Metadata

- [ ] `metadata.name` is present and non-empty
- [ ] `metadata.slug` (if provided) matches `[a-z][a-z0-9-]{0,62}` — starts with a letter,
      lowercase alphanumeric plus hyphens, 1–63 characters total
- [ ] `metadata.labels` values (if provided) are strings
- [ ] `metadata.tags` (if provided) is a list of strings

---

## 3. Spec Core Fields

- [ ] `spec.description` is present, non-empty, and human-readable (1–2 sentences)
- [ ] `spec.instructions` is present and **≥ 10 characters**
- [ ] `spec.icon_url` (if provided) is a valid HTTP/HTTPS URL pointing to SVG, PNG, or JPEG

---

## 4. MCP Server Usages

For each entry in `spec.mcp_server_usages`:

- [ ] `mcp_server_ref` is present
- [ ] `mcp_server_ref.org` is present (e.g. `local`)
- [ ] `mcp_server_ref.kind` is exactly `mcp_server` (lowercase — NOT `McpServer`)
- [ ] `mcp_server_ref.slug` is present and was **verified via `get_mcp_server`** — not guessed
- [ ] `mcp_server_ref.slug` matches `[a-z][a-z0-9-]{0,62}`
- [ ] No two entries in `mcp_server_usages` share the same slug (slugs must be unique)
- [ ] `enabled_tools` names (if provided) exactly match tool names the MCP server exposes

For each entry in `tool_approval_overrides` (if present):

- [ ] `tool_name` is non-empty and matches the MCP server's reported tool name exactly
- [ ] `requires_approval` is a boolean (`true` or `false`)
- [ ] `message` (if provided) is ≤ 100 characters and uses valid `{{args.field}}` syntax

---

## 5. Skill References

For each entry in `spec.skill_refs`:

- [ ] `org` is present
- [ ] `kind` is exactly `skill` (lowercase — NOT `Skill`)
- [ ] `slug` is present and was **verified via `get_skill`** — not guessed
- [ ] `slug` matches `[a-z][a-z0-9-]{0,62}`
- [ ] `version` (if provided) is either a tag name (alphanumeric + `.`, `-`, `_`) or a
      64-character lowercase hex SHA256 hash

---

## 6. Sub-Agents

For each entry in `spec.sub_agents`:

- [ ] `name` is present and **unique** within the `sub_agents` list
- [ ] `instructions` is present and **≥ 10 characters**
- [ ] `description` (if provided) is non-empty

For each entry in `mcp_access` (if present):

- [ ] `mcp_server` value matches the **slug** of one of the parent's `mcp_server_usages`
      entries (must be an exact slug match, not the full ref)
- [ ] `enabled_tools` (if provided) is a **subset** of the parent agent's `enabled_tools`
      for the referenced MCP server
      - If the parent's `enabled_tools` is empty (= all tools), the sub-agent may list any
        tools the server exposes.
      - Sub-agent can **never** add tools the parent did not enable.

For `skill_refs` within a sub-agent:

- [ ] Same rules as `spec.skill_refs` above (`org`, `kind: skill`, verified `slug`)

---

## 7. Environment Spec

For each key in `spec.env_spec.data` (if present):

- [ ] Key name follows `UPPER_SNAKE_CASE` convention (recommended, not enforced by schema)
- [ ] `description` is present and explains the variable's purpose
- [ ] `is_secret` is a boolean; `true` for tokens, passwords, private keys
- [ ] `value` is empty or omitted in the spec (actual values are runtime-injected)

---

## 8. Resource Discovery Audit

Before final presentation, confirm:

- [ ] Every `mcp_server_ref.slug` was returned by `get_mcp_server` or `search` — no slug
      was invented without platform verification
- [ ] Every `skill_refs[].slug` was returned by `get_skill` or `search` — no slug was
      invented without platform verification
- [ ] If any required resource was **not found** on the platform, the user was informed and
      agreed to proceed (or to create the resource first)

---

## 9. Common Pitfall Quick-Check

| Pitfall | What to verify |
|---------|----------------|
| Capitalized `kind` in refs | `kind: skill` ✓ — not `kind: Skill` ✗ |
| Wrong `kind` for MCP | `kind: mcp_server` ✓ — not `kind: McpServer` ✗ |
| Missing `org` in ref | Every `ApiResourceReference` must have `org:` |
| Sub-agent expands parent tools | Sub-agent tools ⊆ parent tools — verify subset |
| Sub-agent references unknown server | `mcp_access[].mcp_server` must match a parent slug |
| Duplicate MCP slugs | Each slug appears exactly once in `mcp_server_usages` |
| `instructions` too short | Both parent and sub-agent `instructions` ≥ 10 chars |
| `status` present | Must be absent — remove if accidentally included |
| Guessed slug | All slugs verified via `get_mcp_server` / `get_skill` / `search` |
| Tab characters in YAML | YAML requires spaces — replace all tabs |
