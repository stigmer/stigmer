// The server's upgrade gate: a backup of the database before the server
// moves to a new version.
//
// The server migrates its database forward when it boots and cannot go
// back; a database ahead of a server is refused by that server, which names
// the restore. So when this operator runs a newer Stigmer than the running
// server (operator vX runs Stigmer vX, and `helm upgrade` of the operator is
// the upgrade), and the database backs up to a bucket, the server is not
// rolled until an on-demand backup of the database has completed. A backup
// that fails holds the upgrade, in the plugin's words; the annotation
// `stigmer.ai/upgrade-without-backup` set to the new version lets that one
// upgrade go ahead without it. Without a bucket the upgrade proceeds, and
// the server's Ready sentence says no backup was taken.
//
// The operator keeps no state of its own: the version the server runs is
// read off its Deployment, and what the last upgrade did is written onto the
// Deployment as two annotations, which the Ready sentence reads back.

package component

import (
	"context"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

// UpgradeWithoutBackupAnnotation, set on the Stigmer to the version being
// upgraded to, lets that one upgrade proceed without the backup it waits for.
const UpgradeWithoutBackupAnnotation = "stigmer.ai/upgrade-without-backup"

// The Deployment's record of the last upgrade.
const (
	upgradedFromAnnotation  = "stigmer.ai/upgraded-from"
	upgradeBackupAnnotation = "stigmer.ai/upgrade-backup"
	noBackup                = "none"
)

// upgradeGate is what the server component does about the version change.
type upgradeGate struct {
	// hold, when set, is the Result the server reports instead of rolling.
	hold *Result
	// annotations go on the Deployment.
	annotations map[string]string
}

// gateUpgrade decides whether the server may roll to this operator's
// version, taking the backup first when the database backs up.
func gateUpgrade(ctx context.Context, env *Env, live *appsv1.Deployment) (upgradeGate, error) {
	st := env.Stigmer
	kept := map[string]string{}
	if live != nil {
		for _, k := range []string{upgradedFromAnnotation, upgradeBackupAnnotation} {
			if v, ok := live.Annotations[k]; ok {
				kept[k] = v
			}
		}
	}
	from := runningVersion(live)
	to := version.Stigmer
	if from == "" || from == to {
		return upgradeGate{annotations: kept}, nil
	}
	if !render.BackupsOn(st) {
		return upgradeGate{annotations: map[string]string{upgradedFromAnnotation: from, upgradeBackupAnnotation: noBackup}}, nil
	}
	if st.Annotations[UpgradeWithoutBackupAnnotation] == to {
		return upgradeGate{annotations: map[string]string{upgradedFromAnnotation: from, upgradeBackupAnnotation: noBackup}}, nil
	}

	backup := render.UpgradeBackupObject(st, to)
	name := backup.GetName()
	existing := &unstructured.Unstructured{}
	existing.SetGroupVersionKind(backup.GroupVersionKind())
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: name}, existing)
	switch {
	case apierrors.IsNotFound(err):
		// A Backup's spec cannot change once it exists, so it is created
		// once and only read after.
		if err := Apply(ctx, env, backup); err != nil {
			return upgradeGate{}, err
		}
		existing = nil
	case err != nil:
		return upgradeGate{}, fmt.Errorf("reading Backup %s: %w", name, err)
	}
	backupRef := Ref("Backup", st.Namespace, name)
	phase := ""
	if existing != nil {
		phase, _, _ = unstructured.NestedString(existing.Object, "status", "phase")
	}
	switch phase {
	case "completed":
		return upgradeGate{annotations: map[string]string{upgradedFromAnnotation: from, upgradeBackupAnnotation: name}}, nil
	case "failed":
		why, _, _ := unstructured.NestedString(existing.Object, "status", "error")
		if why == "" {
			why = "the backup plugin gave no reason"
		}
		res := Deploying(stigmerv1.ReasonUpgradeBackupFailed, backupRef,
			fmt.Sprintf("the upgrade from %s to %s is held: backup %s failed (%s). Fix the cause and delete Backup %s to take it again, or upgrade without one: kubectl -n %s annotate stigmer %s %s=%s",
				from, to, name, strings.TrimSpace(why), name, st.Namespace, st.Name, UpgradeWithoutBackupAnnotation, to))
		return upgradeGate{hold: &res, annotations: kept}, nil
	default:
		res := Deploying(stigmerv1.ReasonBackingUpBeforeUpgrade, backupRef,
			fmt.Sprintf("upgrading %s to %s: taking backup %s first, since the server migrates its database forward and cannot go back", from, to, name))
		return upgradeGate{hold: &res, annotations: kept}, nil
	}
}

// runningVersion is the version the live server Deployment runs, read off
// its server container's image tag; "" before the first rollout.
func runningVersion(live *appsv1.Deployment) string {
	if live == nil {
		return ""
	}
	for _, c := range live.Spec.Template.Spec.Containers {
		if c.Name != render.ServerContainer {
			continue
		}
		if i := strings.LastIndex(c.Image, ":"); i >= 0 && !strings.Contains(c.Image[i:], "/") {
			return c.Image[i+1:]
		}
	}
	return ""
}

// upgradeSentence is what the Ready sentence says about the last upgrade.
func upgradeSentence(annotations map[string]string) string {
	from, ok := annotations[upgradedFromAnnotation]
	if !ok {
		return ""
	}
	if b := annotations[upgradeBackupAnnotation]; b != "" && b != noBackup {
		return fmt.Sprintf("; upgraded from %s after backup %s", from, b)
	}
	return fmt.Sprintf("; upgraded from %s without a backup: declare spec.objectStore to have one taken before every upgrade", from)
}
