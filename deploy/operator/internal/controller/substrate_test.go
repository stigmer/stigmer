// Pins the substrate driver's component, its runner wait and its cleanup
// against a real API server. The install itself is walked against a fake
// cluster in internal/substrate/install; envtest serves neither the
// pod-certificate APIs nor any controller, so here Substrate is someone
// else's (a stub definition) and the component's own work is what is
// checked:
//
//   - a build with no runner digest, a bucket the sandboxes cannot name, and
//     skip with no Substrate are each refused in words;
//   - with someone else's Substrate, the component makes the privileged
//     sandbox namespace and a WorkerPool of the declared size whose label
//     the server's worker selector names, admits the server's namespace to
//     Substrate's API, waits in words for the first worker, and once one is
//     ready names the identities the other install must allow;
//   - the runner component holds the install out of Ready until the server
//     says the sandbox image exists, and only under the substrate driver;
//   - the janitor keeps the operator's Substrate while a WorkerPool remains,
//     removes it once none does, and withdraws the API access label only
//     where its own field manager set it.

package controller

import (
	"context"
	"errors"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/janitor"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

func workerPoolCRD(labels map[string]string) *unstructured.Unstructured {
	return stubCRD("ate.dev", "workerpools", "WorkerPool", labels)
}

// substrateStigmer is a Stigmer on the substrate driver, with a bucket the
// sandboxes reach by an in-cluster name and its credentials in place.
func substrateStigmer(t *testing.T, endpoint string) *stigmerv1.Stigmer {
	t.Helper()
	ns := namespace(t)
	createIgnoringExisting(t, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "bucket"},
		Data: map[string][]byte{render.ObjectStoreAccessKeyID: []byte("id"), render.ObjectStoreSecretAccessKey: []byte("secret")}})
	s := stigmer(ns, "stigmer")
	s.UID = "u"
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", Endpoint: endpoint,
		CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	s.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverSubstrate,
		Substrate: &stigmerv1.SubstrateSpec{Workers: 2}}
	return s
}

// withRunnerDigest stamps a runner digest for one test, as a release build
// would.
func withRunnerDigest(t *testing.T) {
	t.Helper()
	was := version.SandboxRunnerDigest
	version.SandboxRunnerDigest = "sha256:" + strings.Repeat("a", 64)
	t.Cleanup(func() { version.SandboxRunnerDigest = was })
}

func TestTheSubstrateDriverRefusesInWords(t *testing.T) {
	ctx := context.Background()
	s := substrateStigmer(t, "http://minio.storage.svc.cluster.local:9000")
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}

	res, err := component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseRefused || !strings.Contains(res.Message, "SANDBOX_RUNNER_DIGEST") {
		t.Errorf("an operator build with no runner digest: %+v %v", res, err)
	}

	withRunnerDigest(t)
	env.Stigmer = substrateStigmer(t, "http://minio:9000")
	res, err = component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseRefused || !strings.Contains(res.Message, "two or more labels") {
		t.Errorf("a bucket at a single-label host: %+v %v", res, err)
	}

	if err := k8s.Delete(ctx, workerPoolCRD(nil)); err != nil && !apierrors.IsNotFound(err) {
		t.Fatal(err)
	}
	waitGone(t, workerPoolCRD(nil))
	env.Stigmer = substrateStigmer(t, "http://minio.storage.svc.cluster.local:9000")
	env.Stigmer.Spec.Prerequisites.Substrate = stigmerv1.PrerequisiteSkip
	res, err = component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseRefused || !strings.Contains(res.Message, "spec.prerequisites.substrate is skip") {
		t.Errorf("skip with no Substrate: %+v %v", res, err)
	}
}

func TestSomeoneElsesSubstrateGetsAPoolAndAnAdmittedServer(t *testing.T) {
	ctx := context.Background()
	withRunnerDigest(t)
	if err := k8s.Delete(ctx, workerPoolCRD(nil)); err != nil && !apierrors.IsNotFound(err) {
		t.Fatal(err)
	}
	waitGone(t, workerPoolCRD(nil))
	createIgnoringExisting(t, workerPoolCRD(map[string]string{render.ManagedByLabel: "Helm"}))
	waitEstablished(t, substrate.WorkerPoolCRD)
	s := substrateStigmer(t, "http://minio.storage.svc.cluster.local:9000")
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}

	res, err := component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseDeploying || res.Reason != stigmerv1.ReasonWaitingForWorkers {
		t.Fatalf("before any worker: %+v %v", res, err)
	}
	sandboxes := render.SandboxNamespace(s)
	var sandboxNS corev1.Namespace
	if err := k8s.Get(ctx, client.ObjectKey{Name: sandboxes}, &sandboxNS); err != nil {
		t.Fatal(err)
	}
	if sandboxNS.Labels["pod-security.kubernetes.io/enforce"] != "privileged" {
		t.Errorf("the sandbox namespace for gVisor workers enforces %q", sandboxNS.Labels["pod-security.kubernetes.io/enforce"])
	}
	pool := &unstructured.Unstructured{}
	pool.SetGroupVersionKind(render.SubstratePoolGVK)
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: sandboxes, Name: render.SubstratePool(s)}, pool); err != nil {
		t.Fatalf("no WorkerPool: %v", err)
	}
	if replicas, _, _ := unstructured.NestedInt64(pool.Object, "spec", "replicas"); replicas != 2 {
		t.Errorf("the pool keeps %d workers, want the declared 2", replicas)
	}
	if pool.GetLabels()[render.SubstratePoolLabel] != render.SubstratePool(s) {
		t.Errorf("the pool's own labels %v lack the label the server's worker selector names", pool.GetLabels())
	}
	if image, _, _ := unstructured.NestedString(pool.Object, "spec", "workerImage"); !strings.Contains(image, "ateworker-gvisor") || !strings.Contains(image, "@sha256:") {
		t.Errorf("the pool runs %q, not the pinned gVisor worker", image)
	}
	var serverNS corev1.Namespace
	if err := k8s.Get(ctx, client.ObjectKey{Name: s.Namespace}, &serverNS); err != nil {
		t.Fatal(err)
	}
	if serverNS.Labels[substrate.APIAccessLabel] != "true" {
		t.Errorf("the server's namespace is not admitted to Substrate's API: %v", serverNS.Labels)
	}

	_ = unstructured.SetNestedField(pool.Object, int64(1), "status", "readyReplicas")
	if err := k8s.Update(ctx, pool); err != nil {
		t.Fatal(err)
	}
	res, err = component.Sandboxes{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseReady || !strings.Contains(res.Message, render.ServerPrincipal(s)) || !strings.Contains(res.Message, render.ServerSPIFFEID(s)) {
		t.Errorf("with a ready worker on someone else's Substrate: %+v %v", res, err)
	}
	unstamp(t, sandboxes)
}

