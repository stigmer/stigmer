// Renders an embedded Helm chart in memory into objects the operator applies
// itself, with no Helm release in the cluster.
//
// The operator owns these objects like any other it renders: server-side
// applied under its field manager, owned by the Stigmer, read back for
// status. A Helm release would be a second owner with its own idea of the
// objects' state. Hooks are kept as ordinary objects, since a Job a chart
// marks pre-install is still a Job the operator wants applied; the caller
// orders and waits on them. Chart tests are dropped. The namespace is set on
// every namespaced object the chart left unqualified, so nothing lands in
// the operator's own namespace by accident.

package helmrender

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/release"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
)

// kubeVersion is the Kubernetes version charts are rendered for; it only
// gates a chart's own kubeVersion checks and capability switches.
const kubeVersion = "v1.30.0"

// clusterScoped lists the kinds an embedded chart may render that carry no
// namespace; everything else is given the target namespace.
var clusterScoped = map[string]bool{
	"Namespace": true, "ClusterRole": true, "ClusterRoleBinding": true,
	"CustomResourceDefinition": true, "MutatingWebhookConfiguration": true,
	"ValidatingWebhookConfiguration": true, "PriorityClass": true, "StorageClass": true,
}

// Render renders a packaged chart with values into objects in namespace.
func Render(archive []byte, releaseName, namespace string, values map[string]any) ([]*unstructured.Unstructured, error) {
	chrt, err := loader.LoadArchive(bytes.NewReader(archive))
	if err != nil {
		return nil, fmt.Errorf("loading the embedded chart: %w", err)
	}
	install := action.NewInstall(&action.Configuration{})
	install.ClientOnly = true
	install.DryRun = true
	install.Replace = true
	install.IncludeCRDs = false
	install.ReleaseName = releaseName
	install.Namespace = namespace
	kv, err := chartutil.ParseKubeVersion(kubeVersion)
	if err != nil {
		return nil, fmt.Errorf("parsing the render's Kubernetes version: %w", err)
	}
	install.KubeVersion = kv

	rel, err := install.Run(chrt, values)
	if err != nil {
		return nil, fmt.Errorf("rendering chart %s: %w", chrt.Name(), err)
	}

	var docs strings.Builder
	docs.WriteString(rel.Manifest)
	for _, hook := range rel.Hooks {
		if isTestHook(hook) {
			continue
		}
		docs.WriteString("\n---\n")
		docs.WriteString(hook.Manifest)
	}
	objs, err := Parse([]byte(docs.String()))
	if err != nil {
		return nil, fmt.Errorf("parsing chart %s's render: %w", chrt.Name(), err)
	}
	for _, obj := range objs {
		if obj.GetNamespace() == "" && !clusterScoped[obj.GetKind()] {
			obj.SetNamespace(namespace)
		}
	}
	return objs, nil
}

func isTestHook(hook *release.Hook) bool {
	for _, event := range hook.Events {
		if event == release.HookTest {
			return true
		}
	}
	return false
}

// Parse splits multi-document YAML into objects, skipping empty documents.
func Parse(data []byte) ([]*unstructured.Unstructured, error) {
	decoder := utilyaml.NewYAMLOrJSONDecoder(bytes.NewReader(data), 4096)
	var objs []*unstructured.Unstructured
	for {
		var raw map[string]any
		if err := decoder.Decode(&raw); err != nil {
			if errors.Is(err, io.EOF) {
				return objs, nil
			}
			return nil, err
		}
		if len(raw) == 0 {
			continue
		}
		objs = append(objs, &unstructured.Unstructured{Object: raw})
	}
}
