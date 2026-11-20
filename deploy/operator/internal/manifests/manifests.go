// Third-party pieces embedded in the operator binary at the versions it is
// tested against: CloudNativePG's release manifest, its Barman Cloud backup
// plugin's release manifest, Temporal's Helm chart, and agent-sandbox's core
// manifest.
//
// Embedding them means an install needs no network path to GitHub or a
// chart repository, and an operator version always installs the same
// prerequisites. README.md beside this file says where each came from and how
// to move it; the Makefile's vendor targets fetch them.

package manifests

import (
	"embed"
	"fmt"
	"io/fs"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	"github.com/stigmer/stigmer/deploy/operator/internal/helmrender"
)

//go:embed cloudnative-pg/release.yaml
var cloudNativePGRelease []byte

//go:embed barman-cloud/manifest.yaml
var barmanCloudPluginRelease []byte

//go:embed temporal
var temporalChart embed.FS

//go:embed agent-sandbox/sandbox.yaml
var agentSandboxRelease []byte

// CloudNativePGNamespace is where CloudNativePG's release installs itself.
const CloudNativePGNamespace = "cnpg-system"

// CloudNativePG parses CloudNativePG's release into objects.
func CloudNativePG() ([]*unstructured.Unstructured, error) {
	objs, err := helmrender.Parse(cloudNativePGRelease)
	if err != nil {
		return nil, fmt.Errorf("parsing the embedded CloudNativePG release: %w", err)
	}
	return objs, nil
}

// BarmanCloudPlugin parses the Barman Cloud plugin's release into objects:
// its definition, its controller in CloudNativePG's namespace (the only
// namespace CloudNativePG discovers plugins in), and the cert-manager
// Issuer and Certificates its TLS rides on.
func BarmanCloudPlugin() ([]*unstructured.Unstructured, error) {
	objs, err := helmrender.Parse(barmanCloudPluginRelease)
	if err != nil {
		return nil, fmt.Errorf("parsing the embedded Barman Cloud plugin release: %w", err)
	}
	return objs, nil
}

// AgentSandboxNamespace is where agent-sandbox's release installs its
// controller.
const AgentSandboxNamespace = "agent-sandbox-system"

// AgentSandbox parses agent-sandbox's core release into objects: its
// definitions, its controller and the controller's roles.
func AgentSandbox() ([]*unstructured.Unstructured, error) {
	objs, err := helmrender.Parse(agentSandboxRelease)
	if err != nil {
		return nil, fmt.Errorf("parsing the embedded agent-sandbox release: %w", err)
	}
	return objs, nil
}

// TemporalChart is Temporal's packaged chart and its version.
func TemporalChart() ([]byte, string, error) {
	entries, err := fs.ReadDir(temporalChart, "temporal")
	if err != nil {
		return nil, "", fmt.Errorf("reading the embedded Temporal chart: %w", err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "temporal-") && strings.HasSuffix(e.Name(), ".tgz") {
			data, err := fs.ReadFile(temporalChart, "temporal/"+e.Name())
			if err != nil {
				return nil, "", fmt.Errorf("reading the embedded Temporal chart: %w", err)
			}
			return data, strings.TrimSuffix(strings.TrimPrefix(e.Name(), "temporal-"), ".tgz"), nil
		}
	}
	return nil, "", fmt.Errorf("no Temporal chart is embedded: run make vendor-temporal-chart")
}
