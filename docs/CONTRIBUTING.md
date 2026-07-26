# Contributing to Stigmer documentation

Thank you for improving Stigmer's docs. This guide covers everything you need to
add or edit documentation.

## Prerequisites

| Tool    | Version | Install                    |
| ------- | ------- | -------------------------- |
| Node.js | 22 LTS  | `nvm use` (reads `.nvmrc`) |
| Vale    | 3.x     | `brew install vale`        |
| Lychee  | latest  | `brew install lychee`      |

After cloning the repo, run the one-time setup:

```bash
make setup
```

This installs Go/Python/Node.js dependencies, syncs Vale packages, and
configures Husky pre-commit hooks.

## Workflow

1. **Fork and branch** from `main`.
2. **Edit or create** `.mdx` files under `docs/`.
3. **Preview** locally with `make site` (starts the Fumadocs dev server with hot
   reload).
4. **Validate** before pushing:

   ```bash
   make lint-docs          # Vale prose lint (strict)
   make format-docs-check  # Prettier format check
   make check-links        # Broken link detection
   ```

5. **Commit**. Pre-commit hooks automatically run Prettier and Vale on staged
   docs files.
6. **Open a pull request** against `main`.

## Content architecture

Documentation lives in `docs/` at the repo root. Fumadocs renders it at `/docs/`
on the site. The sections, in sidebar order, are:

| Directory          | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `getting-started/` | Cloud quickstart, local quickstart, first Skill     |
| `concepts/`        | Core concepts (Agents, Skills, Workflows, etc.)     |
| `tutorials/`       | Progressive tutorials (tools, approvals, Workflows) |
| `sdks/`            | Per-language SDK guides                             |
| `cli/`             | CLI overview and command reference                  |
| `reference/`       | API reference                                       |

Non-rendered files that remain in `docs/` but are excluded from the sidebar:
`vocabulary.md`, `STYLE.md`, `CONTRIBUTING.md`, `README.md`.

## Adding a new page

1. Create a `.mdx` file in the appropriate section directory.
2. Add frontmatter with `title` and `description`:

   ```yaml no-validate="docs-page frontmatter example, not resource YAML"
   ---
   title: How to create a Skill
   description: Define a reusable Skill and attach it to an Agent.
   ---
   ```

3. If you need to control the page's position in the sidebar, edit the
   `meta.json` file in that section's directory. Each `meta.json` has a `pages`
   array that determines ordering.
4. Follow the conventions in [STYLE.md](STYLE.md).

## Sidebar ordering with `meta.json`

Each directory can contain a `meta.json` that controls sidebar title and page
order:

```json
{
  "title": "Getting started",
  "pages": ["quickstart", "local", "first-skill"]
}
```

Pages not listed in `meta.json` appear alphabetically after the listed pages.

## Make targets

| Target                   | Description                            |
| ------------------------ | -------------------------------------- |
| `make site`              | Start Fumadocs dev server (hot reload) |
| `make lint-docs`         | Vale lint (strict, fails on warnings)  |
| `make format-docs`       | Prettier format (writes files)         |
| `make check-links`       | Lychee broken link check               |
| `make lint-docs-audit`   | Vale lint (non-blocking report)        |
| `make format-docs-check` | Prettier check (CI, no writes)         |

## Pre-commit hooks

Husky runs two checks on every commit:

1. **Prettier** (via lint-staged) reformats any staged `docs/**/*.{md,mdx}`
   files.
2. **Vale** lints staged docs files if Vale is installed. If Vale is not
   available, the hook prints a warning but does not block the commit.

To bypass hooks in an emergency, use `git commit --no-verify`. CI will still
catch issues.

## MDX components

Custom components are available in all `.mdx` files without needing `import`
statements. See [STYLE.md](STYLE.md) for usage examples of each component.

Available components: `Callout`, `Tabs`/`Tab`, `SDKTabs`, `Steps`/`Step`,
`Term`, `Files`/`Folder`/`File`, `Accordions`/`Accordion`, `TypeTable`,
`ImageZoom`, `Cards`/`Card`.

### Docs component directory

Custom docs-specific components live in `site/src/components/docs/`. This
directory is separate from the website components (`site/src/components/ui/`,
`layout/`, etc.) to maintain a clear boundary between the marketing site and
documentation.

| File           | Purpose                                     |
| -------------- | ------------------------------------------- |
| `glossary.ts`  | Term definitions for the `<Term>` component |
| `term.tsx`     | `<Term>` glossary tooltip component         |
| `sdk-tabs.tsx` | `<SDKTabs>` language switcher wrapper       |
| `index.ts`     | Barrel export                               |

All components (Fumadocs built-ins and custom) are registered in
`site/src/components/mdx.tsx`.

### Adding a new glossary term

Edit `site/src/components/docs/glossary.ts` and add an entry to the `glossary`
object. The key is the term as it appears in prose; the value is a one- or
two-sentence plain-language definition.

## Writing conventions

See [STYLE.md](STYLE.md) for the full style guide. The key points:

- Capitalize Stigmer domain terms (Agent, Workflow, Skill, etc.).
- Use sentence casing for headings.
- Always add language hints to code blocks.
- Write for platform builders, not end users.

## Reporting issues

If you find a docs problem but cannot fix it yourself, open a GitHub issue with
the `docs` label and include the page address or file path.
