// Pins the server's upgrade gate (component/upgrade.go) against a real API
// server, the server's dependencies faked Ready and no CloudNativePG
// running:
//
//   - with backups on, a server running an older version is not rolled: a
//     Backup named for the new version is created and the server waits on
//     it, saying which versions and why;
//   - a completed backup lets the server roll, and the Deployment records
//     what the upgrade did;
//   - a failed backup holds the upgrade in the plugin's words, and the
//     escape annotation for that version lets it through without one;
//   - without a bucket the server rolls at once and records that no backup
//     was taken;
//   - a server already at this version is never gated;
//   - a Job whose template changed (Temporal's schema step at a new
//     version) is created again rather than refused.

package controller

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

// serverAt creates the server's Deployment as an earlier operator left it.
func serverAt(t *testing.T, st *stigmerv1.Stigmer, tag string) {
	t.Helper()
	old := version.Stigmer
	version.Stigmer = tag
	d := render.ServerDeploymentObject(st, nil)
	version.Stigmer = old
	if err := k8s.Create(context.Background(), d); err != nil {
		t.Fatal(err)
	}
}

func liveServer(t *testing.T, st *stigmerv1.Stigmer) *appsv1.Deployment {
	t.Helper()
	var d appsv1.Deployment
	if err := k8s.Get(context.Background(), client.ObjectKey{Namespace: st.Namespace, Name: render.ServerDeployment(st)}, &d); err != nil {
		t.Fatal(err)
	}
	return &d
}

func serverImageTag(d *appsv1.Deployment) string {
	image := d.Spec.Template.Spec.Containers[0].Image
	return image[strings.LastIndex(image, ":")+1:]
}

func setBackupPhase(t *testing.T, ns, name, phase, why string) {
	t.Helper()
	b := &unstructured.Unstructured{}
	b.SetAPIVersion(render.CNPGAPIVersion)
	b.SetKind("Backup")
	if err := k8s.Get(context.Background(), client.ObjectKey{Namespace: ns, Name: name}, b); err != nil {
		t.Fatalf("Backup %s: %v", name, err)
	}
	b.Object["status"] = map[string]any{"phase": phase, "error": why}
	if err := k8s.Update(context.Background(), b); err != nil {
		t.Fatal(err)
	}
}

func upgradeReconciler() *StigmerReconciler {
	deps := []component.Component{}
	for _, name := range []string{render.ComponentKeys, render.ComponentObjectStore, render.ComponentDatabase, render.ComponentTemporal, render.ComponentSandboxes} {
		deps = append(deps, &fake{name: name, res: component.Ready("ok")})
	}
	return &StigmerReconciler{Client: k8s, Reader: k8s, Components: append(deps, component.Server{})}
}

func TestAnUpgradeWaitsForABackupOfTheDatabase(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	createIgnoringExisting(t, stubCRD("postgresql.cnpg.io", "backups", "Backup", map[string]string{render.ManagedByLabel: "Helm"}))
	old := version.Stigmer
	version.Stigmer = "v2"
	t.Cleanup(func() { version.Stigmer = old })

	s := stigmer(ns, "stigmer")
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	serverAt(t, s, "v1")
	r := upgradeReconciler()

	got := reconcileOnce(t, r, s)
	server := componentStatus(got, render.ComponentServer)
	if server == nil || server.Reason != stigmerv1.ReasonBackingUpBeforeUpgrade || !strings.Contains(server.Message, "upgrading v1 to v2") {
		t.Fatalf("waiting on the backup: %+v", server)
	}
	if tag := serverImageTag(liveServer(t, s)); tag != "v1" {
		t.Fatalf("the server rolled to %s before its backup", tag)
	}
	name := render.UpgradeBackupName(s, "v2")

	setBackupPhase(t, ns, name, "failed", "can't reach the bucket")
	server = componentStatus(reconcileOnce(t, r, s), render.ComponentServer)
	if server == nil || server.Reason != stigmerv1.ReasonUpgradeBackupFailed ||
		!strings.Contains(server.Message, "can't reach the bucket") || !strings.Contains(server.Message, component.UpgradeWithoutBackupAnnotation+"=v2") {
		t.Fatalf("a failed backup: %+v", server)
	}
	if tag := serverImageTag(liveServer(t, s)); tag != "v1" {
		t.Fatalf("the server rolled to %s past a failed backup", tag)
	}

	setBackupPhase(t, ns, name, "completed", "")
	server = componentStatus(reconcileOnce(t, r, s), render.ComponentServer)
	d := liveServer(t, s)
	if tag := serverImageTag(d); tag != "v2" {
		t.Fatalf("the server did not roll after its backup: %s (%+v)", tag, server)
	}
	if d.Annotations["stigmer.ai/upgraded-from"] != "v1" || d.Annotations["stigmer.ai/upgrade-backup"] != name {
		t.Errorf("the Deployment does not record the upgrade: %v", d.Annotations)
	}
	reconcileOnce(t, r, s)
	if d := liveServer(t, s); d.Annotations["stigmer.ai/upgraded-from"] != "v1" {
		t.Errorf("a later pass dropped the upgrade's record: %v", d.Annotations)
	}
	_ = k8s.Delete(ctx, s)
}

