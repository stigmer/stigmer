{{- /*
Named templates for the Stigmer chart: names and labels, the two image
references, the addresses of the dependencies (bundled or yours), the two
public URLs, and the cross-field refusals the schema cannot carry. Nothing
clever: each template is one fact the other templates read from one place,
so a rename or an address change happens once.
*/ -}}

{{- /* The release name is the endpoint: every Service is named from it. */ -}}
{{- define "stigmer.fullname" -}}
{{- default .Release.Name .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "stigmer.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- /* Selector labels for one component; selectors are immutable, so this set never gains a key. */ -}}
{{- define "stigmer.selectorLabels" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- /* Image references: an empty tag means the release version the train pushed with this chart. */ -}}
{{- define "stigmer.serverImage" -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.server.repository (default (printf "v%s" .Chart.AppVersion) .Values.image.server.tag) -}}
{{- end -}}

{{- define "stigmer.runnerImage" -}}
{{- printf "%s/%s:%s" .Values.image.registry .Values.image.runner.repository (default (printf "v%s" .Chart.AppVersion) .Values.image.runner.tag) -}}
{{- end -}}

{{- /* Where Postgres is: the bundled Service, or the operator's host. */ -}}
{{- define "stigmer.postgresHost" -}}
{{- if .Values.postgres.enabled -}}
{{- printf "%s-postgres" (include "stigmer.fullname" .) -}}
{{- else -}}
{{- .Values.externalDatabase.host -}}
{{- end -}}
{{- end -}}

{{- define "stigmer.postgresPort" -}}
{{- if .Values.postgres.enabled -}}5432{{- else -}}{{ .Values.externalDatabase.port }}{{- end -}}
{{- end -}}

{{- define "stigmer.postgresUser" -}}
{{- if .Values.postgres.enabled -}}postgres{{- else -}}{{ .Values.externalDatabase.user }}{{- end -}}
{{- end -}}

{{- define "stigmer.postgresDatabase" -}}
{{- if .Values.postgres.enabled -}}stigmer{{- else -}}{{ .Values.externalDatabase.database }}{{- end -}}
{{- end -}}

{{- /* The Secret and key the database password comes from; the main Secret unless externalDatabase names another. */ -}}
{{- define "stigmer.postgresPasswordSecret" -}}
{{- if and (not .Values.postgres.enabled) .Values.externalDatabase.existingSecret -}}
{{- .Values.externalDatabase.existingSecret -}}
{{- else -}}
{{- .Values.secrets.existingSecret -}}
{{- end -}}
{{- end -}}

{{- define "stigmer.postgresPasswordKey" -}}
{{- if .Values.postgres.enabled -}}POSTGRES_PASSWORD{{- else -}}{{ .Values.externalDatabase.passwordKey }}{{- end -}}
{{- end -}}

{{- /* Where Temporal is, address and namespace together (half a coordinate is no coordinate). */ -}}
{{- define "stigmer.temporalHostPort" -}}
{{- if .Values.temporal.enabled -}}
{{- printf "%s-temporal:7233" (include "stigmer.fullname" .) -}}
{{- else -}}
{{- .Values.externalTemporal.hostPort -}}
{{- end -}}
{{- end -}}

{{- define "stigmer.temporalNamespace" -}}
{{- if .Values.temporal.enabled -}}default{{- else -}}{{ .Values.externalTemporal.namespace }}{{- end -}}
{{- end -}}

{{- /* The scheme an Ingress host is reached on: https once it has a TLS Secret. */ -}}
{{- define "stigmer.ingressScheme" -}}
{{- if .tlsSecretName -}}https{{- else -}}http{{- end -}}
{{- end -}}

{{- /* The API's public URL: set, derived from the Ingress, or the port-forward posture. */ -}}
{{- define "stigmer.publicUrl" -}}
{{- if .Values.server.publicUrl -}}
{{- .Values.server.publicUrl -}}
{{- else if .Values.ingress.enabled -}}
{{- printf "%s://%s" (include "stigmer.ingressScheme" .Values.ingress.api) .Values.ingress.api.host -}}
{{- else -}}
http://localhost:7234
{{- end -}}
{{- end -}}

{{- define "stigmer.artifactPublicUrl" -}}
{{- if .Values.server.artifactPublicUrl -}}
{{- .Values.server.artifactPublicUrl -}}
{{- else if .Values.ingress.enabled -}}
{{- printf "%s://%s" (include "stigmer.ingressScheme" .Values.ingress.artifacts) .Values.ingress.artifacts.host -}}
{{- else -}}
http://localhost:7235
{{- end -}}
{{- end -}}

{{- /*
The cross-field refusals: each names the fix in the words the operator needs.
Rendered once, from the Deployment, so every install runs them. The schema
handles shape; these handle "set both or neither" and "you forgot the Secret".
*/ -}}
{{- define "stigmer.validate" -}}
{{- if not .Values.secrets.existingSecret -}}
{{- fail (printf "\n\nsecrets.existingSecret is required: the name of a Secret carrying STIGMER_ENCRYPTION_KEY and STIGMER_RUNNER_TOKEN_KEY (base64-encoded 32 bytes each)%s. The chart refuses to render without it, as docker compose refuses without .env: keys that materialize implicitly make the backup and rotation story invisible where a self-hoster needs it explicit. Create it, then set the value:\n\n  kubectl create secret generic stigmer-secrets \\\n    --from-literal=STIGMER_ENCRYPTION_KEY=$(openssl rand -base64 32) \\\n    --from-literal=STIGMER_RUNNER_TOKEN_KEY=$(openssl rand -base64 32)%s\n\n  helm install stigmer ... --set secrets.existingSecret=stigmer-secrets\n" (ternary " and POSTGRES_PASSWORD (the bundled database's superuser password)" "" .Values.postgres.enabled) (ternary " \\\n    --from-literal=POSTGRES_PASSWORD=$(openssl rand -hex 24)" "" .Values.postgres.enabled)) -}}
{{- end -}}
{{- if or .Values.openfga.enabled .Values.redis.enabled .Values.openbao.enabled .Values.licenseKeySecret -}}
{{- fail "\n\nopenfga, redis, openbao and licenseKeySecret are reserved for Stigmer Enterprise (the editions program's sp.helm-ee). This version of the chart serves the open-source server image and refuses them; leave openfga/redis/openbao at enabled: false and licenseKeySecret empty.\n" -}}
{{- end -}}
{{- if and .Values.server.oidc.issuer (not .Values.server.oidc.audience) -}}
{{- fail "\n\nserver.oidc.issuer is set but server.oidc.audience is not. They go together (a verifier that skipped audience validation would accept any token the issuer ever minted for any other service); set both or neither. The server would refuse the same at boot; the chart refuses first.\n" -}}
{{- end -}}
{{- if and .Values.server.oidc.audience (not .Values.server.oidc.issuer) -}}
{{- fail "\n\nserver.oidc.audience is set but server.oidc.issuer is not. They go together; set both or neither.\n" -}}
{{- end -}}
{{- if and .Values.server.oidc.issuer (not .Values.runner.stigmerToken.existingSecret) -}}
{{- fail "\n\nserver.oidc.issuer is set but runner.stigmerToken.existingSecret is not. With authentication on, the runner needs an API key to call the server, and an API key can only be minted by a signed-in operator, so an authenticated install is two steps:\n\n  1. install with server.oidc unset, sign in as the operator and mint the key:\n       stigmer apikey create --name runner\n  2. put it in a Secret and upgrade with OIDC on:\n       kubectl create secret generic stigmer-runner-token --from-literal=STIGMER_TOKEN=stk_...\n       helm upgrade ... --set server.oidc.issuer=... --set server.oidc.audience=... --set runner.stigmerToken.existingSecret=stigmer-runner-token\n\nThe chart refuses the half state rather than let a runner poll Temporal and fail every task UNAUTHENTICATED.\n" -}}
{{- end -}}
{{- if and (not .Values.postgres.enabled) (not .Values.externalDatabase.host) -}}
{{- fail "\n\npostgres.enabled is false but externalDatabase.host is empty. Name the Postgres the server should use (externalDatabase.host, port, user, database, and the password's Secret and key), or leave postgres.enabled true for the bundled one.\n" -}}
{{- end -}}
{{- if and (not .Values.temporal.enabled) (not .Values.externalTemporal.hostPort) -}}
{{- fail "\n\ntemporal.enabled is false but externalTemporal.hostPort is empty. Name the Temporal frontend the server and runner should dial (externalTemporal.hostPort, with externalTemporal.namespace), or leave temporal.enabled true for the bundled one.\n" -}}
{{- end -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.api.host) -}}
{{- fail "\n\ningress.enabled is true but ingress.api.host is empty. The API needs a hostname (and the artifact lane its own, ingress.artifacts.host): storage keys carry full paths, so the two lanes cannot share one host by path prefix.\n" -}}
{{- end -}}
{{- if and .Values.ingress.enabled (not .Values.ingress.artifacts.host) -}}
{{- fail "\n\ningress.enabled is true but ingress.artifacts.host is empty. Artifact download URLs are minted for browsers and the CLI and need a reachable hostname of their own.\n" -}}
{{- end -}}
{{- end -}}
