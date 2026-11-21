// Installs Agent Substrate the way its own installer does, for one shape,
// and keeps it so: the one place the operator knows how Substrate is put
// together.
//
// Substrate publishes no chart or install manifest, only an installer whose
// code is internal to its module. This package does what that installer does
// for bundled Postgres, gVisor and the Envoy dataplane, from the release the
// operator embeds (internal/manifests/substrate), so a cluster with no
// internet route installs it too. When Substrate ships its own rendered
// install (agent-substrate/substrate#79), it replaces this package: Settings
// carries only upstream's own setting names, and the rest of the operator
// depends only on Substrate's public contract (its namespace, its service
// names, its signers, the WorkerPool definition), never on how it got there.
//
// Reconcile walks upstream's phases on every pass and stops at the first one
// still converging, saying what it waits for:
//
//  1. preflight: the cluster serves the pod-certificate and trust-bundle
//     APIs, and the step from the installed release is one Substrate allows;
//  2. namespaces, definitions, roles and the admission policy;
//  3. the key material, created once and never replaced, the API server's
//     configuration, the snapshot store's credentials, the gVisor
//     SandboxConfig, and the pod-certificate controller, then its three
//     trust bundles;
//  4. Postgres, which makes Substrate's roles itself as it starts;
//  5. the control plane: API server, identity server, controller, atelet,
//     router, egress gateway and their network policies, then their
//     rollouts and the egress gateway's trust bundle.
//
// Every pass applies every phase it reaches, so drift reverts. What Substrate's
// controllers create (the trust bundles) carries an owner reference to the
// namespace of the controller that writes it, since those controllers reset
// their labels; deleting the namespaces takes the bundles with them.

package install