func TestAnUpgradeEscapesAFailedBackupOnlyForTheNamedVersion(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	createIgnoringExisting(t, stubCRD("postgresql.cnpg.io", "backups", "Backup", map[string]string{render.ManagedByLabel: "Helm"}))
	old := version.Stigmer
	version.Stigmer = "v3"
	t.Cleanup(func() { version.Stigmer = old })

	s := stigmer(ns, "stigmer")
	s.Annotations = map[string]string{component.UpgradeWithoutBackupAnnotation: "v9"}
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{Bucket: "acme", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"}}}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	serverAt(t, s, "v2")
	r := upgradeReconciler()
	if server := componentStatus(reconcileOnce(t, r, s), render.ComponentServer); server.Reason != stigmerv1.ReasonBackingUpBeforeUpgrade {
		t.Fatalf("an escape for another version let the upgrade through: %+v", server)
	}
	var current stigmerv1.Stigmer
	if err := k8s.Get(ctx, client.ObjectKeyFromObject(s), &current); err != nil {
		t.Fatal(err)
	}
	current.Annotations[component.UpgradeWithoutBackupAnnotation] = "v3"
	if err := k8s.Update(ctx, &current); err != nil {
		t.Fatal(err)
	}
	reconcileOnce(t, r, &current)
	d := liveServer(t, s)
	if serverImageTag(d) != "v3" || d.Annotations["stigmer.ai/upgrade-backup"] != "none" {
		t.Errorf("the escape for this version did not let it through: %s %v", serverImageTag(d), d.Annotations)
	}
	_ = k8s.Delete(ctx, &current)
}

func TestAnUpgradeWithoutABucketTakesNoBackupAndSaysSo(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	old := version.Stigmer
	version.Stigmer = "v2"
	t.Cleanup(func() { version.Stigmer = old })

	s := stigmer(ns, "stigmer")
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	serverAt(t, s, "v1")
	r := upgradeReconciler()
	reconcileOnce(t, r, s)
	d := liveServer(t, s)
	if serverImageTag(d) != "v2" || d.Annotations["stigmer.ai/upgrade-backup"] != "none" {
		t.Fatalf("without a bucket: %s %v", serverImageTag(d), d.Annotations)
	}
	var backups unstructured.UnstructuredList
	backups.SetAPIVersion(render.CNPGAPIVersion)
	backups.SetKind("BackupList")
	if err := k8s.List(ctx, &backups, client.InNamespace(ns)); err == nil && len(backups.Items) > 0 {
		t.Errorf("a backup was taken without a bucket: %d", len(backups.Items))
	}

	// Already at this version: never gated, the record kept.
	reconcileOnce(t, r, s)
	if d := liveServer(t, s); d.Annotations["stigmer.ai/upgraded-from"] != "v1" {
		t.Errorf("the record of the last upgrade was lost: %v", d.Annotations)
	}
	_ = k8s.Delete(ctx, s)
}

// A Job's template cannot change once created, and Temporal's schema Job
// is applied again with a new image when an operator release moves
// Temporal: the apply deletes the old Job and creates the new one, so the
// schema step runs at the new version before the services roll.
func TestAJobWhoseTemplateChangedIsCreatedAgain(t *testing.T) {
	ctx := context.Background()
	ns := namespace(t)
	s := stigmer(ns, "stigmer")
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	env := &component.Env{Client: k8s, Reader: k8s, Stigmer: s}
	job := func(image string) *batchv1.Job {
		return &batchv1.Job{
			TypeMeta:   metav1.TypeMeta{APIVersion: "batch/v1", Kind: "Job"},
			ObjectMeta: metav1.ObjectMeta{Name: "schema", Namespace: ns},
			Spec: batchv1.JobSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
				RestartPolicy: corev1.RestartPolicyNever,
				Containers:    []corev1.Container{{Name: "schema", Image: image}},
			}}},
		}
	}
	if err := component.Apply(ctx, env, job("temporalio/admin-tools:1.32.2")); err != nil {
		t.Fatal(err)
	}
	var first batchv1.Job
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: "schema"}, &first); err != nil {
		t.Fatal(err)
	}
	if err := component.Apply(ctx, env, job("temporalio/admin-tools:1.33.0")); err != nil {
		t.Fatalf("a Job whose template changed was not applied: %v", err)
	}
	var second batchv1.Job
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: "schema"}, &second); err != nil {
		t.Fatal(err)
	}
	if second.Spec.Template.Spec.Containers[0].Image != "temporalio/admin-tools:1.33.0" {
		t.Errorf("the Job runs %s", second.Spec.Template.Spec.Containers[0].Image)
	}
	_ = k8s.Delete(ctx, s)
}
