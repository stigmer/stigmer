// Pins the bundled Temporal's render of the embedded chart: no step creates
// a database (the database component declared both), a schema Job and a
// namespace Job exist under the names readiness looks for, the namespace Job
// registers `default` with Compose's retention, the frontend is reached at
// the address the server is given, and nothing lands outside the Stigmer's
// namespace or outside the operator's ownership rules.

package component

import (
	"encoding/json"
	"strings"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func TestTemporalRender(t *testing.T) {
	st := &stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{Name: "stigmer", Namespace: "team", UID: "u1"}}
	objs, err := RenderTemporal(st)
	if err != nil {
		t.Fatal(err)
	}
	var schemaJob, namespaceJob *unstructured.Unstructured
	frontendService := false
	for _, o := range objs {
		if o.GetNamespace() != "team" {
			t.Errorf("%s %s renders into namespace %q", o.GetKind(), o.GetName(), o.GetNamespace())
		}
		raw, _ := json.Marshal(o.Object)
		if strings.Contains(string(raw), "create-database") {
			t.Errorf("%s %s creates a database", o.GetKind(), o.GetName())
		}
		switch {
		case o.GetKind() == "Job" && strings.HasPrefix(o.GetName(), render.TemporalSchemaJobPrefix(st)):
			schemaJob = o
		case o.GetKind() == "Job" && strings.HasPrefix(o.GetName(), render.TemporalNamespaceJobPrefix(st)):
			namespaceJob = o
		case o.GetKind() == "Service" && o.GetName() == render.TemporalFrontendService(st):
			frontendService = true
		}
	}
	if schemaJob == nil || namespaceJob == nil {
		t.Fatalf("schema Job %v, namespace Job %v", schemaJob != nil, namespaceJob != nil)
	}
	raw, _ := json.Marshal(namespaceJob.Object)
	if !strings.Contains(string(raw), render.TemporalNamespace) || !strings.Contains(string(raw), render.TemporalRetention) {
		t.Errorf("the namespace Job does not register %s with %s retention", render.TemporalNamespace, render.TemporalRetention)
	}
	if !frontendService {
		t.Errorf("no Service %s, the address the server dials", render.TemporalFrontendService(st))
	}
	if err := Own(st, objs, func(u *unstructured.Unstructured) (bool, error) {
		return u.GetKind() != "ClusterRole" && u.GetKind() != "ClusterRoleBinding", nil
	}); err != nil {
		t.Errorf("the render breaks the ownership rules: %v", err)
	}
}
