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

# The npm version (e.g. 1.2.3) or dist-tag (e.g. dev) to install. Also reported
# by the server itself via STIGMER_MCP_VERSION (server.ts).
ARG MCP_SERVER_VERSION=latest
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
