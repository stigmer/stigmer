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

| Path               | Purpose                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `index.mdx`        | The welcome page                                                                                           |
| `getting-started/` | The Get Started journey, from the coding-agent setup to an agent in your app                               |
| `<topic>.mdx`      | A topic's explanation page, when the topic has no how-tos (Agents, Sessions, Billing)                      |
| `<topic>/`         | A topic with how-tos: `index.mdx` explains it, its how-tos sit beside it (Environments, Channels, Runners) |
| `guides/`          | Folders of how-tos with no explanation page of their own (Integrations, Authentication, Self-hosting)      |
| `sdk/`             | The SDK tab                                                                                                |
| `cli/`             | The CLI tab: its overview and the command reference, generated from `client-apps/cli/docs/commands/`       |

A page's address is its path under `docs/`: `docs/agents.mdx` is `/docs/agents`,
`docs/channels/index.mdx` is `/docs/channels`, and
`docs/channels/connect-slack.mdx` is `/docs/channels/connect-slack`. So where a
file sits is what its address says, and the folders follow the sidebar: an
explanation page sits at the top of `docs/`; when a topic gains how-tos, it
becomes a folder whose `index.mdx` is its explanation, shown as the folder's own
sidebar entry; `guides/` holds only folders of how-tos with no explanation page.

Moving a page changes its address, so the same change adds three lines to
`site/public/_redirects` (the page, its trailing slash and its `.md` twin, each
to the new address) and links the new address everywhere.
`site/src/lib/__tests__/docs-links.test.ts` fails on a link to an address no
page serves, on a redirect to one, and on a moved page missing one of its three
lines.

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

3. List the page in the sidebar: add it to the `pages` array of the `meta.json`
   in its directory or, for a page at the top of `docs/` or in a folder without
   one (such as `getting-started/`), to the root `docs/meta.json` by its path. A
   page listed nowhere fails the build (see below).
4. Follow the conventions in [STYLE.md](STYLE.md).

## Sidebar ordering with `meta.json`

A folder's `meta.json` gives the order of its pages, as
`docs/channels/meta.json` does:

```json
{
  "pages": [
    "create-a-chat-link",
    "embed-an-agent",
    "connect-slack",
    "bring-your-own-slack-app",
    "connect-whatsapp",
    "set-up-your-meta-app",
    "send-proactive-messages-with-templates",
    "take-over-conversations"
  ]
}
```

`pages` is an allowlist, not an ordering hint: a page it leaves out is not in
the sidebar. A folder's `index` page is the one exception and is included either
way.

A topic's folder has no `title`: its sidebar entry takes the title of its
`index.mdx`, so the topic's name is written once, in the page's frontmatter, and
the entry opens that page with its how-tos listed under it. A folder with no
index page (each one under `guides/`) gives its sidebar name as `title`. No two
neighbours in the sidebar share a name:
`site/src/lib/__tests__/sidebar-labels.test.ts` fails while two do.

The root `docs/meta.json` orders the top level. Its `pages` array mixes four
kinds of entry:

- `"---Get Started---"`: a separator that starts a sidebar group with that
  label;
- `"agents"`: one page, by its path under `docs/`: a page at the top, or one in
  a folder with no `meta.json` of its own (`"getting-started/quickstart"`);
- `"channels"`: a folder, listed with the order its own `meta.json` gives; its
  `index.mdx` is the entry itself;
- `"[Run it on your servers](/docs/guides/self-hosting/overview)"`: a link
  entry: an item with its own label that opens that page, so a page can also
  appear in a group its folder is not in.

The build checks that every page under `docs/` is reachable from these files:
`site/scripts/generate-llms-txt.ts` fails the build, naming each page that is
not, because such a page would vanish from `llms.txt` and the per-page `.md`
exports.

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
`Screen`, `ImageZoom`, `Cards`/`Card`.

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

- Capitalize Stigmer domain terms (Agent, Session, Skill, etc.).
- Use sentence casing for headings.
- Always add language hints to code blocks.
- Write for platform builders, not end users.

## Reporting issues

If you find a docs problem but cannot fix it yourself, open a GitHub issue with
the `docs` label and include the page address or file path.
