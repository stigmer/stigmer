# Notes: 20260325.01.auto-personal-org

**Created**: 2026-03-25

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-25 — Architecture Analysis & Approach

### Key Architectural Decision: Personal Org = Regular Org

A personal org is structurally identical to a team org. It uses the same `Organization` proto, same `metadata.org` scoping, same FGA tuples. The only difference is:
- **Lifecycle**: auto-created during identity provisioning (not user-initiated)
- **Constraints**: cannot be deleted while identity exists, `is_personal` is immutable
- **UX**: shown with user icon instead of building icon in OrgSwitcher

This means **zero impact on existing resource model**. All downstream logic that depends on `metadata.org`, org ID, FGA tuples, CLI context — unchanged.

### Why Server-Side, Not Client-Side

Auto-creation must happen in the `IdentityAccountCommandController.create` handler (server-side), not in `OrgGate` (client-side). Reasons:
- Org exists before user hits the console — no loading/race conditions
- CLI users also benefit (daemon `EnsureOrgContext` auto-selects the single org)
- Clean separation: identity provisioning is already a system-level operation

### Current System Reference

| Concept | Current Behavior |
|---------|-----------------|
| Org creation | Explicit via `CreateOrganizationForm` in `OrgGate` (web) or `stigmer apply` (CLI) |
| `OrgGate` | Blocks app shell until ≥1 org exists; shows onboarding form if 0 orgs |
| CLI context | `EnsureOrgContext` auto-selects if exactly 1 org; errors if 0 orgs |
| Org slug | 2-15 chars, `^[a-z][a-z0-9-]+$`, must start with letter |
| `metadata.org` | Every resource has owning org slug — the tenancy column |
| `is_personal` | Does not exist yet — no personal vs team distinction |
| `ManagementMode` | `self_managed` vs `platform_managed` — orthogonal to personal/team |

### Slug Generation Strategy

1. Take email local part (e.g., `suresh@gmail.com` → `suresh`)
2. Sanitize: lowercase, replace non-alphanumeric with hyphens, strip leading non-alpha, truncate to 15 chars
3. If < 2 chars after sanitization, pad or use fallback (e.g., first name)
4. If slug is taken, append random 3-char suffix (e.g., `suresh-x7k`)
5. Retry up to N times if suffix also collides (astronomically unlikely)

### Effort Estimate

| Layer | Effort |
|-------|--------|
| Proto changes | ~0.5 day |
| Server (stigmer-cloud) | ~2-3 days |
| Web Console | ~0.5-1 day |
| CLI | ~0 (existing auto-select works) |
| Testing | ~1 day |
| **Total** | **~4-5 days** |

### What This Does NOT Change

- Resource model (`metadata.org` scoping)
- FGA authorization model
- Multi-org support (users can still create team orgs)
- Platform-managed orgs / federated auth
- SDK packages (`@stigmer/react`, `@stigmer/sdk`)
- CLI command structure

---

*Add your timestamped notes below as you work*

---

