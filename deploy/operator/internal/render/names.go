// The names, labels and images every object the operator renders carries,
// derived from the Stigmer's name alone.
//
// Every name is a pure function of the resource, so each component can say
// what it renders and what it reads without asking another component, and a
// test can name any object without a cluster. The labels double as the
// operator's cache filter: Secrets, ConfigMaps and the workloads it owns are
// cached only when they carry ManagedByLabel, so the operator never holds
// the rest of the cluster's Secrets in memory.

package render

import (
	"fmt"

	stigmerv1 "github.com/stigmer/stigmer/deploy/operator/api/v1"
	"github.com/stigmer/stigmer/deploy/operator/internal/version"
)

const (
	// FieldManager is the server-side apply field manager for every object
	// the operator applies.
	FieldManager = "stigmer-operator"

	// ManagedByLabel and ManagedByValue mark what this operator made.
	ManagedByLabel = "app.kubernetes.io/managed-by"
	// ManagedByValue is the managed-by label's value.
	ManagedByValue = "stigmer-operator"
	// NameLabel is the standard name label; its value is always "stigmer".
	NameLabel = "app.kubernetes.io/name"
	// InstanceLabel names the Stigmer an object belongs to.
	InstanceLabel = "app.kubernetes.io/instance"
	// ComponentLabel names the component an object belongs to.
	ComponentLabel = "app.kubernetes.io/component"

	// GRPCPort is the server's unified port: gRPC, Connect and the console.
	GRPCPort = 7234
	// ArtifactsPort is the server's artifact file server.
	ArtifactsPort = 7235
	// TemporalPort is a Temporal frontend's gRPC port.
	TemporalPort = 7233

	// RunnerTaskQueue is the one queue the server dispatches to and the
	// shared runner polls (Compose's x-runner-task-queue).
	RunnerTaskQueue = "stigmer_runner"
	// ArtifactsMount is where the artifact volume is mounted in both
	// containers. Compose mounts it at /data/.stigmer/data/artifacts, inside
	// the /data volume; in a pod a mount nested inside a fresh claim is
	// created root-owned, which the non-root server cannot write, so it
	// stands on its own path.
	ArtifactsMount = "/artifacts"
	// TemporalNamespace is the Temporal namespace the bundled Temporal
	// registers and Stigmer uses.
	TemporalNamespace = "default"

	// PostgresImage is the bundled Postgres: CloudNativePG's build of
	// Compose's exact release (postgres:16.15), which the parity test holds
	// equal.
	PostgresImage = "ghcr.io/cloudnative-pg/postgresql:16.15"
	// PostgresAppDatabase and PostgresAppUser are the database the server
	// uses and the role that owns it.
	PostgresAppDatabase = "stigmer"
	// PostgresAppUser owns PostgresAppDatabase.
	PostgresAppUser = "stigmer"
	// TemporalUser owns Temporal's two databases.
	TemporalUser = "temporal"
	// TemporalDatabase and TemporalVisibilityDatabase are Temporal's stores.
	TemporalDatabase = "temporal"
	// TemporalVisibilityDatabase is Temporal's visibility store.
	TemporalVisibilityDatabase = "temporal_visibility"
)

// Labels is the label set of every object a component renders.
func Labels(st *stigmerv1.Stigmer, component string) map[string]string {
	return map[string]string{
		NameLabel:      "stigmer",
		InstanceLabel:  st.Name,
		ComponentLabel: component,
		ManagedByLabel: ManagedByValue,
	}
}

// SelectorLabels picks a component's pods; a strict subset of Labels, so it
// never changes when a label is added.
func SelectorLabels(st *stigmerv1.Stigmer, component string) map[string]string {
	return map[string]string{
		NameLabel:      "stigmer",
		InstanceLabel:  st.Name,
		ComponentLabel: component,
	}
}

// KeysSecret holds the server's three keys. It outlives the Stigmer.
func KeysSecret(st *stigmerv1.Stigmer) string { return st.Name + "-keys" }

// ServerDeployment and ServerService are the server's workload and address.
func ServerDeployment(st *stigmerv1.Stigmer) string { return st.Name }

// ServerService is the server's in-cluster address.
func ServerService(st *stigmerv1.Stigmer) string { return st.Name }

// ServerDataClaim is the server's own volume.
func ServerDataClaim(st *stigmerv1.Stigmer) string { return st.Name + "-server-data" }

// RunnerDataClaim is the shared runner's own volume.
func RunnerDataClaim(st *stigmerv1.Stigmer) string { return st.Name + "-runner-data" }

// ArtifactsClaim is the artifact volume both containers mount.
func ArtifactsClaim(st *stigmerv1.Stigmer) string { return st.Name + "-artifacts" }

// PostgresCluster is the bundled Postgres's CloudNativePG Cluster.
func PostgresCluster(st *stigmerv1.Stigmer) string { return st.Name + "-postgres" }

// PostgresReadWriteService is the Service CloudNativePG points at the primary.
func PostgresReadWriteService(st *stigmerv1.Stigmer) string { return PostgresCluster(st) + "-rw" }

// PostgresAppSecret is the Secret CloudNativePG mints for the app role.
func PostgresAppSecret(st *stigmerv1.Stigmer) string { return PostgresCluster(st) + "-app" }

// PostgresTemporalSecret is the operator-minted password of the temporal role.
func PostgresTemporalSecret(st *stigmerv1.Stigmer) string { return PostgresCluster(st) + "-temporal" }

// TemporalFullname is the bundled Temporal's chart fullname.
func TemporalFullname(st *stigmerv1.Stigmer) string { return st.Name + "-temporal" }

// TemporalFrontendService is the bundled Temporal's frontend address.
func TemporalFrontendService(st *stigmerv1.Stigmer) string { return TemporalFullname(st) + "-frontend" }

// Licensed reports whether the Stigmer runs Stigmer Enterprise.
func Licensed(st *stigmerv1.Stigmer) bool {
	return st.Spec.Enterprise != nil && st.Spec.Enterprise.License != nil
}

// Edition is the status's edition word.
func Edition(st *stigmerv1.Stigmer) string {
	if Licensed(st) {
		return "enterprise"
	}
	return "open source"
}

// SignInOn reports whether the server signs callers in.
func SignInOn(st *stigmerv1.Stigmer) bool {
	return st.Spec.Identity != nil && st.Spec.Identity.OIDC != nil
}

// registry is the declared registry, or Stigmer's own.
func registry(st *stigmerv1.Stigmer) string {
	if st.Spec.Image.Registry != "" {
		return st.Spec.Image.Registry
	}
	return "ghcr.io/stigmer"
}

// ServerImage is the server's image: the Enterprise build under a license.
func ServerImage(st *stigmerv1.Stigmer) string {
	repository := "stigmer-server"
	if Licensed(st) {
		repository = "stigmer-server-ee"
	}
	return fmt.Sprintf("%s/%s:%s", registry(st), repository, version.Stigmer)
}

// RunnerImage is the shared runner's image.
func RunnerImage(st *stigmerv1.Stigmer) string {
	return fmt.Sprintf("%s/stigmer-runner:%s", registry(st), version.Stigmer)
}

// PortForwardPorts are the ports a port-forward to the server needs: the API,
// and the artifact file server when files live on its volume (a bucket
// install serves none).
func PortForwardPorts(st *stigmerv1.Stigmer) string {
	if ObjectStore(st) != nil {
		return fmt.Sprintf("%d", GRPCPort)
	}
	return fmt.Sprintf("%d %d", GRPCPort, ArtifactsPort)
}
