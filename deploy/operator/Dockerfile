# The Stigmer operator's image: one static binary on distroless, non-root.
#
# Built from deploy/operator alone, which is its own Go module. The builder
# runs on the build machine's architecture and cross-compiles for the
# target's, so a multi-architecture build never emulates the compiler. The
# version is stamped into the binary: it is the tag of every Stigmer image
# the operator runs. So is the per-session runner image's digest, which
# pins every sandbox to the same bytes; a build without one runs agent-sandbox
# sessions by tag and refuses the substrate driver, which needs the digest.

FROM --platform=$BUILDPLATFORM golang:1.25 AS build
ARG TARGETOS
ARG TARGETARCH
ARG STIGMER_VERSION=dev
ARG SANDBOX_RUNNER_DIGEST=
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY api/ api/
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} GOWORK=off \
    go build -trimpath \
    -ldflags "-s -w -X github.com/stigmer/stigmer/deploy/operator/internal/version.Stigmer=${STIGMER_VERSION} -X github.com/stigmer/stigmer/deploy/operator/internal/version.SandboxRunnerDigest=${SANDBOX_RUNNER_DIGEST}" \
    -o /out/stigmer-operator ./cmd

FROM gcr.io/distroless/static:nonroot
LABEL org.opencontainers.image.title="stigmer-operator" \
      org.opencontainers.image.source="https://github.com/stigmer/stigmer"
COPY --from=build /out/stigmer-operator /stigmer-operator
USER 65532:65532
ENTRYPOINT ["/stigmer-operator"]
