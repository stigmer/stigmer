// The bundled Temporal: Temporal's own Helm chart, rendered in memory with
// values chosen to match docker-compose.yml's Temporal.
//
// Both stores run on the bundled Postgres as the temporal role, in databases
// the database component already declared, so the chart's create-database
// step is off and only its schema step runs. Temporal's namespace-setup Job
// registers `default` with Compose's 24-hour retention; the server is applied
// only after that Job succeeds, because a server that connects before the
// namespace exists never retries its worker. Four history shards is the
// Temporal server image's own default that Compose runs with; the shard
// count can never change after the first boot, so it is held here. The web
// UI and the admin-tools Deployment are left out: nothing in Stigmer uses
// them. Both Jobs are rendered as plain Jobs named for the chart version and
// are never cleaned up after success, so the operator can read that they
// succeeded on every pass, and a new chart version runs them afresh.

package render

import (
	"fmt"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
)

// TemporalRetention is the default namespace's retention, Compose's value.
const TemporalRetention = "24h"

// TemporalHistoryShards is the shard count Compose runs with: it sets none,
// so its Temporal takes the server image's default, NUM_HISTORY_SHARDS 4. It
// never changes after the first boot.
const TemporalHistoryShards = 4

// TemporalServices are the chart's server services, each sized alike.
var TemporalServices = []string{"frontend", "history", "matching", "worker"}

func temporalStore(st *stigmerv1.Stigmer, database string) map[string]any {
	return map[string]any{"sql": map[string]any{
		"pluginName":      "postgres12",
		"driverName":      "postgres12",
		"databaseName":    database,
		"connectAddr":     fmt.Sprintf("%s:5432", PostgresReadWriteService(st)),
		"connectProtocol": "tcp",
		"user":            TemporalUser,
		"existingSecret":  PostgresTemporalSecret(st),
		"secretKey":       "password",
		"createDatabase":  false,
		"manageSchema":    true,
		"maxConns":        20,
		"maxIdleConns":    20,
		"maxConnLifetime": "1h",
	}}
}

// TemporalValues are the chart values for the bundled Temporal.
func TemporalValues(st *stigmerv1.Stigmer) map[string]any {
	resources := ResourcesValue(BundledTemporalResources(st))
	server := map[string]any{
		"replicaCount": 1,
		"config": map[string]any{
			"persistence": map[string]any{
				"numHistoryShards": TemporalHistoryShards,
				"datastores": map[string]any{
					"default":    temporalStore(st, TemporalDatabase),
					"visibility": temporalStore(st, TemporalVisibilityDatabase),
				},
			},
			"namespaces": map[string]any{
				"create":       true,
				"useHelmHooks": false,
				"namespace":    []any{map[string]any{"name": TemporalNamespace, "retention": TemporalRetention}},
			},
		},
	}
	for _, svc := range TemporalServices {
		server[svc] = map[string]any{"resources": resources}
	}
	values := map[string]any{
		"fullnameOverride": TemporalFullname(st),
		"server":           server,
		"admintools":       map[string]any{"enabled": false},
		"web":              map[string]any{"enabled": false},
		// Kept after success (no TTL) so readiness can read that they ran.
		"schema": map[string]any{"useHelmHooks": false, "ttlSecondsAfterFinished": nil},
	}
	if len(st.Spec.Image.PullSecrets) > 0 {
		var secrets []any
		for _, s := range st.Spec.Image.PullSecrets {
			secrets = append(secrets, map[string]any{"name": s.Name})
		}
		values["imagePullSecrets"] = secrets
	}
	return values
}

// TemporalFrontendDeployment is the frontend's Deployment in the render.
func TemporalFrontendDeployment(st *stigmerv1.Stigmer) string {
	return TemporalFullname(st) + "-frontend"
}

// TemporalNamespaceJobPrefix and TemporalSchemaJobPrefix prefix the two Jobs'
// names; the chart appends its version and the render's revision.
func TemporalNamespaceJobPrefix(st *stigmerv1.Stigmer) string {
	return TemporalFullname(st) + "-namespace-"
}

// TemporalSchemaJobPrefix prefixes the schema Job's name.
func TemporalSchemaJobPrefix(st *stigmerv1.Stigmer) string { return TemporalFullname(st) + "-schema-" }
