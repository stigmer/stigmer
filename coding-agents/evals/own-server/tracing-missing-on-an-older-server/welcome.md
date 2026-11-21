What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Reading the version from `kubectl -n stigmer get stigmer` (the Version column) or the image tag on the server's pod.
- The operator's version is the Stigmer version: operator `vX` runs Stigmer `vX`; `stigmer version` prints only the CLI's version; the release notes are on the GitHub releases page.
- Restarting the port-forward after the runner's pod is replaced.
- A collector's gRPC port needs `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`; Langfuse does not.
- The conversation's text stays out of the traces unless they set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
- The upgrade as the operations guide gives it: `helm upgrade stigmer-operator ... --version <newer>`; with a bucket the operator takes a full backup and waits for it before the server rolls, and without one they back up first.
- Langfuse takes the default `http/protobuf` protocol at `<langfuse>/api/public/otel`, with `OTEL_EXPORTER_OTLP_HEADERS` set to `Authorization=Basic%20<base64 of public:secret key>`.
