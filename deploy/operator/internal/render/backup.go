// The bundled database's backups, through CloudNativePG's Barman Cloud
// plugin: an ObjectStore naming where in the bucket the archive goes and how
// to sign in, the Cluster's plugin entry archiving every change there
// continuously under a server name, a ScheduledBackup taking the full
// backups the archive is replayed onto, and an on-demand Backup before an
// upgrade. A restore is the same objects read the other way: the Cluster
// bootstrapped from the archive of the server it names, to the moment it
// names, instead of from an empty database.
//
// Everything here is a pure builder over the Stigmer, so the maps are pinned
// by tests without a cluster. The database component decides when each is
// applied (component/database.go).

package render

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// The plugin's names, as CloudNativePG and the plugin's release know them.
const (
	// BarmanPluginName is how a Cluster and a backup name the plugin.
	BarmanPluginName = "barman-cloud.cloudnative-pg.io"
	// BarmanObjectStoreCRD is the definition the plugin is detected by.
	BarmanObjectStoreCRD = "objectstores.barmancloud.cnpg.io"
	// BarmanPluginDeployment is the plugin's controller, in CloudNativePG's
	// namespace.
	BarmanPluginDeployment = "barman-cloud"
	// BarmanAPIVersion is the ObjectStore's group and version.
	BarmanAPIVersion = "barmancloud.cnpg.io/v1"
)

// cert-manager's two definitions the plugin's release creates objects of.
var CertManagerCRDs = []string{"certificates.cert-manager.io", "issuers.cert-manager.io"}

// Backup defaults: a full backup daily at 02:00 UTC (CloudNativePG's cron
// has six fields, seconds first) and thirty days kept.
const (
	DefaultBackupSchedule  = "0 0 2 * * *"
	DefaultBackupRetention = "30d"
)

// backupRegionKey is the key the region is read from: the plugin takes every
// setting as a Secret reference, the region too, so the operator writes it
// into a small Secret of its own rather than ask for it in the credentials.
const backupRegionKey = "AWS_REGION"

// archivePrefix is where in the bucket the database's archive lives, beside
// the server's own top-level prefixes (artifacts/, files/, skills/ and the
// rest).
const archivePrefix = "postgres"

// recoverySource is the name a restore's source carries inside the Cluster.
const recoverySource = "origin"

// BackupsOn reports whether the bundled database backs up: it is bundled and
// a bucket is declared.
func BackupsOn(st *stigmerv1.Stigmer) bool {
	return ObjectStore(st) != nil && Database(st).Bundled
}

// BackupObjectStore is the ObjectStore's name.
func BackupObjectStore(st *stigmerv1.Stigmer) string { return st.Name + "-backups" }

// BackupSettingsSecret holds the settings the plugin reads by reference.
func BackupSettingsSecret(st *stigmerv1.Stigmer) string { return st.Name + "-backup-settings" }

// ScheduledBackupName is the schedule's name.
func ScheduledBackupName(st *stigmerv1.Stigmer) string { return PostgresCluster(st) + "-daily" }

// ArchiveServerName is a new database's server name in the archive. A
// restored database archives under a name of its own, stamped with when it
// was created, so it never writes into the archive it was restored from.
func ArchiveServerName(st *stigmerv1.Stigmer, now time.Time) string {
	if BundledDatabase(st).RecoverFrom == nil {
		return PostgresCluster(st)
	}
	return fmt.Sprintf("%s-%s", PostgresCluster(st), now.UTC().Format("200601021504"))
}

// BackupSettingsSecretObject is the plugin's settings Secret.
func BackupSettingsSecretObject(st *stigmerv1.Stigmer) *corev1.Secret {
	return &corev1.Secret{
		TypeMeta:   metav1.TypeMeta{APIVersion: "v1", Kind: "Secret"},
		ObjectMeta: meta(st, BackupSettingsSecret(st), ComponentDatabase),
		StringData: map[string]string{backupRegionKey: ObjectStoreRegion(ObjectStore(st))},
	}
}

// BackupObjectStoreObject is where the archive goes, and how to sign in.
func BackupObjectStoreObject(st *stigmerv1.Stigmer) *unstructured.Unstructured {
	s3 := ObjectStore(st)
	creds := s3.CredentialsSecret.Name
	configuration := map[string]any{
		"destinationPath": fmt.Sprintf("s3://%s/%s/", s3.Bucket, archivePrefix),
		"s3Credentials": map[string]any{
			"accessKeyId":     map[string]any{"name": creds, "key": ObjectStoreAccessKeyID},
			"secretAccessKey": map[string]any{"name": creds, "key": ObjectStoreSecretAccessKey},
			"region":          map[string]any{"name": BackupSettingsSecret(st), "key": backupRegionKey},
		},
		"wal":  map[string]any{"compression": "gzip"},
		"data": map[string]any{"compression": "gzip"},
	}
	if s3.Endpoint != "" {
		configuration["endpointURL"] = s3.Endpoint
		// A named store serves no per-bucket hostnames.
		configuration["s3AddressingStyle"] = "path"
	}
	retention := DefaultBackupRetention
	if b := BundledDatabase(st).Backup; b != nil && b.Retention != "" {
		retention = b.Retention
	}
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": BarmanAPIVersion,
		"kind":       "ObjectStore",
		"metadata": map[string]any{
			"name":      BackupObjectStore(st),
			"namespace": st.Namespace,
			"labels":    labelsAny(st, ComponentDatabase),
		},
		"spec": map[string]any{
			"configuration":   configuration,
			"retentionPolicy": retention,
		},
	}}
}

