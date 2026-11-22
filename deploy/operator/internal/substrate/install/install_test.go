// Walks an install through every phase against a fake cluster, standing in
// for each controller's progress, and pins the order Agent Substrate needs:
// no key material before the namespaces, no database before the trust
// bundles, no control plane before the database, Ready only once every
// rollout and the egress gateway's trust bundle are there. It also pins that
// key material is made once and kept, that Substrate's trust bundles are
// pointed at the namespaces they go with, and that a cluster without the
// pod-certificate APIs, or a release step Substrate forbids, is refused in
// words before anything is applied.

package install

import (
	"bytes"
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	clientgoscheme "k8s.io/client-go/kubernetes/scheme"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

type fakeDiscovery struct {
	served []string
	issuer string
}

func (d fakeDiscovery) Resources(string) ([]string, error) { return d.served, nil }
func (d fakeDiscovery) ServiceAccountIssuer(context.Context) (string, error) {
	return d.issuer, nil
}

var podCertAPIs = []string{"clustertrustbundles", "podcertificaterequests"}

// harness is a fake cluster and every object applied to it, by pass.
type harness struct {
	t       *testing.T
	c       client.Client
	applied []*unstructured.Unstructured
	cluster Cluster
}

func newHarness(t *testing.T, disc Discovery) *harness {
	t.Helper()
	scheme := runtime.NewScheme()
	if err := clientgoscheme.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	if err := apiextensionsv1.AddToScheme(scheme); err != nil {
		t.Fatal(err)
	}
	h := &harness{t: t, c: fake.NewClientBuilder().WithScheme(scheme).Build()}
	h.cluster = Cluster{
		Reader: h.c, Writer: h.c, Discovery: disc,
		Apply: func(ctx context.Context, objs []*unstructured.Unstructured) error {
			for _, u := range objs {
				h.applied = append(h.applied, u)
				// Namespaces exist once applied, with the UID the trust
				// bundles are pointed at.
				if u.GetKind() == "Namespace" {
					ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: u.GetName(), Labels: u.GetLabels(), UID: types.UID("uid-" + u.GetName())}}
					if err := h.c.Create(ctx, ns); err != nil && !strings.Contains(err.Error(), "already exists") {
						return err
					}
				}
			}
			return nil
		},
	}
	return h
}

func (h *harness) pass() Result {
	h.t.Helper()
	h.applied = nil
	res, err := reconcile(context.Background(), h.cluster, mustEmbedded(h.t), testSettings())
	if err != nil {
		h.t.Fatal(err)
	}
	return res
}

func (h *harness) appliedKinds() map[string]bool {
	out := map[string]bool{}
	for _, u := range h.applied {
		out[u.GetKind()+"/"+u.GetName()] = true
	}
	return out
}

func (h *harness) create(obj client.Object) {
	h.t.Helper()
	if err := h.c.Create(context.Background(), obj); err != nil {
		h.t.Fatal(err)
	}
}

func (h *harness) establishDefinitions() {
	for _, name := range []string{"csidriverconfigs.ate.dev", "sandboxconfigs.ate.dev", WorkerPoolCRD} {
		h.create(&apiextensionsv1.CustomResourceDefinition{
			ObjectMeta: metav1.ObjectMeta{Name: name},
			Status: apiextensionsv1.CustomResourceDefinitionStatus{Conditions: []apiextensionsv1.CustomResourceDefinitionCondition{
				{Type: apiextensionsv1.Established, Status: apiextensionsv1.ConditionTrue},
			}},
		})
	}
}

func (h *harness) available(namespace, name string) {
	h.create(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: namespace, Name: name}, Status: appsv1.DeploymentStatus{AvailableReplicas: 1}})
}

func (h *harness) trustBundle(signer string) {
	u := &unstructured.Unstructured{}
	u.SetAPIVersion("certificates.k8s.io/v1beta1")
	u.SetKind("ClusterTrustBundle")
	u.SetName(strings.ReplaceAll(signer, "/", ":") + ":primary-bundle")
	u.SetLabels(map[string]string{TrustBundleLabel: "live"})
	_ = unstructured.SetNestedField(u.Object, signer, "spec", "signerName")
	_ = unstructured.SetNestedField(u.Object, "-----BEGIN CERTIFICATE-----", "spec", "trustBundle")
	h.create(u)
}

func (h *harness) bundleOwner(signer string) string {
	u := &unstructured.Unstructured{}
	u.SetAPIVersion("certificates.k8s.io/v1beta1")
	u.SetKind("ClusterTrustBundle")
	if err := h.c.Get(context.Background(), client.ObjectKey{Name: strings.ReplaceAll(signer, "/", ":") + ":primary-bundle"}, u); err != nil {
		h.t.Fatal(err)
	}
	refs := u.GetOwnerReferences()
	if len(refs) != 1 {
		return ""
	}
	return refs[0].Kind + "/" + refs[0].Name
}

