package apiresource

import (
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Well-known stigmer.ai/* metadata labels marking resources whose lifecycle
// is owned by the system rather than the user. The Go twin of the cloud
// edition's SystemManagedLabels (stigmer-cloud
// backend/libs/java/api/api-shape/.../metadata/SystemManagedLabels.java).
// Keep the two in sync.
//
// Trust boundary: labels are client-suppliable, so they may be used to
// RESTRICT what a request may do (e.g. reject visibility updates on default
// instances) but never to GRANT anything. Where a grant-shaped decision is
// needed, key it on server-owned state instead (e.g. the parent blueprint's
// status.default_instance_id, written only by the create/self-heal flows).
// The cloud edition additionally guards the whole reserved namespace at its
// write boundaries (GuardReservedLabelsStep); OSS has no such guard, which
// is one of the reasons OSS predicates must not trust these labels alone.
const (
	// ReservedLabelPrefix is the platform-reserved label key namespace. Keys
	// under this prefix carry platform semantics (default-agent resolution,
	// personal-environment uniqueness, default-instance marking) and are
	// written by the server — never introduced by ordinary client requests
	// on the cloud edition.
	ReservedLabelPrefix = "stigmer.ai/"

	// DefaultInstanceLabel marks a blueprint's one auto-created default
	// instance (the empty config shell the runner resolves when a user has
	// no personal instance). Default instances carry no visibility of their
	// own: their access always follows the parent blueprint.
	DefaultInstanceLabel = ReservedLabelPrefix + "default-instance"

	// SystemManagedLabel marks a resource whose lifecycle (creation, naming,
	// visibility) is system-managed; user mutations of the managed aspects
	// are rejected.
	SystemManagedLabel = ReservedLabelPrefix + "system-managed"

	// ReservedLabelTrue is the only value that activates a reserved marker
	// label; any other value is inert (matching cloud's "true".equals(...)).
	// Stamped by the flows that create system-managed resources (e.g. the
	// defaultinstance factories) and read by the predicates here.
	ReservedLabelTrue = "true"
)

// IsDefaultInstance reports whether the metadata carries the
// DefaultInstanceLabel marker (nil-safe).
//
// Because OSS has no reserved-label write guard, callers making a
// restrict-shaped decision should combine this with the authoritative
// parent pointer (blueprint status.default_instance_id) — the label alone
// misses pre-labeling legacy rows and can be dropped by a client update.
func IsDefaultInstance(metadata *apiresourcepb.ApiResourceMetadata) bool {
	return metadata.GetLabels()[DefaultInstanceLabel] == ReservedLabelTrue
}
