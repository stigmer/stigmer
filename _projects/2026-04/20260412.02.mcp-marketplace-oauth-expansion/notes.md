# Notes: 20260412.02.mcp-marketplace-oauth-expansion

**Created**: 2026-04-12

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-04-12 -- Research Complete, Project Bootstrapped

### Key Decisions
- DCR verification is mandatory before adding any server as "DCR-compatible" (Pattern A / no `oauth_app_ref`).
- Two auth patterns in Stigmer YAML:
  - **Pattern A (DCR)**: `auth.target_env_var` only. Stigmer auto-discovers + DCR. Used for Linear, Notion, etc.
  - **Pattern B (Vendor OAuth)**: `auth.oauth_app_ref` pointing to an OAuthApp resource. Used for Figma, Slack.
- For Wave 1, all servers are Pattern A. Wave 3 servers are Pattern B.

### Learnings
- Having `registration_endpoint` in OAuth metadata does NOT guarantee DCR works. Vercel has it but enforces an allowlist.
- The old Cloudflare servers (`bindings.mcp.cloudflare.com`) had broken DCR until March 2026. The NEW `mcp.cloudflare.com` server works.
- GitHub explicitly does not support DCR. Asana V2 explicitly does not support DCR.
- Many vendors use an **OAuth proxy pattern**: a thin MCP-specific OAuth layer on `mcp.*.com` that accepts DCR, then proxies to the vendor's standard OAuth.
- Stripe built a dedicated DCR layer at `access.stripe.com/mcp/oauth2/register`.

### Gotchas
- Atlassian is currently configured as DCR-compatible in the marketplace, but awesome-remote-mcp-servers lists it as "no DCR". Needs auditing (T06).
- Datadog has regional endpoints (datadoghq.eu, etc) -- users in EU need different URL.
- Webflow auto-installs a companion Bridge app during OAuth.
- PayPal production endpoint is `/http` (streamable HTTP), sandbox is separate at `mcp.sandbox.paypal.com`.

### References
- Full research plan: `/Users/suresh/.cursor/plans/oauth_mcp_server_research_7faa970d.plan.md`
- Awesome Remote MCP Servers: https://github.com/jaw9c/awesome-remote-mcp-servers
- MCP Authorization Spec (2025-11-25): DCR + CIMD + Cross App Access

---

