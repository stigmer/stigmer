// How every object reaches the cluster: server-side apply under the
// operator's field manager, labelled as the operator's, owned by the Stigmer.
//
// Ownership is how deleting the Stigmer removes what it made, so the two
// shapes Kubernetes cannot collect are refused in words before anything is
// applied: a cluster-scoped object (a namespaced owner never collects one)
// and an object in another namespace (Kubernetes treats an owner it cannot
// see as gone and deletes the object at once). The owner reference is
// merged by UID, so a controller reference another operator set (on an
// object CloudNativePG creates, say) is never replaced. Cluster-level
// prerequisites take ApplyShared instead: labelled, never owned, removed
// only by the deletion path that knows who installed them.
//
// A Job's pod template is immutable. When a new render changes a Job (a new
// image, new settings) the apply is refused; the Job is deleted and applied
// again, which is what Helm does for a hook. An unchanged Job is a no-op
// apply and never re-runs.

package component

import (
	"context"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	logf "sigs.k8s.io/controller-runtime/pkg/log"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// OwnerReference is the Stigmer's reference on what it owns.
func OwnerReference(st *stigmerv1.Stigmer) metav1.OwnerReference {
	yes := true
	return metav1.OwnerReference{
		APIVersion:         stigmerv1.GroupVersion.String(),
		Kind:               "Stigmer",
		Name:               st.Name,
		UID:                st.UID,
		Controller:         &yes,
		BlockOwnerDeletion: &yes,
	}
}

// ToUnstructured turns a typed object, whose TypeMeta is set, into the form
// apply sends, without the fields a fresh object carries empty.
func ToUnstructured(obj client.Object) (*unstructured.Unstructured, error) {
	if u, ok := obj.(*unstructured.Unstructured); ok {
		return u, nil
	}
	m, err := runtime.DefaultUnstructuredConverter.ToUnstructured(obj)
	if err != nil {
		return nil, fmt.Errorf("converting %T for apply: %w", obj, err)
	}
	u := &unstructured.Unstructured{Object: m}
	unstructured.RemoveNestedField(u.Object, "status")
	unstructured.RemoveNestedField(u.Object, "metadata", "creationTimestamp")
	unstructured.RemoveNestedField(u.Object, "spec", "template", "metadata", "creationTimestamp")
	return u, nil
}

func stampManaged(u *unstructured.Unstructured) {
	labels := u.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[render.ManagedByLabel] = render.ManagedByValue
	u.SetLabels(labels)
}

// Own stamps the Stigmer's ownership on objects, refusing the shapes
// Kubernetes cannot collect. namespaced says whether an object's kind is
// namespaced. It is pure, so the contract is unit-tested.
func Own(st *stigmerv1.Stigmer, objs []*unstructured.Unstructured, namespaced func(*unstructured.Unstructured) (bool, error)) error {
	ref := OwnerReference(st)
	for _, u := range objs {
		isNamespaced, err := namespaced(u)
		if err != nil {
			return fmt.Errorf("finding whether %s %s is namespaced: %w", u.GetKind(), u.GetName(), err)
		}
		if !isNamespaced {
			return fmt.Errorf("%s %q is cluster-scoped, and the Stigmer in namespace %q cannot own it: it would never be removed with the Stigmer",
				u.GetKind(), u.GetName(), st.Namespace)
		}
		if u.GetNamespace() != st.Namespace {
			return fmt.Errorf("%s %s/%s is outside the Stigmer's namespace %q, and Kubernetes deletes an object whose owner it cannot see",
				u.GetKind(), u.GetNamespace(), u.GetName(), st.Namespace)
		}
		stampManaged(u)
		refs := u.GetOwnerReferences()
		owned := false
		for _, existing := range refs {
			if existing.UID == ref.UID {
				owned = true
				break
			}
		}
		if !owned {
			// A second controller reference is refused by the API server, so
			// ours is a plain owner reference when another controller is set.
			for _, existing := range refs {
				if existing.Controller != nil && *existing.Controller {
					ref.Controller = nil
					break
				}
			}
			u.SetOwnerReferences(append(refs, ref))
		}
	}
	return nil
}

// Apply applies objects the Stigmer owns.
func Apply(ctx context.Context, env *Env, objs ...client.Object) error {
	us := make([]*unstructured.Unstructured, 0, len(objs))
	for _, obj := range objs {
		u, err := ToUnstructured(obj)
		if err != nil {
			return err
		}
		us = append(us, u)
	}
	if err := Own(env.Stigmer, us, func(u *unstructured.Unstructured) (bool, error) {
		return env.Client.IsObjectNamespaced(u)
	}); err != nil {
		return err
	}
	return patch(ctx, env.Client, us)
}

// ApplyShared applies cluster-level prerequisite objects: labelled as the
// operator's, owned by nothing.
func ApplyShared(ctx context.Context, c client.Client, objs []*unstructured.Unstructured) error {
	for _, u := range objs {
		stampManaged(u)
	}
	return patch(ctx, c, objs)
}

func patch(ctx context.Context, c client.Client, objs []*unstructured.Unstructured) error {
	log := logf.FromContext(ctx)
	for _, u := range objs {
		opts := []client.PatchOption{client.ForceOwnership, client.FieldOwner(render.FieldManager)}
		err := c.Patch(ctx, u, client.Apply, opts...)
		if err != nil && isImmutableJobChange(u, err) {
			log.Info("replacing a Job whose template changed", "namespace", u.GetNamespace(), "name", u.GetName())
			if derr := c.Delete(ctx, u, client.PropagationPolicy(metav1.DeletePropagationBackground)); derr != nil && !apierrors.IsNotFound(derr) {
				return fmt.Errorf("replacing Job %s/%s whose template changed: %w", u.GetNamespace(), u.GetName(), derr)
			}
			err = c.Patch(ctx, u, client.Apply, opts...)
		}
		if err != nil {
			return fmt.Errorf("applying %s %s/%s: %w", u.GetKind(), u.GetNamespace(), u.GetName(), err)
		}
	}
	return nil
}

func isImmutableJobChange(u *unstructured.Unstructured, err error) bool {
	return u.GetKind() == "Job" && u.GroupVersionKind().Group == "batch" &&
		apierrors.IsInvalid(err) && strings.Contains(err.Error(), "immutable")
}
