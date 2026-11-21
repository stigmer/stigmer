// Cluster-level operators a component needs (CloudNativePG, its backup
// plugin): detected,
// installed when missing, and never touched when someone else installed them.
//
// A prerequisite is recognised by its definition. Absent, the operator
// applies the release it carries, labelled as its own; that label is how it
// later tells its install from anyone else's. Present and someone else's,
// the operator trusts it and reconciles nothing of it, since the adopter
// owns its version and its upgrades. Present and the operator's own, its
// controller must be ready before anything is built on it; a controller
// that is missing (a half-finished install, a deleted Deployment) has the
// release applied again. `skip` trusts the declaration completely and
// refuses in words when the definition is not there.

package component

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Prerequisite describes one cluster-level operator.
type Prerequisite struct {
	// Name is how messages name it.
	Name string
	// CRD is the definition it is detected by.
	CRD string
	// Controller is its controller Deployment.
	Controller client.ObjectKey
	// Mode is the declared mode, and ModeField the field it is declared in.
	Mode      stigmerv1.PrerequisiteMode
	ModeField string
	// Manifests is the release the operator carries.
	Manifests func() ([]*unstructured.Unstructured, error)
	// ReapplyUntilReady applies the release again on every pass while its
	// controller is not ready: a release that mints its certificates through
	// cert-manager can have an object refused while its Deployment stands,
	// and the Deployment then waits on a Secret nobody will mint.
	ReapplyUntilReady bool
}

var crdKind = schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"}

// EnsurePrerequisite reports whether the prerequisite is ready to build on,
// and when it is not, the Result that says why.
func EnsurePrerequisite(ctx context.Context, env *Env, p Prerequisite) (bool, Result, error) {
	crd := &metav1.PartialObjectMetadata{}
	crd.SetGroupVersionKind(crdKind)
	err := env.Reader.Get(ctx, client.ObjectKey{Name: p.CRD}, crd)
	present := err == nil
	if err != nil && !apierrors.IsNotFound(err) {
		return false, Result{}, fmt.Errorf("looking for %s's definition %s: %w", p.Name, p.CRD, err)
	}
	ref := Ref("CustomResourceDefinition", "", p.CRD)

	if p.Mode == stigmerv1.PrerequisiteSkip {
		if !present {
			return false, Refused(stigmerv1.ReasonConfigurationRefused, ref,
				fmt.Sprintf("%s is skip, but %s is not installed (no definition %s): install it, or set %s to auto", p.ModeField, p.Name, p.CRD, p.ModeField)), nil
		}
		return true, Result{}, nil
	}

	if present && crd.GetLabels()[render.ManagedByLabel] != render.ManagedByValue {
		// Someone else's install: theirs to run and upgrade.
		return true, Result{}, nil
	}

	deployRef := Ref("Deployment", p.Controller.Namespace, p.Controller.Name)
	var controller appsv1.Deployment
	err = env.Reader.Get(ctx, p.Controller, &controller)
	if err != nil && !apierrors.IsNotFound(err) {
		return false, Result{}, fmt.Errorf("reading %s's controller: %w", p.Name, err)
	}
	if !present || apierrors.IsNotFound(err) || (p.ReapplyUntilReady && controller.Status.AvailableReplicas < 1) {
		objs, merr := p.Manifests()
		if merr != nil {
			return false, Result{}, merr
		}
		if aerr := ApplyShared(ctx, env.Client, orderForInstall(objs)); aerr != nil {
			return false, Result{}, fmt.Errorf("installing %s: %w", p.Name, aerr)
		}
		return false, Deploying(stigmerv1.ReasonInstallingPrerequisite, deployRef,
			fmt.Sprintf("installing %s into namespace %s", p.Name, p.Controller.Namespace)), nil
	}
	if controller.Status.AvailableReplicas < 1 {
		return false, Deploying(stigmerv1.ReasonInstallingPrerequisite, deployRef,
			fmt.Sprintf("waiting for %s's controller (%s/%s) to be ready", p.Name, p.Controller.Namespace, p.Controller.Name)), nil
	}
	return true, Result{}, nil
}

// orderForInstall puts what others depend on first: the namespace, then the
// definitions, then identities and roles, then the rest.
func orderForInstall(objs []*unstructured.Unstructured) []*unstructured.Unstructured {
	rank := map[string]int{
		"Namespace": 0, "CustomResourceDefinition": 1, "ServiceAccount": 2,
		"ClusterRole": 3, "Role": 3, "ClusterRoleBinding": 4, "RoleBinding": 4,
		"ConfigMap": 5, "Secret": 5, "Service": 6, "Deployment": 7,
		"MutatingWebhookConfiguration": 8, "ValidatingWebhookConfiguration": 8,
	}
	out := append([]*unstructured.Unstructured(nil), objs...)
	r := func(u *unstructured.Unstructured) int {
		if v, ok := rank[u.GetKind()]; ok {
			return v
		}
		return 6
	}
	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && r(out[j]) < r(out[j-1]); j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}
	return out
}
