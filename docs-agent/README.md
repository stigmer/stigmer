# Stigmer Docs Agent

The first-party agent behind **Ask AI** on [stigmer.ai/docs](https://stigmer.ai/docs).
It answers questions about Stigmer from the official documentation — grounded,
cited, and always current — and reaches readers through Stigmer's own
share/embed capability. This directory is the complete, declarative definition
of that experience: the agent, its skill, and its public share.

## Design in one paragraph

The agent answers in two tiers. Common conceptual questions are answered
directly from the `stigmer-docs` skill, which carries a **stable map of the
documentation** and the answering methodology — zero tool calls. Everything
specific is read **live** from the published docs via the seedpack `fetch`
MCP server: `https://stigmer.ai/llms.txt` to locate the page, then the page's
`.md` export (or the page itself — fetch converts HTML to Markdown) to answer
from what the docs say *today*. There is deliberately no docs snapshot and no
sync pipeline: the published documentation is the single source of truth, so
the agent's knowledge cannot drift.

## The pieces

| File | What it is |
|------|------------|
| [`agents/stigmer-docs.yaml`](agents/stigmer-docs.yaml) | The Agent: instructions, the skill, and the least-privilege `fetch` tool |
| [`skills/stigmer-docs/SKILL.md`](skills/stigmer-docs/SKILL.md) | The methodology + documentation map (no content snapshot) |
| [`shares/stigmer-docs.yaml`](shares/stigmer-docs.yaml) | The public AgentShare that powers the hosted chat + docs-site embed |
| [`stigmer.yaml`](stigmer.yaml) | Project manifest, pinned to the `stigmer` org |

Three deliberate postures, chosen once and worth preserving:

- **Blueprint is `visibility_org`; chat access is the share's job.** The agent
  is first-party infrastructure, not a marketplace template (that role belongs
  to [`org-knowledge-agent`](https://github.com/stigmer/org-knowledge-agent)).
  The public-audience `AgentShare` grants anonymous chat without exposing the
  blueprint.
- **Credential-free by construction.** The docs' Markdown exports are public,
  so the only tool is the no-auth `fetch` server: no PAT to provision, no
  `environment_refs` to bind, nothing to rotate.
- **`fetch` must stay auto-approved.** Anonymous guest conversations run in
  unattended approval mode, where an approval-gated tool is silently *skipped*
  — a gated `fetch` would break every long-tail answer. Never add a
  `requires_approval` override to it.

## Deploy

You need the [Stigmer CLI](https://stigmer.ai/docs/cli) authenticated with an
identity that can write to the `stigmer` org (the platform operator). From
this directory:

```bash
# Push the skill and apply the agent + project (dry-run first to preview):
stigmer apply --org stigmer --dry-run
stigmer apply --org stigmer

# The share is its own resource — applying the agent never touches it:
stigmer apply --org stigmer -f shares/stigmer-docs.yaml
```

The hosted chat goes live at `https://app.stigmer.ai/chat/stigmer/stigmer-docs`.
The docs site embeds the same share via `@stigmer/embed`'s `<stigmer-agent>`
element (see `site/src/components/docs/ask-ai/` in this repo).

## Operational notes

- Guest conversations bill the `stigmer` org's credits, bounded by the
  platform's guest execution profile (per-conversation cost/round caps) and
  per-visitor/per-org rate limits. Keep the org funded or the widget answers
  with the `unavailable` message.
- `allowed_origins` pins embedding to `https://stigmer.ai`. Origins are exact:
  add an entry before testing the embed from any other host, and remove it
  after.
