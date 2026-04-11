package environment

import (
	"context"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Environment service.
//
// Architecture Note: This client lives OUTSIDE the environment domain because it's
// infrastructure for calling the environment service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the environment service.
//
// This implementation uses in-process gRPC with bufconn, ensuring:
//   - All gRPC interceptors execute (validation, logging, api_resource_kind injection, etc.)
//   - All middleware runs before handlers
//   - Full gRPC request/response lifecycle
//   - Zero network overhead (in-process communication)
//
// Implementation Notes:
//   - Real gRPC calls: Uses bufconn for in-process gRPC with full interceptor chain
//   - Blocking calls: Synchronous environment operations via blocking stub
//   - Migration-ready: Can be swapped with network gRPC for microservices
//   - Propagates context: Uses provided context for authentication/authorization
//
// Migration to Microservices:
// When splitting to separate services, this client will be deployed with services that
// need to call the environment service. Simply replace the in-process gRPC connection
// with a network gRPC connection pointing to the environment service endpoint.
// No changes to this client code are needed - just the connection configuration.
type Client struct {
	conn          *grpc.ClientConn
	queryClient   environmentv1.EnvironmentQueryControllerClient
	commandClient environmentv1.EnvironmentCommandControllerClient
}

// NewClient creates a new in-process Environment client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:          conn,
		queryClient:   environmentv1.NewEnvironmentQueryControllerClient(conn),
		commandClient: environmentv1.NewEnvironmentCommandControllerClient(conn),
	}
}

// GetByReference retrieves an environment by its org/kind/slug reference.
//
// This makes an in-process gRPC call to EnvironmentQueryController.GetByReference()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: During agent execution creation, environment_refs from the AgentInstance
// are resolved to full Environment resources so their data can be merged into the
// ExecutionContext.
func (c *Client) GetByReference(ctx context.Context, ref *apiresource.ApiResourceReference) (*environmentv1.Environment, error) {
	log.Debug().
		Str("org", ref.GetOrg()).
		Str("slug", ref.GetSlug()).
		Msg("Getting environment by reference via in-process gRPC")

	env, err := c.queryClient.GetByReference(ctx, ref)
	if err != nil {
		log.Error().
			Err(err).
			Str("org", ref.GetOrg()).
			Str("slug", ref.GetSlug()).
			Msg("Failed to get environment by reference")
		return nil, err
	}

	log.Debug().
		Str("id", env.GetMetadata().GetId()).
		Str("name", env.GetMetadata().GetName()).
		Msg("Successfully retrieved environment")

	return env, nil
}

// List retrieves environments filtered by organization and optional labels.
//
// This makes an in-process gRPC call to EnvironmentQueryController.List()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: During execution context creation, the caller's personal
// environment (labeled stigmer.ai/personal=true) is looked up so that
// workspace-provisioning keys like GITHUB_TOKEN can be injected.
func (c *Client) List(ctx context.Context, req *environmentv1.ListEnvironmentsRequest) (*environmentv1.EnvironmentList, error) {
	log.Debug().
		Str("org", req.GetOrg()).
		Int("label_count", len(req.GetLabels())).
		Msg("Listing environments via in-process gRPC")

	list, err := c.queryClient.List(ctx, req)
	if err != nil {
		log.Error().
			Err(err).
			Str("org", req.GetOrg()).
			Msg("Failed to list environments")
		return nil, err
	}

	log.Debug().
		Int32("total_count", list.GetTotalCount()).
		Msg("Successfully listed environments")

	return list, nil
}

// GetSecretValue retrieves a single unredacted secret value from an environment.
//
// This makes an in-process gRPC call to EnvironmentQueryController.GetSecretValue()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: After locating the caller's personal environment, the decrypted
// GITHUB_TOKEN is retrieved so it can be injected into the ExecutionContext
// for workspace provisioning (git clone of private repositories).
func (c *Client) GetSecretValue(ctx context.Context, input *environmentv1.EnvironmentSecretValueInput) (*environmentv1.EnvironmentValue, error) {
	log.Debug().
		Str("environment_id", input.GetEnvironmentId()).
		Str("key", input.GetKey()).
		Msg("Getting secret value via in-process gRPC")

	val, err := c.queryClient.GetSecretValue(ctx, input)
	if err != nil {
		log.Error().
			Err(err).
			Str("environment_id", input.GetEnvironmentId()).
			Str("key", input.GetKey()).
			Msg("Failed to get secret value")
		return nil, err
	}

	log.Debug().
		Str("environment_id", input.GetEnvironmentId()).
		Str("key", input.GetKey()).
		Msg("Successfully retrieved secret value")

	return val, nil
}

// UpdateVariables adds or updates specific variables in an environment.
// Existing keys not in the variables map are left unchanged.
//
// This makes an in-process gRPC call to EnvironmentCommandController.UpdateVariables()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Use case: Storing OAuth access tokens and refresh tokens in the user's
// personal environment after a successful OAuth code exchange.
func (c *Client) UpdateVariables(ctx context.Context, req *environmentv1.UpdateEnvironmentVariablesRequest) (*environmentv1.Environment, error) {
	log.Debug().
		Str("environment_id", req.GetEnvironmentId()).
		Int("variable_count", len(req.GetVariables())).
		Msg("Updating environment variables via in-process gRPC")

	env, err := c.commandClient.UpdateVariables(ctx, req)
	if err != nil {
		log.Error().
			Err(err).
			Str("environment_id", req.GetEnvironmentId()).
			Msg("Failed to update environment variables")
		return nil, err
	}

	log.Debug().
		Str("environment_id", req.GetEnvironmentId()).
		Msg("Successfully updated environment variables")

	return env, nil
}

// Create creates a new environment resource.
//
// Use case: Auto-creating a personal environment when one doesn't exist
// during OAuth token storage.
func (c *Client) Create(ctx context.Context, env *environmentv1.Environment) (*environmentv1.Environment, error) {
	log.Debug().
		Str("org", env.GetMetadata().GetOrg()).
		Str("name", env.GetMetadata().GetName()).
		Msg("Creating environment via in-process gRPC")

	created, err := c.commandClient.Create(ctx, env)
	if err != nil {
		log.Error().
			Err(err).
			Str("org", env.GetMetadata().GetOrg()).
			Str("name", env.GetMetadata().GetName()).
			Msg("Failed to create environment")
		return nil, err
	}

	log.Debug().
		Str("id", created.GetMetadata().GetId()).
		Str("name", created.GetMetadata().GetName()).
		Msg("Successfully created environment")

	return created, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
