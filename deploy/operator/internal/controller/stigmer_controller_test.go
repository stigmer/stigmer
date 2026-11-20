// Pins the controller and the definition against a real API server:
// admission refuses each contradictory declaration with its sentence; keys
// are minted once, never rewritten, carry no owner reference (so they
// outlive the Stigmer), and a missing one is added alone; a component waits
// naming the dependency that is not ready; a second Stigmer is refused naming
// the first; a declared size that cannot run refuses the install; a bucket
// waits, in words, for its credentials Secret and both keys; one pass
// writes status once and a pass that changes nothing writes nothing; and a
// prerequisite is installed when absent, waited on while its controller is
// not ready, trusted when someone else installed it, and refused under skip
// when it is missing.

package controller

import (
	"context"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func stigmer(ns, name string) *stigmerv1.Stigmer {
	return &stigmerv1.Stigmer{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name}}
}

func TestAdmissionRefusesContradictions(t *testing.T) {
	ns := namespace(t)
	ctx := context.Background()
	external := &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{External: &stigmerv1.ExternalPostgreSQLSpec{
		Host: "db", User: "u", PasswordSecret: stigmerv1.SecretKeySelector{Name: "s", Key: "k"},
	}}}
	oidc := &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{Issuer: "https://issuer", Audience: "a"}}
	license := &stigmerv1.SecretKeySelector{Name: "l", Key: "STIGMER_LICENSE_KEY"}
	bucket := &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	owner := &stigmerv1.OwnerSpec{Email: "priya@acme.dev"}
	frontDoor := &stigmerv1.IngressSpec{Hostname: "stigmer.acme.dev", TLS: &stigmerv1.IngressTLSSpec{SecretName: "stigmer-tls"}}
	cases := []struct {
		name string
		spec stigmerv1.StigmerSpec
		says string
	}{
		{"bundled and external database", stigmerv1.StigmerSpec{Database: &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{
			Bundled: &stigmerv1.BundledPostgreSQLSpec{}, External: external.PostgreSQL.External}}},
			"choose one of bundled or external"},
		{"your database with the bundled Temporal", stigmerv1.StigmerSpec{Database: external},
			"bring your own Temporal too"},
		{"Enterprise settings without a license", stigmerv1.StigmerSpec{Identity: oidc,
			Enterprise: &stigmerv1.EnterpriseSpec{OrganizationCreators: []string{"ida_x"}}},
			"need a license"},
		{"a license without sign-in", stigmerv1.StigmerSpec{Enterprise: &stigmerv1.EnterpriseSpec{License: license}},
			"refuses to boot without sign-in"},
		{"a licensed install on a plaintext Temporal", stigmerv1.StigmerSpec{Identity: oidc,
			Enterprise: &stigmerv1.EnterpriseSpec{License: license},
			Database:   external,
			Temporal:   &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{HostPort: "t:7233"}}},
			"must authenticate"},
		{"half a client certificate", stigmerv1.StigmerSpec{Database: external, Temporal: &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{
			HostPort: "t:7233", TLS: &stigmerv1.TemporalTLSSpec{SecretName: "s", CertKey: "tls.crt"}}}},
			"certKey and keyKey go together"},
		{"a host without a port", stigmerv1.StigmerSpec{Database: external, Temporal: &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{HostPort: "temporal"}}},
			"spec.temporal.external.hostPort"},
		{"a plain-http issuer", stigmerv1.StigmerSpec{Identity: &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{Issuer: "http://issuer.example.com", Audience: "a"}}},
			"must be an https URL"},
		{"an owner that is not an email", stigmerv1.StigmerSpec{Owner: &stigmerv1.OwnerSpec{Email: "priya"}},
			"must be an email address"},
		{"an artifacts volume beside a bucket", stigmerv1.StigmerSpec{ObjectStore: bucket,
			Server: stigmerv1.ServerSpec{Artifacts: &stigmerv1.VolumeSpec{}}},
			"remove spec.server.artifacts"},
		{"the bundled sign-in without a front door", stigmerv1.StigmerSpec{Owner: owner,
			Identity: &stigmerv1.IdentitySpec{Bundled: &stigmerv1.BundledIdentitySpec{}}},
			"declare spec.ingress"},
		{"an exposed install without an owner", stigmerv1.StigmerSpec{Ingress: frontDoor},
			"needs spec.owner.email"},
		{"the bundled sign-in on your own database", stigmerv1.StigmerSpec{Owner: owner, Ingress: frontDoor, Database: external,
			Temporal: &stigmerv1.TemporalSpec{External: &stigmerv1.ExternalTemporalSpec{HostPort: "t:7233"}}},
			"keeps its accounts on the bundled database"},
		{"sign-up without mail", stigmerv1.StigmerSpec{Owner: owner, Ingress: frontDoor,
			Identity: &stigmerv1.IdentitySpec{Bundled: &stigmerv1.BundledIdentitySpec{SignUp: &stigmerv1.SignUpSpec{EmailDomains: []string{"acme.dev"}}}}},
			"needs mail"},
		{"exposure on purpose beside sign-in", stigmerv1.StigmerSpec{Identity: oidc, Ingress: frontDoor,
			Server: stigmerv1.ServerSpec{AllowUnauthenticatedExposure: true}},
			"keep one"},
		{"both sign-ins", stigmerv1.StigmerSpec{Owner: owner, Ingress: frontDoor,
			Identity: &stigmerv1.IdentitySpec{Bundled: &stigmerv1.BundledIdentitySpec{}, OIDC: oidc.OIDC}},
			"exactly one of bundled"},
		{"a front door with neither a certificate nor a Gateway", stigmerv1.StigmerSpec{Owner: owner,
			Ingress: &stigmerv1.IngressSpec{Hostname: "stigmer.acme.dev"}},
			"exactly one of tls"},
		{"a certificate both kept and issued", stigmerv1.StigmerSpec{Owner: owner,
			Ingress: &stigmerv1.IngressSpec{Hostname: "stigmer.acme.dev", TLS: &stigmerv1.IngressTLSSpec{
				SecretName: "tls", Issuer: &stigmerv1.IssuerReference{Name: "ca"}}}},
			"exactly one of secretName"},
		{"per-session sandboxes without a bucket", stigmerv1.StigmerSpec{
			Sandboxes: &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox}},
			"declare spec.objectStore to run agents in per-session sandboxes"},
		{"agent-sandbox settings under the shared driver", stigmerv1.StigmerSpec{
			Sandboxes: &stigmerv1.SandboxesSpec{AgentSandbox: &stigmerv1.AgentSandboxSpec{}}},
			"set spec.sandboxes.driver to agentSandbox"},
		{"a sandbox range that is not a range", stigmerv1.StigmerSpec{ObjectStore: bucket,
			Sandboxes: &stigmerv1.SandboxesSpec{Driver: stigmerv1.SandboxDriverAgentSandbox,
				AgentSandbox: &stigmerv1.AgentSandboxSpec{Egress: &stigmerv1.SandboxEgressSpec{AllowCIDRs: []string{"10.0.0.1"}}}}},
			"holds CIDR ranges"},
		{"a server range that is not a range", stigmerv1.StigmerSpec{
			Server: stigmerv1.ServerSpec{Egress: &stigmerv1.ServerEgressSpec{Fenced: true, AllowCIDRs: []string{"db.internal"}}}},
			"holds CIDR ranges"},
		{"a bucket endpoint that is not a URL", stigmerv1.StigmerSpec{ObjectStore: &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{
			Bucket: "acme", Endpoint: "minio:9000", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}},
			"must be an http or https URL"},
	}
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			s := stigmer(ns, "refused-"+string(rune('a'+i)))
			s.Spec = c.spec
			err := k8s.Create(ctx, s)
			if err == nil || !strings.Contains(err.Error(), c.says) {
				t.Errorf("got %v; want a refusal saying %q", err, c.says)
			}
		})
	}
	ok := stigmer(ns, "accepted")
	ok.Spec = stigmerv1.StigmerSpec{Owner: &stigmerv1.OwnerSpec{Email: "priya@acme.dev"}, Identity: oidc,
		Enterprise: &stigmerv1.EnterpriseSpec{License: license}}
	if err := k8s.Create(ctx, ok); err != nil {
		t.Errorf("a valid licensed declaration is refused: %v", err)
	}
	exposed := stigmer(ns, "exposed")
	exposed.Spec = stigmerv1.StigmerSpec{Owner: owner, Ingress: frontDoor}
	if err := k8s.Create(ctx, exposed); err != nil {
		t.Errorf("an exposed install with an owner is refused: %v", err)
	}
	loopback := stigmer(ns, "loopback")
	loopback.Spec.Identity = &stigmerv1.IdentitySpec{OIDC: &stigmerv1.OIDCSpec{Issuer: "http://127.0.0.1:8080/realms/x", Audience: "a"}}
	if err := k8s.Create(ctx, loopback); err != nil {
		t.Errorf("a loopback issuer is refused: %v", err)
	}
}

