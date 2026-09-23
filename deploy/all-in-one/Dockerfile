# =============================================================================
# The all-in-one evaluation image: ghcr.io/stigmer/stigmer
# =============================================================================
# One container for the "let me try this in thirty seconds" moment: the
# server (with the web console), an embedded Temporal dev-server, an embedded
# runner, SQLite, one volume. EVALUATION ONLY, NOT FOR PRODUCTION — Temporal's
# dev-server is not built for durable history, one container has no separate
# backups or scaling, and an upgrade kills in-flight runs. The production
# self-host shape is docker-compose.yml (and, later, the Helm chart).
#
# What this image IS: a pre-warmed `stigmer up`. The CLI acquires the server
# and the runner on a laptop's first `up` (and the plugin catalogue on its
# first `stigmer install`) into ~/.stigmer/runtimes/<version>/node_modules/
# @stigmer/…, and downloads the Temporal CLI into ~/.stigmer/bin. Here those
# acquisitions are already done, read-only, off the data volume: the same npm
# packages, installed into the same layout under /opt/stigmer, and the
# composition `stigmer up` runs (server, runner, Temporal, the bootstrap; see
# client-apps/cli/src/local/) runs here in the foreground. There is no second
# launcher.
#
# Build (scripts/stage-all-in-one.mjs stages the packages and the Temporal
# binary for THIS host's arch into ./stage; the smoke and CI do the same):
#   node scripts/stage-all-in-one.mjs
#   docker build --build-arg STIGMER_VERSION=$(cat deploy/all-in-one/stage/VERSION) \
#     -t stigmer-all-in-one:local deploy/all-in-one
#
# Run:
#   docker run -d -p 7234:7234 -p 7235:7235 -v stigmer-data:/data \
#     -e ANTHROPIC_API_KEY=sk-ant-... ghcr.io/stigmer/stigmer:latest
#
# node:22-slim, not alpine/distroless: the Temporal core-bridge prebuilds are
# gnu-triple (glibc) binaries and 22 is the engines floor (DD-014). Built
# natively per arch (the packages carry a per-arch native bridge), merged
# into one manifest by the release lane.
FROM node:22-slim

# The version the staged packages were stamped with. The build asserts that
# the installed CLI reports it: the runtimes layout is keyed by it, and a
# mismatch would leave `stigmer up` looking in an empty directory.
ARG STIGMER_VERSION
ARG IMAGE_REVISION=unknown

# The source label is load-bearing, not decorative: together with the first
# push coming from a repo workflow, it links the GHCR package to
# stigmer/stigmer so the repo's GITHUB_TOKEN keeps write access.
LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer" \
      org.opencontainers.image.title="stigmer" \
      org.opencontainers.image.description="Stigmer all-in-one for evaluation: server, console, Temporal dev-server and runner in one container. Not for production." \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${STIGMER_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}"

# tini: an init, not a launcher. The stack is a process tree (the CLI, the
# server, the runner, Temporal, and the stdio MCP servers the runner spawns);
# PID 1 must reap orphans and forward docker stop's SIGTERM, which node as
# PID 1 does not do. git: agents and the file-review flow shell out to it.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tini git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Where `stigmer up` looks for acquired runtimes and the Temporal binary, and
# where this image puts them (client-apps/cli/src/local/paths.ts,
# temporal/manager.ts). Set before the install so the paths below are
# derived from one place.
ENV STIGMER_RUNTIMES_DIR=/opt/stigmer/runtimes \
    STIGMER_TEMPORAL_BIN=/opt/stigmer/bin/temporal

