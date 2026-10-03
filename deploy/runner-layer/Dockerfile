# check=skip=InvalidDefaultArgInFrom
# Adds the Stigmer runner layer to a base image of your own; see
# https://stigmer.ai/docs/guides/self-hosting/runners#bring-your-own-base-image
ARG BASE_IMAGE
ARG STIGMER_VERSION
FROM ghcr.io/stigmer/runner-layer:${STIGMER_VERSION} AS runner-layer
FROM ${BASE_IMAGE}
COPY --from=runner-layer /runner /runner
