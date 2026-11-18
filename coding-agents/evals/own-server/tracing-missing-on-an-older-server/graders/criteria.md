---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Does not assume either way: says to establish the server's actual Stigmer version from the release itself (for example the Helm release or the pod's image tag), not the CLI's version, and check it against the release notes.
- Says that if their release predates runner tracing, the fix is a Helm upgrade to a newer chart version with a backup taken first, since the only way back is a restore.
- Checks their settings against the tracing page: the variables belong on the runner (`runner.extraEnv` is right), and Langfuse needs its OTLP endpoint and a Basic-auth header built from its public and secret keys.

**FAIL if**

- It states which release added tracing without having read it from a release note or changelog.
- It treats the CLI's version as the server's.
- It invents a chart value or server setting that turns tracing on.
- It tells them to set the variables on the server instead of the runner.
- It suggests downgrading or editing the chart.
- It recommends an upgrade and skips the backup before it.

**Welcome**

- Reading the release with `helm list -n stigmer` or the image tag on the pod.
- Restarting the port-forward after the upgrade, since the pod is recreated.
- A collector's gRPC port needs `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`; Langfuse does not.
- The conversation's text stays out of the traces unless they set `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`.
- The chart version is the Stigmer version; `stigmer version` prints only the CLI's version; the release notes are on the GitHub releases page.
- The upgrade as the operations guide gives it: back up the three durable claims, the Secret and the values file, then `helm upgrade ... --version <newer> -f values.yaml --wait`.
- Langfuse takes the default `http/protobuf` protocol at `<langfuse>/api/public/otel`, with `OTEL_EXPORTER_OTLP_HEADERS` set to `Authorization=Basic%20<base64 of public:secret key>`.
