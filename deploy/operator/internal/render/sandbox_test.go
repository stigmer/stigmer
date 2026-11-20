// Pins per-session sandboxes and the fences: under agent-sandbox the server
// is told the driver, session routing and its sandbox namespace, runs as its
// own ServiceAccount with its token mounted, hands sandboxes only the model
// keys the Secret holds, and renders no shared runner; the shared driver is
// left as it was. The fences admit what each workload needs and nothing
// else: a sandbox reaches the server, the bucket's pods, the public internet
// and the declared ranges, and takes nothing in; the server's egress is
// fenced only when asked or under a strict license.

package render

import (
	"maps"
	"slices"
	"testing"

	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/util/intstr"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

func agentSandboxProfile() *stigmerv1.Stigmer {
	st := profiles()["bucket"]
	idle := int32(120)
	st.Spec.Sandboxes = &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox, IdleSeconds: &idle,
		AgentSandbox: &stigmerv1.AgentSandboxSpec{Egress: &stigmerv1.SandboxEgressSpec{AllowCIDRs: []string{"172.18.0.1/32"}}}}
	return st
}

func TestAgentSandboxTellsTheServerItsDriver(t *testing.T) {
	st := agentSandboxProfile()
	env := envMap(ServerEnv(st, []string{"ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"}))
	for name, want := range map[string]string{
		"SANDBOX_PROVISIONER_TYPE":                           "agent-sandbox",
		"STIGMER_ACTIVITY_ROUTING":                           "session",
		"STIGMER_DEFAULT_EXECUTION_TARGET":                   "cloud",
		"STIGMER_SANDBOX_BACKEND_ENDPOINT":                   "http://stigmer.stigmer.svc.cluster.local:7234",
		"STIGMER_SANDBOX_K8S_NAMESPACE":                      "stigmer-sandboxes",
		"STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS": "120",
		"STIGMER_SANDBOX_RUNNER_SECRETS":                     "ANTHROPIC_API_KEY",
		"STIGMER_SANDBOX_RUNNER_ENV":                         "ANTHROPIC_BASE_URL",
	} {
		if got := env[name].Value; got != want {
			t.Errorf("%s = %q; want %q", name, got, want)
		}
	}
	key := env["ANTHROPIC_API_KEY"]
	if key.ValueFrom == nil || key.ValueFrom.SecretKeyRef == nil || key.ValueFrom.SecretKeyRef.Name != "anthropic" {
		t.Errorf("the model key is not referenced from its Secret: %+v", key)
	}
	if _, ok := env["OPENAI_API_KEY"]; ok {
		t.Error("a key the Secret does not hold is handed to the server, which refuses to boot on a listed name with no value")
	}
	if _, ok := env["STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT"]; ok {
		t.Error("a sandbox is handed the port-forward address, which means nothing inside it")
	}
	if _, ok := envMap(ServerEnv(profiles()["bucket"], nil))["SANDBOX_PROVISIONER_TYPE"]; ok {
		t.Error("the shared driver names a sandbox driver")
	}
}

func TestAgentSandboxRendersNoSharedRunner(t *testing.T) {
	st := agentSandboxProfile()
	pod := ServerDeploymentObject(st, nil).Spec.Template.Spec
	if len(pod.Containers) != 1 || RunnerEnabled(st) {
		t.Errorf("the pod holds %d containers under a per-session driver; want the server alone", len(pod.Containers))
	}
	if pod.ServiceAccountName != "stigmer-server" || pod.AutomountServiceAccountToken == nil || !*pod.AutomountServiceAccountToken {
		t.Errorf("the server does not carry its own mounted identity for the agent-sandbox driver: %q %v", pod.ServiceAccountName, pod.AutomountServiceAccountToken)
	}
	shared := ServerDeploymentObject(profiles()["bucket"], nil).Spec.Template.Spec
	if shared.AutomountServiceAccountToken == nil || *shared.AutomountServiceAccountToken {
		t.Error("the shared driver's server mounts a Kubernetes token it never uses")
	}
	for _, c := range ServerClaims(st) {
		if c.Name == RunnerDataClaim(st) {
			t.Error("a per-session install claims the shared runner's volume")
		}
	}
}

func TestSandboxImageIsPinnedWhenADigestIsStamped(t *testing.T) {
	st := agentSandboxProfile()
	before := version.SandboxRunnerDigest
	t.Cleanup(func() { version.SandboxRunnerDigest = before })
	version.SandboxRunnerDigest = ""
	if image, pinned := SandboxRunnerImage(st); pinned || image != "ghcr.io/stigmer/runner:"+version.Stigmer {
		t.Errorf("an unstamped build: %q pinned=%v", image, pinned)
	}
	version.SandboxRunnerDigest = "sha256:abc"
	if image, pinned := SandboxRunnerImage(st); !pinned || image != "ghcr.io/stigmer/runner:"+version.Stigmer+"@sha256:abc" {
		t.Errorf("a stamped build: %q pinned=%v", image, pinned)
	}
}

func TestSandboxModelKeysKeepOnlyHeldKeys(t *testing.T) {
	got := SandboxModelKeys(map[string][]byte{"OPENAI_API_KEY": []byte("k"), "ANTHROPIC_API_KEY": []byte("k"), "ANTHROPIC_BASE_URL": {}, "OTHER": []byte("x")})
	if !slices.Equal(got, []string{"ANTHROPIC_API_KEY", "OPENAI_API_KEY"}) {
		t.Errorf("got %v", got)
	}
}

