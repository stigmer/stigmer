// The server and runner components. Both live in one Deployment; the server
// component applies it, and each judges its own container.
//
// The server is applied only once the keys, the database and Temporal are
// Ready, which is the whole of what docker-compose.yml's depends_on chain
// waits for. Before applying, it refuses in words what would only fail
// later: a license Secret that is missing (the Enterprise image would boot as
// open source without it). Ready is the server container's own readiness, its
// gRPC health answering SERVING. A server that exits says why: the container
// reports its last log lines as its termination message, and the NotReady
// explanation carries the line that names the cause.
//
// Moving the server to a new version waits for a backup of the database
// when it has one (upgrade.go), and status.version is the version the
// server's newest pod runs once it serves.
//
// The runner has no health endpoint, so it is Ready when its container is
// running and not restarting. Under sign-in it starts signed in: the server
// component mints the runner key Secret (an stk_ key) once, the server
// stores it at boot as its runner service account's key, and the runner
// presents the same value.
//
// Under a per-session driver each conversation with a computer runs in a
// sandbox of its own, and the one shared runner beside the sandboxes serves
// only conversations without one (render/computerless.go). The server
// component mints the key the server admits that runner by (once, like the
// runner key) before the server starts, since the server reads it at boot;
// the payload key is the keys component's. The runner component applies
// the runner's own Deployment once the server serves, so the runner never
// runs ahead of the server it reaches Temporal through, and judges it and
// the model key every sandbox is handed. The server learns which keys the
// Secret holds from this component's read, because it refuses to boot on a
// listed key with no value (render/sandbox.go). An install that moves back
// to the shared driver loses the computer-less runner's Deployment before
// the server's pod, which takes back the runner's claim, is applied.
//
// A licensed install that declares the shared driver is refused: a licensed
// server may hold several organizations, and one shared runner would carry
// one organization's key into every organization's runs. The computer-less
// runner holds no organization's key, so a licensed install runs it too.

package component

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

// Server is the server component.
type Server struct{}

// Name implements Component.
func (Server) Name() string { return render.ComponentServer }

// Dependencies implements Component.
func (Server) Dependencies() []string {
	return []string{render.ComponentKeys, render.ComponentObjectStore, render.ComponentDatabase, render.ComponentTemporal, render.ComponentSandboxes}
}

// Reconcile implements Component.
func (Server) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	if render.Licensed(st) {
		lic := st.Spec.Enterprise.License
		ok, res, err := CheckSecretKeys(ctx, env, lic.Name, "your Stigmer Enterprise license key", lic.Key)
		if err != nil || !ok {
			return res, err
		}
	}
	var live *appsv1.Deployment
	var current appsv1.Deployment
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: render.ServerDeployment(st)}, &current)
	switch {
	case err == nil:
		live = &current
	case !apierrors.IsNotFound(err):
		return Result{}, fmt.Errorf("reading the server's Deployment: %w", err)
	}
	gate, err := gateUpgrade(ctx, env, live)
	if err != nil {
		return Result{}, err
	}
	if gate.hold != nil {
		return *gate.hold, nil
	}
	if render.SignInOn(st) && render.RunnerEnabled(st) {
		if err := ensureRunnerKey(ctx, env); err != nil {
			return Result{}, err
		}
	}
	if render.ComputerlessRunner(st) {
		if err := ensureSharedRunnerKey(ctx, env); err != nil {
			return Result{}, err
		}
	} else if err := removeObject(ctx, env, appsv1.SchemeGroupVersion.WithKind("Deployment"), render.ComputerlessRunnerDeployment(st)); err != nil {
		return Result{}, err
	}
	var modelKeys []string
	if render.PerSession(st) {
		held, _, err := readModelSecret(ctx, env)
		if err != nil {
			return Result{}, err
		}
		modelKeys = render.SandboxModelKeys(held)
	}
	deployment := render.ServerDeploymentObject(st, modelKeys)
	deployment.Annotations = gate.annotations
	objs := []client.Object{render.ServerServiceAccountObject(st)}
	for _, c := range render.ServerClaims(st) {
		objs = append(objs, c)
	}
	objs = append(objs, render.ServerServiceObject(st), deployment)
	if err := Apply(ctx, env, objs...); err != nil {
		return Result{}, err
	}
	if err := ensureServerFence(ctx, env); err != nil {
		return Result{}, err
	}

	ready, err := containerReady(ctx, env, render.ServerContainer)
	if err != nil {
		return Result{}, err
	}
	if ready {
		// The newest pod is the declared one, so it runs this version.
		st.Status.Version = version.Stigmer
		return Ready(fmt.Sprintf("serving Stigmer %s%s; reach it with: kubectl -n %s port-forward svc/%s %s",
			version.Stigmer, upgradeSentence(gate.annotations), st.Namespace, render.ServerService(st), render.PortForwardPorts(st))), nil
	}
	return Explain(ctx, env, render.SelectorLabels(st, render.ComponentServer), []string{render.ServerContainer},
		Deploying(stigmerv1.ReasonDeploying, Ref("Deployment", st.Namespace, render.ServerDeployment(st)), "waiting for the server's pod"))
}

