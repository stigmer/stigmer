# Stigmer Website

The official Stigmer product website at [stigmer.ai](https://stigmer.ai).

## Tech Stack

- **Framework**: Next.js 15 (App Router, Static Export)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4
- **Deployment**: a Cloudflare Worker serving the static export, via GitHub Actions, with a review site per pull request

## Development

### Prerequisites

- Node.js 20+
- Yarn 4.5+ (via Corepack)

### Setup

```bash
# Enable Corepack for Yarn
corepack enable

# Install dependencies
make deps
# or: yarn install

# Start development server
make dev
# or: yarn dev
```

The site will be available at [http://localhost:3000](http://localhost:3000).

### Commands

| Command | Description |
|---------|-------------|
| `make deps` | Install dependencies |
| `make dev` | Start dev server (port 3000) |
| `make build` | Production build → `out/` |
| `make lint` | Run ESLint |
| `make typecheck` | Run TypeScript type checking |
| `make preview` | Build and serve static site locally |
| `make clean` | Remove build artifacts |

### Custom Port

```bash
make dev PORT=3001
```

## Project Structure

```
site/
├── public/           # Static assets
│   └── docs/         # Markdown documentation
├── src/
│   ├── app/          # Next.js App Router pages
│   ├── components/
│   │   ├── pages/    # Page compositions
│   │   ├── sections/ # Page sections (Hero, Features, etc.)
│   │   └── ui/       # Atomic components (Button, Badge)
│   ├── lib/          # Utilities and constants
│   └── theme/        # Design tokens
├── deploy/           # The deploy jobs' one tool (pinned wrangler) and their scripts
├── wrangler.jsonc    # The website's two Cloudflare Workers
├── next.config.ts    # Next.js configuration
├── tailwind.config.ts # Tailwind configuration (if needed)
└── tsconfig.json     # TypeScript configuration
```

## Deployment

One build, `.github/workflows/build.website.yaml`, makes the static export for both of its uses:

- **Production.** A merge to `main` that touches the site, the docs, the tours or a package the site links runs `release.website.yaml`, which deploys the export to the Cloudflare Worker `stigmer-website` (`wrangler.jsonc`).
- **Review sites.** Every pull request that would redeploy the site gets the same build at `https://review-<pull request number>.stigmer.ai`, linked in a comment on the pull request. `preview.website.yaml` builds it with no key; `publish.website-preview.yaml`, which runs from `main`, uploads it as a version of `stigmer-website-preview`, marks it `noindex`, and closes it when the pull request is merged or closed. A pull request from a fork waits for a maintainer's approval before its review site goes up.

The deploy jobs never install the site's dependencies: they install only the pinned wrangler in `deploy/`, and `deploy/check-export-read.sh` refuses a deploy unless wrangler reads every file of the export.

## Design System

The site uses a custom design system with:

- **Colors**: Dark theme with blue primary and purple accents
- **Typography**: Geist Sans (body) and Geist Mono (code)
- **Components**: Based on shadcn/ui patterns with Radix primitives

See `src/app/globals.css` for design tokens.
