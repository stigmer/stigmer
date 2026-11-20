// The janitor: once no Stigmer remains, it removes what this operator
// installed at the cluster level, and nothing anyone else installed.
//
// Deleting a Stigmer removes everything it owns through owner references:
// the server, the database cluster, Temporal, the front door. What it
// cannot own is cluster-scoped or in another namespace: the sandbox
// namespace with the sandboxes in it, and the operators the install needed
// (agent-sandbox, CloudNativePG's backup plugin, CloudNativePG). The
// janitor removes those, in an order that lets each controller finish its
// own objects first:
//
//  1. the sandbox namespaces the operator made, with their sandboxes and
//     the server's access in them;
//  2. agent-sandbox, once no Sandbox remains anywhere;
//  3. the backup plugin, once no ObjectStore remains;
//  4. CloudNativePG, once no Cluster remains.
//
// It runs only when no Stigmer exists: a Stigmer's owned database is
// deleted by garbage collection after the Stigmer is gone, and CloudNativePG
// must still be running then to clear the Cluster's own finalizer. So there
// is no finalizer on the Stigmer, and the janitor sweeps again while
// anything is draining.
//
// Every object is checked for the operator's stamp before it is deleted. A
// prerequisite whose definition someone else installed is theirs, and is
// left whole. Each sweep reports one verdict per prerequisite: removed, kept
// (someone else's), in use (instances of its kinds remain, possibly another
// tenant's), or draining (deleted, not yet gone).

package janitor

import (
	"context"
	"fmt"
	"slices"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Verdict is what a sweep did with one prerequisite.
type Verdict string

const (
	// Removed: nothing of it remains.
	Removed Verdict = "removed"
	// KeptForeign: someone else installed it, so it stays.
	KeptForeign Verdict = "kept, installed by someone else"
	// KeptInUse: instances of its kinds remain, so it stays.
	KeptInUse Verdict = "kept, still in use"
	// Draining: deleted, and not yet gone.
	Draining Verdict = "draining"
)

// Outcome is one prerequisite's verdict.
type Outcome struct {
	Name    string
	Verdict Verdict
	Detail  string
}

// Done reports whether nothing is left to sweep.
func Done(outcomes []Outcome) bool {
	return !slices.ContainsFunc(outcomes, func(o Outcome) bool { return o.Verdict == Draining })
}

// Client reads straight from the API server and deletes.
type Client interface {
	client.Reader
	client.Writer
}

// prerequisite is one cluster-level piece the janitor may remove.
type prerequisite struct {
	name string
	// crd is the definition its install is recognised by.
	crd string
	// instances are kinds whose objects keep it in place.
	instances []schema.GroupVersionKind
	// manifests is the release the operator applied.
	manifests func() ([]*unstructured.Unstructured, error)
}

// prerequisites is every cluster-level piece, in the order they come down.
func prerequisites() []prerequisite {
	return []prerequisite{
		{
			name:      "agent-sandbox",
			crd:       "sandboxes.agents.x-k8s.io",
			instances: []schema.GroupVersionKind{{Group: "agents.x-k8s.io", Version: "v1beta1", Kind: "Sandbox"}},
			manifests: manifests.AgentSandbox,
		},
		{
			name:      "the Barman Cloud backup plugin",
			crd:       "objectstores.barmancloud.cnpg.io",
			instances: []schema.GroupVersionKind{{Group: "barmancloud.cnpg.io", Version: "v1", Kind: "ObjectStore"}},
			manifests: manifests.BarmanCloudPlugin,
		},
		{
			name:      "CloudNativePG",
			crd:       render.CNPGClusterCRD,
			instances: []schema.GroupVersionKind{{Group: "postgresql.cnpg.io", Version: "v1", Kind: "Cluster"}},
			manifests: manifests.CloudNativePG,
		},
	}
}

// Sweep removes what the operator installed, if no Stigmer remains. It
// returns nil outcomes when a Stigmer exists. Reads go straight to the API
// server, never through the operator's cache: a cached read of an arbitrary
// kind would start a cluster-wide watch of it, Secrets included.
func Sweep(ctx context.Context, c Client) ([]Outcome, error) {
	var stigmers stigmerv1.StigmerList
	if err := c.List(ctx, &stigmers); err != nil {
		return nil, fmt.Errorf("listing Stigmers: %w", err)
	}
	if len(stigmers.Items) > 0 {
		return nil, nil
	}
	outcomes := []Outcome{}
	o, err := sweepSandboxNamespaces(ctx, c)
	if err != nil {
		return nil, err
	}
	outcomes = append(outcomes, o)
	if o.Verdict == Draining {
		// agent-sandbox's controller still clears the sandboxes in them.
		return outcomes, nil
	}
	for _, p := range prerequisites() {
		o, err := sweepPrerequisite(ctx, c, p)
		if err != nil {
			return nil, err
		}
		outcomes = append(outcomes, o)
		if o.Verdict == Draining {
			// The next one may still be serving this one's objects.
			break
		}
	}
	return outcomes, nil
}

// sweepSandboxNamespaces deletes the sandbox namespaces the operator made.
func sweepSandboxNamespaces(ctx context.Context, c Client) (Outcome, error) {
	out := Outcome{Name: "sandbox namespaces", Verdict: Removed}
	var namespaces metav1.PartialObjectMetadataList
	namespaces.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "NamespaceList"})
	if err := c.List(ctx, &namespaces, client.MatchingLabels{
		render.ManagedByLabel: render.ManagedByValue,
		render.ComponentLabel: render.ComponentSandboxes,
	}); err != nil {
		return out, fmt.Errorf("listing sandbox namespaces: %w", err)
	}
	for i := range namespaces.Items {
		ns := &namespaces.Items[i]
		out.Verdict = Draining
		out.Detail = "namespace " + ns.Name
		if ns.DeletionTimestamp != nil {
			continue
		}
		if err := c.Delete(ctx, ns); err != nil && !apierrors.IsNotFound(err) {
			return out, fmt.Errorf("deleting namespace %s: %w", ns.Name, err)
		}
	}
	return out, nil
}