type fake struct {
	name  string
	deps  []string
	res   component.Result
	calls int
}

func (f *fake) Name() string           { return f.name }
func (f *fake) Dependencies() []string { return f.deps }
func (f *fake) Reconcile(context.Context, *component.Env) (component.Result, error) {
	f.calls++
	return f.res, nil
}

// counting counts status writes.
type counting struct {
	client.Client
	writes int
}

type countingStatus struct {
	client.SubResourceWriter
	c *counting
}

func (c *counting) Status() client.SubResourceWriter {
	return countingStatus{SubResourceWriter: c.Client.Status(), c: c}
}

func (s countingStatus) Patch(ctx context.Context, obj client.Object, patch client.Patch, opts ...client.SubResourcePatchOption) error {
	s.c.writes++
	return s.SubResourceWriter.Patch(ctx, obj, patch, opts...)
}

func reconcileOnce(t *testing.T, r *StigmerReconciler, s *stigmerv1.Stigmer) *stigmerv1.Stigmer {
	t.Helper()
	if _, err := r.Reconcile(context.Background(), ctrl.Request{NamespacedName: client.ObjectKeyFromObject(s)}); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	var got stigmerv1.Stigmer
	if err := k8s.Get(context.Background(), client.ObjectKeyFromObject(s), &got); err != nil {
		t.Fatal(err)
	}
	return &got
}

