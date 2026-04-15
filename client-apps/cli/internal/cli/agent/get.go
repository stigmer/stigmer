// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// GetFromBackend fetches an agent from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*agentv1.Agent, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent reference")
	}

	ctx := context.Background()

	var result *agentv1.Agent

	if parsed.IsID {
		result, err = client.Agent.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get agent by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.Agent.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
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
	Reference string
	OrgID     string
	Client    *stigmer.Client
}

// Get fetches an agent from the backend using the provided options.
func Get(opts *GetOptions) (*agentv1.Agent, error) {
	if opts == nil {
		return nil, fmt.Errorf("get options cannot be nil")
	}
	if opts.Client == nil {
		return nil, fmt.Errorf("client cannot be nil")
	}
	if opts.Reference == "" {
		return nil, fmt.Errorf("agent reference cannot be empty")
	}
	return GetFromBackend(opts.Client, opts.OrgID, opts.Reference)
}
