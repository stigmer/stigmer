// The sandbox runtime component: what engineers' sessions run on, ready
// before the server that drives them.
//
// Under the shared driver there is nothing to bring up; the shared runner is
// the runner component's. Under a per-session driver this component installs
// the runtime when the cluster has none (agent-sandbox's controller, or
// Agent Substrate's control plane), makes the install's sandbox namespace,
// and gives the server what its driver acts through there: agent-sandbox's
// role, or Substrate's worker pool and the label that admits the server's
// namespace to Substrate's API. It precedes the server in the walk because
// the server's driver cannot work against a runtime that is not there.
//
// Everything this component makes outside the Stigmer's namespace (the
// sandbox namespace and what is in it, the runtime itself) is cluster-level
// or in another namespace, so it carries the operator's stamp instead of an
// owner reference, and the janitor removes it once no Stigmer remains.
//
// The worker pool is the size the Stigmer declares. The operator never sizes
// it from demand; Substrate's own autoscaler grows it once it ships.

package component

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate"
	"github.com/stigmer/stigmer/deploy/operator/internal/substrate/install"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
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
	if d := render.Driver(st); d == stigmerv1.SandboxDriverAgentSandbox || d == stigmerv1.SandboxDriverSubstrate {
		refusal, err := foreignSandboxNamespace(ctx, env)
		if err != nil {
			return Result{}, err
		}
		if refusal != "" {
			return Refused(stigmerv1.ReasonConfigurationRefused, Ref("Namespace", "", render.SandboxNamespace(st)), refusal), nil
		}
	}
	switch render.Driver(st) {
	case stigmerv1.SandboxDriverAgentSandbox:
		return reconcileAgentSandbox(ctx, env)
	case stigmerv1.SandboxDriverSubstrate:
		return reconcileSubstrate(ctx, env)
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

// foreignSandboxNamespace says why the install may not use its sandbox
// namespace, or "" when it may: the namespace does not exist yet, or it
// carries this Stigmer's stamp. A namespace of that name someone else made,
// or another Stigmer's, is never taken over: the operator would fence it,
// set its Pod Security level and, once no Stigmer remains, the janitor would
// delete it with everything in it.
func foreignSandboxNamespace(ctx context.Context, env *Env) (string, error) {
	st := env.Stigmer
	name := render.SandboxNamespace(st)
	var ns corev1.Namespace
	err := env.Reader.Get(ctx, client.ObjectKey{Name: name}, &ns)
	if apierrors.IsNotFound(err) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reading namespace %s: %w", name, err)
	}
	l := ns.Labels
	if l[render.ManagedByLabel] != render.ManagedByValue || l[render.ComponentLabel] != render.ComponentSandboxes {
		return fmt.Sprintf("the sandbox namespace %s already exists and the operator did not make it: "+
			"the operator never takes over a namespace it did not create, since it fences it and removes it when the install is deleted; "+
			"move what is in it and delete it, or install Stigmer in another namespace", name), nil
	}
	if l[render.InstanceLabel] != st.Name {
		return fmt.Sprintf("the sandbox namespace %s belongs to the Stigmer %q in namespace %s: one namespace holds one Stigmer with per-session sandboxes",
			name, l[render.InstanceLabel], st.Namespace), nil
	}
	return "", nil
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

// reconcileSubstrate installs Agent Substrate when the cluster has none,
// then makes the sandbox namespace and the worker pool, and admits the
// server's namespace to Substrate's API.
func reconcileSubstrate(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	stRef := Ref("Stigmer", st.Namespace, st.Name)
	if version.SandboxRunnerDigest == "" {
		return Refused(stigmerv1.ReasonConfigurationRefused, stRef,
			"the substrate driver runs each session from the runner image pinned by digest, and this operator build carries none: "+
				"install a released operator, or build one with SANDBOX_RUNNER_DIGEST set to the runner image's digest"), nil
	}
	if _, _, problem := render.SubstrateBucketLane(st); problem != "" {
		return Refused(stigmerv1.ReasonConfigurationRefused, stRef, problem), nil
	}

	present, ours, err := install.Detect(ctx, env.Reader)
	if err != nil {
		return Result{}, err
	}
	crdRef := Ref("CustomResourceDefinition", "", substrate.WorkerPoolCRD)
	foreign := present && !ours
	switch {
	case st.Spec.Prerequisites.Substrate == stigmerv1.PrerequisiteSkip && !present:
		return Refused(stigmerv1.ReasonConfigurationRefused, crdRef,
			fmt.Sprintf("spec.prerequisites.substrate is skip, but Agent Substrate is not installed (no definition %s): install it, or set spec.prerequisites.substrate to auto",
				substrate.WorkerPoolCRD)), nil
	case st.Spec.Prerequisites.Substrate == stigmerv1.PrerequisiteSkip, foreign:
		// Someone else's install: theirs to run and upgrade.
	default:
		settings, err := substrateSettings(ctx, env)
		if err != nil {
			return Result{}, err
		}
		res, err := install.Reconcile(ctx, install.Cluster{
			Reader: env.Reader, Writer: env.Client, Discovery: env.Discovery,
			Apply: func(ctx context.Context, objs []*unstructured.Unstructured) error {
				return ApplyShared(ctx, env.Client, objs)
			},
		}, settings)
		if err != nil {
			return Result{}, fmt.Errorf("installing Agent Substrate: %w", err)
		}
		ref := Ref(res.Kind, res.Namespace, res.Name)
		switch {
		case res.Refusal != "":
			reason := stigmerv1.ReasonConfigurationRefused
			if res.Kind == "CustomResourceDefinition" {
				reason = stigmerv1.ReasonPrerequisiteMissing
			}
			return Refused(reason, ref, res.Refusal), nil
		case !res.Ready:
			return Deploying(stigmerv1.ReasonInstallingPrerequisite, ref, "installing Agent Substrate: "+res.Waiting), nil
		}
	}

	objs, err := sandboxNamespaceObjects(ctx, env)
	if err != nil {
		return Result{}, err
	}
	workerImage, err := install.WorkerImage()
	if err != nil {
		return Result{}, err
	}
	objs = append(objs, render.SubstratePoolObject(st, workerImage))
	if err := ApplyShared(ctx, env.Client, objs); err != nil {
		return Result{}, fmt.Errorf("applying the sandbox namespace %s and its worker pool: %w", render.SandboxNamespace(st), err)
	}
	if err := admitToSubstrateAPI(ctx, env); err != nil {
		return Result{}, err
	}

	pool := &unstructured.Unstructured{}
	pool.SetGroupVersionKind(render.SubstratePoolGVK)
	key := client.ObjectKey{Namespace: render.SandboxNamespace(st), Name: render.SubstratePool(st)}
	if err := env.Reader.Get(ctx, key, pool); err != nil && !apierrors.IsNotFound(err) {
		return Result{}, fmt.Errorf("reading the worker pool %s: %w", key, err)
	}
	poolRef := Ref("WorkerPool", key.Namespace, key.Name)
	if ready, _, _ := unstructured.NestedInt64(pool.Object, "status", "readyReplicas"); ready < 1 {
		return Deploying(stigmerv1.ReasonWaitingForWorkers, poolRef,
			fmt.Sprintf("waiting for the sandbox pool's first worker (WorkerPool %s)", key)), nil
	}
	message := fmt.Sprintf("sessions run as Agent Substrate actors on a pool of %d gVisor workers in namespace %s",
		render.SubstrateWorkers(st), render.SandboxNamespace(st))
	if foreign || st.Spec.Prerequisites.Substrate == stigmerv1.PrerequisiteSkip {
		message += fmt.Sprintf("; this Agent Substrate was installed by someone else, so it must name %s among its bootstrap owners and %s among the router's allowed SPIFFE IDs",
			render.ServerPrincipal(st), render.ServerSPIFFEID(st))
	}
	return Ready(message), nil
}

// substrateSettings derives Substrate's install settings from the Stigmer:
// the server is its owner and the router's one client, and snapshots go to
// the install's bucket under substrate/, with the bucket's own credentials.
func substrateSettings(ctx context.Context, env *Env) (install.Settings, error) {
	st := env.Stigmer
	s3 := render.ObjectStore(st)
	var creds corev1.Secret
	key := client.ObjectKey{Namespace: st.Namespace, Name: s3.CredentialsSecret.Name}
	if err := env.Reader.Get(ctx, key, &creds); err != nil {
		return install.Settings{}, fmt.Errorf("reading the bucket's credentials %s: %w", key, err)
	}
	return install.Settings{
		BootstrapOwners:         []string{render.ServerPrincipal(st)},
		IngressAllowedSPIFFEIDs: []string{render.ServerSPIFFEID(st)},
		SnapshotLocation:        fmt.Sprintf("s3://%s/substrate/", s3.Bucket),
		SnapshotStore: install.ObjectStore{
			Endpoint:        s3.Endpoint,
			Region:          render.ObjectStoreRegion(s3),
			PathStyle:       s3.Endpoint != "",
			AccessKeyID:     string(creds.Data[render.ObjectStoreAccessKeyID]),
			SecretAccessKey: string(creds.Data[render.ObjectStoreSecretAccessKey]),
		},
		LocalhostRegistryReplacement: env.Operator.LocalRegistry,
	}, nil
}

// admitToSubstrateAPI sets the one label Substrate's network policy admits
// the server's namespace by, under a field manager of its own so nothing
// else on the adopter's namespace is touched.
func admitToSubstrateAPI(ctx context.Context, env *Env) error {
	ns := &unstructured.Unstructured{}
	ns.SetAPIVersion("v1")
	ns.SetKind("Namespace")
	ns.SetName(env.Stigmer.Namespace)
	ns.SetLabels(map[string]string{substrate.APIAccessLabel: "true"})
	if err := env.Client.Patch(ctx, ns, client.Apply, client.FieldOwner(render.SubstrateAccessFieldManager), client.ForceOwnership); err != nil {
		return fmt.Errorf("admitting namespace %s to Agent Substrate's API: %w", env.Stigmer.Namespace, err)
	}
	return nil
}
