// Package agent provides CLI utilities for managing Agent resources.
package agent

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// ApplyOptions contains options for applying an Agent configuration.
type ApplyOptions struct {
	// Agent is the Agent proto to apply.
	Agent *agentv1.Agent
	// OrgID is the organization ID for the resource.
	OrgID string
	// Client is the Stigmer SDK client.
	Client *stigmer.Client
	// Quiet suppresses detailed output.
	Quiet bool
	// DryRun validates without applying.
	DryRun bool
}

// ApplyResult contains the result of applying an Agent configuration.
type ApplyResult struct {
	// Agent is the applied Agent (from server response).
	Agent *agentv1.Agent
	// Created is true if resource was created, false if updated.
	Created bool
}

// Apply applies an Agent configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if opts.Agent == nil {
		return nil, fmt.Errorf("agent is required")
	}

	if opts.Client == nil {
		return nil, fmt.Errorf("client is required")
	}

	if opts.Agent.Metadata == nil {
		opts.Agent.Metadata = &apiresource.ApiResourceMetadata{}
	}

	if opts.Agent.Metadata.Org == "" && opts.OrgID != "" {
		opts.Agent.Metadata.Org = opts.OrgID
	}

	if opts.DryRun {
		if !opts.Quiet {
			climsg.Info("Dry run mode - configuration is valid")
			displayAgentSummary(opts.Agent)
		}
		return &ApplyResult{
			Agent:   opts.Agent,
			Created: false,
		}, nil
	}

	isCreate := opts.Agent.Metadata.Id == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating agent: %s", opts.Agent.Metadata.Name)
		} else {
			climsg.Info("Updating agent: %s", opts.Agent.Metadata.Name)
		}
	}

	result, err := opts.Client.Agent.Apply(context.Background(), stigmer.AgentInputFromProto(opts.Agent))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply agent")
	}

	return &ApplyResult{
		Agent:   result,
		Created: isCreate,
	}, nil
}
