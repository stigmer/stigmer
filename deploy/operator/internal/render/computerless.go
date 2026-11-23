// The computer-less runner: the one runner an install with per-session
// sandboxes runs beside them, for conversations whose agent has no
// computer.
//
// Such a turn needs no sandbox: it touches no disk and starts no program,
// so a sandbox per conversation would cost a pod for nothing. The server
// sends those turns to the runner queue (STIGMER_SHARED_RUNNER_KEY turns
// that on) and every other turn to a sandbox as before. The runner serves
// only them (STIGMER_RUNNER_SERVES=computerless) and refuses any turn with
// a computer, so it shares nothing between conversations but the process
// their locked hosts run under. It holds no organization's key, which is
// why a licensed install renders it too.
//
// It reaches Temporal the way a sandbox does, through the server's worker
// lane on the server's unified port: its Temporal address is the server's
// Service as its backend endpoint names it, which is how the runner knows
// the lane (backend/services/runner/src/temporal-lane.ts), and it presents
// the shared-runner key there as its token. It holds no Temporal address or
// credential of its own. Each turn's credential reaches it sealed in the
// Temporal task under the payload key, so the server and this runner, and
// nothing else, are handed that key; sandboxes are never handed either
// key.
//
// It is its own Deployment, not a container in the server's pod: the
// server's pod mounts the agent-sandbox driver's Kubernetes token, and the
// runner runs agents. Its pod mounts no token at all. No fence selects it,
// and the database's and Temporal's fences admit only the server, so it
// reaches the server and the public internet but neither store.

package render

import (
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// ComputerlessRunner reports whether the computer-less runner renders:
// under every per-session driver, licensed or not.
func ComputerlessRunner(st *stigmerv1.Stigmer) bool { return PerSession(st) }

// computerlessServerEnv is what the server is told when the computer-less
// runner runs: the key it admits that runner by, and the payload key it
// seals each such turn's credential with. The server refuses to boot with
// the first and not the second.
func computerlessServerEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	return []corev1.EnvVar{
		fromSecret(SharedRunnerKeyKey, SharedRunnerKeySecret(st), SharedRunnerKeyKey, false),
		fromSecret(PayloadKey, KeysSecret(st), PayloadKey, false),
		value("STIGMER_PAYLOAD_ENCRYPTION_KEY_ID", PayloadKeyID),
	}
}

// ComputerlessRunnerEnv is the computer-less runner's environment, before
// extraEnv.
func ComputerlessRunnerEnv(st *stigmerv1.Stigmer) []corev1.EnvVar {
	t := Temporal(st)
	backend := BackendEndpoint(st)
	env := []corev1.EnvVar{
		// local mode keeps each conversation's saved state in the durable
		// sqlite saver on this runner's own disk. The guards local mode
		// relaxes (stdio MCP servers, private fetch addresses) never reach
		// a conversation without a computer, which is always strict.
		value("MODE", "local"),
		value("STIGMER_RUNNER_SERVES", "computerless"),
		value("STIGMER_BACKEND_ENDPOINT", backend),
	}
	// Without a front door the public URL is the port-forward address on
	// the engineer's own machine, which no remote MCP server can dial.
	if FrontDoor(st) != nil {
		env = append(env, value("STIGMER_MCP_PUBLIC_ENDPOINT", PublicURL(st)))
	}
	env = append(env,
		// The server's own host and port, exactly as the backend endpoint
		// names them: the runner reaches Temporal through the server.
		value("TEMPORAL_SERVICE_ADDRESS", BackendHostPort(st)),
		value("TEMPORAL_NAMESPACE", t.Namespace),
		value("STIGMER_TASK_QUEUE", RunnerTaskQueue),
		value("WORKSPACE_ROOT_DIR", "/data/.stigmer/data/workspace"),
		value("STIGMER_AGENT_HOME", "/data/agent"),
		// A per-session install always has a bucket; the runner reaches it
		// through the server's artifact lane, never STIGMER_PROXY_ENDPOINT,
		// which would also send its model calls through the server.
		value("ARTIFACT_STORAGE_TYPE", "proxy"),
		value("STIGMER_ARTIFACT_PROXY_ENDPOINT", backend),
		fromSecret("STIGMER_TOKEN", SharedRunnerKeySecret(st), SharedRunnerKeyKey, false),
		fromSecret(PayloadKey, KeysSecret(st), PayloadKey, false),
		value("STIGMER_PAYLOAD_ENCRYPTION_KEY_ID", PayloadKeyID),
	)
	if llm := st.Spec.Runner.LLM; llm != nil {
		for _, key := range RunnerModelKeys {
			env = append(env, fromSecret(key, llm.SecretName, key, true))
		}
	}
	return env
}

