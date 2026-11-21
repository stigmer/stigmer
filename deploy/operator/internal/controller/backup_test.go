// Pins the database's backup arm against a real API server, with
// CloudNativePG's and cert-manager's definitions stubbed and no controllers
// running:
//
//   - a bucket declared on a cluster without cert-manager refuses the
//     database in words naming cert-manager, and creates no Cluster;
//   - with cert-manager there, the operator installs the backup plugin and
//     holds the new database until the plugin serves, so no Cluster exists
//     that names a plugin nobody answers for;
//   - once the plugin serves, the ObjectStore and its settings are applied
//     and the Cluster is created archiving under its own name;
//   - a recoverFrom declared on a running install changes nothing about the
//     Cluster's bootstrap, and the Ready sentence says it was not restored.

package controller

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/component"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

func createIgnoringExisting(t *testing.T, obj client.Object) {
	t.Helper()
	if err := k8s.Create(context.Background(), obj); err != nil && !apierrors.IsAlreadyExists(err) {
		t.Fatal(err)
	}
}

func liveCluster(t *testing.T, ns string) *unstructured.Unstructured {
	t.Helper()
	u := &unstructured.Unstructured{}
	u.SetAPIVersion(render.CNPGAPIVersion)
	u.SetKind("Cluster")
	err := k8s.Get(context.Background(), client.ObjectKey{Namespace: ns, Name: "stigmer-postgres"}, u)
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func TestADatabaseWithABucketIsBornArchiving(t *testing.T) {
	deleteStigmersElsewhere(t)
	ctx := context.Background()
	ns := namespace(t)
	// CloudNativePG as someone else's install: trusted, never touched.
	for _, plural := range []string{"clusters", "databases", "backups", "scheduledbackups"} {
		kind := map[string]string{"clusters": "Cluster", "databases": "Database", "backups": "Backup", "scheduledbackups": "ScheduledBackup"}[plural]
		createIgnoringExisting(t, stubCRD("postgresql.cnpg.io", plural, kind, map[string]string{render.ManagedByLabel: "Helm"}))
	}
	createIgnoringExisting(t, &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: manifests.CloudNativePGNamespace}})
	createIgnoringExisting(t, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: "bucket"},
		Data: map[string][]byte{render.ObjectStoreAccessKeyID: []byte("id"), render.ObjectStoreSecretAccessKey: []byte("secret")}})

	s := stigmer(ns, "stigmer")
	s.Spec.ObjectStore = &stigmerv1.ObjectStoreSpec{S3: stigmerv1.S3Spec{
		Bucket: "acme", Endpoint: "http://minio.storage:9000", CredentialsSecret: corev1.LocalObjectReference{Name: "bucket"},
	}}
	if err := k8s.Create(ctx, s); err != nil {
		t.Fatal(err)
	}
	r := &StigmerReconciler{Client: k8s, Reader: k8s, Components: []component.Component{component.ObjectStore{}, component.Database{}}}

	db := componentStatus(reconcileOnce(t, r, s), render.ComponentDatabase)
	if db == nil || db.Phase != stigmerv1.PhaseRefused || db.Reason != stigmerv1.ReasonPrerequisiteMissing || !strings.Contains(db.Message, "need cert-manager") {
		t.Fatalf("without cert-manager: %+v", db)
	}
	if liveCluster(t, ns) != nil {
		t.Fatal("a Cluster was created that cannot back up")
	}

	createIgnoringExisting(t, stubCRD("cert-manager.io", "certificates", "Certificate", nil))
	createIgnoringExisting(t, stubCRD("cert-manager.io", "issuers", "Issuer", nil))
	db = componentStatus(reconcileOnce(t, r, s), render.ComponentDatabase)
	if db == nil || db.Phase != stigmerv1.PhasePending || db.Reason != stigmerv1.ReasonWaitingForBackupPlugin || !strings.Contains(db.Message, "first minute") {
		t.Fatalf("plugin installing: %+v", db)
	}
	if liveCluster(t, ns) != nil {
		t.Fatal("the Cluster was created before the plugin serves")
	}
	var plugin appsv1.Deployment
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: manifests.CloudNativePGNamespace, Name: render.BarmanPluginDeployment}, &plugin); err != nil {
		t.Fatalf("the plugin was not installed: %v", err)
	}
	plugin.Status.Replicas, plugin.Status.AvailableReplicas, plugin.Status.ReadyReplicas = 1, 1, 1
	if err := k8s.Status().Update(ctx, &plugin); err != nil {
		t.Fatal(err)
	}

	reconcileOnce(t, r, s)
	cluster := liveCluster(t, ns)
	if cluster == nil {
		t.Fatal("no Cluster once the plugin serves")
	}
	if got := render.LiveArchiveServerName(cluster); got != "stigmer-postgres" {
		t.Errorf("the database archives as %q", got)
	}
	store := &unstructured.Unstructured{}
	store.SetAPIVersion(render.BarmanAPIVersion)
	store.SetKind("ObjectStore")
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.BackupObjectStore(s)}, store); err != nil {
		t.Fatalf("no ObjectStore: %v", err)
	}

	// Bring the database up by hand, as CloudNativePG would, then declare a
	// restore on the running install.
	cluster.Object["status"] = map[string]any{
		"readyInstances": int64(1),
		"conditions":     []any{map[string]any{"type": "Ready", "status": "True"}},
		"pluginStatus":   []any{map[string]any{"name": render.BarmanPluginName}},
	}
	if err := k8s.Update(ctx, cluster); err != nil {
		t.Fatal(err)
	}
	for _, d := range render.TemporalDatabaseObjects(s) {
		live := &unstructured.Unstructured{}
		live.SetGroupVersionKind(d.GroupVersionKind())
		if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: d.GetName()}, live); err != nil {
			t.Fatal(err)
		}
		live.Object["status"] = map[string]any{"applied": true}
		if err := k8s.Update(ctx, live); err != nil {
			t.Fatal(err)
		}
	}
	createIgnoringExisting(t, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: render.PostgresAppSecret(s)},
		Data: map[string][]byte{"password": []byte("p")}})

	var current stigmerv1.Stigmer
	if err := k8s.Get(ctx, client.ObjectKeyFromObject(s), &current); err != nil {
		t.Fatal(err)
	}
	current.Spec.Database = &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{Bundled: &stigmerv1.BundledPostgreSQLSpec{
		RecoverFrom: &stigmerv1.RecoverFromSpec{ServerName: "elsewhere"},
	}}}
	if err := k8s.Update(ctx, &current); err != nil {
		t.Fatal(err)
	}
	got := reconcileOnce(t, r, &current)
	db = componentStatus(got, render.ComponentDatabase)
	if db == nil || db.Phase != stigmerv1.PhaseReady || !strings.Contains(db.Message, "honoured only when the database is created") {
		t.Fatalf("recoverFrom on a running install: %+v", db)
	}
	if render.LiveRestoredFrom(liveCluster(t, ns)) != "" {
		t.Error("a running database was given a recovery bootstrap")
	}
	if got.Status.Backup == nil || got.Status.Backup.ServerName != "stigmer-postgres" {
		t.Errorf("status.backup %+v", got.Status.Backup)
	}
	sb := &unstructured.Unstructured{}
	sb.SetAPIVersion(render.CNPGAPIVersion)
	sb.SetKind("ScheduledBackup")
	if err := k8s.Get(ctx, client.ObjectKey{Namespace: ns, Name: render.ScheduledBackupName(s)}, sb); err != nil {
		t.Errorf("no schedule once the plugin is loaded: %v", err)
	}
	_ = k8s.Delete(ctx, &current)
}
