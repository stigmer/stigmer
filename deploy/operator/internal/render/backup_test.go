// Pins the backup render (backup.go) without a cluster: where the archive
// goes and how the plugin signs in (path-style only for a named store, the
// region by reference); the Cluster's plugin entry and server name; a
// restore's bootstrap from the named archive to the named moment; the
// six-field default schedule and a declared one; a restored database's
// server name never equal to its source's; and an upgrade backup's name
// kept to a valid object name.

package render

import (
	"strings"
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

func str(t *testing.T, u *unstructured.Unstructured, path ...string) string {
	t.Helper()
	v, _, err := unstructured.NestedString(u.Object, path...)
	if err != nil {
		t.Fatalf("%s: %v", strings.Join(path, "."), err)
	}
	return v
}

func TestTheArchiveGoesToTheBucketsPostgresPrefix(t *testing.T) {
	st := profiles()["bucket"]
	if !BackupsOn(st) {
		t.Fatal("a bundled database with a bucket is not backed up")
	}
	store := BackupObjectStoreObject(st)
	if got := str(t, store, "spec", "configuration", "destinationPath"); got != "s3://acme-stigmer/postgres/" {
		t.Errorf("destinationPath %q", got)
	}
	if got := str(t, store, "spec", "configuration", "endpointURL"); got != "http://minio.storage:9000" {
		t.Errorf("endpointURL %q", got)
	}
	if got := str(t, store, "spec", "configuration", "s3AddressingStyle"); got != "path" {
		t.Errorf("a named store is addressed %q, want path", got)
	}
	if got := str(t, store, "spec", "configuration", "s3Credentials", "secretAccessKey", "name"); got != "bucket" {
		t.Errorf("the secret key is read from %q", got)
	}
	if got := str(t, store, "spec", "configuration", "s3Credentials", "region", "name"); got != BackupSettingsSecret(st) {
		t.Errorf("the region is read from %q", got)
	}
	if got := BackupSettingsSecretObject(st).StringData["AWS_REGION"]; got != "eu-west-1" {
		t.Errorf("the settings Secret carries region %q", got)
	}
	if got := str(t, store, "spec", "retentionPolicy"); got != DefaultBackupRetention {
		t.Errorf("retention %q", got)
	}

	aws := st.DeepCopy()
	aws.Spec.ObjectStore.S3.Endpoint = ""
	cfg, _, _ := unstructured.NestedMap(BackupObjectStoreObject(aws).Object, "spec", "configuration")
	if _, has := cfg["endpointURL"]; has {
		t.Error("AWS S3 is given an endpoint")
	}
	if _, has := cfg["s3AddressingStyle"]; has {
		t.Error("AWS S3 is forced to path-style")
	}
	if _, has, _ := unstructured.NestedFieldNoCopy(BackupObjectStoreObject(aws).Object, "spec", "instanceSidecarConfiguration"); has {
		t.Error("AWS S3's archiver is taken off the SDK's checksum defaults")
	}
}

// Google Cloud Storage's S3 API refuses the AWS SDKs' default request
// checksums, so the archiver of a store named by an endpoint asks for them
// only when an operation requires them (stigmer/stigmer#3415).
func TestANamedStoresArchiverAsksForChecksumsOnlyWhenRequired(t *testing.T) {
	st := profiles()["bucket"]
	env, _, err := unstructured.NestedSlice(BackupObjectStoreObject(st).Object, "spec", "instanceSidecarConfiguration", "env")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]any{}
	for _, item := range env {
		e := item.(map[string]any)
		got[e["name"].(string)] = e["value"]
	}
	for _, name := range []string{"AWS_REQUEST_CHECKSUM_CALCULATION", "AWS_RESPONSE_CHECKSUM_VALIDATION"} {
		if got[name] != "when_required" {
			t.Errorf("the archiver's %s is %v, want when_required", name, got[name])
		}
	}

	byo := profiles()["byo"]
	byo.Spec.ObjectStore = st.Spec.ObjectStore
	if BackupsOn(byo) {
		t.Error("the operator backs up a database it does not run")
	}
}

