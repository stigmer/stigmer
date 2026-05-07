# Task T01: OSS Positioning Strategy Shift — Full Plan

**Created**: 2026-05-03
**Status**: PENDING REVIEW
**Type**: Positioning, Content, Community, Governance
**Source**: Deep research report at `_projects/2026-05/research.open-source-strategy-for-ai-agent-platforms/04.report.gpt.md`

---

## Strategic Context

The deep research report analyzed 10 infrastructure company case studies (Temporal, Supabase, PostHog, Sentry, HashiCorp, GitLab, Grafana, n8n, LangChain, CrewAI), 8 license options, competitive landscape mapping, and revenue data. The unanimous conclusion:

> **Stigmer should shift from "cloud-primary, OSS as trust signal" to "OSS-led discovery, cloud-led monetization."**

Key findings:
- Keep Apache 2.0 — do not relicense
- Keep the OSS product fully functional — do not cripple it
- Open source should be the hero on developer-facing surfaces, cloud the hero on buyer/enterprise surfaces
- Commercialize around production operations, governance, compliance, and scale — not around core agent capabilities
- Build community around production agent patterns, MCP connectors, Skills, and workflow templates

The report says: **"Change positioning now, not later."**

---

## Phase 1: Positioning & Messaging Update (Week 1–2)

### T01: Update Positioning Strategy Doc
Update `_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md` to reflect the new strategy:
- Change Decision 3 from "Cloud-Primary, Open Source as Trust Signal" → "OSS-Led Discovery, Cloud-Led Monetization"
- Update the positioning statement to lead with "open-source infrastructure platform for production AI agents"
- Update headline recommendations: new hero = "Open-source agent infrastructure for engineering teams"
- Add the hybrid channel positioning table (homepage=OSS hero, pricing=cloud hero, enterprise=governance/security)
- Keep the rest of the positioning doc intact (audience, pillars, tone, competitive framing still apply)

### T02: Rewrite Homepage Hero & Open Source Section
Update site components to reflect new positioning:
- **Hero**: Change tagline/hero from business-first to OSS-first: "Open-source agent infrastructure for engineering teams" with sub "Define agents, teach them domain knowledge, connect MCP tools, enforce human approvals, and run durable multi-step workflows — locally, self-hosted, or on Stigmer Cloud."
- **CTAs**: Two equal CTAs: "Start Locally" + "Use Stigmer Cloud" (instead of "Start Free" as primary)
- **Open Source section**: Elevate from trust-badge to hero section. Make it more prominent, earlier in the page.
- **Supporting message**: "Build on open contracts, not a black box. Public protobuf APIs, YAML resources, SDKs, MCP integration, durable execution, and a real self-hosted path."
- Files to modify: `site/src/components/pages/HomePage.tsx`, `site/src/lib/constants.ts`, and related hero/OpenSource/CTA components

### T03: Rewrite README.md
Update the root README to emphasize OSS-first with local success path:
- Lead with "open-source infrastructure platform for production AI agents"
- Make `brew install` / `stigmer server` / local quickstart the hero flow
- Add a clear "Open Source" section near the top (not buried)
- Add a brief "Cloud vs Self-Hosted" section
- Add a "Contributing" section or link
- Keep the resource model and architecture sections
- New badge layout: License (Apache 2.0) prominent, GitHub stars, Discord

### T04: Create "Open Source Philosophy" Page
New docs page (`docs/open-source.mdx` or similar):
- What's open and what stays open (table from report: agent definitions, Skills, MCP, approvals, workflows, runners, CLI, SDKs, APIs, local control plane, docs)
- What's commercial (managed infra, multi-tenant, SSO/SAML, RBAC, audit, secrets, backups, SLA, support)
- Explicit promise: core primitives stay open
- License explanation (Apache 2.0, why, what it means)
- Link to CONTRIBUTING guide
- "Why we chose open source" narrative

### T05: Create "Cloud vs Self-Hosted" Comparison Page
New docs page with honest feature boundaries:
- Feature comparison table (what you get in OSS vs Cloud vs Enterprise)
- When to self-host vs when to use Cloud
- Migration path from local → Cloud
- Honest about self-hosting operational burden (like Supabase/PostHog do)

---

## Phase 2: Governance & Community Foundation (Week 3–4)

### T06: Governance Documents
Create or update:
- **SECURITY.md** — Security disclosure policy (responsible disclosure process)
- **DCO (Developer Certificate of Origin)** — Add DCO sign-off requirement to CONTRIBUTING.md (lighter than CLA, more community-friendly per report)
- **Trademark Policy** — Basic trademark usage guidelines for "Stigmer" name and logo
- Update **CONTRIBUTING.md** — Add contribution types (MCP connectors, Skills, SDK examples, docs, core), contributor ladder concept, DCO sign-off instructions

