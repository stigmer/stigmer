# Page Template: Blog Page

<!--
  BLOG PAGE TEMPLATE
  ==================
  Type: Blog
  URL: /blog/{post-slug}
  Funnel: Awareness → Interest
  Personas: All

  Blog posts drive organic traffic, build thought leadership, and
  demonstrate the team's technical depth. They are content marketing
  assets — each post targets a specific search intent and guides the
  reader toward Stigmer's ecosystem.

  This template covers individual blog posts. The blog index page
  (/blog) is a listing page that does not need a template — it is
  a reverse-chronological card grid of posts.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Blog |
| **URL pattern** | `/blog/{post-slug}` |
| **Funnel stages** | Awareness → Interest |
| **Target personas** | All (varies per post) |
| **Visitor goal** | Learn something useful, build trust in the Stigmer team |
| **Success metric** | Click-through to related post or quickstart |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `{Post Title} | Stigmer Blog` |
| `<meta description>` | Max 160 chars. Post summary with specific detail + CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Post-specific or default blog OG image. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |
| `author` | Author name (required for structured data) |
| `date` | Publication date in ISO 8601 format |

## Structured Data

- `Article` or `BlogPosting` (with author, datePublished, headline, image)

## Post Types

Blog posts fall into several categories. Each post should be identifiable as one type:

| Type | Purpose | Example |
|---|---|---|
| **Technical deep-dive** | Explain a Stigmer capability in depth | "How Durable Execution Works Under the Hood" |
| **Tutorial** | Teach the reader to build something | "Build a Research Agent with Stigmer and MCP" |
| **Announcement** | Communicate a product launch or milestone | "Stigmer v1.0: What's New" |
| **Comparison / Opinion** | Technical analysis of approaches | "Why We Chose Temporal Over Custom State Machines" |
| **Ecosystem** | Spotlight community, integrations, or use cases | "How Platform Builders Are Embedding Stigmer" |

## Section Sequence

### 1. Title Block

- **Required elements**:
  - Post title (`<h1>`): Descriptive, keyword-aware, benefit-oriented when possible. "Why Durable Execution Matters for AI Agents" is better than "Announcing Durable Execution."
  - Author name and avatar (if available).
  - Publication date.
  - Reading time estimate.
  - Category tag or label (Technical, Tutorial, Announcement, etc.).
- **No hero section**: Blog posts use a title block, not a hero. The content starts immediately after the title block.

### 2. Content

- **Job**: Deliver genuinely useful technical content that earns the reader's trust.
- **Required elements**:
  - Structured with H2 and H3 headings for scannability.
  - Code examples with language tags, copy buttons, and context labels.
  - At least one visual element (code block, diagram, terminal output, or comparison table).
- **Copy guidance**:
  - Blog posts should teach, not sell. The reader came to learn something — deliver on that promise first. Stigmer promotion is secondary and should feel natural, not forced.
  - Technical depth is expected. Surface-level posts that could have been written by someone who read the README are not valuable. Show depth that demonstrates genuine expertise.
  - Write in the same voice as the rest of the site: confident, technical, conversational. Not academic. Not casual.
  - Every factual claim needs support (code, data, link). Blog posts follow the same "show, don't tell" standard as the rest of the site.
- **Constraint**: Blog posts must not contradict information on other site pages, in the docs, or in the README. If a blog post references a Stigmer capability, it must be accurate for the current version.

### 3. Related Posts

- **Job**: Keep the reader in the ecosystem.
- **Required elements**:
  - 2-3 links to related blog posts or relevant site pages.
  - Each link has a descriptive title and a 1-sentence summary.
- **Copy guidance**: "Related" means genuinely related by topic, not "other posts we want to promote." A post about durable execution links to posts about reliability, Temporal, or agent architecture — not to unrelated announcements.
- **Layout**: Card grid below the content, visually separated. Or inline callouts within the content at natural topic transitions.

### 4. CTA (Inline, not CTA Band)

- **Job**: Guide interested readers toward Stigmer.
- **Pattern**: Blog posts use an inline CTA at the end of the content (before related posts), not a full CTA band. The tone is softer: "Want to try this yourself? Follow the quickstart." not a hard sell.
- **Constraint**: Maximum one inline CTA per post. The blog exists to build trust through useful content — aggressive CTAs undermine that purpose.

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Related blog posts | "Read more about {topic}" |
| Feature pages | "Learn about {feature}" — when the post discusses a Stigmer capability |
| Use-case pages | "See how {persona} uses this" — when relevant |
| Docs | "Follow the {guide}" — for readers who want to try what the post describes |
| Quickstart | "Try it yourself" — as the inline CTA |

## Blog Index Page (`/blog`)

The blog index is a listing page, not a content page. Requirements:

- Reverse-chronological post listing.
- Each entry shows: title, date, author, category tag, 1-2 sentence summary.
- Card grid layout: 1 column on mobile, 2 on tablet, 3 on desktop.
- Pagination or "Load more" if more than 12 posts.
- Filter by category tag (optional).

## Quality Checklist

- [ ] Title block includes: title, author, date, reading time, category
- [ ] Content is structured with H2/H3 headings for scannability
- [ ] At least one visual element (code block, diagram, table)
- [ ] Code examples have language tags and copy buttons
- [ ] Content teaches first, promotes second
- [ ] Technical claims are accurate for the current version
- [ ] 2-3 genuinely related posts or pages linked
- [ ] Maximum one inline CTA, softly written
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters
- [ ] One `<h1>`, sequential heading levels
- [ ] JSON-LD: Article or BlogPosting with author, date, headline
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
