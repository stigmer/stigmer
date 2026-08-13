// Package defaultinstance builds the canonical AgentInstance request for
// per-agent default instances — the OSS twin of the cloud edition's
// DefaultAgentInstanceFactory (stigmer-cloud
// backend/services/stigmer-service/.../domain/agentic/agentinstance/).
// Keep the two in sync.
//
// Every agent has exactly one default instance: an empty shell with no
// custom configuration that serves as the fallback when the user has no
// personal instance. This package is the single source of its naming
// convention and request shape, shared by every flow that creates one
// (agent create, session create's self-heal, agent-execution create) and
// by the agent delete cascade's slug fallback — previously four
// hand-rolled copies that could drift.
//
// Default instances carry no visibility of their own: their access always
// follows the parent agent (on cloud via the default_of FGA relation; on
// OSS by construction — the runner resolves the default instance through
// the blueprint). metadata.visibility is deliberately left unset here, and
// visibility updates on default instances are rejected by the
// agentinstance controller's RejectDefaultInstanceVisibilityUpdate step.
//
// Default instances are tagged with two reserved labels (see
// backend/libs/go/apiresource/labels.go): stigmer.ai/default-instance and
// stigmer.ai/system-managed. The labels are descriptive markers matching
// the cloud edition's stored shape — restrict-shaped decisions must also
// key on the parent's status.default_instance_id, which is server-owned
// (labels are client-suppliable, and instances created before this package
// existed carry none).
package defaultinstance

import (
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	apiresourcepb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
)

const (
	// apiVersion / kind match what every creation flow (and the cloud
	// edition's resolvers) put on AgentInstance requests.
	apiVersion = "agentic.stigmer.ai/v1"
	kind       = "AgentInstance"

	slugSuffix  = "-default"
	description = "Default instance (auto-created, no custom configuration)"
)

// Slug resolves the deterministic slug of an agent's default instance
// (<agent-slug>-default) — the single source of the naming convention,
// used by the creation flows and by the agent delete cascade's fallback
// when a legacy agent lacks status.default_instance_id.
func Slug(agentSlug string) string {
	return agentSlug + slugSuffix
}

// BuildRequest builds the AgentInstance proto for a default-instance
// creation request. Callers hand it to the agentinstance downstream client
// (Create/Apply AsSystem), which owns persistence and validation.
func BuildRequest(agentID, agentSlug, orgID string) *agentinstancev1.AgentInstance {
	return &agentinstancev1.AgentInstance{
		ApiVersion: apiVersion,
		Kind:       kind,
		Metadata: &apiresourcepb.ApiResourceMetadata{
			Name: Slug(agentSlug),
			Org:  orgID,
			Labels: map[string]string{
				apiresource.DefaultInstanceLabel: apiresource.ReservedLabelTrue,
				apiresource.SystemManagedLabel:   apiresource.ReservedLabelTrue,
			},
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId:     agentID,
			Description: description,
		},
	}
}
