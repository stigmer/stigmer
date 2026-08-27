# =============================================================================
# The official stigmer-server image (DD-014, Phase-2 P4)
# =============================================================================
# Packages the SAME @stigmer/server-slim artifact the CLI acquires at
# `stigmer up` — one artifact, every channel (console included, DD-012).
# The image executes NO build steps: the per-arch dist-slim tree is built
# and verified OUTSIDE docker (scripts/bundle-slim.mjs --platform=...,
# release-stamped in the release lane), then copied in. That keeps the
# multi-arch build hermetic — the QEMU leg of a buildx run assembles
# layers without executing emulated code — and keeps this file from
# becoming a second packaging path.
#
# Build (the smoke script and CI stage the tree; by hand):
#   node scripts/bundle-slim.mjs --platform=linux-arm64   # or linux-x64
#   mv dist-slim dist-slim-arm64                          # or dist-slim-amd64
#   docker build -t stigmer-server backend/services/stigmer-server
#
# Run (laptop tier — sqlite, one volume):
#   docker run -d -p 7234:7234 -p 7235:7235 -v stigmer-data:/data \
#     ghcr.io/stigmer/stigmer-server:latest
#
# node:22-slim, not alpine/distroless: the Temporal core-bridge prebuilds
# are gnu-triple (glibc) binaries, and 22 is the engines floor (DD-014;
# the #24 Ruling-3 amendment).
FROM node:22-slim

# TARGETARCH (amd64|arm64) is populated by BuildKit per platform leg; the
# staged trees are named after it so ONE buildx invocation covers both
# platforms. A missing tree for the requested arch fails the COPY loudly.
ARG TARGETARCH

# The source label is load-bearing, not decorative: together with the
# first push coming from a repo workflow, it links the GHCR package to
# stigmer/stigmer so the repo's GITHUB_TOKEN keeps write access — the
# linkage whose absence broke the mirror-image packages (permission_denied
# on every upstream tag move).
ARG IMAGE_VERSION=dev
ARG IMAGE_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer" \
      org.opencontainers.image.title="stigmer-server" \
      org.opencontainers.image.description="Stigmer control plane: unified gRPC/Connect/REST port with the bundled web console" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      org.opencontainers.image.revision="${IMAGE_REVISION}"

# HOME=/data is the persistence design, not a convenience: every stateful
# default derives from the home directory — DB_PATH (~/.stigmer/stigmer.db),
# STORAGE_PATH, ARTIFACT_LOCAL_BASE_PATH, AND the auto-generated encryption/
# runner-token key files (src/encryption/key-manager.ts writes
# ~/.stigmer/*.key; a key outside the volume would be lost on container
# recreate, making every enc:v1: value in the database permanently
# undecryptable). Pointing HOME at the volume puts ALL of it — including
# keys — under one mount, with the exact on-disk layout of a bare-metal
# ~/.stigmer: /data/.stigmer is byte-portable to and from `stigmer up`.
#
# ARTIFACT_HTTP_HOST=0.0.0.0 (DD-013): the artifact file server defaults
# to loopback, which is unreachable through the container boundary even
# with -p; the container network namespace is the isolation here.
ENV HOME=/data \
    ARTIFACT_HTTP_HOST=0.0.0.0

# /data must exist owned by the runtime user before VOLUME freezes it:
# named volumes initialize from the image and inherit this ownership.
# (Bind mounts keep host ownership — the docker run docs cover chown.)
#
# The artifact path is pre-created for the compose stack (DD-013): compose
# mounts a SHARED named volume at this exact path (the runner reads what
# the server writes). A nested mountpoint that does not pre-exist would be
# created root-owned by the docker daemon INSIDE the outer /data volume —
# and this non-root server would then fail its boot mkdirs with EACCES.
# Pre-created node-owned, both the intermediate dirs and the volume's
# initialized content stay writable. Harmless outside compose: the boot
# mkdir -p of the same default path becomes a no-op.
RUN mkdir -p /data/.stigmer/data/artifacts && chown -R node:node /data

WORKDIR /app
COPY --chown=node:node dist-slim-${TARGETARCH}/ /app/

# Non-root: the server needs nothing root can do. node:22-slim ships the
# node user (uid 1000).
USER node

# Keeps state out of the container's writable layer even when the operator
# forgets -v (an anonymous volume outlives the layer and shows up in
# `docker volume ls` instead of vanishing silently).
VOLUME /data

# 7234: the unified port — gRPC, gRPC-Web, Connect, REST, and the console
# (lane 4). 7235: the artifact file server (GRPC_PORT+1, local storage).
EXPOSE 7234 7235

# Probes the REAL health service over the Connect JSON lane (the transport
# pins this shape in src/transport/__tests__/server.test.ts): overall ""
# flips SERVING only after wiring completes, so "healthy" means serving,
# not merely bound. Reads GRPC_PORT so a port override keeps the probe
# honest. start-period covers the boot-time search-index rebuild on large
# adopted databases.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const p=process.env.GRPC_PORT||'7234';fetch('http://127.0.0.1:'+p+'/grpc.health.v1.Health/Check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.ok?r.json():Promise.reject(new Error('http '+r.status))).then(b=>process.exit(b.status==='SERVING'?0:1)).catch(()=>process.exit(1))"

# Exec form: node is PID 1 and receives docker stop's SIGTERM directly
# (verify-slim-artifact pins the clean SIGTERM lifecycle).
CMD ["node", "main.js"]
