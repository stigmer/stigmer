# Information Architecture

This document defines the page map, navigation structure, URL scheme, internal linking rules, and page inventory for the Stigmer sales website. It is the authoritative reference for site structure decisions and the blueprint for any content project that adds or reorganizes pages.

The page types, section types, and funnel stages referenced here are defined in [`website-standards.md`](website-standards.md).

---

## Page Map

Every page on the sales website belongs to exactly one funnel stage and targets one or more personas. The funnel stages are:

| Stage | Visitor Goal | Site's Job |
|---|---|---|
| **Awareness** | "What is this?" | Hook in 5 seconds |
| **Interest** | "What does it do?" | Educate with benefits |
| **Evaluation** | "Is it right for me?" | Build trust, address objections |
| **Action** | "Let me try it" | Remove friction |

The three target personas are:

| Persona | Motivation | Primary Objection |
|---|---|---|
| **Solo developer / indie hacker** | Ship AI features fast, minimal infra | "Is it production-ready?" / "Will I get locked in?" |
| **Platform team lead** | Embed agentic capabilities into their product | "How does this integrate with our stack?" |
| **Engineering manager / architect** | Evaluate build-vs-buy for agent infrastructure | "How does this compare to X?" |

### Page Map by Funnel Stage

```
Awareness
│
├── Homepage (/)
│   Hub page. Provides clear paths for each persona's journey.
│   Personas: all
│
Interest
│
├── Use Cases (/use-cases)
│   ├── Solo Developer (/use-cases/solo-developer)
│   ├── Platform Builder (/use-cases/platform-builder)
│   └── Engineering Leader (/use-cases/engineering-leader)
│
├── Features (/features)
│   ├── Declarative YAML (/features/declarative-yaml)
│   ├── Durable Execution (/features/durable-execution)
│   ├── MCP Tool Protocol (/features/mcp-tool-protocol)
│   ├── Human-in-the-Loop (/features/human-in-the-loop)
│   ├── Local-First (/features/local-first)
│   └── Platform for Platforms (/features/platform-for-platforms)
│
Evaluation
│
├── Compare (/compare)
│   ├── Stigmer vs LangChain (/compare/langchain)
│   ├── Stigmer vs CrewAI (/compare/crewai)
│   └── Stigmer vs Custom Solutions (/compare/custom-solutions)
│
├── Pricing (/pricing)
│
Action
│
├── Community (/community)
│
Cross-Funnel
│
├── Blog (/blog)
│   └── {individual posts} (/blog/{post-slug})
│
└── Changelog (/changelog)
```

### Page Registry

Each page has a defined type, funnel stage, persona target, visitor goal, and success metric.

#### Awareness

| Page | Type | Personas | Visitor Goal | Success Metric |
|---|---|---|---|---|
| **Homepage** | Homepage | All | Understand what Stigmer is and find a relevant path | Scroll depth > 60%, click-through to use-case or quickstart |

#### Interest

| Page | Type | Personas | Visitor Goal | Success Metric |
|---|---|---|---|---|
| **Solo Developer** | Use-Case | Solo dev | See how Stigmer solves their specific problem | Click-through to quickstart or install command |
| **Platform Builder** | Use-Case | Platform lead | Understand how Stigmer embeds into their product | Click-through to SDK docs or architecture |
| **Engineering Leader** | Use-Case | Eng manager | Evaluate whether Stigmer replaces custom agent infra | Click-through to comparison or pricing |
| **Declarative YAML** | Feature | All | Understand the YAML-first configuration model | Click-through to quickstart or docs |
| **Durable Execution** | Feature | All | Understand crash recovery and checkpoint semantics | Click-through to architecture docs |
| **MCP Tool Protocol** | Feature | All | Understand how agents connect to external tools | Click-through to MCP server guide |
| **Human-in-the-Loop** | Feature | All | Understand approval workflows and human oversight | Click-through to guide or use-case |
| **Local-First** | Feature | Solo dev, platform lead | Understand zero-cloud-dependency local development | Click-through to quickstart |
| **Platform for Platforms** | Feature | Platform lead | Understand SDK packages, gRPC API, multi-tenant model | Click-through to SDK docs or platform builder use-case |

