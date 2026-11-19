// The database component's backup arm: the Barman Cloud plugin installed
// through the same gate as every cluster-level operator, cert-manager
// required and never installed, and the plugin's standing read back into
// status.backup and the BackupHealthy condition.
//
// Two orderings are load-bearing. A Cluster never names the plugin before
// the plugin serves: CloudNativePG parks a Cluster that names a plugin it
// cannot reach with no instances at all, so a new database waits for the
// plugin and is born archiving rather than restarted to attach it. And a
// failing backup never takes the install out of Ready: the install still
// serves; its safety net does not, and BackupHealthy and the Backup column
// say so where a platform engineer reads first.

package component

import (
	"context"
	"fmt"
	"time"

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

// cert-manager's release the refusal points at, the one the install tests run.
const certManagerRelease = "https://github.com/cert-manager/cert-manager/releases/download/v1.21.3/cert-manager.yaml"

// The BackupHealthy condition's reasons.
const (
	backupReasonArchiving     = "Archiving"
	backupReasonFirstPending  = "FirstBackupPending"
	backupReasonArchiveFailed = "ArchivingFailed"
	backupReasonBackupFailed  = "BackupFailed"
)

var (
	objectStoreKind = schema.GroupVersionKind{Group: "barmancloud.cnpg.io", Version: "v1", Kind: "ObjectStore"}
	backupListKind  = schema.GroupVersionKind{Group: "postgresql.cnpg.io", Version: "v1", Kind: "BackupList"}
)

// BarmanCloudPlugin is the backup plugin's prerequisite.
func BarmanCloudPlugin(st *stigmerv1.Stigmer) Prerequisite {
	mode := st.Spec.Prerequisites.PostgresBackupPlugin
	if mode == "" {
		mode = stigmerv1.PrerequisiteAuto
	}
	return Prerequisite{
		Name:              "the Barman Cloud backup plugin",
		CRD:               render.BarmanObjectStoreCRD,
		Controller:        client.ObjectKey{Namespace: manifests.CloudNativePGNamespace, Name: render.BarmanPluginDeployment},
		Mode:              mode,
		ModeField:         "spec.prerequisites.postgresBackupPlugin",
		Manifests:         manifests.BarmanCloudPlugin,
		ReapplyUntilReady: true,
	}
}

// ensureBackupPlugin reports whether the plugin serves, and when it does
// not, why: cert-manager missing (refused, in words), or the plugin still
// installing.
func ensureBackupPlugin(ctx context.Context, env *Env) (bool, Result, error) {
	p := BarmanCloudPlugin(env.Stigmer)
	if p.Mode != stigmerv1.PrerequisiteSkip {
		for _, crd := range render.CertManagerCRDs {
			present, err := crdPresent(ctx, env, crd)
			if err != nil {
				return false, Result{}, err
			}
			if !present {
				return false, Refused(stigmerv1.ReasonPrerequisiteMissing, Ref("CustomResourceDefinition", "", crd),
					fmt.Sprintf("backups to the bucket need cert-manager, and this cluster has none (no definition %s): install it (kubectl apply -f %s), and the database starts archiving; the operator never installs cert-manager itself", crd, certManagerRelease)), nil
			}
		}
	}
	return EnsurePrerequisite(ctx, env, p)
}

func crdPresent(ctx context.Context, env *Env, name string) (bool, error) {
	crd := &metav1.PartialObjectMetadata{}
	crd.SetGroupVersionKind(crdKind)
	err := env.Reader.Get(ctx, client.ObjectKey{Name: name}, crd)
	if apierrors.IsNotFound(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("looking for definition %s: %w", name, err)
	}
	return true, nil
}

// keepLiveBootstrap holds a Cluster's creation-time fields as they are: how
// it was bootstrapped and the archive it was restored from cannot change
// once it exists, so a declaration that changes them later is not applied
// to it.
func keepLiveBootstrap(desired, live *unstructured.Unstructured) {
	for _, field := range []string{"bootstrap", "externalClusters"} {
		value, found, _ := unstructured.NestedFieldCopy(live.Object, "spec", field)
		if found {
			_ = unstructured.SetNestedField(desired.Object, value, "spec", field)
		} else {
			unstructured.RemoveNestedField(desired.Object, "spec", field)
		}
	}
}

// clusterReportsPlugin reports whether CloudNativePG has loaded the plugin
// for this Cluster, the moment a schedule naming it can work.
func clusterReportsPlugin(live *unstructured.Unstructured) bool {
	plugins, _, _ := unstructured.NestedSlice(live.Object, "status", "pluginStatus")
	for _, p := range plugins {
		if m, ok := p.(map[string]any); ok && m["name"] == render.BarmanPluginName {
			return true
		}
	}
	return false
}

// recordBackupStatus writes status.backup and BackupHealthy from the plugin's
// and CloudNativePG's own reports; with backups off it clears both.
func recordBackupStatus(ctx context.Context, env *Env, live *unstructured.Unstructured) {
	st := env.Stigmer
	if !render.BackupsOn(st) || live == nil {
		st.Status.Backup = nil
		meta.RemoveStatusCondition(&st.Status.Conditions, stigmerv1.ConditionBackupHealthy)
		return
	}
	server := render.LiveArchiveServerName(live)
	b := &stigmerv1.BackupStatus{ServerName: server, RestoredFrom: render.LiveRestoredFrom(live)}
	var lastFailed *metav1.Time
	store := &unstructured.Unstructured{}
	store.SetGroupVersionKind(objectStoreKind)
	if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: render.BackupObjectStore(st)}, store); err == nil && server != "" {
		window, _, _ := unstructured.NestedMap(store.Object, "status", "serverRecoveryWindow", server)
		b.FirstRecoverabilityPoint = timeOf(window["firstRecoverabilityPoint"])
		b.LastSuccessfulBackup = timeOf(window["lastSuccessfulBackupTime"])
		lastFailed = timeOf(window["lastFailedBackupTime"])
	}

	archiving, archivingMessage := conditionOf(live, "ContinuousArchiving")
	condition := metav1.Condition{Type: stigmerv1.ConditionBackupHealthy, ObservedGeneration: st.Generation}
	bucket := render.ObjectStore(st).Bucket
	switch {
	case archiving == metav1.ConditionFalse:
		b.LastFailure = "archiving to the bucket fails: " + archivingMessage
		condition.Status, condition.Reason = metav1.ConditionFalse, backupReasonArchiveFailed
		condition.Message = fmt.Sprintf("the database cannot archive to bucket %s: %s", bucket, archivingMessage)
	case lastFailed != nil && (b.LastSuccessfulBackup == nil || lastFailed.After(b.LastSuccessfulBackup.Time)):
		b.LastFailure = fmt.Sprintf("the full backup at %s failed%s", lastFailed.UTC().Format(time.RFC3339), lastBackupError(ctx, env))
		condition.Status, condition.Reason = metav1.ConditionFalse, backupReasonBackupFailed
		condition.Message = b.LastFailure
	case b.LastSuccessfulBackup == nil:
		condition.Status, condition.Reason = metav1.ConditionFalse, backupReasonFirstPending
		condition.Message = fmt.Sprintf("archiving to bucket %s; taking the first full backup", bucket)
	default:
		condition.Status, condition.Reason = metav1.ConditionTrue, backupReasonArchiving
		condition.Message = fmt.Sprintf("archiving to bucket %s as %s; restorable from %s; last full backup %s",
			bucket, server, formatTime(b.FirstRecoverabilityPoint), formatTime(b.LastSuccessfulBackup))
	}
	st.Status.Backup = b
	meta.SetStatusCondition(&st.Status.Conditions, condition)
}