func componentStatus(st *stigmerv1.Stigmer, name string) *stigmerv1.ComponentStatus {
	for i := range st.Status.Components {
		if st.Status.Components[i].Name == name {
			return &st.Status.Components[i]
		}
	}
	return nil
}

func deleteStigmersElsewhere(t *testing.T) {
	t.Helper()
	var all stigmerv1.StigmerList
	if err := k8s.List(context.Background(), &all); err != nil {
		t.Fatal(err)
	}
	for i := range all.Items {
		_ = k8s.Delete(context.Background(), &all.Items[i])
	}
}

func TestKeysAreMintedOnceAndOutliveTheStigmer(t *testing.T) {
	deleteStigmersElsewhere(t)
	ns := namespace(t)
	ctx := context.Background()
	s := stigmer(ns, "stigmer")
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{component.Keys{}}}
	got := reconcileOnce(t, r, s)
	if c := componentStatus(got, "keys"); c == nil || c.Phase != stigmerv1.PhaseReady || !strings.Contains(c.Message, "keep a copy outside the cluster") {
		t.Fatalf("keys: %+v", c)
	}
	var secret corev1.Secret
	key := client.ObjectKey{Namespace: ns, Name: "stigmer-keys"}
	if err := k8s.Get(ctx, key, &secret); err != nil {
		t.Fatal(err)
	}
	if len(secret.OwnerReferences) != 0 {
		t.Errorf("the keys Secret is owned (%v); it must outlive the Stigmer", secret.OwnerReferences)
	}
	if secret.Labels[render.ManagedByLabel] != render.ManagedByValue {
		t.Error("the keys Secret is not labelled as the operator's")
	}
	first := secret.DeepCopy()

	reconcileOnce(t, r, s)
	if err := k8s.Get(ctx, key, &secret); err != nil {
		t.Fatal(err)
	}
	for _, k := range component.KeyNames {
		if string(secret.Data[k]) != string(first.Data[k]) {
			t.Errorf("%s was rewritten", k)
		}
	}

	delete(secret.Data, render.RunnerTokenKey)
	if err := k8s.Update(ctx, &secret); err != nil {
		t.Fatal(err)
	}
	reconcileOnce(t, r, s)
	if err := k8s.Get(ctx, key, &secret); err != nil {
		t.Fatal(err)
	}
	if len(secret.Data[render.RunnerTokenKey]) == 0 || string(secret.Data[render.EncryptionKey]) != string(first.Data[render.EncryptionKey]) {
		t.Error("a missing key was not added alone")
	}

	secret.Data[render.EncryptionKey] = []byte("broken")
	if err := k8s.Update(ctx, &secret); err != nil {
		t.Fatal(err)
	}
	got = reconcileOnce(t, r, s)
	if c := componentStatus(got, "keys"); c.Phase != stigmerv1.PhaseRefused || !strings.Contains(c.Message, "not canonical base64") {
		t.Errorf("a malformed key: %+v", c)
	}
	if err := k8s.Get(ctx, key, &secret); err != nil {
		t.Fatal(err)
	}
	if string(secret.Data[render.EncryptionKey]) != "broken" {
		t.Error("a malformed key was overwritten")
	}
	_ = k8s.Delete(ctx, s)
}

