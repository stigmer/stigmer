# Build stage — compile the Next.js static export
FROM node:22-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* variables are inlined into the JS bundle at build time.
# Pass these as --build-arg to configure the target environment.
ARG NEXT_PUBLIC_AUTH_MODE=disabled
ARG NEXT_PUBLIC_API_URL=http://localhost:7234
ENV NEXT_PUBLIC_AUTH_MODE=$NEXT_PUBLIC_AUTH_MODE
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Copy workspace config and dependency manifests first (layer caching)
COPY package.json package-lock.json ./
COPY apis/stubs/ts/package.json apis/stubs/ts/

# Copy the proto stubs (committed to the repo, no Buf needed)
COPY apis/stubs/ts/ apis/stubs/ts/

# Copy the web console source
COPY client-apps/web/ client-apps/web/

# Install dependencies and build
RUN npm ci && \
    npm run build -w client-apps/web

# Runtime stage — nginx serves the static export
FROM nginx:alpine

LABEL org.opencontainers.image.source="https://github.com/stigmer/stigmer"
LABEL org.opencontainers.image.vendor="Stigmer"
LABEL org.opencontainers.image.licenses="Apache-2.0"

COPY --from=builder /app/client-apps/web/out /usr/share/nginx/html
COPY client-apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
