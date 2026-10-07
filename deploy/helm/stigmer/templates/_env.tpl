{{- /*
The environment the chart sets on the server and the runner, one named
template per container. The Deployment renders them, and stigmer.validate
reads their names back to refuse an extraEnv entry that repeats one: a later
entry of the same name replaces the earlier one when the kubelet builds the
environment, so an extraEnv line could silently undo a value this chart
sets (STIGMER_OIDC_ISSUER: "" would turn sign-in off under a values file
that shows it on). The rendered list is the one source of the names the
chart owns; nothing keeps a second copy.

Every entry has a compose counterpart, in compose's order, and the parity
test holds the two equal name for name. Nothing from values is spliced into
a string unquoted, and every Secret name and key is quoted, so a value that
reads as a YAML number or boolean stays the string it was.
*/ -}}

{{- /*
Percent-encodes one URL component. urlquery is Go's query escaping: every
byte outside the unreserved set is %XX, except a space, which it writes as
"+"; a literal "+" comes out as %2B, so every "+" left is a space and
becomes %20, the encoding a URL's user and path segments read.
*/ -}}
{{- define "stigmer.urlEscape" -}}
{{- urlquery . | replace "+" "%20" -}}
{{- end -}}

{{- define "stigmer.serverEnv" -}}
- name: GRPC_PORT
  value: "7234"
# Non-empty DATABASE_URL selects the Postgres driver. It names
# no password: node-postgres reads PGPASSWORD when the URL
# carries none, so no character in the password can break the
# URL, and the password stays in its Secret, never in YAML.
- name: DATABASE_URL
  value: {{ printf "postgres://%s@%s:%s/%s" (include "stigmer.urlEscape" (include "stigmer.postgresUser" .)) (include "stigmer.postgresHost" .) (include "stigmer.postgresPort" .) (include "stigmer.urlEscape" (include "stigmer.postgresDatabase" .)) | quote }}
- name: PGPASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "stigmer.postgresPasswordSecret" . | quote }}
      key: {{ include "stigmer.postgresPasswordKey" . | quote }}
- name: TEMPORAL_HOST_PORT
  value: {{ include "stigmer.temporalHostPort" . | quote }}
- name: TEMPORAL_NAMESPACE
  value: {{ include "stigmer.temporalNamespace" . | quote }}
{{- include "stigmer.temporalConnectionEnv" . }}
# The ONE runner task queue, set on both sides (compose's anchor).
- name: TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE
  value: stigmer_runner
- name: TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE
  value: stigmer_runner
- name: ARTIFACT_STORAGE_TYPE
  value: local
- name: ARTIFACT_LOCAL_BASE_PATH
  value: /artifacts
- name: ARTIFACT_LOCAL_SERVE_URL
  value: {{ include "stigmer.artifactPublicUrl" . | quote }}
- name: SKILL_TRANSFER_BASE_URL
  value: {{ include "stigmer.publicUrl" . | quote }}
# Explicit keys, loud fail: from the operator's Secret.
- name: STIGMER_ENCRYPTION_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: STIGMER_ENCRYPTION_KEY
- name: STIGMER_RUNNER_TOKEN_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: STIGMER_RUNNER_TOKEN_KEY
# Optional, unlike the two above: it signs only the 15-minute
# PlatformClient user tokens, so a lost key costs at most one
# token lifetime and has no backup story. Absent from the
# Secret, the server generates one on its claim.
- name: STIGMER_PLATFORM_TOKEN_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secrets.existingSecret | quote }}
      key: STIGMER_PLATFORM_TOKEN_KEY
      optional: true
- name: STIGMER_OPERATOR_EMAIL
  value: {{ .Values.server.operator.email | quote }}
- name: STIGMER_OPERATOR_NAME
  value: {{ .Values.server.operator.name | quote }}
{{- if .Values.server.oidc.issuer }}
- name: STIGMER_OIDC_ISSUER
  value: {{ .Values.server.oidc.issuer | quote }}
- name: STIGMER_OIDC_AUDIENCE
  value: {{ .Values.server.oidc.audience | quote }}
- name: STIGMER_OIDC_CONSOLE_CLIENT_ID
  value: {{ .Values.server.oidc.consoleClientId | quote }}
{{- end }}
{{- end -}}

{{- define "stigmer.runnerEnv" -}}
# local mode: stdio MCP servers are allowed (they spawn inside
# this container and can reach its filesystem and network) and
# the checkpointer is the durable sqlite saver under HOME.
- name: MODE
  value: local
- name: STIGMER_BACKEND_ENDPOINT
  value: http://localhost:7234
# What a remote MCP server dials back on: the public URL, never
# the pod-local address above.
- name: STIGMER_MCP_PUBLIC_ENDPOINT
  value: {{ include "stigmer.publicUrl" . | quote }}
- name: TEMPORAL_SERVICE_ADDRESS
  value: {{ include "stigmer.temporalHostPort" . | quote }}
- name: TEMPORAL_NAMESPACE
  value: {{ include "stigmer.temporalNamespace" . | quote }}
{{- include "stigmer.temporalConnectionEnv" . }}
- name: STIGMER_TASK_QUEUE
  value: stigmer_runner
- name: WORKSPACE_ROOT_DIR
  value: /data/.stigmer/data/workspace
- name: ARTIFACT_STORAGE_TYPE
  value: local
- name: LOCAL_ARTIFACT_PATH
  value: /artifacts
{{- with .Values.runner.llm.existingSecret }}
# Optional LLM keys, by explicit reference: agents need one,
# workflows without agent tasks run key-free.
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ . | quote }}
      key: ANTHROPIC_API_KEY
      optional: true
- name: CURSOR_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ . | quote }}
      key: CURSOR_API_KEY
      optional: true
{{- end }}
{{- with .Values.runner.stigmerToken.existingSecret }}
# The runner's API key under authentication, created after
# signing in (the chart README, "Authentication").
- name: STIGMER_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ . | quote }}
      key: {{ $.Values.runner.stigmerToken.key | quote }}
{{- end }}
{{- end -}}

{{- /* The names stigmer.serverEnv or stigmer.runnerEnv sets, read back from the render. */ -}}
{{- define "stigmer.ownedEnvNames" -}}
{{- $names := list -}}
{{- range (include .template .root | fromYamlArray) -}}
{{- $names = append $names .name -}}
{{- end -}}
{{- toJson $names -}}
{{- end -}}
