// The sandbox runtime component: what engineers' sessions run on, ready
// before the server that drives them.
//
// Under the shared driver there is nothing to bring up; the shared runner is
// the runner component's. Under a per-session driver this component installs
// the runtime when the cluster has none (agent-sandbox's controller), makes
// the install's sandbox namespace, and gives the server what its driver acts
// through there. It precedes the server in the walk because the server's
// driver cannot work against a runtime that is not there.
//
// Everything this component makes outside the Stigmer's namespace (the
// sandbox namespace and what is in it, the runtime itself) is cluster-level
// or in another namespace, so it carries the operator's stamp instead of an
// owner reference, and the janitor removes it once no Stigmer remains.

package component

import (
	"context"
	"fmt"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Sandboxes is the sandbox runtime component.
type Sandboxes struct{}

// Name implements Component.
func (Sandboxes) Name() string { return render.ComponentSandboxes }

// Dependencies implements Component.
func (Sandboxes) Dependencies() []string { return []string{render.ComponentObjectStore} }

// AgentSandboxPrerequisite is agent-sandbox's controller.
func AgentSandboxPrerequisite(st *stigmerv1.Stigmer) Prerequisite {
	return Prerequisite{
		Name:       "agent-sandbox",
		CRD:        "sandboxes.agents.x-k8s.io",
		Controller: client.ObjectKey{Namespace: manifests.AgentSandboxNamespace, Name: "agent-sandbox-controller"},
		Mode:       st.Spec.Prerequisites.AgentSandbox,
		ModeField:  "spec.prerequisites.agentSandbox",
		Manifests:  manifests.AgentSandbox,
	}
}

// Reconcile implements Component.
func (Sandboxes) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	switch render.Driver(st) {
	case stigmerv1.SandboxDriverAgentSandbox:
		return reconcileAgentSandbox(ctx, env)
	default:
		return Ready("agents run on the shared runner beside the server; no per-session sandboxes are declared"), nil
	}
}

// reconcileAgentSandbox installs agent-sandbox when the cluster has none,
// then makes the sandbox namespace, its fence and the server's access in it.
func reconcileAgentSandbox(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	ok, res, err := EnsurePrerequisite(ctx, env, AgentSandboxPrerequisite(st))
	if err != nil || !ok {
		return res, err
	}
	objs, err := sandboxNamespaceObjects(ctx, env)
	if err != nil {
		return Result{}, err
	}
	role, binding := render.AgentSandboxAccess(st)
	for _, o := range []client.Object{role, binding} {
		u, err := ToUnstructured(o)
		if err != nil {
			return Result{}, err
		}
		objs = append(objs, u)
	}
	if err := ApplyShared(ctx, env.Client, objs); err != nil {
		return Result{}, fmt.Errorf("applying the sandbox namespace %s: %w", render.SandboxNamespace(st), err)
	}
	return Ready(fmt.Sprintf("sessions run in agent-sandbox pods in namespace %s, fenced to the server, the bucket and the public internet",
		render.SandboxNamespace(st))), nil
}

// sandboxNamespaceObjects is the sandbox namespace and the fence around the
// sandboxes in it.
func sandboxNamespaceObjects(ctx context.Context, env *Env) ([]*unstructured.Unstructured, error) {
	st := env.Stigmer
	ns, err := ToUnstructured(render.SandboxNamespaceObject(st))
	if err != nil {
		return nil, err
	}
	objs := []*unstructured.Unstructured{ns}
	fences, err := sandboxFences(ctx, env)
	if err != nil {
		return nil, err
	}
	return append(objs, fences...), nil
}
