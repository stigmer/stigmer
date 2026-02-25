# Agent YAML Validation Checklist

Run every item before delivering a final Agent YAML. Fix all failures before presenting.

---

## Table of Contents
1. [Top-Level Structure](#1-top-level-structure)
2. [Metadata](#2-metadata)
3. [Spec Fields](#3-spec-fields)
4. [MCP Server Usages](#4-mcp-server-usages)
5. [Skill References](#5-skill-references)
6. [Sub-Agents](#6-sub-agents)
7. [Environment Spec](#7-environment-spec)
8. [YAML Syntax](#8-yaml-syntax)
9. [Resource Existence](#9-resource-existence)

---

## 1. Top-Level Structure

- [ ] `apiVersion` is exactly `agentic.stigmer.ai/v1` (no variation)
- [ ] `kind` is exactly `Agent` (capital A, no variation)
- [ ] `metadata` block is present
- [ ] `spec` block is present

## 2. Metadata

- [ ] `metadata.name` is present and non-empty
- [ ] `metadata.slug` (if provided): lowercase alphanumeric with hyphens, starts with a
  letter, 1–63 characters (pattern: `^[a-z][a-z0-9-]{0,62}$`)
- [ ] `metadata.labels` (if provided): all values are strings
- [ ] `metadata.tags` (if provided): array of strings

## 3. Spec Fields

- [ ] `spec.description` is present and clearly explains agent purpose (1–2 sentences)
- [ ] `spec.instructions` is present and **at least 10 characters** long
- [ ] `spec.instructions` provides meaningful behavioral guidance (not just a label)
- [ ] `spec.icon_url` (if provided): a valid, publicly accessible HTTP/HTTPS URL

## 4. MCP Server Usages

- [ ] Each `mcp_server_ref.kind` is exactly `mcp_server` (lowercase)
- [ ] Each `mcp_server_ref.org` is present
- [ ] Each `mcp_server_ref.slug` is present
- [ ] MCP server slugs are **unique** within `mcp_server_usages` (no duplicates)
- [ ] All referenced MCP server slugs were **verified to exist** via `get_mcp_server`
- [ ] All `enabled_tools` names **exactly match** tool names from the MCP server
  (case-sensitive; verified via `get_mcp_server`)
- [ ] For `tool_approval_overrides`:
  - [ ] `tool_name` is non-empty
  - [ ] `tool_name` matches a real tool on the MCP server
  - [ ] `requires_approval` is a boolean (`true` or `false`)
  - [ ] `message` (if provided) is under 100 characters and uses valid `{{args.field}}`
    placeholders where appropriate

## 5. Skill References

- [ ] Each skill ref has `org`, `kind`, and `slug` present
- [ ] Each `kind` is exactly `skill` (lowercase)
- [ ] All referenced skill slugs were **verified to exist** via `get_skill` or `search`
- [ ] `version` (if provided): valid tag name or content hash (pattern: `^[a-zA-Z0-9._-]+$`)

## 6. Sub-Agents

- [ ] Each sub-agent `name` is unique within the `sub_agents` list
- [ ] Each sub-agent `name` is descriptive and meaningful
- [ ] Each sub-agent `instructions` is present and **at least 10 characters** long
- [ ] Each `mcp_access[].mcp_server` references a slug from the **parent's**
  `mcp_server_usages` (not any arbitrary MCP server)
- [ ] Each `mcp_access[].enabled_tools` is a **subset** of the parent's `enabled_tools`
  for that MCP server (sub-agents cannot expand permissions)
- [ ] Sub-agent `skill_refs` follow the same rules as parent skill refs (items 5 above)

## 7. Environment Spec

- [ ] `env_spec.data` (if provided): each key is an uppercase env var name
- [ ] Each entry has a `description` explaining the variable's purpose
- [ ] `is_secret: true` for any tokens, passwords, API keys, or sensitive values
- [ ] `is_secret: false` for non-sensitive config values (URLs, names, flags)

## 8. YAML Syntax

- [ ] YAML is syntactically valid (proper indentation, no tab characters, no stray quotes)
- [ ] Multi-line `instructions` uses `|` block scalar (not inline strings with `\n`)
- [ ] Boolean values use `true`/`false` (not `yes`/`no` or `1`/`0`)
- [ ] No trailing whitespace on lines

## 9. Resource Existence

- [ ] Every `mcp_server_ref` was confirmed via `get_mcp_server(org, slug)` returning a
  valid resource (not a 404 / not found)
- [ ] Every `skill_ref` was confirmed via `get_skill(org, slug)` or `search` returning a
  valid resource
- [ ] If any resource was NOT found: user was informed and asked how to proceed

---

## Common Pitfalls Quick Reference

| Pitfall | Wrong | Correct |
|---|---|---|
| Kind capitalization | `kind: Skill` | `kind: skill` |
| Kind capitalization | `kind: MCP_Server` | `kind: mcp_server` |
| Slug format | `Code_Reviewer` | `code-reviewer` |
| Instructions too short | `"Helper"` | `"You are a helpful assistant that..."` |
| Sub-agent tool exceeds parent | sub has `delete_repo` when parent only has `search_code` | sub-agent tools ⊆ parent tools |
| Duplicate MCP slugs | two entries with `slug: github` | each slug appears once |
| Missing required ref fields | `{org: local}` | `{org: local, kind: skill, slug: my-skill}` |
| Guessed resource slug | `slug: github-mcp` (unverified) | verified via `get_mcp_server` first |
| Sub-agent MCP not in parent | `mcp_server: slack` (parent has no slack) | must match parent's `mcp_server_usages` slug |