func egressTo(p *networkingv1.NetworkPolicy, match func(networkingv1.NetworkPolicyEgressRule) bool) bool {
	return slices.ContainsFunc(p.Spec.Egress, match)
}

func TestTheSandboxFenceAdmitsOnlyWhatASessionNeeds(t *testing.T) {
	st := agentSandboxProfile()
	bucket := &ServicePeer{Namespace: "storage", Selector: map[string]string{"app": "minio"}, Ports: []intstr.IntOrString{intstr.FromInt32(9000)}}
	p := SandboxPolicyObject(st, FenceInputs{Bucket: bucket})
	if p.Namespace != SandboxNamespace(st) || len(p.Spec.PodSelector.MatchLabels) != 0 {
		t.Errorf("the fence does not cover every pod in the sandbox namespace: %s %+v", p.Namespace, p.Spec.PodSelector)
	}
	if !slices.Contains(p.Spec.PolicyTypes, networkingv1.PolicyTypeIngress) || len(p.Spec.Ingress) != 0 {
		t.Error("a sandbox takes connections in")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].PodSelector != nil && r.To[0].PodSelector.MatchLabels[ComponentLabel] == ComponentServer &&
			len(r.Ports) == 1 && r.Ports[0].Port.IntValue() == GRPCPort
	}) {
		t.Error("a sandbox cannot reach the server's unified port")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].PodSelector != nil && r.To[0].PodSelector.MatchLabels["app"] == "minio" &&
			r.To[0].NamespaceSelector.MatchLabels["kubernetes.io/metadata.name"] == "storage" && r.Ports[0].Port.IntValue() == 9000
	}) {
		t.Error("a sandbox cannot reach the in-cluster bucket's pods")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].IPBlock != nil && r.To[0].IPBlock.CIDR == "172.18.0.1/32"
	}) {
		t.Error("a declared private range is not admitted")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 2 && r.To[0].IPBlock != nil && r.To[0].IPBlock.CIDR == "0.0.0.0/0" && slices.Contains(r.To[0].IPBlock.Except, "10.0.0.0/8")
	}) {
		t.Error("the public internet rule does not leave out the private ranges")
	}
}

func TestTheBucketServiceIsReadFromItsAddress(t *testing.T) {
	st := profiles()["bucket"]
	st.Spec.ObjectStore.S3.RunnerEndpoint = "http://minio.storage.svc.cluster.local:9000"
	if ns, name, ok := BucketServiceRef(st); !ok || ns != "storage" || name != "minio" {
		t.Errorf("got %s/%s %v", ns, name, ok)
	}
	st.Spec.ObjectStore.S3.RunnerEndpoint = "https://s3.eu-west-1.amazonaws.com"
	st.Spec.ObjectStore.S3.Endpoint = "https://s3.eu-west-1.amazonaws.com"
	if _, _, ok := BucketServiceRef(st); ok {
		t.Error("a bucket outside the cluster is taken for a Service")
	}
}

func TestTheServerIsFencedOnlyWhenAsked(t *testing.T) {
	if ServerFenced(profiles()["bucket"]) {
		t.Error("an open-source install's server is fenced by default")
	}
	if !ServerFenced(profiles()["enterprise"]) {
		t.Error("a strict license does not fence the server")
	}
	st := agentSandboxProfile()
	st.Spec.Server.Egress = &stigmerv1.ServerEgressSpec{Fenced: true, AllowCIDRs: []string{"10.9.0.0/16"}}
	p := ServerEgressPolicyObject(st, FenceInputs{APIServerIPs: []string{"172.18.0.2"}, APIServerPort: []int32{6443}})
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].IPBlock != nil && r.To[0].IPBlock.CIDR == "172.18.0.2/32" && r.Ports[0].Port.IntValue() == 6443
	}) {
		t.Error("a fenced server cannot reach the Kubernetes API its agent-sandbox driver calls")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].PodSelector != nil && r.To[0].PodSelector.MatchLabels["cnpg.io/cluster"] == PostgresCluster(st)
	}) {
		t.Error("a fenced server cannot reach its database")
	}
	if !egressTo(p, func(r networkingv1.NetworkPolicyEgressRule) bool {
		return len(r.To) == 1 && r.To[0].IPBlock != nil && r.To[0].IPBlock.CIDR == "10.9.0.0/16"
	}) {
		t.Error("a declared private range is not admitted for the server")
	}
}

func TestTheDatabaseAndTemporalAdmitOnlyTheInstall(t *testing.T) {
	st := profiles()["bundled"]
	pg := PostgresPolicyObject(st)
	var from []map[string]string
	for _, r := range pg.Spec.Ingress {
		for _, peer := range r.From {
			if peer.PodSelector != nil {
				from = append(from, peer.PodSelector.MatchLabels)
			}
		}
	}
	for _, want := range []map[string]string{SelectorLabels(st, ComponentServer), TemporalPodLabels(st), SelectorLabels(st, ComponentIdentity)} {
		if !slices.ContainsFunc(from, func(m map[string]string) bool { return mapsEqual(m, want) }) {
			t.Errorf("the database does not admit %v", want)
		}
	}
	tp := TemporalPolicyObject(st)
	if len(tp.Spec.Ingress) != 2 || tp.Spec.Ingress[1].Ports[0].Port.IntValue() != TemporalPort {
		t.Errorf("Temporal does not admit the server on its frontend alone: %+v", tp.Spec.Ingress)
	}
}

func mapsEqual(a, b map[string]string) bool { return maps.Equal(a, b) }

