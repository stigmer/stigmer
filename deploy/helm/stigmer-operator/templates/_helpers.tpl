{{- /*
Names and labels for the operator's own objects. The name label is the one
the operator's one-per-cluster check looks for, so it is fixed, not derived
from the release name. The version label is the operator version that runs:
the image tag when one is set, else v<appVersion>, so after `helm upgrade`
every object, the definition included, says which operator it belongs to.
*/ -}}
{{- define "stigmer-operator.version" -}}
{{- default (printf "v%s" .Chart.AppVersion) .Values.image.tag -}}
{{- end -}}

{{- define "stigmer-operator.labels" -}}
app.kubernetes.io/name: stigmer-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ include "stigmer-operator.version" . | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "stigmer-operator.selectorLabels" -}}
app.kubernetes.io/name: stigmer-operator
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "stigmer-operator.image" -}}
{{- printf "%s:%s" .Values.image.repository (include "stigmer-operator.version" .) -}}
{{- end -}}
