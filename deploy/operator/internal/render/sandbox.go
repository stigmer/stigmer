// Per-session sandboxes: what the server is told when each session runs in a
// sandbox of its own, on agent-sandbox, instead of on the shared runner
// beside it.
//
// The server drives every sandbox itself (backend/services/stigmer-server/
// src/sandbox); the operator installs what the sandboxes run on, gives the
// server the identity and settings its driver reads, and renders no shared
// runner. A sandbox reaches the server and nothing else of the install: it
// dials the server's unified port for the API, its artifact lane and the
// Temporal worker lane (transport/temporal-worker-door), so the backend
// endpoint is the server's Service by its full DNS name, plain HTTP.
//
// The sandbox namespace is one per install, made and stamped by the
// operator. It is cluster-scoped, so it carries no owner reference; the
// janitor removes it once the Stigmer is gone.
//
// Model keys reach a sandbox through the server: each key the model Secret
// holds is projected onto the server container, and the server's runner
// lists name them (STIGMER_SANDBOX_RUNNER_SECRETS for credentials,
// STIGMER_SANDBOX_RUNNER_ENV for a gateway address). The server refuses to
// boot on a listed name with no value, so only the keys the Secret holds are
// listed, and the component reads the Secret to know which.

package render

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

// ComponentSandboxes is the sandbox runtime's component name.
const ComponentSandboxes = "sandboxes"

// sandboxGatewayKey is the one model setting that is an address, not a
// credential: it goes on the plain runner list.
const sandboxGatewayKey = "ANTHROPIC_BASE_URL"

// Driver is the declared sandbox driver, shared when none is declared.
func Driver(st *stigmerv1.Stigmer) stigmerv1.SandboxDriver {
	if st.Spec.Sandboxes == nil || st.Spec.Sandboxes.Driver == "" {
		return stigmerv1.SandboxDriverShared
	}
	return st.Spec.Sandboxes.Driver
}

// PerSession reports whether each session runs in a sandbox of its own.
func PerSession(st *stigmerv1.Stigmer) bool {
	return Driver(st) != stigmerv1.SandboxDriverShared
}

// provisionerType is the server's SANDBOX_PROVISIONER_TYPE for a driver
// (sandbox/builtins.ts).
func provisionerType(d stigmerv1.SandboxDriver) string {
	switch d {
	case stigmerv1.SandboxDriverAgentSandbox:
		return "agent-sandbox"
	default:
		return ""
	}
}

// SandboxNamespace is the namespace the install's sandboxes run in: one per
// install, beside the Stigmer's own.
func SandboxNamespace(st *stigmerv1.Stigmer) string { return st.Namespace + "-sandboxes" }

// ServerServiceAccount is the server pod's own identity: the principal the
// sandbox drivers act as.
func ServerServiceAccount(st *stigmerv1.Stigmer) string { return st.Name + "-server" }

// BackendEndpoint is the address a sandbox dials the server at.
func BackendEndpoint(st *stigmerv1.Stigmer) string {
	return fmt.Sprintf("http://%s.%s.svc.cluster.local:%d", ServerService(st), st.Namespace, GRPCPort)
}

// SandboxRunnerImage is the per-session runner image, pinned to the digest
// stamped into this build when there is one. pinned reports whether it is.
func SandboxRunnerImage(st *stigmerv1.Stigmer) (image string, pinned bool) {
	image = fmt.Sprintf("%s/runner:%s", registry(st), version.Stigmer)
	if version.SandboxRunnerDigest == "" {
		return image, false
	}
	return image + "@" + version.SandboxRunnerDigest, true
}

// idleSeconds is the declared suspend window, or "" for the driver's own.
func idleSeconds(st *stigmerv1.Stigmer) string {
	if st.Spec.Sandboxes == nil || st.Spec.Sandboxes.IdleSeconds == nil {
		return ""
	}
	return strconv.Itoa(int(*st.Spec.Sandboxes.IdleSeconds))
}

// SandboxModelKeys orders the model keys a Secret holds the way
// RunnerModelKeys does, dropping any it does not hold.
func SandboxModelKeys(held map[string][]byte) []string {
	keys := []string{}
	for _, k := range RunnerModelKeys {
		if len(held[k]) > 0 {
			keys = append(keys, k)
		}
	}
	return keys
}

