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
// running and not restarting. Under sign-in it needs its own API key, which
// this version cannot give it, so the container is held back and the
// component says so.

package component

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
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
	return []string{render.ComponentKeys, render.ComponentObjectStore, render.ComponentDatabase, render.ComponentTemporal}
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
	deployment := render.ServerDeploymentObject(st)
	deployment.Annotations = gate.annotations
	objs := []client.Object{}
	for _, c := range render.ServerClaims(st) {
		objs = append(objs, c)
	}
	objs = append(objs, render.ServerServiceObject(st), deployment)
	if err := Apply(ctx, env, objs...); err != nil {
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
	st := env.Stigmer
	var pods corev1.PodList
	if err := env.Reader.List(ctx, &pods, client.InNamespace(st.Namespace),
		client.MatchingLabels(render.SelectorLabels(st, render.ComponentServer))); err != nil {
		return false, fmt.Errorf("listing the server's pods: %w", err)
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
	if !render.RunnerEnabled(st) {
		return Pending(stigmerv1.ReasonRunnerKeyPending, nil,
			"not started: under sign-in the shared runner needs its own API key, which this version of the operator cannot give it"), nil
	}
	llm := st.Spec.Runner.LLM
	keyNote := ""
	if llm == nil {
		keyNote = "; no model key is declared (spec.runner.llm), so agents cannot run until one is"
	} else {
		var secret corev1.Secret
		ref := Ref("Secret", st.Namespace, llm.SecretName)
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: llm.SecretName}, &secret); err != nil {
			if client.IgnoreNotFound(err) != nil {
				return Result{}, fmt.Errorf("reading Secret %s: %w", llm.SecretName, err)
			}
			return Refused(stigmerv1.ReasonModelKeyMissing, ref,
				fmt.Sprintf("agents cannot run: create Secret %s in namespace %s with key ANTHROPIC_API_KEY (or another provider's key)", llm.SecretName, st.Namespace)), nil
		}
		found := false
		for _, k := range render.RunnerModelKeys {
			if k != "ANTHROPIC_BASE_URL" && len(secret.Data[k]) > 0 {
				found = true
			}
		}
		if !found {
			return Refused(stigmerv1.ReasonModelKeyMissing, ref,
				fmt.Sprintf("agents cannot run: Secret %s holds no model key; add ANTHROPIC_API_KEY (or OPENAI_API_KEY, ANTHROPIC_FOUNDRY_API_KEY, AWS_BEARER_TOKEN_BEDROCK)", llm.SecretName)), nil
		}
	}
	ready, err := containerReady(ctx, env, render.RunnerContainer)
	if err != nil {
		return Result{}, err
	}
	if ready {
		return Ready(fmt.Sprintf("running, serving task queue %s%s", render.RunnerTaskQueue, keyNote)), nil
	}
	return Explain(ctx, env, render.SelectorLabels(st, render.ComponentServer), []string{render.RunnerContainer},
		Deploying(stigmerv1.ReasonDeploying, Ref("Deployment", st.Namespace, render.ServerDeployment(st)), "waiting for the runner to start"))
}