#### Evaluation

| Page | Type | Personas | Visitor Goal | Success Metric |
|---|---|---|---|---|
| **Stigmer vs LangChain** | Comparison | Eng manager, solo dev | Honest technical comparison of the two approaches | Click-through to quickstart or feature page |
| **Stigmer vs CrewAI** | Comparison | Eng manager, solo dev | Honest comparison of multi-agent orchestration approaches | Click-through to quickstart or feature page |
| **Stigmer vs Custom Solutions** | Comparison | Eng manager, platform lead | Build-vs-buy analysis for agent infrastructure | Click-through to pricing or quickstart |
| **Pricing** | Pricing | Eng manager, platform lead | Understand OSS vs Cloud, costs, and feature boundaries | Click-through to quickstart (OSS) or Cloud signup |

#### Action

| Page | Type | Personas | Visitor Goal | Success Metric |
|---|---|---|---|---|
| **Community** | Community | All | Find contribution paths, community channels, ecosystem | GitHub star, Discord join, or contribution |

#### Cross-Funnel

| Page | Type | Personas | Visitor Goal | Success Metric |
|---|---|---|---|---|
| **Blog** (index) | Blog | All | Browse technical posts and announcements | Click-through to individual post |
| **Blog** (post) | Blog | All | Learn something useful, build trust in the team | Click-through to related post or quickstart |
| **Changelog** | Changelog | Existing users, evaluators | See what changed, assess project velocity | Return visit, version adoption |

---

## Navigation Structure

### Header Navigation

The header is the primary wayfinding mechanism. It surfaces the most important paths without overwhelming the visitor. Links are task-oriented: labels describe what the visitor will find, not how the content is categorized internally.

```
[Logo: Stigmer]   Use Cases   Features   Compare   Docs   Pricing   [GitHub →]
```

| Position | Label | Target | Notes |
|---|---|---|---|
| 1 | **Use Cases** | `/use-cases` (index) or dropdown | Interest-stage entry point per persona |
| 2 | **Features** | `/features` (index) or dropdown | Interest-stage entry point per capability |
| 3 | **Compare** | `/compare` (index) or dropdown | Evaluation-stage entry point |
| 4 | **Docs** | `/docs` | Documentation site (external navigation target) |
| 5 | **Pricing** | `/pricing` | Evaluation-to-action bridge |
| 6 | **GitHub** | External: `github.com/stigmer/stigmer` | Trust signal; always visible as button/icon |

**Dropdown behavior (if used):**

Use Cases, Features, and Compare may use dropdowns to surface individual pages without requiring an index page visit. Dropdowns must be keyboard-navigable, close on `Escape`, and work on touch devices with a tap-to-toggle pattern.

If the page count within a category is small (3 or fewer), a dropdown is preferred. If the count grows beyond 6, an index page with a card grid is preferred over a long dropdown.

### Footer Navigation

The footer provides comprehensive navigation organized by audience intent. It includes links not surfaced in the header.

```
Product             Developers          Resources           Open Source
─────────           ──────────          ─────────           ───────────
Features            Documentation       Blog                GitHub
Use Cases           Quickstart          Changelog           Contributing
Compare             CLI Reference       Community           Issues
Pricing             SDK Guide                               License (Apache 2.0)
```

| Section | Purpose | Links |
|---|---|---|
| **Product** | Pages that explain the product | Features, Use Cases, Compare, Pricing |
| **Developers** | Pages that help developers use the product | Documentation, Quickstart, CLI Reference, SDK Guide |
| **Resources** | Content and community | Blog, Changelog, Community |
| **Open Source** | Trust signals and contribution paths | GitHub, Contributing, Issues, License |

The footer also includes:

- **Brand column**: Logo, one-line tagline, license badge
- **Bottom bar**: Copyright notice, link to privacy policy (when applicable)

### Mobile Navigation

Mobile replicates the header navigation in a full-screen slide-out drawer. Requirements:

- Opens on hamburger tap; closes on `X`, `Escape`, or outside tap
- Focus trap while open; focus returns to hamburger on close
- Scroll lock on body while open
- Respects `prefers-reduced-motion` for open/close animation
- All header links plus GitHub presented as a vertical stack
- No nested dropdowns on mobile; all pages listed flat

### Breadcrumbs

Breadcrumbs appear on all pages except the homepage. They provide positional context and a path back to the parent.

```
Stigmer > Use Cases > Solo Developer
Stigmer > Compare > LangChain
Stigmer > Features > Durable Execution
Stigmer > Blog > Why Durable Execution Matters
```

**Rules:**

- First segment is always "Stigmer" and links to `/`
- Second segment is the page type category and links to the index page (if one exists)
- Third segment is the current page (not linked)
- Blog posts and changelog entries use the section name as the second segment
- Singleton pages (Pricing, Community) use only two segments: `Stigmer > Pricing`
- Breadcrumbs use `<nav aria-label="Breadcrumb">` with an ordered list and `aria-current="page"` on the last item

---

## URL Scheme

Every page type maps to a predictable URL pattern. URLs are permanent — once published, they must not change without a redirect.

### URL Patterns

| Page Type | URL Pattern | Example |
|---|---|---|
| Homepage | `/` | `/` |
| Use-Case | `/use-cases/{persona-slug}` | `/use-cases/solo-developer` |
| Comparison | `/compare/{competitor-slug}` | `/compare/langchain` |
| Feature | `/features/{feature-slug}` | `/features/durable-execution` |
| Landing | `/launch/{campaign-slug}` | `/launch/v1` |
| Pricing | `/pricing` | `/pricing` |
| Changelog | `/changelog` | `/changelog` |
| Blog | `/blog/{post-slug}` | `/blog/why-durable-execution` |
| Community | `/community` | `/community` |

### Index Pages

Categories with multiple child pages have an index page at the root of their URL segment:

| Index Page | URL | Content |
|---|---|---|
| Use Cases | `/use-cases` | Card grid linking to all use-case pages, organized by persona |
| Features | `/features` | Card grid linking to all feature pages, organized by category |
| Compare | `/compare` | Card grid linking to all comparison pages |
| Blog | `/blog` | Reverse-chronological post listing with title, date, and summary |

Index pages are optional in the header nav (dropdowns can replace them) but must exist as addressable URLs so that breadcrumbs and internal links have valid targets.

### Slug Conventions

- **Lowercase with hyphens**: `durable-execution`, not `DurableExecution` or `durable_execution`
- **Descriptive, not abbreviated**: `platform-for-platforms`, not `p4p`
- **Persona-oriented for use-case pages**: `solo-developer`, not `individual-contributor`
- **Competitor name for comparison pages**: `langchain`, not `lang-chain` or `lc`
- **Feature name for feature pages**: Match the canonical name from the homepage features section
- **Verb-noun for blog posts**: `why-durable-execution`, `building-agents-with-yaml`
- **No dates in URLs**: Blog posts use slugs, not `/blog/2026/03/21/post-title`
- **No trailing slashes**: `/features/durable-execution`, not `/features/durable-execution/`

### Directory-to-Route Mapping

With Next.js App Router (static export), each page maps to a directory under `site/src/app/`:

| URL Pattern | App Router Path | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Exists |
| `/use-cases` | `app/use-cases/page.tsx` | Index page |
| `/use-cases/{slug}` | `app/use-cases/[slug]/page.tsx` | Dynamic route |
| `/features` | `app/features/page.tsx` | Index page |
| `/features/{slug}` | `app/features/[slug]/page.tsx` | Dynamic route |
| `/compare` | `app/compare/page.tsx` | Index page |
| `/compare/{slug}` | `app/compare/[slug]/page.tsx` | Dynamic route |
| `/pricing` | `app/pricing/page.tsx` | Singleton |
| `/community` | `app/community/page.tsx` | Singleton |
| `/blog` | `app/blog/page.tsx` | Index page |
| `/blog/{slug}` | `app/blog/[slug]/page.tsx` | Dynamic route |
| `/changelog` | `app/changelog/page.tsx` | Singleton |
| `/launch/{slug}` | `app/launch/[slug]/page.tsx` | Dynamic route, created per campaign |
| `/docs/*` | `app/docs/[[...slug]]/page.tsx` | Exists (Fumadocs) |