// sweepPrerequisite removes one prerequisite when it is the operator's own
// and nothing uses it.
func sweepPrerequisite(ctx context.Context, c Client, p prerequisite) (Outcome, error) {
	out := Outcome{Name: p.name}
	crd := &metav1.PartialObjectMetadata{}
	crd.SetGroupVersionKind(schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"})
	err := c.Get(ctx, client.ObjectKey{Name: p.crd}, crd)
	definitionPresent := err == nil
	if err != nil && !apierrors.IsNotFound(err) {
		return out, fmt.Errorf("reading %s's definition %s: %w", p.name, p.crd, err)
	}
	if definitionPresent && !stamped(crd) {
		out.Verdict = KeptForeign
		return out, nil
	}
	if definitionPresent {
		for _, gvk := range p.instances {
			var list metav1.PartialObjectMetadataList
			list.SetGroupVersionKind(gvk.GroupVersion().WithKind(gvk.Kind + "List"))
			if err := c.List(ctx, &list, client.Limit(1)); err != nil {
				return out, fmt.Errorf("listing %s objects: %w", gvk.Kind, err)
			}
			if len(list.Items) > 0 {
				out.Verdict = KeptInUse
				out.Detail = fmt.Sprintf("%s %s/%s remains", gvk.Kind, list.Items[0].Namespace, list.Items[0].Name)
				return out, nil
			}
		}
	}
	objs, err := p.manifests()
	if err != nil {
		return out, err
	}
	remaining := 0
	for _, u := range removalOrder(objs) {
		obj := &metav1.PartialObjectMetadata{}
		obj.SetGroupVersionKind(u.GroupVersionKind())
		err := c.Get(ctx, client.ObjectKey{Namespace: u.GetNamespace(), Name: u.GetName()}, obj)
		if apierrors.IsNotFound(err) || isNoKind(err) {
			continue
		}
		if err != nil {
			return out, fmt.Errorf("reading %s %s: %w", u.GetKind(), u.GetName(), err)
		}
		if !stamped(obj) {
			// Shared with someone else's install (a namespace both use).
			continue
		}
		remaining++
		if obj.DeletionTimestamp != nil {
			continue
		}
		if err := c.Delete(ctx, obj, client.PropagationPolicy(metav1.DeletePropagationBackground)); err != nil && !apierrors.IsNotFound(err) {
			return out, fmt.Errorf("deleting %s %s: %w", u.GetKind(), u.GetName(), err)
		}
	}
	if remaining > 0 {
		out.Verdict = Draining
		out.Detail = fmt.Sprintf("%d objects deleting", remaining)
		return out, nil
	}
	out.Verdict = Removed
	return out, nil
}

// stamped reports whether this operator applied the object.
func stamped(o client.Object) bool {
	return o.GetLabels()[render.ManagedByLabel] == render.ManagedByValue
}

// isNoKind reports an error for a kind the cluster no longer serves (its
// definition is already gone), which means its objects are gone too.
func isNoKind(err error) bool {
	return err != nil && meta.IsNoMatchError(err)
}

// removalOrder takes down what depends on the rest first: webhooks, then
// definitions, then cluster roles, then namespaced objects, then
// namespaces.
func removalOrder(objs []*unstructured.Unstructured) []*unstructured.Unstructured {
	rank := map[string]int{
		"MutatingWebhookConfiguration": 0, "ValidatingWebhookConfiguration": 0,
		"CustomResourceDefinition": 1,
		"ClusterRole":              2, "ClusterRoleBinding": 2,
		"Namespace": 4,
	}
	r := func(u *unstructured.Unstructured) int {
		if v, ok := rank[u.GetKind()]; ok {
			return v
		}
		return 3
	}
	out := append([]*unstructured.Unstructured(nil), objs...)
	slices.SortStableFunc(out, func(a, b *unstructured.Unstructured) int { return r(a) - r(b) })
	return out
}

// Direct pairs the API server reader with a client's writes.
type Direct struct {
	client.Reader
	client.Writer
}
