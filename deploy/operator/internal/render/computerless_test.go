// Pins the computer-less runner: it renders beside both per-session drivers,
// licensed or not, as one replica that is recreated, never rolled; it serves
// only conversations without a computer and reaches Temporal through the
// server, its Temporal address being exactly its backend endpoint's host
// and port, with no direct Temporal setting; it presents the shared-runner
// key and holds the payload key the server holds; the server is handed the
// same two keys; sandboxes are never handed either; no fence cuts the
// runner off from the server; and the shared driver's render carries none
// of it.

package render

import (
	"encoding/json"
	"net/url"
	"slices"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/labels"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

func licensedAgentSandboxProfile() *stigmerv1.Stigmer {
	st := profiles()["enterprise"]
	st.Spec.ObjectStore = profiles()["bucket"].Spec.ObjectStore
	st.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox}
	return st
}

func perSessionProfiles() map[string]*stigmerv1.Stigmer {
	return map[string]*stigmerv1.Stigmer{
		"agentSandbox":          agentSandboxProfile(),
		"substrate":             substrateProfile(),
		"licensed agentSandbox": licensedAgentSandboxProfile(),
	}
}

// computerlessNames are the settings that exist for the computer-less
// runner alone, on either side.
var computerlessNames = []string{SharedRunnerKeyKey, PayloadKey, "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID", "STIGMER_RUNNER_SERVES"}

func secretRef(e corev1.EnvVar) (string, string) {
	if e.ValueFrom == nil || e.ValueFrom.SecretKeyRef == nil {
		return "", ""
	}
	return e.ValueFrom.SecretKeyRef.Name, e.ValueFrom.SecretKeyRef.Key
}

func TestTheComputerlessRunnerRendersBesideEveryPerSessionDriver(t *testing.T) {
	for name, st := range perSessionProfiles() {
		if !ComputerlessRunner(st) || RunnerEnabled(st) {
			t.Errorf("%s: computer-less %v, shared container %v; want only the computer-less runner", name, ComputerlessRunner(st), RunnerEnabled(st))
		}
		d := ComputerlessRunnerDeploymentObject(st)
		if d.Name != "stigmer-runner" || d.Spec.Replicas == nil || *d.Spec.Replicas != 1 || d.Spec.Strategy.Type != appsv1.RecreateDeploymentStrategyType {
			t.Errorf("%s: %s runs %v replicas by %s; want one, recreated", name, d.Name, d.Spec.Replicas, d.Spec.Strategy.Type)
		}
		pod := d.Spec.Template.Spec
		if pod.AutomountServiceAccountToken == nil || *pod.AutomountServiceAccountToken {
			t.Errorf("%s: the runner's pod mounts a Kubernetes token", name)
		}
		if len(pod.Containers) != 1 || len(pod.Volumes) != 1 || pod.Volumes[0].PersistentVolumeClaim == nil ||
			pod.Volumes[0].PersistentVolumeClaim.ClaimName != RunnerDataClaim(st) || pod.Containers[0].VolumeMounts[0].MountPath != "/data" {
			t.Errorf("%s: the runner's saved state is not on its own claim at /data: %+v", name, pod.Volumes)
		}
		if !labels.SelectorFromSet(d.Spec.Selector.MatchLabels).Matches(labels.Set(d.Spec.Template.Labels)) {
			t.Errorf("%s: the Deployment does not select its own pods", name)
		}

		env := envMap(pod.Containers[0].Env)
		for k, want := range map[string]string{
			"STIGMER_RUNNER_SERVES":             "computerless",
			"STIGMER_TASK_QUEUE":                RunnerTaskQueue,
			"STIGMER_BACKEND_ENDPOINT":          "http://stigmer.stigmer.svc.cluster.local:7234",
			"TEMPORAL_SERVICE_ADDRESS":          "stigmer.stigmer.svc.cluster.local:7234",
			"ARTIFACT_STORAGE_TYPE":             "proxy",
			"STIGMER_ARTIFACT_PROXY_ENDPOINT":   BackendEndpoint(st),
			"STIGMER_PAYLOAD_ENCRYPTION_KEY_ID": PayloadKeyID,
		} {
			if got := env[k]; got.Value != want {
				t.Errorf("%s: %s = %q; want %q", name, k, got.Value, want)
			}
		}
		// The runner knows the server's lane by this equality alone
		// (backend/services/runner/src/temporal-lane.ts).
		backend, err := url.Parse(env["STIGMER_BACKEND_ENDPOINT"].Value)
		if err != nil || backend.Host != env["TEMPORAL_SERVICE_ADDRESS"].Value {
			t.Errorf("%s: the Temporal address %q is not the backend endpoint's host and port %q", name, env["TEMPORAL_SERVICE_ADDRESS"].Value, backend.Host)
		}
		for k := range env {
			if strings.HasPrefix(k, "STIGMER_TEMPORAL_") || k == "STIGMER_PROXY_ENDPOINT" {
				t.Errorf("%s: the runner is handed %s; it reaches Temporal and its models on its own lanes", name, k)
			}
		}
		if s, k := secretRef(env["STIGMER_TOKEN"]); s != "stigmer-shared-runner-key" || k != SharedRunnerKeyKey {
			t.Errorf("%s: the runner's token is %s/%s, not the shared-runner key", name, s, k)
		}
		if s, k := secretRef(env[PayloadKey]); s != KeysSecret(st) || k != PayloadKey {
			t.Errorf("%s: the runner's payload key is %s/%s", name, s, k)
		}
		if s, _ := secretRef(env["ANTHROPIC_API_KEY"]); s != "anthropic" {
			t.Errorf("%s: the runner does not read its model key from the declared Secret", name)
		}

		server := envMap(ServerEnv(st, nil))
		if s, k := secretRef(server[SharedRunnerKeyKey]); s != "stigmer-shared-runner-key" || k != SharedRunnerKeyKey {
			t.Errorf("%s: the server's shared-runner key is %s/%s", name, s, k)
		}
		if s, k := secretRef(server[PayloadKey]); s != KeysSecret(st) || k != PayloadKey || server["STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"].Value != PayloadKeyID {
			t.Errorf("%s: the server does not hold the runner's payload key: %s/%s", name, s, k)
		}
		if _, ok := server["STIGMER_RUNNER_API_KEY"]; ok {
			t.Errorf("%s: the server is handed a shared runner's organization key", name)
		}
	}
}