func TestTheInstallWalksSubstratesPhases(t *testing.T) {
	h := newHarness(t, fakeDiscovery{served: podCertAPIs, issuer: "https://kubernetes.default.svc.cluster.local"})

	res := h.pass()
	if !strings.Contains(res.Waiting, "definition") {
		t.Fatalf("first pass waits on %q, want the definitions", res.Waiting)
	}
	if k := h.appliedKinds(); !k["Namespace/"+Namespace] || !k["Namespace/"+PodCertNamespace] || !k["CustomResourceDefinition/"+WorkerPoolCRD] || k["ConfigMap/"+configMapAPIConfig] {
		t.Fatalf("first pass applied %v: want only namespaces, definitions and roles", k)
	}

	h.establishDefinitions()
	res = h.pass()
	if res.Name != "podcertificate-controller" {
		t.Fatalf("waits on %+v, want the pod-certificate controller", res)
	}
	var secrets corev1.SecretList
	if err := h.c.List(context.Background(), &secrets); err != nil {
		t.Fatal(err)
	}
	if len(secrets.Items) != len(pools()) {
		t.Fatalf("made %d key material Secrets, want %d", len(secrets.Items), len(pools()))
	}
	first := map[string][]byte{}
	for _, s := range secrets.Items {
		first[s.Namespace+"/"+s.Name] = s.Data["pool"]
	}
	if k := h.appliedKinds(); !k["SandboxConfig/gvisor-default"] || !k["Secret/"+secretActorIDCACerts] || k["StatefulSet/postgres"] {
		t.Fatalf("second pass applied %v", k)
	}

	h.available(PodCertNamespace, "podcertificate-controller")
	if res = h.pass(); !strings.Contains(res.Waiting, "trust bundle") {
		t.Fatalf("waits on %q, want the trust bundles", res.Waiting)
	}
	for _, s := range []string{ServiceDNSSigner, PodIdentitySigner, postgresSigner} {
		h.trustBundle(s)
	}
	if res = h.pass(); res.Name != "postgres" {
		t.Fatalf("waits on %+v, want the database", res)
	}
	if got := h.bundleOwner(ServiceDNSSigner); got != "Namespace/"+PodCertNamespace {
		t.Fatalf("servicedns bundle owned by %q, want the pod-certificate namespace", got)
	}
	if k := h.appliedKinds(); k["Deployment/ate-api-server"] {
		t.Fatal("the control plane was applied before the database was ready")
	}

	h.create(&appsv1.StatefulSet{ObjectMeta: metav1.ObjectMeta{Namespace: Namespace, Name: "postgres"}, Status: appsv1.StatefulSetStatus{ReadyReplicas: 1}})
	if res = h.pass(); res.Name != "ate-api-server" {
		t.Fatalf("waits on %+v, want the API server", res)
	}
	for _, name := range []string{"ate-api-server", "ate-idp-server", "ate-controller", "atenet-router", "atenet-egress"} {
		h.available(Namespace, name)
	}
	if res = h.pass(); res.Name != "atelet" {
		t.Fatalf("waits on %+v, want the node agent", res)
	}
	h.create(&appsv1.DaemonSet{ObjectMeta: metav1.ObjectMeta{Namespace: Namespace, Name: "atelet"}, Status: appsv1.DaemonSetStatus{NumberAvailable: 1}})
	if res = h.pass(); !strings.Contains(res.Waiting, egressMITMSigner) {
		t.Fatalf("waits on %q, want the egress gateway's trust bundle", res.Waiting)
	}
	h.trustBundle(egressMITMSigner)
	if res = h.pass(); !res.Ready {
		t.Fatalf("final pass = %+v, want Ready", res)
	}
	if got := h.bundleOwner(egressMITMSigner); got != "Namespace/"+Namespace {
		t.Fatalf("egress bundle owned by %q, want %s", got, Namespace)
	}

	// Key material is never replaced.
	if err := h.c.List(context.Background(), &secrets); err != nil {
		t.Fatal(err)
	}
	for _, s := range secrets.Items {
		if want, ok := first[s.Namespace+"/"+s.Name]; ok && !bytes.Equal(s.Data["pool"], want) {
			t.Errorf("%s/%s was regenerated", s.Namespace, s.Name)
		}
	}
}

func TestAClusterWithoutPodCertificatesIsRefused(t *testing.T) {
	h := newHarness(t, fakeDiscovery{served: []string{"clustertrustbundles"}})
	res := h.pass()
	if res.Refusal == "" || !strings.Contains(res.Refusal, "podcertificaterequests") || !strings.Contains(res.Refusal, "1.37") {
		t.Fatalf("refusal = %q, want one naming the missing API and the version that has it", res.Refusal)
	}
	if len(h.applied) != 0 {
		t.Fatalf("applied %d objects to a cluster that was refused", len(h.applied))
	}
}

func TestASkippedMinorReleaseIsRefused(t *testing.T) {
	h := newHarness(t, fakeDiscovery{served: podCertAPIs})
	h.create(&corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: Namespace, Labels: map[string]string{VersionLabel: "v1.2.0"}}})
	res := h.pass()
	if res.Refusal == "" || !strings.Contains(res.Refusal, "v1.2.0") {
		t.Fatalf("refusal = %q, want one naming the installed release", res.Refusal)
	}
	if len(h.applied) != 0 {
		t.Fatalf("applied %d objects over a release step Substrate forbids", len(h.applied))
	}
}