// ClusterBackup is what the Cluster carries for its backups.
type ClusterBackup struct {
	// Archive attaches the plugin, archiving under ServerName. Never set
	// before the plugin serves: a Cluster naming a plugin CloudNativePG
	// cannot reach is parked with no instances.
	Archive    bool
	ServerName string
	// Recover bootstraps a new Cluster from the declared archive.
	Recover bool
}

// withBackup adds the plugin entry and, for a restore, the recovery
// bootstrap to a Cluster's spec.
func withBackup(st *stigmerv1.Stigmer, spec map[string]any, b ClusterBackup) {
	if b.Archive {
		spec["plugins"] = []any{map[string]any{
			"name":          BarmanPluginName,
			"isWALArchiver": true,
			"parameters": map[string]any{
				"barmanObjectName": BackupObjectStore(st),
				"serverName":       b.ServerName,
			},
		}}
	}
	from := BundledDatabase(st).RecoverFrom
	if !b.Recover || from == nil {
		return
	}
	recovery := map[string]any{
		"source":   recoverySource,
		"database": PostgresAppDatabase,
		"owner":    PostgresAppUser,
	}
	if from.TargetTime != "" {
		recovery["recoveryTarget"] = map[string]any{"targetTime": from.TargetTime}
	}
	spec["bootstrap"] = map[string]any{"recovery": recovery}
	spec["externalClusters"] = []any{map[string]any{
		"name": recoverySource,
		"plugin": map[string]any{
			"name": BarmanPluginName,
			"parameters": map[string]any{
				"barmanObjectName": BackupObjectStore(st),
				"serverName":       from.ServerName,
			},
		},
	}}
}

// ScheduledBackupObject takes a full backup on the declared schedule, and
// one at once when created, so a new install has a base to restore onto
// from its first minutes.
func ScheduledBackupObject(st *stigmerv1.Stigmer) *unstructured.Unstructured {
	schedule := DefaultBackupSchedule
	if b := BundledDatabase(st).Backup; b != nil && b.Schedule != "" {
		schedule = b.Schedule
	}
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": CNPGAPIVersion,
		"kind":       "ScheduledBackup",
		"metadata": map[string]any{
			"name":      ScheduledBackupName(st),
			"namespace": st.Namespace,
			"labels":    labelsAny(st, ComponentDatabase),
		},
		"spec": map[string]any{
			"schedule":             schedule,
			"immediate":            true,
			"backupOwnerReference": "self",
			"cluster":              map[string]any{"name": PostgresCluster(st)},
			"method":               "plugin",
			"pluginConfiguration":  map[string]any{"name": BarmanPluginName},
		},
	}}
}

var unsafeName = regexp.MustCompile(`[^a-z0-9-]+`)

// UpgradeBackupName is the backup taken before the server moves to version.
func UpgradeBackupName(st *stigmerv1.Stigmer, version string) string {
	v := strings.Trim(unsafeName.ReplaceAllString(strings.ToLower(version), "-"), "-")
	name := fmt.Sprintf("%s-before-%s", st.Name, v)
	if len(name) > 63 {
		name = strings.TrimRight(name[:63], "-")
	}
	return name
}

// UpgradeBackupObject is the on-demand backup an upgrade waits for.
func UpgradeBackupObject(st *stigmerv1.Stigmer, version string) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": CNPGAPIVersion,
		"kind":       "Backup",
		"metadata": map[string]any{
			"name":      UpgradeBackupName(st, version),
			"namespace": st.Namespace,
			"labels":    labelsAny(st, ComponentServer),
		},
		"spec": map[string]any{
			"cluster":             map[string]any{"name": PostgresCluster(st)},
			"method":              "plugin",
			"pluginConfiguration": map[string]any{"name": BarmanPluginName},
		},
	}}
}

// LiveArchiveServerName reads the server name a live Cluster archives
// under, "" when it carries no plugin entry.
func LiveArchiveServerName(cluster *unstructured.Unstructured) string {
	plugins, _, _ := unstructured.NestedSlice(cluster.Object, "spec", "plugins")
	for _, p := range plugins {
		m, ok := p.(map[string]any)
		if !ok || m["name"] != BarmanPluginName {
			continue
		}
		name, _, _ := unstructured.NestedString(m, "parameters", "serverName")
		return name
	}
	return ""
}

// LiveRestoredFrom reads the archive a live Cluster was restored from, ""
// when it was created empty.
func LiveRestoredFrom(cluster *unstructured.Unstructured) string {
	if _, restored, _ := unstructured.NestedMap(cluster.Object, "spec", "bootstrap", "recovery"); !restored {
		return ""
	}
	sources, _, _ := unstructured.NestedSlice(cluster.Object, "spec", "externalClusters")
	for _, s := range sources {
		m, ok := s.(map[string]any)
		if !ok || m["name"] != recoverySource {
			continue
		}
		name, _, _ := unstructured.NestedString(m, "plugin", "parameters", "serverName")
		return name
	}
	return ""
}
