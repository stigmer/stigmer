// The database component: the bundled Postgres through CloudNativePG, or the
// adopter's own.
//
// Bundled: CloudNativePG is installed if missing; with a bucket declared,
// its backup plugin too (backup.go), before the Cluster, so the database is
// born archiving to the bucket and takes its first full backup at once; and
// a database declared to recover from an archive is created from it. Then
// one Cluster on
// Compose's Postgres release with the server's database owned by its own
// role, a managed temporal role whose password the operator mints, and
// Temporal's two databases owned by it. Ready means every declared instance
// is ready, CloudNativePG reports the Cluster ready, both databases exist,
// and the server's password Secret is there. While it is not, the reason is
// the pods' own (a claim, an image, memory) or CloudNativePG's phase in its
// words. External: the password's Secret and key must exist; the operator
// cannot see further into a Postgres it does not run, so the server's own
// boot reports a wrong password or an unreachable host.

package component

import (
	"context"
	"fmt"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"sigs.k8s.io/controller-runtime/pkg/client"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// Database is the database component.
type Database struct{}

// Name implements Component.
func (Database) Name() string { return render.ComponentDatabase }

// Dependencies implements Component: the bucket's credentials are checked
// before the backups that read them.
func (Database) Dependencies() []string { return []string{render.ComponentObjectStore} }

// CloudNativePG is the bundled database's prerequisite.
func CloudNativePG(st *stigmerv1.Stigmer) Prerequisite {
	mode := st.Spec.Prerequisites.PostgresOperator
	if mode == "" {
		mode = stigmerv1.PrerequisiteAuto
	}
	return Prerequisite{
		Name:       "CloudNativePG",
		CRD:        render.CNPGClusterCRD,
		Controller: client.ObjectKey{Namespace: manifests.CloudNativePGNamespace, Name: "cnpg-controller-manager"},
		Mode:       mode,
		ModeField:  "spec.prerequisites.postgresOperator",
		Manifests:  manifests.CloudNativePG,
	}
}

// Reconcile implements Component.
func (Database) Reconcile(ctx context.Context, env *Env) (Result, error) {
	st := env.Stigmer
	db := render.Database(st)
	if !db.Bundled {
		ok, res, err := CheckSecretKeys(ctx, env, db.Password.Name, fmt.Sprintf("the password of Postgres role %s", db.User), db.Password.Key)
		if err != nil || !ok {
			return res, err
		}
		return Ready(fmt.Sprintf("using your Postgres at %s:%d, database %s as %s", db.Host, db.Port, db.Database, db.User)), nil
	}

	ready, res, err := EnsurePrerequisite(ctx, env, CloudNativePG(st))
	if err != nil || !ready {
		return res, err
	}
	if err := EnsureBasicAuthSecret(ctx, env, render.PostgresTemporalSecret(st), render.TemporalUser, render.ComponentDatabase); err != nil {
		return Result{}, err
	}
	if render.BundledIdentity(st) {
		if err := EnsureBasicAuthSecret(ctx, env, render.PostgresKeycloakSecret(st), render.KeycloakUser, render.ComponentDatabase); err != nil {
			return Result{}, err
		}
	}
	name := render.PostgresCluster(st)
	ref := Ref("Cluster", st.Namespace, name)
	existing, err := readCluster(ctx, env, name)
	if err != nil {
		return Result{}, err
	}
	backup := render.ClusterBackup{}
	if render.BackupsOn(st) {
		served, res, err := ensureBackupPlugin(ctx, env)
		if err != nil {
			return Result{}, err
		}
		if !served {
			if existing == nil && res.Phase != stigmerv1.PhaseRefused {
				return Pending(stigmerv1.ReasonWaitingForBackupPlugin, res.Object,
					res.Message+"; the database is created once the plugin serves, so it archives from its first minute"), nil
			}
			recordBackupStatus(ctx, env, existing)
			return res, nil
		}
		if err := Apply(ctx, env, render.BackupSettingsSecretObject(st), render.BackupObjectStoreObject(st)); err != nil {
			return Result{}, err
		}
		server := ""
		if existing != nil {
			server = render.LiveArchiveServerName(existing)
		}
		if server == "" {
			server = render.ArchiveServerName(st, time.Now())
		}
		backup = render.ClusterBackup{Archive: true, ServerName: server, Recover: existing == nil}
	}
	cluster := render.PostgresClusterObject(st, backup)
	attaching := false
	if existing != nil {
		keepLiveBootstrap(cluster, existing)
		attaching = backup.Archive && render.LiveArchiveServerName(existing) == ""
	}
	if err := Apply(ctx, env, cluster); err != nil {
		return Result{}, err
	}
	databases := render.TemporalDatabaseObjects(st)
	if render.BundledIdentity(st) {
		databases = append(databases, render.KeycloakDatabaseObject(st))
	}
	for _, d := range databases {
		if err := Apply(ctx, env, d); err != nil {
			return Result{}, err
		}
	}

	live, err := readCluster(ctx, env, name)
	if err != nil {
		return Result{}, err
	}
	if live == nil {
		return Deploying(stigmerv1.ReasonDeploying, ref, fmt.Sprintf("creating Postgres %s", name)), nil
	}
	recordBackupStatus(ctx, env, live)
	instances := render.BundledDatabase(st).Instances
	if instances == 0 {
		instances = 1
	}
	readyInstances, _, _ := unstructured.NestedInt64(live.Object, "status", "readyInstances")
	if readyInstances < int64(instances) || !conditionTrue(live, "Ready") {
		phase, _, _ := unstructured.NestedString(live.Object, "status", "phase")
		why, _, _ := unstructured.NestedString(live.Object, "status", "phaseReason")
		msg := fmt.Sprintf("Postgres %s: %d of %d instances ready", name, readyInstances, instances)
		if attaching {
			msg += "; attaching the backup plugin, so CloudNativePG restarts each instance"
		}
		if from := render.LiveRestoredFrom(live); from != "" && readyInstances == 0 {
			msg += fmt.Sprintf("; restoring from archive %s", from)
		}
		if phase != "" {
			msg += "; CloudNativePG says: " + phase
			if why != "" {
				msg += " (" + why + ")"
			}
		}
		return Explain(ctx, env, map[string]string{"cnpg.io/cluster": name}, nil,
			Deploying(stigmerv1.ReasonDeploying, ref, msg))
	}

	for _, d := range databases {
		liveDB := &unstructured.Unstructured{}
		liveDB.SetGroupVersionKind(d.GroupVersionKind())
		if err := env.Reader.Get(ctx, client.ObjectKey{Namespace: st.Namespace, Name: d.GetName()}, liveDB); err != nil {
			return Result{}, fmt.Errorf("reading Database %s: %w", d.GetName(), err)
		}
		applied, _, _ := unstructured.NestedBool(liveDB.Object, "status", "applied")
		if !applied {
			msg, _, _ := unstructured.NestedString(liveDB.Object, "status", "message")
			sentence := fmt.Sprintf("creating database %s", d.GetName())
			if msg != "" {
				sentence += ": CloudNativePG says: " + msg
			}
			return Deploying(stigmerv1.ReasonDeploying, Ref("Database", st.Namespace, d.GetName()), sentence), nil
		}
	}

	ok, res, err := CheckSecretKeys(ctx, env, render.PostgresAppSecret(st), "the server's database password", "password")
	if err != nil {
		return Result{}, err
	}
	if !ok {
		// CloudNativePG mints this Secret; until it has, this is a wait, not
		// something the adopter must fix.
		return Deploying(stigmerv1.ReasonDeploying, res.Object, "waiting for CloudNativePG to create the server's database password"), nil
	}
	sentence := fmt.Sprintf("Postgres 16.15, %d instance(s), records in database %s", instances, render.PostgresAppDatabase)
	if render.BackupsOn(st) {
		if clusterReportsPlugin(live) {
			if err := Apply(ctx, env, render.ScheduledBackupObject(st)); err != nil {
				return Result{}, err
			}
		}
		sentence += fmt.Sprintf("; archiving to the bucket as %s", render.LiveArchiveServerName(live))
		from := render.BundledDatabase(st).RecoverFrom
		switch restored := render.LiveRestoredFrom(live); {
		case restored != "":
			sentence += fmt.Sprintf("; restored from archive %s", restored)
		case from != nil:
			sentence += fmt.Sprintf("; spec.database.postgresql.bundled.recoverFrom is honoured only when the database is created, and this one already existed, so it was not restored from %s", from.ServerName)
		}
	} else {
		sentence += "; not backed up: declare spec.objectStore to archive it to a bucket"
	}
	return Ready(sentence), nil
}

// readCluster reads the live Cluster, nil when it does not exist yet.
func readCluster(ctx context.Context, env *Env, name string) (*unstructured.Unstructured, error) {
	live := &unstructured.Unstructured{}
	live.SetGroupVersionKind(clusterKind)
	err := env.Reader.Get(ctx, client.ObjectKey{Namespace: env.Stigmer.Namespace, Name: name}, live)
	if apierrors.IsNotFound(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading Cluster %s: %w", name, err)
	}
	return live, nil
}

var clusterKind = schema.GroupVersionKind{Group: "postgresql.cnpg.io", Version: "v1", Kind: "Cluster"}

func conditionTrue(u *unstructured.Unstructured, condition string) bool {
	conds, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	for _, c := range conds {
		m, ok := c.(map[string]any)
		if ok && m["type"] == condition && m["status"] == "True" {
			return true
		}
	}
	return false
}