import (
	"context"
	"fmt"
	"slices"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Substrate's public contract, the names an install of any origin serves.
const (
	// Namespace holds Substrate's control plane.
	Namespace = "ate-system"
	// PodCertNamespace holds the pod-certificate controller.
	PodCertNamespace = "podcertificate-controller-system"
	// WorkerPoolCRD is the definition a Substrate install is recognised by.
	WorkerPoolCRD = "workerpools.ate.dev"
	// APIServerName is the API's in-cluster name and its tokens' audience.
	APIServerName = "api.ate-system.svc"
	// RouterServerName is the router's in-cluster name.
	RouterServerName = "atenet-router.ate-system.svc"
	// ActorJWTIssuer is the issuer of actors' tokens.
	ActorJWTIssuer = "https://idp.ate-system.svc"
	// ServiceDNSSigner issues the certificates Substrate's services are
	// served under.
	ServiceDNSSigner = "servicedns.podcert.ate.dev/identity"
	// PodIdentitySigner issues a pod's client certificate.
	PodIdentitySigner = "podidentity.podcert.ate.dev/identity"
	// TrustBundleLabel selects the live trust bundles.
	TrustBundleLabel = "podcert.ate.dev/canarying"
	// APIAccessLabel admits a namespace's pods to Substrate's API.
	APIAccessLabel = "ate.dev/api-access"
)

const (
	postgresSigner    = "postgres.podcert.ate.dev/identity"
	egressMITMSigner  = "egress-mitm.ate.dev/mitm"
	envHashAnnotation = "ate.dev/env-hash"
	// VersionLabel on Substrate's namespace records the release installed.
	VersionLabel = "stigmer.ai/substrate-version"
)

// Settings is one install's configuration, named after Substrate's own
// installer settings.
type Settings struct {
	// BootstrapOwners are the principals that own the install from its
	// first start (ATE_API_AUTHZ_BOOTSTRAP_OWNERS), such as
	// system:serviceaccount:<namespace>:<name>.
	BootstrapOwners []string
	// IngressAllowedSPIFFEIDs are the clients the router admits
	// (--ingress-allowed-spiffe-ids).
	IngressAllowedSPIFFEIDs []string
	// SnapshotLocation is where sleeping actors' snapshots go
	// (--snapshot-location), such as s3://bucket/substrate/.
	SnapshotLocation string
	// SnapshotStore is the S3-compatible store behind SnapshotLocation.
	SnapshotStore ObjectStore
	// LocalhostRegistryReplacement is the in-cluster address of a
	// development cluster's local registry, which atelet pulls loopback
	// image references through (atelet's --localhost-registry-replacement).
	// Empty on a real cluster.
	LocalhostRegistryReplacement string
}

// ObjectStore is an S3-compatible store and its credentials.
type ObjectStore struct {
	// Endpoint is the store's URL; empty is AWS S3.
	Endpoint string
	Region   string
	// PathStyle addresses buckets by path rather than by host.
	PathStyle       bool
	AccessKeyID     string
	SecretAccessKey string
}

// Discovery is what the installer asks the API server about the cluster.
type Discovery interface {
	// Resources lists the resources a group version serves, empty when it
	// serves none.
	Resources(groupVersion string) ([]string, error)
	// ServiceAccountIssuer is the issuer the cluster's service account
	// tokens carry, from its discovery document; empty when it has none.
	ServiceAccountIssuer(ctx context.Context) (string, error)
}

// Cluster is what the installer acts on.
type Cluster struct {
	// Reader reads straight from the API server.
	Reader client.Reader
	// Writer creates the key material that is made once, and patches the
	// owner references on Substrate's trust bundles.
	Writer client.Writer
	// Apply applies objects as the operator's own and owned by nothing.
	Apply func(ctx context.Context, objs []*unstructured.Unstructured) error
	// Discovery answers questions about the cluster's APIs.
	Discovery Discovery
}

// Result is where the install stands after a pass.
type Result struct {
	// Ready reports a control plane that serves.
	Ready bool
	// Refusal, when set, is why the install cannot proceed until the
	// cluster changes.
	Refusal string
	// Waiting, when set, is what the install waits for.
	Waiting string
	// Kind, Namespace and Name are the object a refusal or wait is about.
	Kind, Namespace, Name string
}

func waiting(kind, namespace, name, format string, args ...any) Result {
	return Result{Waiting: fmt.Sprintf(format, args...), Kind: kind, Namespace: namespace, Name: name}
}

// Version is the embedded release.
func Version() (string, error) {
	r, err := embedded()
	if err != nil {
		return "", err
	}
	return r.version, nil
}

// WorkerImage is the pinned gVisor worker image a WorkerPool names.
func WorkerImage() (string, error) {
	r, err := embedded()
	if err != nil {
		return "", err
	}
	return r.image(workerImage)
}

// Detect reports whether the cluster has Substrate, and whether this
// operator installed it.
func Detect(ctx context.Context, r client.Reader) (present, ours bool, err error) {
	crd := &metav1.PartialObjectMetadata{}
	crd.SetGroupVersionKind(schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"})
	err = r.Get(ctx, client.ObjectKey{Name: WorkerPoolCRD}, crd)
	if apierrors.IsNotFound(err) {
		return false, false, nil
	}
	if err != nil {
		return false, false, fmt.Errorf("looking for Agent Substrate's definition %s: %w", WorkerPoolCRD, err)
	}
	return true, crd.GetLabels()[render.ManagedByLabel] == render.ManagedByValue, nil
}

// Reconcile converges the install one pass further.
func Reconcile(ctx context.Context, cl Cluster, s Settings) (Result, error) {
	r, err := embedded()
	if err != nil {
		return Result{}, err
	}
	return reconcile(ctx, cl, r, s)
}

func reconcile(ctx context.Context, cl Cluster, r *release, s Settings) (Result, error) {
	if res, err := preflight(ctx, cl, r); err != nil || res.Refusal != "" {
		return res, err
	}

	base, err := baseObjects(r)
	if err != nil {
		return Result{}, err
	}
	if err := cl.Apply(ctx, ordered(base)); err != nil {
		return Result{}, fmt.Errorf("applying Agent Substrate's namespaces and definitions: %w", err)
	}
	for _, u := range base {
		if u.GetKind() != "CustomResourceDefinition" {
			continue
		}
		established, err := crdEstablished(ctx, cl.Reader, u.GetName())
		if err != nil {
			return Result{}, err
		}
		if !established {
			return waiting("CustomResourceDefinition", "", u.GetName(), "waiting for Agent Substrate's definition %s to be served", u.GetName()), nil
		}
	}

	material, err := ensureKeyMaterial(ctx, cl)
	if err != nil {
		return Result{}, err
	}
	issuer, err := cl.Discovery.ServiceAccountIssuer(ctx)
	if err != nil {
		return Result{}, err
	}
	configs, err := configObjects(r, s, material, issuer)
	if err != nil {
		return Result{}, err
	}
	podcert, err := r.objects(filePodCertController)
	if err != nil {
		return Result{}, err
	}
	gvisor, err := r.objects(fileSandboxGVisor)
	if err != nil {
		return Result{}, err
	}
	if err := cl.Apply(ctx, ordered(slices.Concat(configs.objects, gvisor, podcert))); err != nil {
		return Result{}, fmt.Errorf("applying Agent Substrate's configuration and pod-certificate controller: %w", err)
	}
	if res, err := deploymentAvailable(ctx, cl.Reader, PodCertNamespace, "podcertificate-controller"); err != nil || res.Waiting != "" {
		return res, err
	}
	if res, err := ownTrustBundles(ctx, cl, PodCertNamespace, ServiceDNSSigner, PodIdentitySigner, postgresSigner); err != nil || res.Waiting != "" {
		return res, err
	}

	postgres, err := r.objects(filePostgres)
	if err != nil {
		return Result{}, err
	}
	if err := patchPostgres(postgres); err != nil {
		return Result{}, err
	}
	if err := cl.Apply(ctx, ordered(postgres)); err != nil {
		return Result{}, fmt.Errorf("applying Agent Substrate's database: %w", err)
	}
	var db appsv1.StatefulSet
	if err := cl.Reader.Get(ctx, client.ObjectKey{Namespace: Namespace, Name: "postgres"}, &db); err != nil && !apierrors.IsNotFound(err) {
		return Result{}, fmt.Errorf("reading Agent Substrate's database: %w", err)
	}
	if db.Status.ReadyReplicas < 1 {
		return waiting("StatefulSet", Namespace, "postgres", "waiting for Agent Substrate's database (%s/postgres) to be ready", Namespace), nil
	}

	plane, err := controlPlaneObjects(r, s, configs.envHash)
	if err != nil {
		return Result{}, err
	}
	if err := cl.Apply(ctx, ordered(plane)); err != nil {
		return Result{}, fmt.Errorf("applying Agent Substrate's control plane: %w", err)
	}
	for _, name := range []string{"ate-api-server", "ate-idp-server", "ate-controller", "atenet-router", "atenet-egress"} {
		if res, err := deploymentAvailable(ctx, cl.Reader, Namespace, name); err != nil || res.Waiting != "" {
			return res, err
		}
	}
	var atelet appsv1.DaemonSet
	if err := cl.Reader.Get(ctx, client.ObjectKey{Namespace: Namespace, Name: "atelet"}, &atelet); err != nil && !apierrors.IsNotFound(err) {
		return Result{}, fmt.Errorf("reading Agent Substrate's node agent: %w", err)
	}
	if atelet.Status.NumberAvailable < 1 {
		return waiting("DaemonSet", Namespace, "atelet", "waiting for Agent Substrate's node agent (%s/atelet) on a node", Namespace), nil
	}
	if res, err := ownTrustBundles(ctx, cl, Namespace, egressMITMSigner); err != nil || res.Waiting != "" {
		return res, err
	}
	return Result{Ready: true}, nil
}

// baseObjects are the namespaces, definitions, roles and admission policy
// everything else is built on. Substrate's namespace carries the release it
// runs.
func baseObjects(r *release) ([]*unstructured.Unstructured, error) {
	var out []*unstructured.Unstructured
	for _, file := range []string{fileNamespace, fileSandboxValidation} {
		objs, err := r.objects(file)
		if err != nil {
			return nil, err
		}
		out = append(out, objs...)
	}
	generated, err := r.generated()
	if err != nil {
		return nil, err
	}
	out = append(out, generated...)
	// The pod-certificate controller's namespace comes first too: its key
	// pools are created into it before the controller is applied.
	podcert, err := r.objects(filePodCertController)
	if err != nil {
		return nil, err
	}
	podcertNS, err := find(podcert, "Namespace", PodCertNamespace)
	if err != nil {
		return nil, err
	}
	out = append(out, podcertNS)
	ns, err := find(out, "Namespace", Namespace)
	if err != nil {
		return nil, err
	}
	labels := ns.GetLabels()
	if labels == nil {
		labels = map[string]string{}
	}
	labels[VersionLabel] = r.version
	ns.SetLabels(labels)
	return out, nil
}

// controlPlaneObjects are the control plane's workloads, patched.
func controlPlaneObjects(r *release, s Settings, envHash string) ([]*unstructured.Unstructured, error) {
	var out []*unstructured.Unstructured
	for _, file := range []string{fileAPIServer, fileIDPServer, fileController, fileAtelet, fileRouter, fileEgress, fileNetworkPolicies} {
		objs, err := r.objects(file)
		if err != nil {
			return nil, err
		}
		out = append(out, objs...)
	}
	// ate-controller.yaml repeats the namespace, which the base phase owns.
	out = slices.DeleteFunc(out, func(u *unstructured.Unstructured) bool { return u.GetKind() == "Namespace" })
	if err := patchAPIServer(out, s, envHash); err != nil {
		return nil, err
	}
	if err := patchIDPServer(out); err != nil {
		return nil, err
	}
	if err := patchRouter(out, s); err != nil {
		return nil, err
	}
	if err := patchAtelet(out, s); err != nil {
		return nil, err
	}
	return out, nil
}

// Objects is every object an install applies, by kind and name: what the
// janitor may remove once no Stigmer remains. The trust bundles Substrate's
// controllers create are not here; they go with their namespaces.
func Objects() ([]*unstructured.Unstructured, error) {
	r, err := embedded()
	if err != nil {
		return nil, err
	}
	out, err := baseObjects(r)
	if err != nil {
		return nil, err
	}
	for _, file := range []string{fileSandboxGVisor, filePodCertController, filePostgres, fileAPIServer, fileIDPServer, fileController, fileAtelet, fileRouter, fileEgress, fileNetworkPolicies} {
		objs, err := r.objects(file)
		if err != nil {
			return nil, err
		}
		out = append(out, objs...)
	}
	for _, name := range generatedNames() {
		u := &unstructured.Unstructured{}
		u.SetAPIVersion("v1")
		u.SetKind(name.kind)
		u.SetNamespace(name.namespace)
		u.SetName(name.name)
		out = append(out, u)
	}
	seen := map[string]bool{}
	return slices.DeleteFunc(out, func(u *unstructured.Unstructured) bool {
		key := u.GetKind() + "/" + u.GetNamespace() + "/" + u.GetName()
		dup := seen[key]
		seen[key] = true
		return dup
	}), nil
}

// preflight refuses a cluster Substrate cannot run on, and a release step
// Substrate does not support.
func preflight(ctx context.Context, cl Cluster, r *release) (Result, error) {
	served, err := cl.Discovery.Resources("certificates.k8s.io/v1beta1")
	if err != nil {
		return Result{}, fmt.Errorf("asking the cluster for the pod-certificate APIs: %w", err)
	}
	var missing []string
	for _, want := range []string{"clustertrustbundles", "podcertificaterequests"} {
		if !slices.Contains(served, want) {
			missing = append(missing, want)
		}
	}
	if len(missing) > 0 {
		return Result{
			Refusal: fmt.Sprintf("Agent Substrate gives every pod its identity through Kubernetes' pod-certificate APIs, and this cluster does not serve %s in certificates.k8s.io/v1beta1: "+
				"use Kubernetes 1.37 or later with the ClusterTrustBundle, ClusterTrustBundleProjection and PodCertificateRequest feature gates and the certificates.k8s.io/v1beta1 API enabled, or a provider that turns them on",
				strings.Join(missing, " and ")),
			Kind: "CustomResourceDefinition", Name: WorkerPoolCRD,
		}, nil
	}
	var ns corev1.Namespace
	err = cl.Reader.Get(ctx, client.ObjectKey{Name: Namespace}, &ns)
	if apierrors.IsNotFound(err) {
		return Result{}, nil
	}
	if err != nil {
		return Result{}, fmt.Errorf("reading namespace %s: %w", Namespace, err)
	}
	installed := ns.Labels[VersionLabel]
	if installed == "" {
		return Result{}, nil
	}
	if problem := upgradeProblem(installed, r.version); problem != "" {
		return Result{Refusal: problem, Kind: "Namespace", Name: Namespace}, nil
	}
	return Result{}, nil
}

// upgradeProblem is why a move between two releases is not one Substrate
// supports, or empty: patches move freely, minors one at a time and back
// one, and a major never in place.
func upgradeProblem(from, to string) string {
	fromMajor, fromMinor, okFrom := majorMinor(from)
	toMajor, toMinor, okTo := majorMinor(to)
	switch {
	case !okFrom || !okTo:
		return fmt.Sprintf("Agent Substrate %s is installed and this operator carries %s, and one of them is not a release version", from, to)
	case fromMajor != toMajor:
		return fmt.Sprintf("Agent Substrate %s is installed and this operator carries %s: a new major release is a fresh install, so remove the Stigmer and let the operator clean up first", from, to)
	case toMinor > fromMinor+1:
		return fmt.Sprintf("Agent Substrate %s is installed and this operator carries %s: Substrate moves one minor release at a time, so upgrade through an operator that carries v%d.%d first", from, to, fromMajor, fromMinor+1)
	case toMinor < fromMinor-1:
		return fmt.Sprintf("Agent Substrate %s is installed and this operator carries %s: Substrate rolls back only one minor release", from, to)
	}
	return ""
}

func majorMinor(version string) (int, int, bool) {
	var major, minor, patch int
	if _, err := fmt.Sscanf(version, "v%d.%d.%d", &major, &minor, &patch); err != nil {
		return 0, 0, false
	}
	return major, minor, true
}

func crdEstablished(ctx context.Context, r client.Reader, name string) (bool, error) {
	crd := &unstructured.Unstructured{}
	crd.SetGroupVersionKind(schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition"})
	if err := r.Get(ctx, client.ObjectKey{Name: name}, crd); err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, fmt.Errorf("reading definition %s: %w", name, err)
	}
	conditions, _, _ := unstructured.NestedSlice(crd.Object, "status", "conditions")
	for _, c := range conditions {
		m, ok := c.(map[string]any)
		if ok && m["type"] == "Established" && m["status"] == "True" {
			return true, nil
		}
	}
	return false, nil
}

func deploymentAvailable(ctx context.Context, r client.Reader, namespace, name string) (Result, error) {
	var dep appsv1.Deployment
	if err := r.Get(ctx, client.ObjectKey{Namespace: namespace, Name: name}, &dep); err != nil && !apierrors.IsNotFound(err) {
		return Result{}, fmt.Errorf("reading %s/%s: %w", namespace, name, err)
	}
	if dep.Status.AvailableReplicas < 1 {
		return waiting("Deployment", namespace, name, "waiting for Agent Substrate's %s (%s/%s) to be available", name, namespace, name), nil
	}
	return Result{}, nil
}

var trustBundleList = schema.GroupVersionKind{Group: "certificates.k8s.io", Version: "v1beta1", Kind: "ClusterTrustBundleList"}

// ownTrustBundles waits for a live trust bundle from each signer and points
// each at the namespace of the controller that writes it, so it goes when
// that namespace does. Substrate's controllers rewrite a bundle's labels but
// keep its owner references.
func ownTrustBundles(ctx context.Context, cl Cluster, namespace string, signers ...string) (Result, error) {
	var owner corev1.Namespace
	if err := cl.Reader.Get(ctx, client.ObjectKey{Name: namespace}, &owner); err != nil {
		return Result{}, fmt.Errorf("reading namespace %s: %w", namespace, err)
	}
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(trustBundleList)
	if err := cl.Reader.List(ctx, list, client.MatchingLabels{TrustBundleLabel: "live"}); err != nil {
		return Result{}, fmt.Errorf("listing Agent Substrate's trust bundles: %w", err)
	}
	for _, signer := range signers {
		var bundle *unstructured.Unstructured
		for i := range list.Items {
			if s, _, _ := unstructured.NestedString(list.Items[i].Object, "spec", "signerName"); s == signer {
				bundle = &list.Items[i]
				break
			}
		}
		if bundle == nil {
			return waiting("ClusterTrustBundle", "", "", "waiting for Agent Substrate's trust bundle for %s", signer), nil
		}
		if slices.ContainsFunc(bundle.GetOwnerReferences(), func(r metav1.OwnerReference) bool { return r.UID == owner.UID }) {
			continue
		}
		original := bundle.DeepCopy()
		bundle.SetOwnerReferences(append(bundle.GetOwnerReferences(),
			metav1.OwnerReference{APIVersion: "v1", Kind: "Namespace", Name: owner.Name, UID: owner.UID}))
		if err := cl.Writer.Patch(ctx, bundle, client.MergeFrom(original)); err != nil {
			return Result{}, fmt.Errorf("pointing trust bundle %s at namespace %s: %w", bundle.GetName(), namespace, err)
		}
	}
	return Result{}, nil
}

// ordered puts what others depend on first: namespaces, definitions,
// identities and roles, configuration, services, then workloads and the
// rest.
func ordered(objs []*unstructured.Unstructured) []*unstructured.Unstructured {
	rank := map[string]int{
		"Namespace": 0, "CustomResourceDefinition": 1, "ServiceAccount": 2,
		"ClusterRole": 3, "Role": 3, "ClusterRoleBinding": 4, "RoleBinding": 4,
		"ValidatingAdmissionPolicy": 5, "ValidatingAdmissionPolicyBinding": 6,
		"ConfigMap": 7, "Secret": 7, "ResourceQuota": 7, "Service": 8,
	}
	r := func(u *unstructured.Unstructured) int {
		if v, ok := rank[u.GetKind()]; ok {
			return v
		}
		return 9
	}
	out := slices.Clone(objs)
	slices.SortStableFunc(out, func(a, b *unstructured.Unstructured) int { return r(a) - r(b) })
	return out
}
