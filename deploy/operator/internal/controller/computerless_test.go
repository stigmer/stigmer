// Pins the computer-less runner against a real API server, the server's
// dependencies faked Ready:
//
//   - under a per-session driver the server component mints the shared-runner
//     key before the server starts and hands the server that key, and the
//     same key survives later passes;
//   - the runner component applies the runner's own Deployment (one replica)
//     and claim, waits in words until its pod runs, and then reports agents
//     without a computer on the one shared runner;
//   - an install that moves back to the shared driver loses the runner's
//     Deployment, so the server's pod can take back the runner's claim.

package controller

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// readyRunnerPod stands in for the computer-less runner's running pod;
// envtest runs no controller that would make one.
func readyRunnerPod(t *testing.T, st *stigmerv1.Stigmer) {
	t.Helper()
	ctx := context.Background()
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: st.Namespace, Name: "runner", Labels: render.SelectorLabels(st, render.ComponentRunner)},
		Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: render.RunnerContainer, Image: "runner"}}},
	}
	if err := k8s.Create(ctx, pod); err != nil {
		t.Fatal(err)
	}
	pod.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name: render.RunnerContainer, Ready: true,
		State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: metav1.Now()}},
	}}
	if err := k8s.Status().Update(ctx, pod); err != nil {
		t.Fatal(err)
	}
}

func TestTheComputerlessRunnerFollowsTheDriver(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	s.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	r := upgradeReconciler()
	reconcileOnce(t, r, s)

	var key corev1.Secret
	keyName := client.ObjectKey{Namespace: ns, Name: render.SharedRunnerKeySecret(s)}
	if err := k8s.Get(ctx, keyName, &key); err != nil {
		t.Fatalf("no shared-runner key before the server starts: %v", err)
	}
	minted := string(key.Data[render.SharedRunnerKeyKey])
	server := liveServer(t, s).Spec.Template.Spec.Containers[0]
	if !hasSecretEnv(server, render.SharedRunnerKeyKey, render.SharedRunnerKeySecret(s)) {
		t.Error("the server is not handed the shared-runner key")
	}
	reconcileOnce(t, r, s)
	if err := k8s.Get(ctx, keyName, &key); err != nil || string(key.Data[render.SharedRunnerKeyKey]) != minted {
		t.Errorf("the shared-runner key was minted again: %v", err)
	}

	var live stigmerv1.Stigmer
	if err := k8s.Get(ctx, client.ObjectKeyFromObject(s), &live); err != nil {
		t.Fatal(err)
	}
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: &live}
	res, err := component.Runner{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseDeploying || !strings.Contains(res.Message, "without a computer") {
		t.Errorf("before the runner's pod runs: %+v %v", res, err)
	}
	var d appsv1.Deployment
	runnerName := client.ObjectKey{Namespace: ns, Name: render.ComputerlessRunnerDeployment(s)}
	if err := k8s.Get(ctx, runnerName, &d); err != nil {
		t.Fatalf("no runner Deployment: %v", err)
	}
	if d.Spec.Replicas == nil || *d.Spec.Replicas != 1 {
		t.Errorf("the runner runs %v replicas", d.Spec.Replicas)
	}
	if !hasSecretEnv(d.Spec.Template.Spec.Containers[0], "STIGMER_TOKEN", render.SharedRunnerKeySecret(s)) {
		t.Error("the runner does not present the shared-runner key")
	}
	var claim corev1.PersistentVolumeClaim
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.RunnerDataClaim(s)}, &claim); err != nil {
		t.Errorf("no claim for the runner's saved state: %v", err)
	}

	readyRunnerPod(t, &live)
	res, err = component.Runner{}.Reconcile(ctx, env)
	if err != nil || res.Phase != stigmerv1.PhaseReady || res.Reason != stigmerv1.ReasonPerSessionSandboxes || !strings.Contains(res.Message, "one shared runner") {
		t.Errorf("with the runner running: %+v %v", res, err)
	}

	// Back to the shared driver: the runner's Deployment goes.
	live.Spec.Sandboxes = nil
	if err := k8s.Update(ctx, &live); err != nil {
		t.Fatal(err)
	}
	reconcileOnce(t, r, s)
	if err := k8s.Get(ctx, runnerName, &d); !apierrors.IsNotFound(err) {
		t.Errorf("the computer-less runner outlived its driver: %v", err)
	}
	_ = k8s.Delete(ctx, s)
}

func hasSecretEnv(c corev1.Container, name, secret string) bool {
	for _, e := range c.Env {
		if e.Name == name && e.ValueFrom != nil && e.ValueFrom.SecretKeyRef != nil && e.ValueFrom.SecretKeyRef.Name == secret {
			return true
		}
	}
	return false
}
