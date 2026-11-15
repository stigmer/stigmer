# Docker image for the TypeScript mcp-server-stigmer.
#
# The image is the published npm package: we install @stigmer/mcp-server from
# the registry so the container runs byte-for-byte what `npx @stigmer/mcp-server`
# runs. The package's publishConfig repoints @stigmer/* deps at their built
# ./dist entry points, so a plain `node` runtime resolves them correctly (a
# source build cannot — the workspace package.json mains point at ./src/*.ts).
#
# Release ordering: this build requires @stigmer/mcp-server@<version> to already
# be on npm. release.mcp-server waits for it (see the wait-for-npm step).
#
#   docker build -f mcp-server/Dockerfile \
#     --build-arg MCP_SERVER_VERSION=<release, e.g. 0.1.4> -t mcp-server-stigmer .
FROM node:22-alpine

# What the image is, on its registry page: the release lane reads this default
# and writes it as the index annotation GHCR shows for a multi-platform image
# (scripts/lib/image-description.mjs), so the words live here once.
ARG IMAGE_DESCRIPTION="Stigmer's MCP server: the Stigmer API as tools for an MCP client, over stdio (the default) or HTTP"
LABEL org.opencontainers.image.description="${IMAGE_DESCRIPTION}"
LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer"
LABEL org.opencontainers.image.vendor="Stigmer"
LABEL org.opencontainers.image.licenses="Apache-2.0"

# The npm version to install, which every build names: the release lane
# passes it (release.mcp-server), and a build that does not is refused. It is
# also reported by the server itself via STIGMER_MCP_VERSION (server.ts).
#
# It must be an exact release version (X.Y.Z or X.Y.Z-<pre>), never a dist-tag
# such as `latest`, and has no default. Two production incidents taught why
# (2026-07-28/29):
#   - `latest` resolves at build time, so an image tagged with a commit SHA
#     can contain bits that commit never saw: the prod bridge shipped a
#     pre-fix package under the fix's own SHA.
#   - the RUN line's text never changes with `latest`, so Docker's layer
#     cache reuses the stale install forever: rebuilding after an npm
#     publish shipped the identical old package and could never do otherwise.
# An exact version is part of the install's cache key, so a new version
# genuinely re-runs the install, and the build states exactly what it installs.
# A default would go stale and quietly install an old release.
ARG MCP_SERVER_VERSION
ENV STIGMER_MCP_VERSION=$MCP_SERVER_VERSION
ENV NODE_ENV=production

WORKDIR /app

# Refuse a missing or non-release version first (see MCP_SERVER_VERSION); the
# `case` refuses any character outside a version's, a newline included, which
# `grep -x` alone would let through by matching one line of several. Then
# install the published package globally; this pulls its full runtime
# dependency tree and exposes the `mcp-server-stigmer` bin on PATH.
#
# The install RETRIES until the whole pinned tree is installable (up to 10
# minutes). A build of the tagged commit can start before release.npm-libs
# has finished publishing that same version, so a bare install races npm and
# fails. Polling only the TOP package with `npm view` is not
# enough: every @stigmer/* dependency is published by the same run and each
# becomes visible on its own schedule (an install then fails with ETARGET on
# one of them), so the only reliable signal is the install itself succeeding. Retrying the
# install (npm install is idempotent on failure: nothing is left half
# installed under --global) fixes every builder of this file at once.
RUN case "${MCP_SERVER_VERSION}" in *[!0-9A-Za-z.-]*) false ;; esac && \
    printf '%s\n' "${MCP_SERVER_VERSION}" | grep -Eqx '[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?' || \
        { echo "MCP_SERVER_VERSION is '${MCP_SERVER_VERSION}', not a release version: pass --build-arg MCP_SERVER_VERSION=<release>, such as 0.1.4 or 0.1.4-rc.1" >&2; exit 1; }; \
    for i in $(seq 1 60); do \
        npm install --global --omit=dev "@stigmer/mcp-server@${MCP_SERVER_VERSION}" && break; \
        if [ "$i" -eq 60 ]; then \
            echo "@stigmer/mcp-server@${MCP_SERVER_VERSION} and its dependencies did not become installable within 10 minutes" >&2; \
            exit 1; \
        fi; \
        echo "attempt $i/60: @stigmer/mcp-server@${MCP_SERVER_VERSION} (or a dependency) not on npm yet; retrying in 10s"; \
        sleep 10; \
    done

# Run as the non-root user shipped with the node:alpine base.
USER node

# The default HTTP port, used only when STIGMER_MCP_TRANSPORT is http or both
# (overridable via STIGMER_MCP_HTTP_PORT). The default transport, stdio,
# listens on no port.
EXPOSE 8080

# Health check for container orchestrators, by transport. Under stdio (the
# default, matched case-insensitively as the server reads it) nothing listens
# on a port, and Docker runs a check only while the process runs, so the
# check passes: a running stdio server is the only honest signal there is.
# Under http or both it probes /health on the configured port; an empty
# variable means its default, as the server's config reads it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD case "$(printf '%s' "${STIGMER_MCP_TRANSPORT:-stdio}" | tr '[:upper:]' '[:lower:]')" in \
        stdio) exit 0 ;; \
    esac; \
    wget -qO- "http://localhost:${STIGMER_MCP_HTTP_PORT:-8080}/health" || exit 1

ENTRYPOINT ["mcp-server-stigmer"]