func TestABucketWaitsForItsCredentials(t *testing.T) {
	deleteStigmersElsewhere(t)
	ns := namespace(t)
	ctx := context.Background()
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{component.ObjectStore{}}}

	none := stigmer(ns, "volume")
	if err := k8s.Create(ctx, none); err != nil {
		t.Fatal(err)
	}
	if c := componentStatus(reconcileOnce(t, r, none), render.ComponentObjectStore); c == nil || c.Phase != stigmerv1.PhaseReady ||
		!strings.Contains(c.Message, "no bucket declared") {
		t.Fatalf("no bucket: %+v", c)
	}
	_ = k8s.Delete(ctx, none)

	s := stigmer(ns, "bucket")
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	c := componentStatus(reconcileOnce(t, r, s), render.ComponentObjectStore)
	if c == nil || c.Phase != stigmerv1.PhaseRefused || c.Reason != stigmerv1.ReasonSecretMissing || !strings.Contains(c.Message, "Secret bucket does not exist") {
		t.Fatalf("missing credentials: %+v", c)
	}
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "bucket"},
		Data: map[string][]byte{render.ObjectStoreAccessKeyID: []byte("id")}}
	if err := k8s.Create(ctx, secret); err != nil {
		t.Fatal(err)
	}
	if c := componentStatus(reconcileOnce(t, r, s), render.ComponentObjectStore); c == nil || !strings.Contains(c.Message, "has no key SECRET_ACCESS_KEY") {
		t.Fatalf("half the credentials: %+v", c)
	}
	secret.Data[render.ObjectStoreSecretAccessKey] = []byte("secret")
	if err := k8s.Update(ctx, secret); err != nil {
		t.Fatal(err)
	}
	if c := componentStatus(reconcileOnce(t, r, s), render.ComponentObjectStore); c == nil || c.Phase != stigmerv1.PhaseReady ||
		!strings.Contains(c.Message, "bucket acme") {
		t.Fatalf("credentials present: %+v", c)
	}
}

