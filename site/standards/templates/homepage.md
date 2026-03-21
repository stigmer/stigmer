# Page Template: Homepage

<!--
  HOMEPAGE TEMPLATE
  =================
  Type: Homepage
  URL: /
  Funnel: Awareness → Interest → Action (spans the full funnel)
  Personas: All three (solo developer, platform builder, engineering leader)

  The homepage is the hub. It provides clear paths for each persona's
  journey without trying to be everything to everyone in a single scroll.
  It must hook in 5 seconds, educate with benefits, and deliver a working
  code example within the first two viewports.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Homepage |
| **URL** | `/` |
| **Funnel stages** | Awareness → Interest → Action |
| **Target personas** | All (solo developer, platform builder, engineering leader) |
| **Visitor goal** | Understand what Stigmer is and find a relevant path forward |
| **Success metric** | Scroll depth > 60%, click-through to use-case or quickstart |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Include primary keyword. Format: `Stigmer: {Value Proposition}` |
| `<meta description>` | Max 160 chars. Primary keyword + call to action. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Product-specific, not generic. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- `Organization` (site-wide, in layout)
- `WebSite` (site-wide, in layout)
- `SoftwareApplication` (on this page)

## Narrative Arc

The homepage tells this story:

1. **Hook** (Hero) — What is this? "Build Agents. Skip the Infrastructure." Category + value in 5 seconds.
2. **Educate** (Features) — What does it do? 3-6 capabilities translated into developer benefits.
3. **Build trust** (How It Works) — How does it work? Step-by-step from YAML to running agent.
4. **Prove** (Quickstart / Code Showcase) — Show me it works. Working code within the first two viewports.
5. **Convert** (CTA Band) — What do I do next? Install command, docs link, GitHub link.

## Section Sequence

Sections must appear in this order. Each section references its section template for detailed requirements.

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Headline**: Communicates category + value proposition in ≤ 8 words.
- **Visual anchor**: Install command (`brew install stigmer/tap/stigmer`) or a 5-line YAML snippet.
- **Primary CTA**: Leads to quickstart or install action.
- **Secondary CTA**: "View on GitHub" — trust signal.
- **Homepage-specific**: The hero must provide enough information for all three personas to self-select their path. Badges or sub-navigation hints (Use Cases, Features, Compare) below the CTAs help with path discovery.

### 2. Features

- **Template**: [`section-features.md`](section-features.md)
- **Homepage-specific**: Show the 6 core capabilities (Declarative YAML, Durable Execution, MCP Tool Protocol, Human-in-the-Loop, Local-First, Platform for Platforms). Each card links to the corresponding feature page.
- **Proof points**: Each feature card should include one concrete artifact (a metric, a code snippet, or a "learn more" link to the feature page).

### 3. How It Works

- **Template**: [`section-how-it-works.md`](section-how-it-works.md)
- **Homepage-specific**: 3-5 steps from "install" to "running agent." Focus on the simplest happy path (local mode, CLI). Do not show the cloud path here — that is an advanced topic for other pages.
- **Must include**: At least one YAML snippet and one terminal output showing a successful agent execution.

### 4. Quickstart / Code Showcase

- **Template**: [`section-code-showcase.md`](section-code-showcase.md)
- **Homepage-specific**: This section bridges the "How It Works" explanation with a concrete, copy-paste-able getting-started experience. Show the 3-command install-to-run flow.
- **Must include**: The `brew install` command, a minimal `agent.yaml`, and the `stigmer apply` + `stigmer run` commands with expected output.
- **Constraint**: The code must be runnable. If a visitor copies and pastes, it must work.

### 5. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Homepage-specific**: Final conversion point. Headline reinforces the core value. Primary CTA leads to the quickstart. Secondary CTA leads to GitHub.
- **Placement**: At the bottom of the page. A lighter CTA band may also appear between the Features and How It Works sections.

## CTA Strategy

| CTA | Label | Destination | Placement |
|---|---|---|---|
| **Primary** | "Install Stigmer" or "Follow the Quickstart" | Quickstart docs or install section | Hero + bottom CTA band |
| **Secondary** | "View on GitHub" | GitHub repo | Hero + bottom CTA band |
| **Tertiary** | Feature card links, "See how it works" | Feature pages, How It Works section | Features section, inline links |

## Internal Linking Requirements

The homepage must link to:

| Destination | Anchor Text Pattern | Example |
|---|---|---|
| Use-case pages | Persona-oriented | "See how solo developers use Stigmer" |
| Feature pages | Capability-oriented | "Explore durable execution" |
| Quickstart (docs) | Action-oriented | "Get started in 3 commands" |
| GitHub repo | Trust-oriented | "View on GitHub," "Star the repo" |

Minimum 2, maximum 3 internal links per content section (Features, How It Works).

## Copy Guidance

- The homepage speaks to all three personas but should not try to address all three equally in every section. The hero is universal. Features are universal. Use-case links allow self-selection.
- Avoid generic copy that works for any product. Every sentence should be Stigmer-specific. Test: replace "Stigmer" with "Acme AI Platform" — if the copy still works, it is too generic.
- The homepage says "why." It links to the docs for "how." Do not duplicate quickstart content — tease it with a code snippet and link to the full quickstart.
- Keep the page focused. Resist the temptation to add sections for social proof, pricing, or comparison on the homepage. Those are separate pages. The homepage earns the click to those pages.

## Quality Checklist

- [ ] All 5 required sections present in the correct order
- [ ] Hero headline ≤ 8 words, passes the "replace with Acme" test
- [ ] Working code visible within the first two viewports
- [ ] Every feature card follows Benefit → Feature → Proof
- [ ] How It Works shows 3-5 concrete steps with code artifacts
- [ ] Code examples are runnable (copy-paste works)
- [ ] Primary and secondary CTAs have specific action text
- [ ] Links to use-case pages, feature pages, quickstart, and GitHub
- [ ] No banned phrases (verify against `copy-guidelines.json`)
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] JSON-LD structured data: Organization, WebSite, SoftwareApplication
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints (375, 768, 1024, 1440)
- [ ] Lighthouse Performance ≥ 90
- [ ] WCAG 2.1 AA compliant
