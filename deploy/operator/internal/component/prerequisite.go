// Cluster-level operators a component needs (CloudNativePG, its backup
// plugin, agent-sandbox): detected, installed when missing, and never
// touched when someone else installed them.
//
// A prerequisite is recognised by its definition. Absent, the operator
// applies the release it carries, labelled as its own; that label is how it
// later tells its install from anyone else's. Present and the operator's
// own, its controller must be ready before anything is built on it; a
// controller that is missing (a half-finished install, a deleted
// Deployment) has the release applied again. `skip` trusts the declaration
// completely and refuses in words when the definition is not there.
//
// Present and someone else's, the operator reconciles nothing of it, since
// the adopter owns its version and its upgrades, and trusts it only while a
// controller of theirs runs. A definition outlives its controller (a Helm
// uninstall keeps definitions; a namespace can be deleted under them), and
// an install declared on a definition nothing serves waits forever. Their
// controller is recognised by the image name of the controller in the
// release the operator carries, because that is what every distribution
// keeps: upstream's manifest and its Helm chart differ in labels, names and
// namespaces, and a registry mirror changes everything before the name.
// theirsRuns looks for it where Helm put the definition, then where the
// release installs itself, then everywhere; a copy the operator cannot see
// (a controller outside the cluster, an image renamed) is what `skip` is for,
// and the refusal says so. Agent Substrate, detected the same way, shares
// that judgment.

package component

import (
	"context"
	"fmt"
	"strings"
	"sync"

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
		// Someone else's install: theirs to run and upgrade, trusted while
		// their controller runs.
		image, err := p.controllerImage()
		if err != nil {
			return false, Result{}, err
		}
		return theirsRuns(ctx, env, theirs{Name: p.Name, Definition: crd, Image: image, Home: p.Controller.Namespace, ModeField: p.ModeField})
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

// controllerImages holds each carried release's controller image by the
// definition it is detected by, read once per process: a release is up to a
// few megabytes of YAML, and a foreign prerequisite is checked every pass.
var controllerImages sync.Map

// controllerImage is the image the carried release's controller Deployment
// runs in its first container.
func (p Prerequisite) controllerImage() (string, error) {
	if image, ok := controllerImages.Load(p.CRD); ok {
		return image.(string), nil
	}
	objs, err := p.Manifests()
	if err != nil {
		return "", err
	}
	for _, o := range objs {
		if o.GetKind() != "Deployment" || o.GetNamespace() != p.Controller.Namespace || o.GetName() != p.Controller.Name {
			continue
		}
		containers, _, _ := unstructured.NestedSlice(o.Object, "spec", "template", "spec", "containers")
		if len(containers) == 0 {
			break
		}
		first, _ := containers[0].(map[string]any)
		image, _, _ := unstructured.NestedString(first, "image")
		if image == "" {
			break
		}
		controllerImages.Store(p.CRD, image)
		return image, nil
	}
	return "", fmt.Errorf("the release carried for %s has no controller Deployment %s with an image", p.Name, p.Controller)
}

// theirs is a cluster-level operator someone else installed: its definition
// carries no label of this operator's.
type theirs struct {
	// Name is how messages name it.
	Name string
	// Definition is the definition it was detected by, with its annotations.
	Definition *metav1.PartialObjectMetadata
	// Image is the image its controller runs in the release the operator
	// carries; only its name is compared (imageName).
	Image string
	// Home is the namespace that release installs its controller into.
	Home string
	// ModeField is the field that declares how it is treated.
	ModeField string
}

// The annotations Helm stamps on what a release installed.
const (
	helmReleaseName      = "meta.helm.sh/release-name"
	helmReleaseNamespace = "meta.helm.sh/release-namespace"
)

// theirsRuns reports whether someone else's install has a controller
// running, and when it has not, the Result that says so: Pending naming
// their Deployment while it has no available replica, Refused naming the
// leftover definitions and every way out when nothing runs their controller
// at all.
func theirsRuns(ctx context.Context, env *Env, t theirs) (bool, Result, error) {
	name := imageName(t.Image)
	annotations := t.Definition.GetAnnotations()
	release, releaseNS := annotations[helmReleaseName], annotations[helmReleaseNamespace]
	var found []appsv1.Deployment
	for _, ns := range searchOrder(releaseNS, t.Home) {
		var list appsv1.DeploymentList
		if err := env.Reader.List(ctx, &list, client.InNamespace(ns)); err != nil {
			return false, Result{}, fmt.Errorf("looking for %s's controller: %w", t.Name, err)
		}
		found = controllersRunning(list.Items, name)
		if len(found) > 0 {
			break
		}
	}
	for _, d := range found {
		if d.Status.AvailableReplicas > 0 {
			return true, Result{}, nil
		}
	}
	if len(found) > 0 {
		d := found[0]
		return false, Pending(stigmerv1.ReasonPrerequisiteNotRunning, Ref("Deployment", d.Namespace, d.Name),
			fmt.Sprintf("%s was installed by someone else, and its controller %s/%s has no available replica: the install waits for it; the operator never changes someone else's %s",
				t.Name, d.Namespace, d.Name, t.Name)), nil
	}
	definition := t.Definition.GetName()
	group := definition[strings.Index(definition, ".")+1:]
	left := ""
	if release != "" {
		left = fmt.Sprintf(", and the Helm release %s in namespace %s that installed it runs none", release, releaseNS)
	}
	return false, Refused(stigmerv1.ReasonPrerequisiteNotRunning, Ref("CustomResourceDefinition", "", definition),
		fmt.Sprintf("%s's definition %s is on this cluster, but no Deployment runs its controller (an image named %s)%s: "+
			"reinstall %s; or, once nothing on the cluster declares a kind of %s, delete the definitions of %s and the operator installs its own; "+
			"or, if its controller runs where the operator cannot see it (outside the cluster, or from an image of another name), set %s to skip",
			t.Name, definition, name, left, t.Name, group, group, t.ModeField)), nil
}

// searchOrder is where their controller is looked for: the namespace Helm
// installed the definition from, the namespace the release installs itself
// into, then every namespace ("").
func searchOrder(releaseNS, home string) []string {
	var order []string
	for _, ns := range []string{releaseNS, home} {
		if ns != "" && (len(order) == 0 || order[0] != ns) {
			order = append(order, ns)
		}
	}
	return append(order, "")
}

// controllersRunning are the Deployments that run an image of that name in
// a container: never an init container (CloudNativePG's poolers copy its
// binary from its image that way), and never a Deployment of this
// operator's own, which cannot vouch for someone else's definitions.
func controllersRunning(deployments []appsv1.Deployment, name string) []appsv1.Deployment {
	var out []appsv1.Deployment
	for _, d := range deployments {
		if d.Labels[render.ManagedByLabel] == render.ManagedByValue {
			continue
		}
		for _, c := range d.Spec.Template.Spec.Containers {
			if imageName(c.Image) == name {
				out = append(out, d)
				break
			}
		}
	}
	return out
}

// imageName is an image reference's name alone: the last segment of its
// repository, without the registry, the path, the tag or the digest.
func imageName(ref string) string {
	if i := strings.Index(ref, "@"); i >= 0 {
		ref = ref[:i]
	}
	if i := strings.LastIndex(ref, "/"); i >= 0 {
		ref = ref[i+1:]
	}
	if i := strings.Index(ref, ":"); i >= 0 {
		ref = ref[:i]
	}
	return ref
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
