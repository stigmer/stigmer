package agentinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches an agent instance from the backend by reference.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*agentinstancev1.AgentInstance, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent instance reference")
	}

	client := agentinstancev1.NewAgentInstanceQueryControllerClient(conn)
	ctx := context.Background()

	var result *agentinstancev1.AgentInstance

	if parsed.IsID {
		result, err = client.Get(ctx, &agentinstancev1.AgentInstanceId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent instance by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_agent_instance,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent instance '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}

// GetOptions contains options for fetching an agent instance.
type GetOptions struct {
	Reference string
	OrgID     string
	Conn      grpc.ClientConnInterface
}

// Get fetches an agent instance from the backend using the provided options.
func Get(opts *GetOptions) (*agentinstancev1.AgentInstance, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, fmt.Errorf("gRPC connection cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("agent instance reference cannot be empty")
	}
	return GetFromBackend(opts.Conn, opts.OrgID, opts.Reference)
}
