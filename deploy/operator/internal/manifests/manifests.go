// Third-party pieces embedded in the operator binary at the versions it is
// tested against: CloudNativePG's release manifest and Temporal's Helm chart.
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

//go:embed temporal
var temporalChart embed.FS

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
