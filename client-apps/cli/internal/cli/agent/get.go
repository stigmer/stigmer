// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an agent from the backend by reference.
// The reference can be a slug (e.g., "my-agent"), org/slug (e.g., "stigmer/my-agent"),
// or a resource ID (e.g., "agt_abc123").
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - orgID: Organization ID for context (used when reference is slug-only)
//   - ref: Resource reference string
//
// Returns the Agent proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*agentv1.Agent, error) {
	// Parse the reference (handles slug, org/slug, and resource ID)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent reference")
	}

	client := agentv1.NewAgentQueryControllerClient(conn)
	ctx := context.Background()

	var result *agentv1.Agent

	if parsed.IsID {
		// Get by resource ID
		result, err = client.Get(ctx, &agentv1.AgentId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent by ID '%s'", parsed.ID)
		}
	} else {
		// Get by org/slug reference
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_agent,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an agent.
type GetOptions struct {
	// Reference is the agent reference (slug, org/slug, or resource ID).
	Reference string
	// OrgID is the organization ID for context (used when reference is slug-only).
	OrgID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// Get fetches an agent from the backend using the provided options.
// This is a convenience wrapper around GetFromBackend for structured options.
func Get(opts *GetOptions) (*agentv1.Agent, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("agent reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
