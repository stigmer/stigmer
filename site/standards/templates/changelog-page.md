# Page Template: Changelog Page

<!--
  CHANGELOG PAGE TEMPLATE
  =======================
  Type: Changelog
  URL: /changelog
  Funnel: Interest
  Personas: Existing users, evaluators

  The changelog signals project health and velocity. For existing users,
  it communicates what changed. For evaluators, it demonstrates that
  the project is actively maintained. A current, well-structured
  changelog is one of the strongest trust signals for open-source
  projects.
-->

## Page Metadata

| Field | Requirement |
|---|---|
| **Page type** | Changelog |
| **URL** | `/changelog` |
| **Funnel stages** | Interest |
| **Target personas** | Existing users, evaluators assessing project health |
| **Visitor goal** | See what changed, assess project velocity and stability |
| **Success metric** | Return visit, version adoption |

## Required Metadata

| Tag | Constraint |
|---|---|
| `<title>` | Max 60 chars. Format: `Changelog | Stigmer` |
| `<meta description>` | Max 160 chars. "Release notes, new features, and migration guides for Stigmer." |
| `og:title` | Matches `<title>` |
| `og:description` | Matches or abbreviates `<meta description>` |
| `og:url` | Canonical URL |
| `twitter:card` | `summary_large_image` (optional for changelog) |

## Narrative Arc

The changelog is chronological, not narrative. It is a reference, not a story. The most recent release is at the top. Each entry is self-contained.

## Section Sequence

### 1. Page Header

- **Required elements**:
  - Page title (`<h1>`): "Changelog"
  - Brief intro (1 sentence): "Release notes and migration guides for Stigmer."
  - Link to the GitHub releases page for full commit history.
- **No hero section**: The changelog does not use a hero. It is a reference page with a simple header.

### 2. Release Entries

- **Job**: Communicate what changed in each release clearly and completely.
- **Required elements per entry**:
  - **Version number** (H2): Semantic version following the project's versioning scheme.
  - **Release date**: ISO 8601 format displayed in human-readable form.
  - **Release type badge**: "Major," "Minor," "Patch," or "Pre-release" — visually distinct.
  - **Summary**: 1-2 sentences describing the theme of this release.
  - **Changes**: Grouped by category with specific entries.
  - **Migration guide** (if breaking changes): Step-by-step instructions for upgrading.
- **Change categories** (use consistently across all entries):
  - **Added** — New features or capabilities
  - **Changed** — Modifications to existing behavior
  - **Fixed** — Bug fixes
  - **Deprecated** — Features marked for future removal
  - **Removed** — Features removed in this release
  - **Security** — Security-related changes
  - **Breaking** — Changes that require user action to upgrade
- **Copy guidance**:
  - Each change entry is a factual statement: "Added support for MCP tool approval policies in agent YAML." Not "We are excited to announce amazing new support for..."
  - Include the relevant YAML, CLI command, or code change when a change affects user-facing behavior.
  - Breaking changes must include before/after examples and migration steps.
  - Link to the relevant feature page or docs guide for significant new features.

### 3. Pagination / Load More

- **Required if**: More than 10 release entries exist.
- **Pattern**: "Load more" button or infinite scroll with a visible page indicator. Do not paginate with separate URLs — the changelog is a single addressable page.

## Internal Linking Requirements

| Destination | Anchor Text Pattern |
|---|---|
| Feature pages | "Learn about {new feature}" — for significant additions |
| Docs | "Read the {feature} guide" or "See the migration guide" |
| GitHub releases | "View on GitHub" — per release or as a page-level link |

## Design Notes

- Release entries use a vertical timeline or card-based layout with clear visual separation between entries.
- Version numbers are prominent (Geist Sans, weight 700). Dates use `--muted` color.
- Category badges (Added, Fixed, Breaking) use distinct colors within the existing palette. Breaking changes use a warning color.
- Code examples within change entries use `text-sm` Geist Mono.
- Section padding between entries: `py-8` to `py-12` — compact but scannable.

## Accessibility

- Release entries use `<article>` elements with `aria-labelledby` pointing to the version heading.
- Category badges are not color-only — they include text labels.
- Migration guide code blocks have language tags.
- "Load more" button is keyboard-accessible with loading state announced via `aria-live`.

## Quality Checklist

- [ ] Most recent release is at the top
- [ ] Every entry has version number, date, and summary
- [ ] Changes are grouped by category (Added, Changed, Fixed, etc.)
- [ ] Breaking changes include before/after examples and migration steps
- [ ] Change descriptions are factual, not marketing
- [ ] Significant new features link to feature pages or docs
- [ ] Link to GitHub releases page present
- [ ] No marketing language in change descriptions
- [ ] Terminology matches `terminology.json`
- [ ] Unique `<title>` under 60 characters
- [ ] Unique `<meta description>` under 160 characters
- [ ] One `<h1>`, sequential heading levels
- [ ] Responsive at all four breakpoints
- [ ] WCAG 2.1 AA compliant
