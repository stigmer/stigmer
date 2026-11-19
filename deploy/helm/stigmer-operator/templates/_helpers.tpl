{{- /*
Names and labels for the operator's own objects. The name label is the one
the operator's one-per-cluster check looks for, so it is fixed, not derived
from the release name.
*/ -}}
{{- define "stigmer-operator.labels" -}}
app.kubernetes.io/name: stigmer-operator
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "stigmer-operator.selectorLabels" -}}
app.kubernetes.io/name: stigmer-operator
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "stigmer-operator.image" -}}
{{- printf "%s:%s" .Values.image.repository (default (printf "v%s" .Chart.AppVersion) .Values.image.tag) -}}
{{- end -}}