func TestTheClusterArchivesUnderItsServerName(t *testing.T) {
	st := profiles()["bucket"]
	plain := PostgresClusterObject(st, ClusterBackup{})
	if _, has, _ := unstructured.NestedSlice(plain.Object, "spec", "plugins"); has {
		t.Error("a Cluster names the plugin before it is asked to")
	}
	c := PostgresClusterObject(st, ClusterBackup{Archive: true, ServerName: "stigmer-postgres"})
	if got := LiveArchiveServerName(c); got != "stigmer-postgres" {
		t.Errorf("server name %q", got)
	}
	plugins, _, _ := unstructured.NestedSlice(c.Object, "spec", "plugins")
	p := plugins[0].(map[string]any)
	if p["name"] != BarmanPluginName || p["isWALArchiver"] != true {
		t.Errorf("plugin entry %v", p)
	}
	if _, has, _ := unstructured.NestedMap(c.Object, "spec", "bootstrap", "initdb"); !has {
		t.Error("a new database is not created empty")
	}
}

func TestARestoreBootstrapsFromTheNamedArchive(t *testing.T) {
	st := profiles()["bucket"]
	st.Spec.Database = &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{Bundled: &stigmerv1.BundledPostgreSQLSpec{
		RecoverFrom: &stigmerv1.RecoverFromSpec{ServerName: "stigmer-postgres", TargetTime: "2026-11-19T12:00:00Z"},
	}}}
	now := time.Date(2026, 11, 20, 9, 30, 0, 0, time.UTC)
	server := ArchiveServerName(st, now)
	if server != "stigmer-postgres-202611200930" {
		t.Errorf("a restored database archives as %q", server)
	}
	c := PostgresClusterObject(st, ClusterBackup{Archive: true, ServerName: server, Recover: true})
	if got := str(t, c, "spec", "bootstrap", "recovery", "recoveryTarget", "targetTime"); got != "2026-11-19T12:00:00Z" {
		t.Errorf("target %q", got)
	}
	if got := str(t, c, "spec", "bootstrap", "recovery", "owner"); got != PostgresAppUser {
		t.Errorf("the restored database is owned by %q", got)
	}
	if _, has, _ := unstructured.NestedMap(c.Object, "spec", "bootstrap", "initdb"); has {
		t.Error("a restore also initialises an empty database")
	}
	if got := LiveRestoredFrom(c); got != "stigmer-postgres" {
		t.Errorf("restored from %q", got)
	}
	if LiveArchiveServerName(c) == LiveRestoredFrom(c) {
		t.Error("a restored database archives into its source's archive")
	}
	if ArchiveServerName(profiles()["bucket"], now) != PostgresCluster(st) {
		t.Error("a new database's archive is not named for its Cluster")
	}
	notRecovering := PostgresClusterObject(st, ClusterBackup{Archive: true, ServerName: server})
	if LiveRestoredFrom(notRecovering) != "" {
		t.Error("a Cluster that already exists is given a recovery bootstrap")
	}
}

func TestBackupSchedule(t *testing.T) {
	st := profiles()["bucket"]
	if got := str(t, ScheduledBackupObject(st), "spec", "schedule"); got != "0 0 2 * * *" || len(strings.Fields(got)) != 6 {
		t.Errorf("default schedule %q is not CloudNativePG's six-field cron", got)
	}
	if got := str(t, ScheduledBackupObject(st), "spec", "method"); got != "plugin" {
		t.Errorf("method %q", got)
	}
	st.Spec.Database = &stigmerv1.DatabaseSpec{PostgreSQL: &stigmerv1.PostgreSQLSpec{Bundled: &stigmerv1.BundledPostgreSQLSpec{
		Backup: &stigmerv1.PostgreSQLBackupSpec{Schedule: "0 30 3 * * 0", Retention: "8w"},
	}}}
	if got := str(t, ScheduledBackupObject(st), "spec", "schedule"); got != "0 30 3 * * 0" {
		t.Errorf("declared schedule %q", got)
	}
	if got := str(t, BackupObjectStoreObject(st), "spec", "retentionPolicy"); got != "8w" {
		t.Errorf("declared retention %q", got)
	}
}

func TestUpgradeBackupNamesAreObjectNames(t *testing.T) {
	st := profiles()["bucket"]
	if got := UpgradeBackupName(st, "v0.3.0"); got != "stigmer-before-v0-3-0" {
		t.Errorf("%q", got)
	}
	if got := UpgradeBackupName(st, "smoke-2"); got != "stigmer-before-smoke-2" {
		t.Errorf("%q", got)
	}
	if got := UpgradeBackupName(st, strings.Repeat("9", 80)); len(got) > 63 || strings.HasSuffix(got, "-") {
		t.Errorf("%q is not a valid name", got)
	}
}