func TestComponentsWaitNamingTheirDependency(t *testing.T) {
	deleteStigmersElsewhere(t)
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	if err := k8s.Create(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	db := &fake{name: "database", res: component.Deploying(stigmerv1.ReasonDeploying, nil, "starting")}
	server := &fake{name: "server", deps: []string{"database"}, res: component.Ready("serving")}
	c := &counting{Client: k8s}
	r := &StigmerReconciler{Client: c, Reader: k8s, Components: []component.Component{db, server}}
	got := reconcileOnce(t, r, s)
	sc := componentStatus(got, "server")
	if server.calls != 0 || sc.Phase != stigmerv1.PhasePending || sc.Message != "waiting for database to be ready" {
		t.Errorf("server: %+v after %d calls", sc, server.calls)
	}
	cond := meta.FindStatusCondition(got.Status.Conditions, stigmerv1.ConditionReady)
	if got.Status.Phase != stigmerv1.PhaseDeploying || cond.Message != "database: starting (1 more not ready)" {
		t.Errorf("phase %s, Ready %q", got.Status.Phase, cond.Message)
	}
	if c.writes != 1 {
		t.Errorf("one pass wrote status %d times", c.writes)
	}
	reconcileOnce(t, r, s)
	if c.writes != 1 {
		t.Errorf("a pass that changed nothing wrote status (%d writes)", c.writes)
	}

	db.res = component.Ready("up")
	got = reconcileOnce(t, r, s)
	if got.Status.Phase != stigmerv1.PhaseReady || server.calls != 1 {
		t.Errorf("phase %s after the dependency became ready; server called %d times", got.Status.Phase, server.calls)
	}
	_ = k8s.Delete(context.Background(), s)
}

func TestASecondStigmerIsRefusedNamingTheFirst(t *testing.T) {
	deleteStigmersElsewhere(t)
	first, second := stigmer(namespace(t), "one"), stigmer(namespace(t), "two")
	if err := k8s.Create(context.Background(), first); err != nil {
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond) // creation timestamps have one-second resolution
	if err := k8s.Create(context.Background(), second); err != nil {
		t.Fatal(err)
	}
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{&fake{name: "x", res: component.Ready("ok")}}}
	got := reconcileOnce(t, r, second)
	cond := meta.FindStatusCondition(got.Status.Conditions, stigmerv1.ConditionReady)
	if got.Status.Phase != stigmerv1.PhaseRefused || cond.Reason != string(stigmerv1.ReasonAnotherStigmer) ||
		!strings.Contains(cond.Message, first.Namespace+"/one") {
		t.Errorf("phase %s, Ready %+v", got.Status.Phase, cond)
	}
	if got := reconcileOnce(t, r, first); got.Status.Phase != stigmerv1.PhaseReady {
		t.Errorf("the first Stigmer is %s", got.Status.Phase)
	}
	_ = k8s.Delete(context.Background(), first)
	_ = k8s.Delete(context.Background(), second)
}

func TestASizeThatCannotRunRefusesTheInstall(t *testing.T) {
	deleteStigmersElsewhere(t)
	s := stigmer(namespace(t), "stigmer")
	s.Spec.Runner.Resources = &corev1.ResourceRequirements{Limits: corev1.ResourceList{corev1.ResourceMemory: resource.MustParse("64Mi")}}
	if err := k8s.Create(context.Background(), s); err != nil {
		t.Fatal(err)
	}
	x := &fake{name: "x", res: component.Ready("ok")}
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{x}}
	got := reconcileOnce(t, r, s)
	cond := meta.FindStatusCondition(got.Status.Conditions, stigmerv1.ConditionReady)
	if got.Status.Phase != stigmerv1.PhaseRefused || !strings.Contains(cond.Message, "spec.runner.resources") || x.calls != 0 {
		t.Errorf("phase %s, Ready %+v, component called %d times", got.Status.Phase, cond, x.calls)
	}
	_ = k8s.Delete(context.Background(), s)
}

func stubCRD(group, plural, kind string, labels map[string]string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "apiextensions.k8s.io/v1",
		"kind":       "CustomResourceDefinition",
		"metadata":   map[string]any{"name": plural + "." + group},
		"spec": map[string]any{
			"group": group,
			"names": map[string]any{"plural": plural, "kind": kind, "singular": strings.ToLower(kind), "listKind": kind + "List"},
			"scope": "Namespaced",
			"versions": []any{map[string]any{
				"name": "v1", "served": true, "storage": true,
				"schema": map[string]any{"openAPIV3Schema": map[string]any{"type": "object", "x-kubernetes-preserve-unknown-fields": true}},
			}},
		},
	}}
	if labels != nil {
		u.SetLabels(labels)
	}
	return u
}