// lastBackupError is the newest failed Backup's own error, as ": <error>",
// or "" when there is none to read.
func lastBackupError(ctx context.Context, env *Env) string {
	list := &unstructured.UnstructuredList{}
	list.SetGroupVersionKind(backupListKind)
	if err := env.Reader.List(ctx, list, client.InNamespace(env.Stigmer.Namespace)); err != nil {
		return ""
	}
	cluster := render.PostgresCluster(env.Stigmer)
	var newest *unstructured.Unstructured
	for i := range list.Items {
		item := &list.Items[i]
		name, _, _ := unstructured.NestedString(item.Object, "spec", "cluster", "name")
		phase, _, _ := unstructured.NestedString(item.Object, "status", "phase")
		if name != cluster || phase != "failed" {
			continue
		}
		if newest == nil || item.GetCreationTimestamp().After(newest.GetCreationTimestamp().Time) {
			newest = item
		}
	}
	if newest == nil {
		return ""
	}
	if msg, _, _ := unstructured.NestedString(newest.Object, "status", "error"); msg != "" {
		return ": " + msg
	}
	return ""
}

// conditionOf reads one condition's status and message off an object.
func conditionOf(u *unstructured.Unstructured, condition string) (metav1.ConditionStatus, string) {
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		m, ok := c.(map[string]any)
		if !ok || m["type"] != condition {
			continue
		}
		status, _ := m["status"].(string)
		message, _ := m["message"].(string)
		return metav1.ConditionStatus(status), message
	}
	return metav1.ConditionUnknown, ""
}

func timeOf(v any) *metav1.Time {
	s, ok := v.(string)
	if !ok || s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	mt := metav1.NewTime(t)
	return &mt
}

func formatTime(t *metav1.Time) string {
	if t == nil {
		return "not yet"
	}
	return t.UTC().Format(time.RFC3339)
}
