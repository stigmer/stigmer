# Docker image for the TypeScript mcp-server-stigmer.
#
# The image is the published npm package: we install @stigmer/mcp-server from
# the registry so the container runs byte-for-byte what `npx @stigmer/mcp-server`
# runs. The package's publishConfig repoints @stigmer/* deps at their built
# ./dist entry points, so a plain `node` runtime resolves them correctly (a
# source build cannot — the workspace package.json mains point at ./src/*.ts).
#
# Release ordering: this build requires @stigmer/mcp-server@<version> to already
# be on npm. release.mcp-server waits for it (see the wait-for-npm step) and
# release.dev runs publish-mcp after publish-npm.
#
#   docker build -f mcp-server/Dockerfile \
#     --build-arg MCP_SERVER_VERSION=<npm-version-or-dist-tag> -t mcp-server-stigmer .
FROM public.ecr.aws/docker/library/node:22-alpine

LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer"
LABEL org.opencontainers.image.vendor="Stigmer"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# The npm version to install. Also reported by the server itself via
# STIGMER_MCP_VERSION (server.ts). Release workflows pass this explicitly
# (release.mcp-server, release.dev); the default below serves builds that
# don't — notably the prod deploy pipeline, which builds on every
# mcp-server-touching push to main.
#
# The default is a PINNED version, deliberately NOT `latest`, and is bumped
# as part of releasing. Two production incidents taught why (2026-07-28/29):
#   - `latest` resolves at build time, so an image tagged with a commit SHA
#     can contain bits that commit never saw — the prod bridge shipped a
#     pre-fix package under the fix's own SHA.
#   - the RUN line's text never changes with `latest`, so Docker's layer
#     cache reuses the stale install forever — rebuilding after an npm
#     publish shipped the identical old package and could never do otherwise.
# Bumping the pin changes the ARG (and therefore the cache key), so the
# install genuinely re-runs, and the recipe states exactly what prod runs.
#
# The bump is ENFORCED, not remembered: release.npm-libs refuses to publish
# a version this pin does not match (added after the pin sat at 3.4.1 for
# five releases and prod served a bridge with no /channels route,
# 2026-08-05). Bump the pin in the same commit you tag.
ARG MCP_SERVER_VERSION=3.6.0
ENV STIGMER_MCP_VERSION=$MCP_SERVER_VERSION
ENV NODE_ENV=production

WORKDIR /app

# Install the published package globally; this pulls its full runtime dependency
# tree and exposes the `mcp-server-stigmer` bin on PATH.
RUN npm install --global --omit=dev "@stigmer/mcp-server@${MCP_SERVER_VERSION}"

# Run as the non-root user shipped with the node:alpine base.
USER node

# Default HTTP port (overridable via STIGMER_MCP_HTTP_PORT).
EXPOSE 8080

# Health check for container orchestrators.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

ENTRYPOINT ["mcp-server-stigmer"]
