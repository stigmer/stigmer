// The bundled Postgres as CloudNativePG resources: one Cluster, and a
// Database for each of Temporal's two stores.
//
// Nobody connects as the superuser. initdb creates the server's database
// owned by its own role, for which CloudNativePG mints <cluster>-app; the
// temporal role is declared to the Cluster as a managed role with a password
// the operator mints, and owns Temporal's two databases, so Temporal's
// schema jobs never need to create a database. The image is CloudNativePG's
// build of the exact Postgres release docker-compose.yml runs. The objects
// are unstructured, so the operator does not depend on CloudNativePG's Go
// module; the fields used are CloudNativePG's documented v1 API.

package render

import (
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// CloudNativePG's API version and the definition the operator detects it by.
const (
	CNPGAPIVersion = "postgresql.cnpg.io/v1"
	CNPGClusterCRD = "clusters.postgresql.cnpg.io"
)

func labelsAny(st *stigmerv1.Stigmer, component string) map[string]any {
	out := map[string]any{}
	for k, v := range Labels(st, component) {
		out[k] = v
	}
	return out
}

func quantities(list corev1.ResourceList) map[string]any {
	out := map[string]any{}
	for name, q := range list {
		out[string(name)] = q.String()
	}
	return out
}

// ResourcesValue is a ResourceRequirements as plain values.
func ResourcesValue(r corev1.ResourceRequirements) map[string]any {
	out := map[string]any{}
	if len(r.Requests) > 0 {
		out["requests"] = quantities(r.Requests)
	}
	if len(r.Limits) > 0 {
		out["limits"] = quantities(r.Limits)
	}
	return out
}

// PostgresClusterObject is the bundled Postgres, carrying what its backups
// need (backup.go).
func PostgresClusterObject(st *stigmerv1.Stigmer, backup ClusterBackup) *unstructured.Unstructured {
	bundled := BundledDatabase(st)
	instances := bundled.Instances
	if instances == 0 {
		instances = 1
	}
	storage := map[string]any{"size": PostgresSize.String()}
	if bundled.Storage != nil {
		if bundled.Storage.Size != nil {
			storage["size"] = bundled.Storage.Size.String()
		}
		if bundled.Storage.StorageClassName != nil {
			storage["storageClass"] = *bundled.Storage.StorageClassName
		}
	}
	spec := map[string]any{
		"instances":             int64(instances),
		"imageName":             PostgresImage,
		"enableSuperuserAccess": false,
		// CloudNativePG stamps these on everything it makes for the
		// Cluster, the Secrets included, so the operator's label-filtered
		// cache sees them.
		"inheritedMetadata": map[string]any{"labels": labelsAny(st, ComponentDatabase)},
		"storage":           storage,
		"resources":         ResourcesValue(PostgresSizing.Effective(bundled.Resources)),
		"bootstrap": map[string]any{
			"initdb": map[string]any{"database": PostgresAppDatabase, "owner": PostgresAppUser},
		},
		"managed": map[string]any{"roles": managedRoles(st)},
	}
	withBackup(st, spec, backup)
	if len(st.Spec.Image.PullSecrets) > 0 {
		var secrets []any
		for _, s := range st.Spec.Image.PullSecrets {
			secrets = append(secrets, map[string]any{"name": s.Name})
		}
		spec["imagePullSecrets"] = secrets
	}
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": CNPGAPIVersion,
		"kind":       "Cluster",
		"metadata": map[string]any{
			"name":      PostgresCluster(st),
			"namespace": st.Namespace,
			"labels":    labelsAny(st, ComponentDatabase),
		},
		"spec": spec,
	}}
}

// managedRoles are the roles declared to CloudNativePG: Temporal's always,
// and the bundled sign-in's when it runs.
func managedRoles(st *stigmerv1.Stigmer) []any {
	roles := []any{map[string]any{
		"name":           TemporalUser,
		"ensure":         "present",
		"login":          true,
		"passwordSecret": map[string]any{"name": PostgresTemporalSecret(st)},
	}}
	if BundledIdentity(st) {
		roles = append(roles, KeycloakRole(st))
	}
	return roles
}

// TemporalDatabaseObjects are Temporal's two databases, owned by its role and
// kept if the Database object is ever removed.
func TemporalDatabaseObjects(st *stigmerv1.Stigmer) []*unstructured.Unstructured {
	var out []*unstructured.Unstructured
	for _, db := range []struct{ object, name string }{
		{PostgresCluster(st) + "-temporal", TemporalDatabase},
		{PostgresCluster(st) + "-temporal-visibility", TemporalVisibilityDatabase},
	} {
		out = append(out, &unstructured.Unstructured{Object: map[string]any{
			"apiVersion": CNPGAPIVersion,
			"kind":       "Database",
			"metadata": map[string]any{
				"name":      db.object,
				"namespace": st.Namespace,
				"labels":    labelsAny(st, ComponentDatabase),
			},
			"spec": map[string]any{
				"name":                  db.name,
				"owner":                 TemporalUser,
				"cluster":               map[string]any{"name": PostgresCluster(st)},
				"ensure":                "present",
				"databaseReclaimPolicy": "retain",
			},
		}})
	}
	return out
}
