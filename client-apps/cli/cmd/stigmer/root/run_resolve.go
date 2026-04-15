package root

import (
	"context"
	"fmt"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	agentv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agent/v1"
	"google.golang.org/grpc"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/backend"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
)

// connectToBackend creates a Stigmer SDK client and returns it with the organization ID.
// For local backend, it ensures the daemon is running before connecting and
// retries transient connection failures with backoff.
func connectToBackend(orgOverride string) (*stigmer.Client, string, error) {
	cfg, err := config.Load()
	if err != nil {
		climsg.Error("Failed to load configuration: %s", err)
		return nil, "", err
	}

	orgID := resolveOrgID(orgOverride, cfg)
	if orgID == "" {
		printOrgNotSetError()
		return nil, "", fmt.Errorf("organization not set")
	}

	if cfg.Backend.Type == config.BackendTypeLocal {
		dataDir, err := config.GetDataDir()
		if err != nil {
			return nil, "", errors.Wrap(err, "failed to get data directory")
		}
		if err := daemon.EnsureRunning(dataDir); err != nil {
			return nil, "", errors.Wrap(err, "failed to start daemon")
		}
	}

	const maxAttempts = 3
	const retryDelay = 2 * time.Second

	var client *stigmer.Client
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		client, err = backend.NewStigmerClient()
		if err == nil {
			return client, orgID, nil
		}
		if attempt < maxAttempts {
			log.Debug().Err(err).Int("attempt", attempt).Msg("Connection failed, retrying")
			time.Sleep(retryDelay)
		}
	}

	climsg.Error("Failed to connect to backend: %s", err)
	return nil, "", err
}

// resolveOrgID determines the organization ID from override or config context.
// The same chain applies regardless of backend type (local or cloud).
func resolveOrgID(orgOverride string, cfg *config.Config) string {
	if orgOverride != "" {
		return orgOverride
	}
	return cfg.ResolveContextOrganization()
}

// printOrgNotSetError displays the organization not set error message
func printOrgNotSetError() {
	climsg.Error("Organization not set")
	climsg.Info("")
	climsg.Info("Set organization with:")
	climsg.Info("  stigmer config context set --org <org-id>")
	climsg.Info("")
	climsg.Info("Or use --org flag:")
	climsg.Info("  stigmer run --org <org-id>")
	fmt.Println()
}

// resolveAgent resolves an agent by ID, org/slug, or slug (with context org).
//
// Supported reference formats:
//   - "agt_xxx": Agent ID (direct lookup)
//   - "org/slug": Explicit organization and slug
//   - "slug": Uses orgID as the organization context
func resolveAgent(ref string, orgID string, conn grpc.ClientConnInterface) (*agentv1.Agent, error) {
	client := agentv1.NewAgentQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Parse the reference (handles ID detection and org/slug parsing)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid agent reference")
	}

	// If it's an ID, fetch directly
	if parsed.IsID {
		agent, err := client.Get(ctx, &agentv1.AgentId{Value: parsed.ID})
		if err != nil {
			return nil, errors.Wrap(err, "agent not found")
		}
		return agent, nil
	}

	// Lookup by org/slug using GetByReference
	agent, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  parsed.Org,
		Kind: apiresourcekind.ApiResourceKind_agent,
		Slug: parsed.Slug,
	})
	if err != nil {
		return nil, errors.Wrap(err, "agent not found")
	}

	return agent, nil
}

// resolveWorkflow resolves a workflow by ID, org/slug, or slug (with context org).
//
// Supported reference formats:
//   - "wf_xxx": Workflow ID (direct lookup)
//   - "org/slug": Explicit organization and slug
//   - "slug": Uses orgID as the organization context
func resolveWorkflow(ref string, orgID string, conn grpc.ClientConnInterface) (*workflowv1.Workflow, error) {
	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Parse the reference (handles ID detection and org/slug parsing)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid workflow reference")
	}

	// If it's an ID, fetch directly
	if parsed.IsID {
		workflow, err := client.Get(ctx, &workflowv1.WorkflowId{Value: parsed.ID})
		if err != nil {
			return nil, errors.Wrap(err, "workflow not found")
		}
		return workflow, nil
	}

	// Lookup by org/slug using GetByReference
	workflow, err := client.GetByReference(ctx, &apiresource.ApiResourceReference{
		Org:  parsed.Org,
		Kind: apiresourcekind.ApiResourceKind_workflow,
		Slug: parsed.Slug,
	})
	if err != nil {
		return nil, errors.Wrap(err, "workflow not found")
	}

	return workflow, nil
}