# The acquisitions, pre-warmed: every workspace package (the CLI, its
# @stigmer/* deps, the plugin catalogue) plus @stigmer/server-slim and
# @stigmer/runner-slim with this arch's native bridge, packed from source by
# stage-all-in-one.mjs. One `npm install` into the per-version prefix the
# CLI's acquirers read; our @stigmer/* graph resolves among the tarballs,
# third-party deps come from the registry as any `npm ci` does. The CLI's
# own version is asserted against the build-arg so the layout is keyed
# correctly. The npm cache is dropped: nothing installs at runtime.
COPY stage/pkgs/ /tmp/stigmer-pkgs/
RUN test -n "${STIGMER_VERSION}" || { echo "STIGMER_VERSION build-arg is required (deploy/all-in-one/stage/VERSION)"; exit 1; } \
  && npm install --prefix "${STIGMER_RUNTIMES_DIR}/${STIGMER_VERSION}" --omit=dev --no-audit --no-fund /tmp/stigmer-pkgs/*.tgz \
  && installed="$(node -p "require('${STIGMER_RUNTIMES_DIR}/${STIGMER_VERSION}/node_modules/@stigmer/cli/package.json').version")" \
  && test "${installed}" = "${STIGMER_VERSION}" || { echo "staged CLI is ${installed}, build-arg says ${STIGMER_VERSION}"; exit 1; } \
  && rm -rf /tmp/stigmer-pkgs /root/.npm

# The Temporal CLI for this arch, downloaded and checksum-verified by the
# CLI's own downloader at staging time (one pin, one verification, shared
# with `stigmer up`).
COPY --chmod=755 stage/temporal ${STIGMER_TEMPORAL_BIN}

# The entrypoint: the evaluation banner, the volume and key checks, then
# `exec stigmer up --foreground`. Any argument replaces that command
# (`docker run … stigmer status`), the postgres-image convention.
COPY --chmod=755 entrypoint.sh /usr/local/bin/stigmer-all-in-one

# HOME=/data is the persistence design, not a convenience (the server image's
# rule): every stateful default derives from the home directory — the SQLite
# database, the auto-generated encryption keys, config.yaml, Temporal's own
# database, the runner's session checkpoints, the artifacts, the logs. One
# volume holds all of it, byte-portable with a laptop's ~/.stigmer.
# ARTIFACT_HTTP_HOST=0.0.0.0: the artifact file server defaults to loopback,
# unreachable through the container boundary even with -p.
# PATH: the `stigmer` bin the install laid down — the entrypoint's command,
# `docker exec … stigmer status`, and the runner's `stigmer mcp-server`
# spawn for memory and channel attachments all resolve it from here.
ENV HOME=/data \
    ARTIFACT_HTTP_HOST=0.0.0.0 \
    PATH="/opt/stigmer/runtimes/${STIGMER_VERSION}/node_modules/.bin:${PATH}"

# /data must exist owned by the runtime user before VOLUME freezes it: named
# volumes initialize from the image and inherit this ownership. (Bind mounts
# keep host ownership — the entrypoint refuses with a clear message.)
RUN mkdir -p /data/.stigmer/data/artifacts && chown -R node:node /data

# Non-root: nothing here needs root. node:22-slim ships the node user (uid 1000).
USER node

# Keeps state out of the container's writable layer even when the operator
# forgets -v (an anonymous volume outlives the layer and shows up in
# `docker volume ls` instead of vanishing silently).
VOLUME /data

# 7234: the unified port — gRPC, gRPC-Web, Connect, REST, and the console.
# 7235: the artifact file server (GRPC_PORT+1). Temporal's UI (8233) stays
# bound to loopback inside the container and is deliberately not exposed.
EXPOSE 7234 7235

# The server image's probe, byte for byte: the REAL health service over the
# Connect JSON lane flips SERVING only after wiring completes. The runner is
# proven by the smoke's end-to-end run, not by this probe. start-period
# covers Temporal's boot, the server's gate and the runner's first poll.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.GRPC_PORT||'7234';fetch('http://127.0.0.1:'+p+'/grpc.health.v1.Health/Check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.ok?r.json():Promise.reject(new Error('http '+r.status))).then(b=>process.exit(b.status==='SERVING'?0:1)).catch(()=>process.exit(1))"

# Graceful stop takes the daemon's teardown budget (runner, server, then
# Temporal; up to ~20s worst case): `docker stop -t 30`. The entrypoint's
# banner says so.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/stigmer-all-in-one"]
