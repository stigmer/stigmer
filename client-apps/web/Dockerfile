# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable

# Copy workspace config first (for caching)
COPY package.json yarn.lock .yarnrc.yml ./

# Copy workspace packages
COPY apis/stubs/ts/ apis/stubs/ts/
COPY client-apps/web/ client-apps/web/

# Install all workspace dependencies and build the web console
# Combined into single RUN to preserve Yarn's install state file across commands
RUN rm -f client-apps/web/.env client-apps/web/.env.local && \
    yarn install && \
    cd client-apps/web && \
    yarn build

# Prepare standalone output
# With outputFileTracingRoot set to monorepo root, standalone output structure is:
#   .next/standalone/
#   ├── node_modules/                      (traced dependencies)
#   ├── client-apps/web/           (app with server.js)
#   └── package.json                       (root)
RUN mkdir -p /app/standalone && \
    cp -R client-apps/web/.next/standalone/* /app/standalone/ && \
    cp -R client-apps/web/public /app/standalone/client-apps/web/ && \
    cp -R client-apps/web/.next/static /app/standalone/client-apps/web/.next/

# Runtime stage
FROM node:22-alpine AS runtime

LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer-cloud"
LABEL org.opencontainers.image.vendor="Stigmer"
LABEL org.opencontainers.image.licenses="Proprietary"

# WORKDIR must match the app location inside standalone output
WORKDIR /app/client-apps/web
EXPOSE 3000
COPY --from=builder /app/standalone /app/
CMD ["node", "server.js"]