For static export, dynamic routes require `generateStaticParams()` to enumerate all slugs at build time.

---

## Internal Linking Rules

Internal links guide visitors through the conversion funnel. Every link must move the visitor forward in their journey — from Awareness to Interest to Evaluation to Action.

### Funnel Flow

```
                    ┌─────────────────────┐
                    │      Homepage        │
                    │    (Awareness)       │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Use Cases  │  │  Features  │  │    Blog    │
     │ (Interest) │  │ (Interest) │  │ (Interest) │
     └──────┬─────┘  └──────┬─────┘  └──────┬─────┘
            │               │               │
            └───────┬───────┘               │
                    ▼                       │
     ┌──────────────────────────┐           │
     │  Compare  ·  Pricing    │ ◄─────────┘
     │      (Evaluation)       │
     └────────────┬────────────┘
                  │
                  ▼
     ┌──────────────────────────┐
     │  Quickstart · Community  │
     │  Install    · Docs       │
     │        (Action)          │
     └──────────────────────────┘
```

### Linking Requirements by Page Type

Every page must include 2-3 outbound internal links with descriptive anchor text. No page is a dead end.

| Page Type | Must Link To | Example Anchor Text |
|---|---|---|
| **Homepage** | Use-case pages, feature pages, quickstart | "See how solo developers use Stigmer", "Explore durable execution" |
| **Use-Case** | Related feature pages, comparison pages, quickstart | "Compare Stigmer to LangChain", "Get started in 3 commands" |
| **Feature** | Related use-case pages, other feature pages, docs deep-dive | "See this in action for platform builders", "Read the architecture docs" |
| **Comparison** | Feature pages (for claims made), quickstart, pricing | "See how durable execution works", "Try it yourself" |
| **Pricing** | Quickstart (OSS path), Cloud signup, FAQ answers linking to feature pages | "Start with the open-source version", "See what durable execution includes" |
| **Blog** | Related blog posts, relevant feature or use-case pages, docs | "Read more about MCP tool protocol", "Try the quickstart" |
| **Changelog** | Relevant feature pages, docs for migration guides | "Learn about the new MCP integration" |
| **Community** | GitHub, contributing guide, quickstart, docs | "Start contributing", "Join the community" |
| **Landing** | Quickstart, feature pages relevant to the campaign | Campaign-specific CTAs |

### Anchor Text Rules

- **Descriptive**: "Compare Stigmer to LangChain" — not "Click here" or "Learn more"
- **Action-oriented**: "Get started in 3 commands" — not "Getting started page"
- **Honest about destination**: The anchor text must accurately describe what the visitor will find at the link target
- **No generic CTAs as internal links**: "Learn more" is acceptable only as a button CTA, never as inline text link

### Cross-Site Links

The sales site links to the documentation site and GitHub. These are distinct destinations with different purposes:

| Destination | When to Link | Anchor Pattern |
|---|---|---|
| **Docs** (`/docs/*`) | When the visitor needs how-to depth beyond what the sales page provides | "Read the {topic} guide", "See the CLI reference" |
| **GitHub** | When showing the source builds trust or the visitor wants to contribute | "View on GitHub", "Star the repo", "Read the source" |
| **Cloud signup** | When the visitor has evaluated and is ready for the hosted offering | "Start your Cloud trial" (when Cloud exists) |

The sales site says "why." The docs say "how." Links between them should respect this boundary — the sales site does not duplicate docs content; it links to it.

### Orphan Page Prevention

Every page in the page map must be reachable through at least two paths:

1. **Navigation** — Header, footer, or breadcrumb link
2. **Content link** — Inline link from another page's body content

Pages that are only reachable through navigation are functionally invisible to visitors who do not explore the nav. Pages that are only reachable through content links are invisible to visitors who navigate by menu. Both paths are required.

