// Pins the sandbox runtime and the janitor against a real API server.
//
// Under agent-sandbox, with agent-sandbox already installed by someone else,
// the component makes the sandbox namespace, its fence and the server's Role
// and binding there, and the runner component reports the install as one
// without a shared runner. A licensed install that declares the shared
// driver is refused in words naming the per-session drivers.
//
// The janitor does nothing while a Stigmer exists, leaves a prerequisite
// someone else installed whole, keeps the operator's own while instances of
// its kinds remain, and deletes what carries the operator's stamp once none
// do, saying draining until it is gone. envtest runs no namespace
// controller, so a deleted namespace stays terminating and the sweep stops
// there, which is the order the janitor promises.

package controller

import (
	"context"
	"strings"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/janitor"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// sandboxCRD is agent-sandbox's Sandbox definition at the version the
// janitor lists it by.
func sandboxCRD(labels map[string]string) *unstructured.Unstructured {
	u := stubCRD("agents.x-k8s.io", "sandboxes", "Sandbox", labels)
	versions := u.Object["spec"].(map[string]any)["versions"].([]any)
	versions[0].(map[string]any)["name"] = "v1beta1"
	return u
}

func TestAgentSandboxGivesTheServerItsNamespace(t *testing.T) {
	ctx := context.Background()
	ns := namespace(t)
	createIgnoringExisting(t, sandboxCRD(map[string]string{render.ManagedByLabel: "Helm"}))
	s := stigmer(ns, "stigmer")
	s.UID = types.UID("u")
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	s.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox}
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}

	res, err := component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseReady {
		t.Fatalf("agent-sandbox installed by someone else: %+v %v", res, err)
	}
	sandboxes := render.SandboxNamespace(s)
	var namespaceObj corev1.Namespace
	if err := k8s.Get(ctx, client.ObjectKey{Name: sandboxes}, &namespaceObj); err != nil {
		t.Fatalf("no sandbox namespace: %v", err)
	}
	if namespaceObj.Labels[render.ManagedByLabel] != render.ManagedByValue || namespaceObj.Labels["pod-security.kubernetes.io/enforce"] != "baseline" {
		t.Errorf("the sandbox namespace is not stamped or not held to baseline: %v", namespaceObj.Labels)
	}
	var binding rbacv1.RoleBinding
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: sandboxes, Name: s.Name + "-sandboxes"}, &binding); err != nil {
		t.Fatalf("no RoleBinding for the server: %v", err)
	}
	if binding.Subjects[0].Name != render.ServerServiceAccount(s) || binding.Subjects[0].Namespace != ns {
		t.Errorf("the server's access is bound to %+v", binding.Subjects)
	}
	var fence networkingv1.NetworkPolicy
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: sandboxes, Name: render.SandboxEgressPolicy(s)}, &fence); err != nil {
		t.Errorf("the sandboxes are not fenced: %v", err)
	}
	unstamp(t, sandboxes)
}

// unstamp takes the operator's stamp off a namespace a test made, so the
// janitor's later sweeps leave it alone: envtest never finishes deleting a
// namespace.
func unstamp(t *testing.T, name string) {
	t.Helper()
	var ns corev1.Namespace
	if err := k8s.Get(context.Background(), client.ObjectKey{Name: name}, &ns); err != nil {
		t.Fatal(err)
	}
	delete(ns.Labels, render.ManagedByLabel)
	if err := k8s.Update(context.Background(), &ns); err != nil {
		t.Fatal(err)
	}
}

func TestALicensedInstallMustRunPerSessionSandboxes(t *testing.T) {
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	s.Spec.Identity = &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{Issuer: "https://issuer", Audience: "a"}}
	s.Spec.Enterprise = &stigmerv1.EnterpriseSpec{License: &stigmerv1.SecretKeySelector{Name: "l", Key: "k"}}
	res, err := component.Runner{}.Reconcile(context.Background(), &component.Env{Client: k8s, Reader: k8s, Stigmer: s})
	if err != nil || res.Phase != stigmerv1.PhaseRefused || !strings.Contains(res.Message, "spec.sandboxes.driver agentSandbox") {
		t.Errorf("a licensed install on the shared runner: %+v %v", res, err)
	}
}