// ComputerlessRunnerClaim is the computer-less runner's own volume: each
// conversation's saved state (its checkpoints and pending approvals) under
// the runner's home, /data. It is the shared runner's claim by name and
// size, so an install that moves from the shared driver to a per-session
// one keeps its runner's state.
func ComputerlessRunnerClaim(st *stigmerv1.Stigmer) *corev1.PersistentVolumeClaim {
	return Claim(st, RunnerDataClaim(st), st.Spec.Runner.Storage, RunnerDataSize)
}

// ComputerlessRunnerDeploymentObject is the computer-less runner's
// workload, sized by spec.runner.resources and tuned by spec.runner.extraEnv.
// Its container's posture is the shared runner's: root, dropping each agent
// to its own user and keeping only the five capabilities that takes.
func ComputerlessRunnerDeploymentObject(st *stigmerv1.Stigmer) *appsv1.Deployment {
	pull := st.Spec.Image.PullPolicy
	if pull == "" {
		pull = corev1.PullIfNotPresent
	}
	runner := corev1.Container{
		Name:                     RunnerContainer,
		Image:                    RunnerImage(st),
		ImagePullPolicy:          pull,
		Env:                      append(ComputerlessRunnerEnv(st), st.Spec.Runner.ExtraEnv...),
		Resources:                RunnerSizing.Effective(st.Spec.Runner.Resources),
		TerminationMessagePolicy: corev1.TerminationMessageFallbackToLogsOnError,
		SecurityContext: &corev1.SecurityContext{
			AllowPrivilegeEscalation: ptr(false),
			Capabilities: &corev1.Capabilities{
				Drop: []corev1.Capability{"ALL"},
				Add:  []corev1.Capability{"SETUID", "SETGID", "CHOWN", "KILL", "DAC_OVERRIDE"},
			},
			SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
		},
		VolumeMounts: []corev1.VolumeMount{{Name: "runner-data", MountPath: "/data"}},
	}
	return &appsv1.Deployment{
		TypeMeta:   metav1.TypeMeta{APIVersion: "apps/v1", Kind: "Deployment"},
		ObjectMeta: meta(st, ComputerlessRunnerDeployment(st), ComponentRunner),
		Spec: appsv1.DeploymentSpec{
			// One replica, recreated rather than rolled. The runner keeps
			// each conversation's saved state on its own disk (open source
			// has no server-side store for it), and any replica may take any
			// conversation's next turn: a second replica would find no saved
			// state for the conversations the first one ran, and lose them.
			// Two copies of one must never overlap on the claim either.
			Replicas: ptr(int32(1)),
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RecreateDeploymentStrategyType},
			Selector: &metav1.LabelSelector{MatchLabels: SelectorLabels(st, ComponentRunner)},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: Labels(st, ComponentRunner)},
				Spec: corev1.PodSpec{
					AutomountServiceAccountToken:  ptr(false),
					TerminationGracePeriodSeconds: ptr(int64(60)),
					ImagePullSecrets:              st.Spec.Image.PullSecrets,
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup:        ptr(int64(1000)),
						SeccompProfile: &corev1.SeccompProfile{Type: corev1.SeccompProfileTypeRuntimeDefault},
					},
					Containers: []corev1.Container{runner},
					Volumes:    []corev1.Volume{volume("runner-data", RunnerDataClaim(st))},
				},
			},
		},
	}
}