// containerReady reports whether a container in the server's newest pod is
// ready (for a container with no probe: running).
func containerReady(ctx context.Context, env *Env, container string) (bool, error) {
	return podContainerReady(ctx, env, render.ComponentServer, container)
}

// podContainerReady reports whether a container in a component's newest pod
// is ready (for a container with no probe: running).
func podContainerReady(ctx context.Context, env *Env, component, container string) (bool, error) {
	st := env.Stigmer
	var pods corev1.PodList
	if err := env.Reader.List(ctx, &pods, client.InNamespace(st.Namespace),
		client.MatchingLabels(render.SelectorLabels(st, component))); err != nil {
		return false, fmt.Errorf("listing the %s's pods: %w", component, err)
	}
	var newest *corev1.Pod
	for i := range pods.Items {
		p := &pods.Items[i]
		if p.DeletionTimestamp != nil {
			continue
		}
		if newest == nil || newest.CreationTimestamp.Before(&p.CreationTimestamp) {
			newest = p
		}
	}
	if newest == nil {
		return false, nil
	}
	for _, cs := range newest.Status.ContainerStatuses {
		if cs.Name == container {
			return cs.Ready && cs.State.Running != nil, nil
		}
	}
	return false, nil
}

// Runner is the shared runner component.
type Runner struct{}

// Name implements Component.
func (Runner) Name() string { return render.ComponentRunner }

// Dependencies implements Component.
func (Runner) Dependencies() []string { return []string{render.ComponentServer} }

// Reconcile implements Component.
func (Runner) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	if render.Licensed(st) && !render.PerSession(st) {
		return Refused(stigmerv1.ReasonPerSessionRunnersOnly, nil,
			"a licensed server may hold several organizations, and one shared runner would carry one organization's key into every organization's runs: "+
				"run agents in per-session sandboxes with spec.sandboxes.driver agentSandbox or substrate"), nil
	}
	held, missing, err := readModelSecret(ctx, env)
	if err != nil {
		return Result{}, err
	}
	if missing != nil {
		return *missing, nil
	}
	keyNote := ""
	if held == nil {
		keyNote = "; no model key is declared (spec.runner.llm), so agents cannot run until one is"
	}
	if render.PerSession(st) {
		if err := Apply(ctx, env, render.ComputerlessRunnerClaim(st), render.ComputerlessRunnerDeploymentObject(st)); err != nil {
			return Result{}, err
		}
		if render.Driver(st) == stigmerv1.SandboxDriverSubstrate {
			if wait := waitForSandboxImage(ctx, env); wait != nil {
				return *wait, nil
			}
		}
		ready, err := podContainerReady(ctx, env, render.ComponentRunner, render.RunnerContainer)
		if err != nil {
			return Result{}, err
		}
		if !ready {
			return Explain(ctx, env, render.SelectorLabels(st, render.ComponentRunner), []string{render.RunnerContainer},
				Deploying(stigmerv1.ReasonDeploying, Ref("Deployment", st.Namespace, render.ComputerlessRunnerDeployment(st)),
					"waiting for the runner that serves agents without a computer to start"))
		}
		r := Ready(fmt.Sprintf("agents with a computer run in per-session sandboxes (%s); agents without one run on one shared runner, serving task queue %s%s",
			render.Driver(st), render.RunnerTaskQueue, keyNote))
		r.Reason = stigmerv1.ReasonPerSessionSandboxes
		return r, nil
	}
	ready, err := containerReady(ctx, env, render.RunnerContainer)
	if err != nil {
		return Result{}, err
	}
	if ready {
		signedIn := ""
		if render.SignInOn(st) {
			signedIn = ", signed in as the runner service account"
		}
		return Ready(fmt.Sprintf("running%s, serving task queue %s%s", signedIn, render.RunnerTaskQueue, keyNote)), nil
	}
	return Explain(ctx, env, render.SelectorLabels(st, render.ComponentServer), []string{render.RunnerContainer},
		Deploying(stigmerv1.ReasonDeploying, Ref("Deployment", st.Namespace, render.ServerDeployment(st)), "waiting for the runner to start"))
}

