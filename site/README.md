# Stigmer Website

The official Stigmer product website at [stigmer.ai](https://stigmer.ai).

## Tech Stack

- **Framework**: Next.js 15 (App Router, Static Export)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS 4
- **Deployment**: GitHub Pages via GitHub Actions

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
├── next.config.ts    # Next.js configuration
├── tailwind.config.ts # Tailwind configuration (if needed)
└── tsconfig.json     # TypeScript configuration
```

## Deployment

The site is automatically deployed to GitHub Pages when changes are pushed to the `main` branch (in the `site/` directory).

### Manual Deployment

```bash
make build
# Upload contents of out/ to your hosting provider
```

## Design System

The site uses a custom design system with:

- **Colors**: Dark theme with blue primary and purple accents
- **Typography**: Geist Sans (body) and Geist Mono (code)
- **Components**: Based on shadcn/ui patterns with Radix primitives

See `src/app/globals.css` for design tokens.