func TestTheComputerlessRunnerIsSizedAndTunedLikeTheSharedOne(t *testing.T) {
	st := agentSandboxProfile()
	st.Spec.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("6Gi")}}
	size := resource.MustParse("30Gi")
	st.Spec.Runner.Storage = &stigmerv1.VolumeSpec{Size: &size}
	st.Spec.Runner.ExtraEnv = []corev1.EnvVar{{Name: "STIGMER_TURN_MEMORY_MB", Value: "1024"}}
	c := ComputerlessRunnerDeploymentObject(st).Spec.Template.Spec.Containers[0]
	if got := c.Resources.Limits[corev1.ResourceMemory]; got.String() != "6Gi" {
		t.Errorf("the runner's memory limit is %s; spec.runner.resources says 6Gi", got.String())
	}
	if got := ComputerlessRunnerClaim(st).Spec.Resources.Requests[corev1.ResourceStorage]; got.String() != "30Gi" {
		t.Errorf("the runner's claim asks for %s; spec.runner.storage says 30Gi", got.String())
	}
	if envMap(c.Env)["STIGMER_TURN_MEMORY_MB"].Value != "1024" {
		t.Error("spec.runner.extraEnv does not reach the runner")
	}
	st.Spec.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("128Mi")}}
	if msg := SizingRefusal(st); !strings.Contains(msg, "spec.runner.resources") {
		t.Errorf("a runner too small to boot was not refused: %q", msg)
	}
}

func TestSandboxesAreNeverHandedTheSharedRunnersKeys(t *testing.T) {
	for name, st := range perSessionProfiles() {
		env := envMap(ServerEnv(st, RunnerModelKeys))
		for _, list := range []string{"STIGMER_SANDBOX_RUNNER_SECRETS", "STIGMER_SANDBOX_RUNNER_ENV"} {
			for _, listed := range strings.Split(env[list].Value, ",") {
				if listed == SharedRunnerKeyKey || strings.HasPrefix(listed, "STIGMER_PAYLOAD_ENCRYPTION") || listed == "STIGMER_TOKEN" {
					t.Errorf("%s: %s hands every sandbox %s", name, list, listed)
				}
			}
		}
	}
}

func TestNoFenceCutsTheRunnerOffFromTheServer(t *testing.T) {
	st := agentSandboxProfile()
	st.Spec.Server.Egress = &stigmerv1.ServerEgressSpec{Fenced: true}
	runnerPod := labels.Set(ComputerlessRunnerDeploymentObject(st).Spec.Template.Labels)
	for _, p := range []*networkingv1.NetworkPolicy{
		PostgresPolicyObject(st, "cnpg"), TemporalPolicyObject(st), ServerEgressPolicyObject(st, FenceInputs{}), SandboxPolicyObject(st, FenceInputs{}),
	} {
		if p.Namespace != st.Namespace || len(p.Spec.PodSelector.MatchLabels) == 0 {
			continue
		}
		if labels.SelectorFromSet(p.Spec.PodSelector.MatchLabels).Matches(runnerPod) {
			t.Errorf("fence %s selects the runner's pod", p.Name)
		}
	}
}

func TestTheSharedDriverRendersNoneOfIt(t *testing.T) {
	for name, st := range profiles() {
		if ComputerlessRunner(st) {
			t.Errorf("%s renders the computer-less runner under the shared driver", name)
		}
		for _, e := range ServerEnv(st, nil) {
			if slices.Contains(computerlessNames, e.Name) {
				t.Errorf("%s: the server is handed %s", name, e.Name)
			}
		}
		if RunnerEnabled(st) {
			for _, e := range RunnerEnv(st) {
				if slices.Contains(computerlessNames, e.Name) {
					t.Errorf("%s: the shared runner is handed %s", name, e.Name)
				}
			}
		}
		b, err := json.Marshal(ServerDeploymentObject(st, nil))
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(b), SharedRunnerKeySecret(st)) || strings.Contains(string(b), "PAYLOAD") {
			t.Errorf("%s: the server's Deployment names the computer-less runner's keys", name)
		}
	}
}

func TestExtraEnvMayNotUndoTheComputerlessRunnersSettings(t *testing.T) {
	runner, server := OwnedEnvNames("runner"), OwnedEnvNames("server")
	for _, n := range []string{"STIGMER_RUNNER_SERVES", PayloadKey, "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID", "STIGMER_BACKEND_ENDPOINT", "TEMPORAL_SERVICE_ADDRESS"} {
		if !slices.Contains(runner, n) {
			t.Errorf("spec.runner.extraEnv may set %s", n)
		}
	}
	for _, n := range []string{SharedRunnerKeyKey, PayloadKey, "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"} {
		if !slices.Contains(server, n) {
			t.Errorf("spec.server.extraEnv may set %s", n)
		}
	}
	if slices.Contains(runner, "STIGMER_TURN_MEMORY_MB") {
		t.Error("the per-turn memory cap, which the operator never sets, is refused in spec.runner.extraEnv")
	}
}