func TestPrerequisites(t *testing.T) {
	ctx := context.Background()
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	s.UID = types.UID("u")
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}

	release := func(group string) func() ([]*unstructured.Unstructured, error) {
		return func() ([]*unstructured.Unstructured, error) {
			deploy := &unstructured.Unstructured{Object: map[string]any{
				"apiVersion": "apps/v1", "kind": "Deployment",
				"metadata": map[string]any{"name": "controller", "namespace": ns},
				"spec": map[string]any{
					"selector": map[string]any{"matchLabels": map[string]any{"app": "c"}},
					"template": map[string]any{
						"metadata": map[string]any{"labels": map[string]any{"app": "c"}},
						"spec":     map[string]any{"containers": []any{map[string]any{"name": "c", "image": "c"}}},
					},
				},
			}}
			return []*unstructured.Unstructured{deploy, stubCRD(group, "widgets", "Widget", nil)}, nil
		}
	}
	p := func(group string, mode stigmerv1.PrerequisiteMode) component.Prerequisite {
		return component.Prerequisite{
			Name: "Widgets", CRD: "widgets." + group, Mode: mode, ModeField: "spec.prerequisites.widgets",
			Controller: client.ObjectKey{Namespace: ns, Name: "controller"}, Manifests: release(group),
		}
	}

	ready, res, err := component.EnsurePrerequisite(ctx, env, p("absent.example.com", stigmerv1.PrerequisiteSkip))
	if err != nil || ready || res.Phase != stigmerv1.PhaseRefused || !strings.Contains(res.Message, "is skip, but Widgets is not installed") {
		t.Errorf("skip with nothing installed: %v %+v %v", ready, res, err)
	}

	ready, res, err = component.EnsurePrerequisite(ctx, env, p("ours.example.com", stigmerv1.PrerequisiteAuto))
	if err != nil || ready || res.Reason != stigmerv1.ReasonInstallingPrerequisite {
		t.Fatalf("absent: %v %+v %v", ready, res, err)
	}
	crd := &unstructured.Unstructured{}
	crd.SetGroupVersionKind(stubCRD("", "", "", nil).GroupVersionKind())
	if err := k8s.Get(ctx, client.ObjectKey{Name: "widgets.ours.example.com"}, crd); err != nil {
		t.Fatalf("the definition was not installed: %v", err)
	}
	if crd.GetLabels()[render.ManagedByLabel] != render.ManagedByValue {
		t.Error("the install is not labelled as the operator's")
	}
	ready, res, _ = component.EnsurePrerequisite(ctx, env, p("ours.example.com", stigmerv1.PrerequisiteAuto))
	if ready || !strings.Contains(res.Message, "waiting for Widgets's controller") {
		t.Errorf("ours, controller not ready: %v %+v", ready, res)
	}
	var d appsv1.Deployment
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: "controller"}, &d); err != nil {
		t.Fatal(err)
	}
	d.Status.Replicas, d.Status.AvailableReplicas, d.Status.ReadyReplicas = 1, 1, 1
	if err := k8s.Status().Update(ctx, &d); err != nil {
		t.Fatal(err)
	}
	if ready, res, _ = component.EnsurePrerequisite(ctx, env, p("ours.example.com", stigmerv1.PrerequisiteAuto)); !ready {
		t.Errorf("ours, controller ready: %+v", res)
	}

	if err := k8s.Create(ctx, stubCRD("theirs.example.com", "widgets", "Widget", map[string]string{render.ManagedByLabel: "Helm"})); err != nil {
		t.Fatal(err)
	}
	if ready, res, _ = component.EnsurePrerequisite(ctx, env, p("theirs.example.com", stigmerv1.PrerequisiteAuto)); !ready {
		t.Errorf("someone else's install was not trusted: %+v", res)
	}
}
