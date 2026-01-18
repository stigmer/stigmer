package agent

import (
	"context"
	"fmt"

	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// Get retrieves an agent by ID
func (c *AgentController) Get(ctx context.Context, agentId *agentv1.AgentId) (*agentv1.Agent, error) {
	if agentId == nil || agentId.Value == "" {
		return nil, grpclib.InvalidArgumentError("agent id is required")
	}

	agent := &agentv1.Agent{}
	if err := c.store.GetResource(ctx, agentId.Value, agent); err != nil {
		return nil, grpclib.NotFoundError("Agent", agentId.Value)
	}

	return agent, nil
}

// GetByReference retrieves an agent by reference (slug)
func (c *AgentController) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*agentv1.Agent, error) {
	if ref == nil {
		return nil, grpclib.InvalidArgumentError("reference is required")
	}

	// Try to get by slug
	if ref.Slug != "" {
		return c.findByName(ctx, ref.Slug, ref.Org)
	}

	return nil, grpclib.InvalidArgumentError("slug is required")
}

// findByName finds an agent by name (helper function)
func (c *AgentController) findByName(ctx context.Context, name string, orgID string) (*agentv1.Agent, error) {
	// List all agents and filter by name
	// Note: This is not efficient for large datasets, but acceptable for local usage
	var resources [][]byte
	var err error

	if orgID != "" {
		resources, err = c.store.ListResourcesByOrg(ctx, "Agent", orgID)
	} else {
		resources, err = c.store.ListResources(ctx, "Agent")
	}

	if err != nil {
		return nil, grpclib.InternalError(err, "failed to list agents")
	}

	for _, data := range resources {
		agent := &agentv1.Agent{}
		// BadgerDB returns proto bytes (not JSON), so use proto.Unmarshal
		if err := proto.Unmarshal(data, agent); err != nil {
			continue
		}

		if agent.Metadata.Name == name {
			// Check org filter if provided
			if orgID != "" && agent.Metadata.Org != orgID {
				continue
			}
			return agent, nil
		}
	}

	return nil, grpclib.WrapError(nil, codes.NotFound, fmt.Sprintf("agent not found with name: %s", name))
}
