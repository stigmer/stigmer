# Stigmer all-in-one — `ghcr.io/stigmer/stigmer`

One container for the "let me try this in thirty seconds" moment: the Stigmer server with the web console, an embedded Temporal dev-server, an embedded runner that executes Agents and Workflows, and SQLite. One `docker run`, one volume, no Node.js on the host.

**EVALUATION ONLY. NOT FOR PRODUCTION.** There are no separate backups or scaling, an upgrade kills in-flight runs, and Temporal's dev-server is not built for durable history. For a team, use the [Docker Compose stack](../../docker-compose.yml) ([guide](https://stigmer.ai/docs/guides/self-hosting/docker-compose)). The container says all of this every time it starts.

The user-facing page is [Try Stigmer in one container](https://stigmer.ai/docs/guides/self-hosting/all-in-one). This file is for the people who build the image.

## Run

```bash
docker run -d --name stigmer -p 7234:7234 -p 7235:7235 -v stigmer-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... ghcr.io/stigmer/stigmer:latest
```

No sign-in: like `stigmer up`, the container trusts every caller. Keep the ports on localhost or a private network.

## What the image is

A pre-warmed `stigmer up`. On a laptop, the CLI's first `up` acquires `@stigmer/server-slim` and `@stigmer/runner-slim` (and its first `stigmer install` acquires `@stigmer/plugins`) into `~/.stigmer/runtimes/<version>/node_modules/@stigmer/…` and downloads the Temporal CLI into `~/.stigmer/bin`. This image has those acquisitions already done, read-only, off the data volume:

- `/opt/stigmer/runtimes/<version>/` — the same npm packages (plus the CLI itself), installed into the same layout; `STIGMER_RUNTIMES_DIR` points the CLI's acquirers here, and they find everything present.
- `/opt/stigmer/bin/temporal` — the Temporal CLI, downloaded and checksum-verified by the CLI's own downloader; `STIGMER_TEMPORAL_BIN` points the manager here.
- `HOME=/data` — everything the stack writes lands on the volume: the SQLite database, the encryption keys, `config.yaml`, Temporal's database, the runner's session state, Workspaces, artifacts, logs. `/data/.stigmer` is byte for byte a laptop's `~/.stigmer`.

The entrypoint prints the evaluation banner, refuses a data directory the non-root user cannot write, warns when no LLM credential is present, and runs `stigmer up --foreground` under `tini`. That is the whole composition (`client-apps/cli/src/local/`): Temporal, then the gated server, then the runner, then the bootstrap, supervised, in one process tree. There is no second launcher.

## Build

The Dockerfile COPYs from `./stage`, which `scripts/stage-all-in-one.mjs` fills for the building host's arch from the checkout's sources: every workspace package packed by `scripts/publish-libs.mjs --pack-dir`, the slim server and runner packages (with this arch's native bridge) from each service's `bundle-slim.mjs --emit-packages --version`, and the Temporal binary.

```bash
make smoke-all-in-one          # build the services, stage, build the image, run the smoke
# or by hand:
node scripts/stage-all-in-one.mjs
docker build --build-arg STIGMER_VERSION=$(cat deploy/all-in-one/stage/VERSION) -t stigmer-all-in-one:local deploy/all-in-one
```

`STIGMER_VERSION` must be the version the packages were stamped with; the build asserts the installed CLI reports it. The image is built natively per arch (the Dockerfile has RUN steps); the release lane stages once, builds on native amd64 and arm64 runners, merges the two tags, smokes the pushed tag on both, and promotes `latest` on stable versions only.

## Prove

`scripts/smoke-all-in-one.mjs` is the one smoke, run by `make smoke-all-in-one`, by `ci.all-in-one.yaml` on every relevant PR (both arches, from the PR's sources), and by the release lane against the pushed tag. It proves: Docker `healthy`; the banner and the no-key warning; SERVING and the console lane; the `stigmer` organization created on first boot (the bootstrap's one act); an LLM-free Workflow run to `EXECUTION_COMPLETED` through the embedded Temporal and runner; the artifact lane; `docker restart` persistence; an unclean restart (`docker kill`, `docker start`) with exactly one Temporal across three supervisor ticks; `docker stop -t 30` exiting 0; an unwritable bind mount refused.

## Ports and stopping

- `7234` — the unified port: API, console.
- `7235` — the artifact file server.
- Temporal's UI (`8233`) runs inside the container bound to loopback and is not exposed.
- Stop with `docker stop -t 30`: a graceful shutdown (runner, server, then Temporal) can outlast Docker's default ten seconds. A killed container starts cleanly.
- `docker exec <container> stigmer status` shows every component; the logs are under `/data/.stigmer/data/logs/`.

## What does not run here

stdio MCP Servers that need `uvx`, Python or Go: the image ships Node.js and git only. Ones that need `node`/`npx`, and every remote MCP Server (the whole system catalog), work.
