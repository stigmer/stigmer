// Holds the operator's install to what Agent Substrate's own installer
// creates. testdata/ate-setup-v1.0.1-kind.txt is the object list that
// installer left on a kind cluster; every difference from what this package
// applies is listed here by name, with its reason, so a re-vendored release
// that adds or drops an object fails until someone decides about it.

package install

import (
	"bufio"
	"io/fs"
	"os"
	"slices"
	"strings"
	"testing"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"
)

// clusterScoped are the kinds the install makes outside any namespace.
var clusterScoped = map[string]bool{
	"Namespace": true, "CustomResourceDefinition": true, "ClusterRole": true, "ClusterRoleBinding": true,
	"ValidatingAdmissionPolicy": true, "ValidatingAdmissionPolicyBinding": true, "SandboxConfig": true,
}

// inventoryKey is an object as the inventory names it:
// <namespace or cluster> <resource>/<name>.
func inventoryKey(u *unstructured.Unstructured) string {
	resource := strings.ToLower(u.GetKind())
	if g := u.GroupVersionKind().Group; g != "" {
		resource += "." + g
	}
	scope := u.GetNamespace()
	if clusterScoped[u.GetKind()] {
		scope = "cluster"
	}
	return scope + " " + resource + "/" + u.GetName()
}

func TestTheInstallMatchesUpstreamsInstaller(t *testing.T) {
	f, err := os.Open("testdata/ate-setup-v1.0.1-kind.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	upstream := map[string]bool{}
	scan := bufio.NewScanner(f)
	for scan.Scan() {
		if line := strings.TrimSpace(scan.Text()); line != "" && !strings.HasPrefix(line, "#") {
			upstream[line] = true
		}
	}
	objs, err := Objects()
	if err != nil {
		t.Fatal(err)
	}
	ours := map[string]bool{}
	for _, u := range objs {
		ours[inventoryKey(u)] = true
	}

	// What upstream's kind install has that this one does not.
	notOurs := func(key string) bool {
		for _, prefix := range []string{
			// Kubernetes' own, in every namespace and cluster.
			"ate-system configmap/kube-root-ca.crt", "podcertificate-controller-system configmap/kube-root-ca.crt",
			"ate-system serviceaccount/default", "podcertificate-controller-system serviceaccount/default",
			"cluster clusterrole.rbac.authorization.k8s.io/system:", "cluster clusterrolebinding.rbac.authorization.k8s.io/system:",
			"cluster clusterrolebinding.rbac.authorization.k8s.io/kubeadm:",
			"cluster clustertrustbundle.certificates.k8s.io/kubernetes.io:",
			// Made at run time by Substrate's controllers and the StatefulSet.
			"cluster clustertrustbundle.certificates.k8s.io/", "ate-system persistentvolumeclaim/data-postgres-0",
			// The kind overlay's snapshot store, telemetry stack and the demo.
			"ate-system persistentvolumeclaim/rustfs-data", "ate-system service/rustfs", "ate-system deployment.apps/rustfs",
			"ate-system job.batch/rustfs-bucket-init", "ate-system networkpolicy.networking.k8s.io/rustfs",
			"ate-system rolebinding.rbac.authorization.k8s.io/ate-prometheus", "cluster clusterrole.rbac.authorization.k8s.io/ate-prometheus",
			"cluster namespace/otel-system", "cluster namespace/ate-demo-counter",
		} {
			if strings.HasPrefix(key, prefix) {
				return true
			}
		}
		return false
	}
	// What this install has that upstream's does not: the database's setup
	// script, which upstream runs by exec, and the bucket's credentials,
	// which upstream's kind overlay writes inline.
	onlyOurs := []string{
		"ate-system configmap/" + postgresSetupConfigMap,
		"ate-system secret/" + SnapshotStoreSecret,
	}

	for key := range upstream {
		if !ours[key] && !notOurs(key) {
			t.Errorf("upstream's installer makes %s and this install does not", key)
		}
	}
	for key := range ours {
		if !upstream[key] && !slices.Contains(onlyOurs, key) {
			t.Errorf("this install makes %s and upstream's installer does not", key)
		}
	}
}

func toYAML(t *testing.T, u *unstructured.Unstructured) string {
	t.Helper()
	return toYAMLValue(t, u.Object)
}

func toYAMLValue(t *testing.T, v any) string {
	t.Helper()
	b, err := yaml.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func readRelease(r *release, name string) ([]byte, error) { return fs.ReadFile(r.files, name) }