---

## Page Inventory

### Current State

| URL | Status | Page Type | Notes |
|---|---|---|---|
| `/` | **Exists** | Homepage | 4 sections: Hero, Features, Architecture, Quickstart |
| `/docs` | **Exists** | — | Fumadocs documentation site |
| `/docs/*` | **Exists** | — | Individual docs pages via catch-all route |
| `/examples` | **Dead link** | — | In header/footer nav but no page exists |
| `/changelog` | **Dead link** | Changelog | In footer nav but no page exists |

### Planned Pages by Priority

Priority tiers determine the order in which pages are created in the content project that follows this standards foundation.

#### P0: Foundation

These pages exist or must be updated before the content project begins.

| Page | URL | Status | Notes |
|---|---|---|---|
| Homepage | `/` | Exists — update needed | Add internal links to new pages as they are created |

#### P1: First Wave

Core content pages that complete the primary conversion funnel. Build these first.

| Page | URL | Rationale |
|---|---|---|
| Solo Developer | `/use-cases/solo-developer` | Highest-traffic persona; most likely to install immediately |
| Platform Builder | `/use-cases/platform-builder` | Differentiating persona; "platform for platforms" is a key message |
| Engineering Leader | `/use-cases/engineering-leader` | Decision-maker persona; drives adoption at team/org level |
| Durable Execution | `/features/durable-execution` | Most differentiating technical capability |
| Local-First | `/features/local-first` | Strongest trust signal for the solo developer persona |
| MCP Tool Protocol | `/features/mcp-tool-protocol` | Timely; MCP is gaining ecosystem momentum |
| Stigmer vs LangChain | `/compare/langchain` | Most common comparison visitors will search for |
| Stigmer vs CrewAI | `/compare/crewai` | Second most common comparison in the multi-agent space |

#### P2: Second Wave

Complete the feature set and add evaluation/action pages.

| Page | URL | Rationale |
|---|---|---|
| Declarative YAML | `/features/declarative-yaml` | Supports the "5 lines of YAML" claim on the homepage |
| Human-in-the-Loop | `/features/human-in-the-loop` | Important for enterprise adoption conversations |
| Platform for Platforms | `/features/platform-for-platforms` | Deepens the platform builder use-case |
| Stigmer vs Custom | `/compare/custom-solutions` | Build-vs-buy is a common evaluation path |
| Pricing | `/pricing` | Required when Stigmer Cloud launches |
| Community | `/community` | Drives contribution and ecosystem growth |
| Changelog | `/changelog` | Already linked in footer; resolves the dead link |

#### P3: Ongoing

Pages created on an ongoing basis or as campaigns arise.

| Page | URL Pattern | Trigger |
|---|---|---|
| Blog posts | `/blog/{post-slug}` | Technical content, tutorials, launch announcements |
| Blog index | `/blog` | Created when the first blog post ships |
| Landing pages | `/launch/{campaign-slug}` | Product launches, conference campaigns, partnerships |
| Use Cases index | `/use-cases` | Created when at least 2 use-case pages exist |
| Features index | `/features` | Created when at least 3 feature pages exist |
| Compare index | `/compare` | Created when at least 2 comparison pages exist |

### Dead Link Resolution

The following links exist in the current navigation ([`lib/constants.ts`](../src/lib/constants.ts)) but point to nonexistent pages:

| Link | Current Target | Resolution |
|---|---|---|
| Header: "Examples" | `/examples` | Replace with "Features" → `/features` when feature pages exist. Until then, remove or point to docs examples. |
| Footer: "Examples" | `/examples` | Same as header resolution. |
| Footer: "Changelog" | `/changelog` | Create changelog page (P2) or remove link until it exists. |
| Footer: "Getting Started" | `/docs/getting-started` | Verify this docs route exists. If not, point to `/docs/quickstarts/cli`. |
| Footer: "API Reference" | `/docs/api` | Verify this docs route exists. If not, remove until API docs are published. |

Dead links must not ship. Either create the page, update the link target, or remove the link.
