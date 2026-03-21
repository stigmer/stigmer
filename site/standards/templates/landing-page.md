# Page Template: Landing Page

<!--
  LANDING PAGE TEMPLATE
  =====================
  Type: Landing
  URL: /launch/{campaign-slug}
  Funnel: Awareness → Action
  Personas: Campaign-specific

  Landing pages are single-purpose conversion pages tied to a specific
  campaign, launch, or event. They are tightly focused: one message,
  one audience, one action. Unlike other page types, they may omit
  standard navigation to reduce exit paths.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Landing |
| **URL pattern** | `/launch/{campaign-slug}` |
| **Funnel stages** | Awareness → Action |
| **Target personas** | Campaign-specific (defined per landing page) |
| **Visitor goal** | Understand the campaign message and take the campaign action |
| **Success metric** | Campaign-specific conversion action |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Campaign-specific. Format: `{Campaign Message} | Stigmer` |
| `<meta description>` | Max 160 chars. Campaign value prop + CTA. |
| `og:title` | Matches or abbreviates `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:image` | 1200x630px. Campaign-specific visual. |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` |

## Structured Data

- `SoftwareApplication` (if relevant to the campaign)

## Narrative Arc

Landing pages are compressed funnels — they move the visitor from awareness to action in a single page:

1. **Hook** (Hero) — What is this about? One message, immediately clear.
2. **Key Message** — Why does it matter? The single most important thing to communicate.
3. **Validate** (Social Proof) — Who else cares? Project health signals, community activity.
4. **Convert** (CTA Band) — Take the action.

## Section Sequence

### 1. Hero

- **Template**: [`section-hero.md`](section-hero.md)
- **Page-specific**: Headline is campaign-specific. For a product launch: "Stigmer v1.0: Durable AI Agents Are Here." For a conference: "Building AI Agents? Start Here." The headline must work for someone who knows nothing about Stigmer.
- **Visual anchor**: Campaign-relevant. For a launch: the key feature in code. For a conference: the install command.
- **Navigation**: Landing pages may use a simplified header (logo + primary CTA only) to reduce exit paths. Standard footer is optional.

### 2. Key Message

- **Job**: Deliver the single most important message of the campaign.
- **Required elements**:
  - A focused content block (2-4 paragraphs or a feature highlight list) that expands on the hero's promise.
  - At least one proof artifact (code snippet, demo link, metric).
- **Copy guidance**: Stay focused. A landing page that tries to communicate 5 things communicates none. Identify the one message and support it from multiple angles.
- **Constraint**: No more than 2 scrollable viewports of content between the hero and the final CTA. Landing pages are short by design.

### 3. Social Proof

- **Template**: [`section-social-proof.md`](section-social-proof.md)
- **Page-specific**: Show 2-3 project health metrics (GitHub stars, contributors, release cadence). Keep it compact. The social proof section on a landing page is a trust signal, not a deep credibility section.

### 4. CTA Band

- **Template**: [`section-cta-band.md`](section-cta-band.md)
- **Page-specific**: The CTA must match the campaign's goal. For a launch: "Install Stigmer v1.0." For a conference: "Try the Quickstart." Repeat the same CTA from the hero — do not introduce a different action.

## CTA Strategy

| CTA | Label | Destination |
|---|---|---|
| **Primary** | Campaign-specific action | Quickstart, install, or signup |
| **Secondary** | "Learn More About Stigmer" | Homepage or relevant feature page |

The primary CTA appears in the hero and at the page bottom. No other CTAs should compete.

## Internal Linking Requirements

Landing pages have minimal internal linking to keep visitors focused:

| Destination | Anchor Text Pattern |
|---|---|
| Quickstart (docs) | Campaign-specific action CTA |
| Feature pages | "Learn more about {feature}" — only for the capability most relevant to the campaign |

## Design Notes

- Landing pages may use a distinct visual treatment (different hero layout, campaign-specific colors within the existing palette) to feel timely and event-specific.
- Maximum page length: 4-5 viewports. If the page needs more content, it is not a landing page — it is a feature page or use-case page.
- Mobile-first: Many landing page visitors come from social media links on mobile devices.

## Quality Checklist

- [ ] All 4 required sections present (Hero, Key Message, Social Proof, CTA Band)
- [ ] Single focused message — not trying to communicate multiple things
- [ ] Page length ≤ 5 viewports
- [ ] Primary CTA appears in hero and at page bottom with identical action
- [ ] Proof artifact present (code, demo, metric)
- [ ] Social proof metrics are real and current
- [ ] Simplified navigation (optional) does not trap the visitor
- [ ] No banned phrases
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters with CTA
- [ ] One `<h1>`, sequential heading levels
- [ ] OG and Twitter Card meta tags present
- [ ] Responsive at all four breakpoints (especially mobile)
- [ ] WCAG 2.1 AA compliant