### T07: Enable GitHub Discussions
- Enable GitHub Discussions on the `stigmer/stigmer` repo
- Set up categories: Q&A, Ideas/RFCs, Show & Tell, Announcements, MCP Integrations, Skills & Templates
- Pin a welcome post explaining the community structure
- Link Discussions from README and docs

### T08: GitHub Issue Labels & Templates
- Add labels: `good first skill`, `good first mcp-server`, `good first sdk-issue`, `good first doc`, `help wanted`, `community`
- Add issue templates for: Bug Report, Feature Request, MCP Server Proposal, Skill Proposal
- Add PR template with DCO acknowledgment

### T09: Public Roadmap
- Create a public roadmap (GitHub Projects board or a `docs/roadmap.mdx` page)
- Organize by: Now / Next / Later
- Include community-facing items: MCP connectors, Skills registry, SDK improvements, workflow templates

---

## Phase 3: Content & Examples (Week 5–6)

### T10: High-Quality Agent Examples
Create 5 production-grade agent examples (as referenced in the report):
1. **Support triage agent** — classifies incoming support tickets using domain Skills
2. **Incident response agent** — queries monitoring tools via MCP, suggests remediation, requires approval for actions
3. **GitHub issue agent** — reads GitHub issues via MCP, labels/triages, drafts responses
4. **Customer success agent** — uses CRM tools via MCP, checks account health, suggests interventions
5. **Approval-gated database action agent** — executes database queries with mandatory human approval

Each example should include: YAML resource definitions, Skills, MCP server config, usage instructions, expected behavior description.

### T11: Migration & Comparison Content
Create docs/guides for:
- "LangChain/LangGraph to Stigmer" — how to take a LangGraph prototype to production on Stigmer
- "CrewAI to Stigmer" — same concept
- "Why Stigmer vs agent frameworks" — honest comparison (framework gives you primitives, Stigmer gives you infrastructure)
- "Why Stigmer vs proprietary agent platforms" — open contracts, no lock-in, inspect/self-host

### T12: Documentation-Led Growth Priorities
Audit and improve these critical docs (per report's "buying moments" framework):
1. Five-minute local quickstart
2. "Build your first approval-gated agent"
3. "Connect an MCP tool safely"
4. "Define a Skill"
5. "Run a durable multi-step workflow"
6. "Call an agent from your app via API"
7. "Self-hosting architecture"
8. "When to use Cloud"
9. "Security model"
10. "MCP security best practices"

---

## Phase 4: Commercial Boundary & Conversion Path (Ongoing, Month 2+)

### T13: Cloud Conversion Path from OSS
- Add a `stigmer config backend set cloud` flow in docs
- Create a "Deploy to Stigmer Cloud" guide that shows the 3-command migration from local
- Add telemetry/analytics instrumentation plan for tracking OSS → Cloud conversion funnel (opt-in)

### T14: Enterprise Governance Feature Packaging
- Document and validate the commercial feature boundary:
  - Multi-org tenancy
  - SSO/SAML/OIDC/SCIM
  - OpenFGA advanced RBAC
  - Audit logs and compliance exports
  - Approval routing by team/org/policy
  - Managed sandbox pools
  - Secrets management
  - Backups/DR/SLA
  - Data residency
  - Usage analytics/cost controls
  - Private Skills/MCP registry
  - Verified connector marketplace
  - Enterprise support
  - Billing
- Ensure these are clearly mapped to cloud/enterprise tiers on the pricing page

---

## Success Criteria (Overall Project)

1. Homepage hero leads with open-source identity
2. "Open Source Philosophy" page published with clear open-vs-commercial boundary
3. "Cloud vs Self-Hosted" comparison page published
4. README rewritten with OSS-first messaging
5. Governance docs published: SECURITY.md, DCO, trademark, updated CONTRIBUTING.md
6. GitHub Discussions enabled with structured categories
7. Issue labels and templates for community contributions
8. Public roadmap visible
9. 5 high-quality agent examples published
10. Positioning strategy doc updated
11. At least 2 migration/comparison guides drafted

---

## What This Project Does NOT Cover

- License change (report says keep Apache 2.0 — no action needed)
- Building marketplace/registry infrastructure (future project, month 6+)
- Enterprise feature implementation (separate engineering projects per feature)
- Pricing page restructuring (separate project, depends on commercial tier definition)
- Monthly community demo program (operational, not project-scoped)
- MCP connector bounty program (operational, month 2+)

---

## Review Process

**What happens next**:
1. **You review this plan** — Does the phasing make sense? Are the priorities right?
2. **Provide feedback** — What should be higher/lower priority? Anything missing?
3. **I'll revise** — Create T01_2_revised_plan.md with your feedback incorporated
4. **You approve** — Give explicit go-ahead
5. **Execution begins** — Phase by phase, tracked in task files