// readModelSecret reads the declared model key Secret. held is nil when no
// Secret is declared; missing is the refusal when it is declared but absent
// or holds no model key.
func readModelSecret(ctx context.Context, env *Env) (held map[string][]byte, missing *Result, err error) {
	st := env.Stigmer
	llm := st.Spec.Runner.LLM
	if llm == nil {
		return nil, nil, nil
	}
	var secret corev1.Secret
	ref := Ref("Secret", st.Namespace, llm.SecretName)
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: llm.SecretName}, &secret); err != nil {
		if client.IgnoreNotFound(err) != nil {
			return nil, nil, fmt.Errorf("reading Secret %s: %w", llm.SecretName, err)
		}
		r := Refused(stigmerv1.ReasonModelKeyMissing, ref,
			fmt.Sprintf("agents cannot run: create Secret %s in namespace %s with key ANTHROPIC_API_KEY (or another provider's key)", llm.SecretName, st.Namespace))
		return map[string][]byte{}, &r, nil
	}
	for _, k := range render.RunnerModelKeys {
		if k != "ANTHROPIC_BASE_URL" && len(secret.Data[k]) > 0 {
			return secret.Data, nil, nil
		}
	}
	r := Refused(stigmerv1.ReasonModelKeyMissing, ref,
		fmt.Sprintf("agents cannot run: Secret %s holds no model key; add ANTHROPIC_API_KEY (or OPENAI_API_KEY, ANTHROPIC_FOUNDRY_API_KEY, AWS_BEARER_TOKEN_BEDROCK)", llm.SecretName))
	return secret.Data, &r, nil
}

// ensureRunnerKey mints the runner key Secret once: an stk_ key in the form
// the server's keys take (32 random bytes, base64url without padding).
func ensureRunnerKey(ctx context.Context, env *Env) error {
	return ensureMintedKey(ctx, env, render.RunnerKeySecret(env.Stigmer), render.RunnerKeyKey, "stk_")
}

// ensureSharedRunnerKey mints the shared-runner key Secret once: 32 random
// bytes, base64url without padding, 43 characters where the server asks for
// at least 32.
func ensureSharedRunnerKey(ctx context.Context, env *Env) error {
	return ensureMintedKey(ctx, env, render.SharedRunnerKeySecret(env.Stigmer), render.SharedRunnerKeyKey, "")
}

// ensureMintedKey creates a Secret holding one random key under key, once:
// a Secret that exists is never rewritten. It is owned by the Stigmer,
// since nothing is stored under the key.
func ensureMintedKey(ctx context.Context, env *Env, name, key, prefix string) error {
	st := env.Stigmer
	var existing corev1.Secret
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, &existing)
	if err == nil {
		return nil
	}
	if !apierrors.IsNotFound(err) {
		return fmt.Errorf("reading Secret %s: %w", name, err)
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return fmt.Errorf("reading random bytes for %s: %w", key, err)
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            name,
			Namespace:       st.Namespace,
			Labels:          render.Labels(st, render.ComponentRunner),
			OwnerReferences: []metav1.OwnerReference{OwnerReference(st)},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{key: []byte(prefix + base64.RawURLEncoding.EncodeToString(b))},
	}
	if err := env.Client.Create(ctx, secret); err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("creating Secret %s: %w", name, err)
	}
	return nil
}

// waitForSandboxImage holds the runner component, and so the install, out of
// Ready while the server builds the image every new sandbox starts from:
// after an install, and after every upgrade that brings a new runner. The
// server itself stays Ready, so the console answers meanwhile. A server the
// operator cannot ask counts as still preparing; the next pass asks again.
func waitForSandboxImage(ctx context.Context, env *Env) *Result {
	if env.ServerHealth == nil {
		return nil
	}
	st := env.Stigmer
	base := fmt.Sprintf("http://%s.%s.svc:%d", render.ServerService(st), st.Namespace, render.GRPCPort)
	serving, err := env.ServerHealth.SandboxesServing(ctx, base)
	if serving {
		return nil
	}
	message := "the server is preparing the image every new sandbox starts from (Agent Substrate's golden snapshot); the console already answers"
	if err != nil {
		message += "; the server could not be asked: " + err.Error()
	}
	r := Deploying(stigmerv1.ReasonPreparingSandboxImage, Ref("Deployment", st.Namespace, render.ServerDeployment(st)), message)
	return &r
}