type fakeHealth struct {
	serving bool
	err     error
	asked   int
}

func (f *fakeHealth) SandboxesServing(context.Context, string) (bool, error) {
	f.asked++
	return f.serving, f.err
}

func TestTheRunnerWaitsForTheSandboxImage(t *testing.T) {
	ctx := context.Background()
	s := substrateStigmer(t, "http://minio.storage.svc.cluster.local:9000")
	health := &fakeHealth{err: errors.New("connection refused")}
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s, ServerHealth: health}

	res, err := component.Runner{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseDeploying || res.Reason != stigmerv1.ReasonPreparingSandboxImage || !strings.Contains(res.Message, "connection refused") {
		t.Errorf("a server that cannot be asked: %+v %v", res, err)
	}
	health.err = nil
	res, err = component.Runner{}.Reconcile(ctx, env)
	if err != nil || res.Reason != stigmerv1.ReasonPreparingSandboxImage || !strings.Contains(res.Message, "the console already answers") {
		t.Errorf("an image still building: %+v %v", res, err)
	}
	health.serving = true
	res, err = component.Runner{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseReady || res.Reason != stigmerv1.ReasonPerSessionSandboxes {
		t.Errorf("the image published: %+v %v", res, err)
	}

	asked := health.asked
	s.Spec.Sandboxes.Driver = stigmerv1.SandboxDriverAgentSandbox
	s.Spec.Sandboxes.Substrate = nil
	res, err = (component.Runner{}).Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseReady || health.asked != asked {
		t.Errorf("agent-sandbox, which has no starting image, was held or the server asked: %+v %v", res, err)
	}
}

func TestTheJanitorRemovesSubstrateAndWithdrawsItsLabel(t *testing.T) {
	ctx := context.Background()
	deleteStigmersElsewhere(t)
	direct := janitor.Direct{Reader: k8s, Writer: k8s}
	stamp := map[string]string{render.ManagedByLabel: render.ManagedByValue}

	// The label: withdrawn where the operator's manager set it, kept where
	// someone else did.
	ours, theirs := namespace(t), namespace(t)
	labelled := []struct{ name, manager string }{{ours, render.SubstrateAccessFieldManager}, {theirs, "someone-else"}}
	for _, n := range labelled {
		ns := &unstructured.Unstructured{}
		ns.SetAPIVersion("v1")
		ns.SetKind("Namespace")
		ns.SetName(n.name)
		ns.SetLabels(map[string]string{substrate.APIAccessLabel: "true"})
		if err := k8s.Patch(ctx, ns, client.Apply, client.FieldOwner(n.manager), client.ForceOwnership); err != nil {
			t.Fatal(err)
		}
	}

	// The operator's own Substrate, with a WorkerPool still there.
	if err := k8s.Delete(ctx, workerPoolCRD(nil)); err != nil && !apierrors.IsNotFound(err) {
		t.Fatal(err)
	}
	waitGone(t, workerPoolCRD(nil))
	if err := k8s.Create(ctx, workerPoolCRD(stamp)); err != nil {
		t.Fatal(err)
	}
	waitEstablished(t, substrate.WorkerPoolCRD)
	pool := &unstructured.Unstructured{}
	pool.SetGroupVersionKind(render.SubstratePoolGVK)
	pool.SetNamespace(namespace(t))
	pool.SetName("pool")
	if err := k8s.Create(ctx, pool); err != nil {
		t.Fatal(err)
	}
	out := sweep(t, direct)
	if o := outcome(out, "Agent Substrate"); o.Verdict != janitor.KeptInUse || !strings.Contains(o.Detail, "WorkerPool") {
		t.Errorf("Substrate with a WorkerPool left: %+v", o)
	}
	for name, want := range map[string]string{ours: "", theirs: "true"} {
		var ns corev1.Namespace
		if err := k8s.Get(ctx, client.ObjectKey{Name: name}, &ns); err != nil {
			t.Fatal(err)
		}
		if got := ns.Labels[substrate.APIAccessLabel]; got != want {
			t.Errorf("namespace %s carries %s=%q after the sweep, want %q", name, substrate.APIAccessLabel, got, want)
		}
	}

	// No WorkerPool left: the stamped definition goes.
	if err := k8s.Delete(ctx, pool); err != nil {
		t.Fatal(err)
	}
	out = sweep(t, direct)
	if o := outcome(out, "Agent Substrate"); o.Verdict != janitor.Draining && o.Verdict != janitor.Removed {
		t.Errorf("Substrate, unused: %+v", o)
	}
	waitGone(t, workerPoolCRD(nil))
}
