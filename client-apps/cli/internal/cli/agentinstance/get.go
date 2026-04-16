package agentinstance

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentinstancev1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentinstance/v1"
)

// GetFromBackend fetches an agent instance from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*agentinstancev1.AgentInstance, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent instance reference")
	}

	ctx := context.Background()

	var result *agentinstancev1.AgentInstance

	if parsed.IsID {
		result, err = client.AgentInstance.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent instance by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.AgentInstance.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
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
	Client    *stigmer.Client
}

// Get fetches an agent instance from the backend using the provided options.
func Get(opts *GetOptions) (*agentinstancev1.AgentInstance, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("agent instance reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