// sandboxEnv is the server's settings for a per-session driver. modelKeys
// are the keys the model Secret holds (SandboxModelKeys).
func sandboxEnv(st *stigmerv1.Stigmer, modelKeys []string) []corev1.EnvVar {
	d := Driver(st)
	image, _ := SandboxRunnerImage(st)
	env := []corev1.EnvVar{
		value("SANDBOX_PROVISIONER_TYPE", provisionerType(d)),
		// A per-session driver serves each session on its own queue, and the
		// server refuses a driver without session routing.
		value("STIGMER_ACTIVITY_ROUTING", "session"),
		// A session gets a sandbox only when its target is the server's
		// sandboxes ("cloud"), not a runner on someone's machine.
		value("STIGMER_DEFAULT_EXECUTION_TARGET", "cloud"),
		value("STIGMER_SANDBOX_BACKEND_ENDPOINT", BackendEndpoint(st)),
		value("STIGMER_SANDBOX_RUNNER_IMAGE", image),
	}
	// Without a front door the public URL is the port-forward address on the
	// engineer's own machine, which means nothing inside a sandbox.
	if FrontDoor(st) != nil {
		env = append(env, value("STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT", PublicURL(st)))
	}
	switch d {
	case stigmerv1.SandboxDriverAgentSandbox:
		env = append(env, value("STIGMER_SANDBOX_K8S_NAMESPACE", SandboxNamespace(st)))
		if idle := idleSeconds(st); idle != "" {
			env = append(env, value("STIGMER_SANDBOX_AGENT_SANDBOX_SUSPEND_AFTER_SECONDS", idle))
		}
	}
	llm := st.Spec.Runner.LLM
	var plain, secret []string
	for _, k := range modelKeys {
		if llm == nil || !slices.Contains(RunnerModelKeys, k) {
			continue
		}
		env = append(env, fromSecret(k, llm.SecretName, k, false))
		if k == sandboxGatewayKey {
			plain = append(plain, k)
		} else {
			secret = append(secret, k)
		}
	}
	if len(plain) > 0 {
		env = append(env, value("STIGMER_SANDBOX_RUNNER_ENV", strings.Join(plain, ",")))
	}
	if len(secret) > 0 {
		env = append(env, value("STIGMER_SANDBOX_RUNNER_SECRETS", strings.Join(secret, ",")))
	}
	return env
}

// SandboxNamespaceObject is the namespace the install's sandboxes run in.
// Its Pod Security level is what its pods need and no more: agent-sandbox's
// runner adds only capabilities baseline allows (SETUID, SETGID, CHOWN,
// KILL, DAC_OVERRIDE).
func SandboxNamespaceObject(st *stigmerv1.Stigmer) *corev1.Namespace {
	labels := Labels(st, ComponentSandboxes)
	labels["pod-security.kubernetes.io/enforce"] = "baseline"
	return &corev1.Namespace{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Namespace"},
		ObjectMeta: metav1.ObjectMeta{Name: SandboxNamespace(st), Labels: labels},
	}
}

// AgentSandboxAccess is the Role and RoleBinding the server's agent-sandbox
// driver works through in the sandbox namespace, exactly what it calls
// (sandbox/agent-sandbox/gateway.ts): Sandboxes it creates, wakes, puts to
// sleep and deletes, and the Secret beside each, which holds the session's
// credentials. Secret delete is there for clusters that enforce owner
// references, where a Sandbox's owned Secret is removed with it. Nothing on
// pods, claims or deployments.
func AgentSandboxAccess(st *stigmerv1.Stigmer) (*rbacv1.Role, *rbacv1.RoleBinding) {
	name := st.Name + "-sandboxes"
	m := metav1.ObjectMeta{Name: name, Namespace: SandboxNamespace(st), Labels: Labels(st, ComponentSandboxes)}
	role := &rbacv1.Role{
		TypeMeta:   metav1.TypeMeta{APIVersion: "rbac.authorization.k8s.io/v1", Kind: "Role"},
		ObjectMeta: m,
		Rules: []rbacv1.PolicyRule{
			{APIGroups: []string{"agents.x-k8s.io"}, Resources: []string{"sandboxes"}, Verbs: []string{"get", "list", "create", "patch", "delete"}},
			{APIGroups: []string{""}, Resources: []string{"secrets"}, Verbs: []string{"create", "update", "delete"}},
		},
	}
	binding := &rbacv1.RoleBinding{
		TypeMeta:   metav1.TypeMeta{APIVersion: "rbac.authorization.k8s.io/v1", Kind: "RoleBinding"},
		ObjectMeta: m,
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "Role", Name: name},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: ServerServiceAccount(st), Namespace: st.Namespace}},
	}
	return role, binding
}
