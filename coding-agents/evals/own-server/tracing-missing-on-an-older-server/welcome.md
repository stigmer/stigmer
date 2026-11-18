What a good answer may also say. Never graded: leaving any of it out fails nothing.

- Reading the release with `helm list -n stigmer` or the image tag on the pod.
- Restarting the port-forward after the upgrade, since the pod is recreated.
- A collector's gRPC port needs `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`; Langfuse does not.
- The conversation's text stays out of the traces unless they set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
- The chart version is the Stigmer version; `stigmer version` prints only the CLI's version; the release notes are on the GitHub releases page.
- The upgrade as the operations guide gives it: back up the three durable claims, the Secret and the values file, then `helm upgrade ... --version <newer> -f values.yaml --wait`.
- Langfuse takes the default `http/protobuf` protocol at `<langfuse>/api/public/otel`, with `OTEL_EXPORTER_OTLP_HEADERS` set to `Authorization=Basic%20<base64 of public:secret key>`.
