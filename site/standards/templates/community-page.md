# Page Template: Community Page

<!--
  COMMUNITY PAGE TEMPLATE
  =======================
  Type: Community
  URL: /community
  Funnel: Interest → Action
  Personas: All (especially contributors and advocates)

  The community page converts interested developers into active
  participants — contributors, advocates, and ecosystem builders.
  For an open-source project, community health is a core trust signal.
  This page showcases the ecosystem and makes contribution paths
  frictionless.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Community |
| **URL** | `/community` |
| **Funnel stages** | Interest → Action |
| **Target personas** | All (contributors, advocates, ecosystem builders) |
| **Visitor goal** | Find contribution paths, community channels, and ecosystem resources |
| **Success metric** | GitHub star, Discord join, or contribution (PR, issue, discussion) |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `Community | Stigmer` or `Join the Stigmer Community` |
| `<meta description>` | Max 160 chars. "Contribute, connect, and build with..." with CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Community-themed (contributor graph, GitHub activity). |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- None required beyond site-wide `Organization` and `WebSite`.

## Narrative Arc

1. **Welcome** (Hero) — You are invited. The community is real and active.
2. **Contribute** (Contribution Paths) — Here is how to get involved, at any level of commitment.
3. **Connect** (Resources) — Here is where the community lives.
4. **Join** (CTA Band) — Start contributing or join the conversation.

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline welcomes the visitor into the community. "Build Stigmer With Us" or "Open Source, Open Community." The tone is inclusive and inviting, not promotional.
- **Visual anchor**: Project health metrics (GitHub stars, contributors, recent activity) or a contributor graph visualization. Not code — this page is about people, not technology.
- **Subheadline**: Communicates that contributions at all levels are valued. "Whether you file an issue, improve the docs, or build an MCP integration — every contribution moves Stigmer forward."

### 2. Contribution Paths

- **Job**: Make it obvious how to contribute at every level of commitment.
- **Required elements**:
  - 3-5 contribution paths, ordered from lowest to highest commitment:
    1. **Star & Share** — Star the repo, share on social media. Zero time investment.
    2. **Report Issues** — File bugs, request features. Link to GitHub Issues with a template.
    3. **Improve Docs** — Fix typos, add examples, write guides. Link to docs contribution guide.
    4. **Write Code** — Fix bugs, add features. Link to CONTRIBUTING.md with setup instructions.
    5. **Build Integrations** — Create MCP servers, SDK extensions, community tools. Link to ecosystem guide.
  - Each path includes: a clear description, a link to get started, and an estimated time commitment.
- **Copy guidance**: Frame contributions as valued, not as free labor. "Help us make Stigmer better" is good. "We need your help" is not — it positions the community as a resource extraction mechanism.
- **Design**: Card grid with icons. Each card links to the starting point for that contribution type.

### 3. Resources

- **Job**: Show where the community lives and how to connect.
- **Required elements**:
  - **GitHub** — Repository link, stars count, recent activity indicator.
  - **Discord / Community forum** — Invite link, member count (if available).
  - **Contributing guide** — Link to `CONTRIBUTING.md` in the repo.
  - **Code of Conduct** — Link to `CODE_OF_CONDUCT.md`. Non-negotiable for any community page.
  - **License** — Apache 2.0 badge and link to the LICENSE file.
- **Copy guidance**: Each resource gets a 1-sentence description explaining what the visitor will find. "Join the Discord to ask questions, share what you are building, and connect with other Stigmer developers."

### 4. Social Proof (Optional)

- **Template**: [`section-social-proof.md`](section-social-proof.md)
- **Page-specific**: If community metrics are strong enough, include a compact social proof section: contributor count, commits this month, issues resolved, community channel membership. All numbers must be current and verifiable.

### 5. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: Headline invites participation. "Start contributing today." Primary CTA leads to the easiest entry point (GitHub repo or "Star on GitHub"). Secondary CTA leads to the quickstart for visitors who want to use Stigmer before contributing.

## CTA Strategy

| CTA | Label | Destination |
|---|---|---|
| **Primary** | "Star on GitHub" / "View the Repo" | GitHub repository |
| **Secondary** | "Join Discord" / "Join the Community" | Community channel invite |
| **Tertiary** | "Read the Contributing Guide" | CONTRIBUTING.md |

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| GitHub repo | "View on GitHub," "Star the repo" |
| Contributing guide | "Read the contributing guide" |
| Quickstart (docs) | "Get started with Stigmer" — for visitors who want to use before contributing |
| Docs | "Improve the documentation" — linking to the docs contribution path |

## Quality Checklist

- [ ] All required sections present (Hero, Contribution Paths, Resources, CTA Band)
- [ ] 3-5 contribution paths ordered from lowest to highest commitment
- [ ] Each path includes description, link to start, and time estimate
- [ ] GitHub, Discord/forum, Contributing guide, Code of Conduct, and License all linked
- [ ] Social proof metrics (if present) are current and verifiable
- [ ] Tone is welcoming and inclusive, not extractive
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
