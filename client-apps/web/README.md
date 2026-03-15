# Stigmer Web Console

Browser-based interface for Stigmer — run agents, monitor executions, manage sessions, and browse the resource catalog.

## Development

Prerequisites: Node.js 22+ and npm.

```bash
# From the repo root — install all workspace dependencies
npm install

# Start the dev server (port 3000)
npm run dev -w client-apps/web
```

The dev server connects to stigmer-server at `http://localhost:7234` by default (configurable via `NEXT_PUBLIC_API_URL`). Run `stigmer server` in a separate terminal to start the API.

## Build modes

### Local development (embedded in CLI)

Builds the web console and installs the CLI with web console embedded:

```bash
make local
stigmer server
```

The web console is served on port 8234. Agent-runner runs from the source tree (dev mode).

### Web-only development (hot reload)

For iterating on UI changes with instant feedback without rebuilding the CLI:

```bash
npm run dev -w client-apps/web
```

### Portable release build

Builds a fully self-contained binary with both agent-runner and web console embedded (equivalent to what CI produces):

```bash
make build-release
```

### Docker build (cloud deployment)

Builds a lightweight nginx container serving the static export:

```bash
docker build -f client-apps/web/Dockerfile -t stigmer-web .
```

Pass build args to configure the target environment:

```bash
docker build \
  --build-arg NEXT_PUBLIC_AUTH_MODE=oidc \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  -f client-apps/web/Dockerfile -t stigmer-web .
```

## Stack

- **Framework**: Next.js 16 (App Router) / React 19
- **Styling**: Tailwind CSS v4 / shadcn-ui
- **API**: Connect-RPC (gRPC-Web) via `@connectrpc/connect-web`
- **Proto stubs**: `@stigmer/protos` — generated TypeScript from `apis/stubs/ts/`

## Project structure

```
src/
├── app/            # Next.js routes (pages, layouts, error boundaries)
├── auth/           # Auth module (configurable: disabled or OIDC)
├── components/     # UI components organized by domain
│   ├── catalog/    # Resource catalog (agents, skills, MCP servers)
│   ├── execution/  # Agent execution streaming and controls
│   ├── layout/     # App shell, sidebar, top bar
│   └── ui/         # Shared primitives (shadcn-ui)
├── config/         # App configuration (env, navigation, draft)
├── contexts/       # React contexts (organization)
├── hooks/          # Data-fetching and state hooks
├── lib/            # Utilities (time, classnames)
└── services/       # Connect-RPC service clients
```

## Workspace dependency

This package consumes `@stigmer/protos` from `apis/stubs/ts/` via npm workspaces. If proto definitions change, regenerate stubs before starting the dev server:

```bash
make -C apis ts-stubs
```