func TestTheJanitor(t *testing.T) {
	ctx := context.Background()
	deleteStigmersElsewhere(t)
	direct := janitor.Direct{Reader: k8s, Writer: k8s}
	stamp := map[string]string{render.ManagedByLabel: render.ManagedByValue}

	// While a Stigmer exists, nothing is swept.
	present := stigmer(namespace(t), "present")
	if err := k8s.Create(ctx, present); err != nil {
		t.Fatal(err)
	}
	if out, err := janitor.Sweep(ctx, direct); err != nil || out != nil {
		t.Fatalf("a sweep beside a Stigmer: %+v %v", out, err)
	}
	if err := k8s.Delete(ctx, present); err != nil {
		t.Fatal(err)
	}

	// agent-sandbox, the operator's own, with a Sandbox still running.
	crd := sandboxCRD(stamp)
	if err := k8s.Delete(ctx, crd); err != nil && !apierrors.IsNotFound(err) {
		t.Fatal(err)
	}
	waitGone(t, crd)
	if err := k8s.Create(ctx, sandboxCRD(stamp)); err != nil {
		t.Fatal(err)
	}
	waitEstablished(t, "sandboxes.agents.x-k8s.io")
	box := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "agents.x-k8s.io/v1beta1", "kind": "Sandbox",
		"metadata": map[string]any{"name": "session", "namespace": namespace(t)},
	}}
	if err := k8s.Create(ctx, box); err != nil {
		t.Fatal(err)
	}
	out := sweep(t, direct)
	if o := outcome(out, "agent-sandbox"); o.Verdict != janitor.KeptInUse || !strings.Contains(o.Detail, "Sandbox") {
		t.Errorf("agent-sandbox with a Sandbox left: %+v", o)
	}

	// No Sandbox left: the stamped definition goes, and the stamped
	// namespace is deleted; it stays terminating under envtest.
	if err := k8s.Delete(ctx, box); err != nil {
		t.Fatal(err)
	}
	createIgnoringExisting(t, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "agent-sandbox-system", Labels: stamp}})
	out = sweep(t, direct)
	if o := outcome(out, "agent-sandbox"); o.Verdict != janitor.Draining {
		t.Errorf("agent-sandbox, unused: %+v", o)
	}
	waitGone(t, sandboxCRD(nil))
	var gone corev1.Namespace
	if err := k8s.Get(ctx, client.ObjectKey{Name: "agent-sandbox-system"}, &gone); err == nil && gone.DeletionTimestamp == nil {
		t.Error("agent-sandbox's own namespace was not deleted")
	}

	// Someone else's definition is never touched.
	if err := k8s.Create(ctx, sandboxCRD(map[string]string{render.ManagedByLabel: "Helm"})); err != nil {
		t.Fatal(err)
	}
	waitEstablished(t, "sandboxes.agents.x-k8s.io")
	out = sweep(t, direct)
	if o := outcome(out, "agent-sandbox"); o.Verdict != janitor.KeptForeign {
		t.Errorf("someone else's agent-sandbox: %+v", o)
	}
}

// TestTheJanitorStopsAtAStampedSandboxNamespace pins the order: sandboxes go
// before the runtime that clears them.
func TestTheJanitorStopsAtAStampedSandboxNamespace(t *testing.T) {
	ctx := context.Background()
	deleteStigmersElsewhere(t)
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "janitor-sandboxes", Labels: map[string]string{
		render.ManagedByLabel: render.ManagedByValue, render.ComponentLabel: render.ComponentSandboxes,
	}}}
	createIgnoringExisting(t, ns)
	out := sweep(t, janitor.Direct{Reader: k8s, Writer: k8s})
	if len(out) != 1 || out[0].Verdict != janitor.Draining {
		t.Errorf("a sweep went past a draining sandbox namespace: %+v", out)
	}
	var got corev1.Namespace
	if err := k8s.Get(ctx, client.ObjectKey{Name: ns.Name}, &got); err == nil && got.DeletionTimestamp == nil {
		t.Error("the stamped sandbox namespace was not deleted")
	}
	unstamp(t, ns.Name)
}

// waitGone waits for an object to be deleted.
func waitGone(t *testing.T, obj *unstructured.Unstructured) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		got := &unstructured.Unstructured{}
		got.SetGroupVersionKind(obj.GroupVersionKind())
		if err := k8s.Get(context.Background(), client.ObjectKey{Name: obj.GetName(), Namespace: obj.GetNamespace()}, got); apierrors.IsNotFound(err) {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("%s %s was never deleted", obj.GetKind(), obj.GetName())
}

// waitEstablished waits for a definition to serve its kind.
func waitEstablished(t *testing.T, name string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		crd := &unstructured.Unstructured{}
		crd.SetGroupVersionKind(stubCRD("", "", "", nil).GroupVersionKind())
		if err := k8s.Get(context.Background(), client.ObjectKey{Name: name}, crd); err == nil {
			conditions, _, _ := unstructured.NestedSlice(crd.Object, "status", "conditions")
			for _, c := range conditions {
				if m, ok := c.(map[string]any); ok && m["type"] == "Established" && m["status"] == "True" {
					return
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("definition %s was never established", name)
}

func sweep(t *testing.T, c janitor.Client) []janitor.Outcome {
	t.Helper()
	out, err := janitor.Sweep(context.Background(), c)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func outcome(out []janitor.Outcome, name string) janitor.Outcome {
	for _, o := range out {
		if o.Name == name {
			return o
		}
	}
	return janitor.Outcome{}
}
