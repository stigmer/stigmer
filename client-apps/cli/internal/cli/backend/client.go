package backend

import (
	"context"
	"os"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// Client is the gRPC client for communicating with stigmer-server
//
// Works with both local daemon (localhost:7234) and cloud (api.stigmer.ai:443)
// The only difference is the endpoint and whether TLS is used.
//
// Local:  localhost:7234 (insecure)
// Cloud:  api.stigmer.ai:443 (TLS + auth token)
type Client struct {
	endpoint string
	conn     *grpc.ClientConn
	isCloud  bool
	token    string // auth token for cloud mode

	// gRPC service clients
	agentCommand  agentv1.AgentCommandControllerClient
	agentQuery    agentv1.AgentQueryControllerClient
	workflowCommand workflowv1.WorkflowCommandControllerClient
	workflowQuery   workflowv1.WorkflowQueryControllerClient
}

// NewConnection creates a new gRPC connection based on current config
// This is a convenience function for commands that just need a connection
func NewConnection() (*grpc.ClientConn, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, errors.Wrap(err, "failed to load config")
	}

	client, err := NewClient(cfg)
	if err != nil {
		return nil, err
	}

	// Use a reasonable timeout for connection (10 seconds)
	// This gives the server time to start up if needed, but fails fast if unreachable
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Connect(ctx); err != nil {
		return nil, err
	}

	return client.conn, nil
}

// NewClient creates a new gRPC client based on config
func NewClient(cfg *config.Config) (*Client, error) {
	var endpoint string
	var isCloud bool
	var token string

	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		// Local mode: Use hardcoded port 7234 by default
		// Allow override via STIGMER_SERVER_ADDR for testing
		endpoint = "localhost:7234" // Temporal + 1, managed by daemon
		if testAddr := os.Getenv("STIGMER_SERVER_ADDR"); testAddr != "" {
			endpoint = testAddr
		}
		isCloud = false

	case config.BackendTypeCloud:
		if cfg.Backend.Cloud == nil {
			return nil, errors.New("cloud backend config is missing")
		}
		endpoint = cfg.Backend.Cloud.Endpoint
		if endpoint == "" {
			endpoint = "api.stigmer.ai:443" // default cloud endpoint
		}
		token = cfg.Backend.Cloud.Token
		isCloud = true

	default:
		return nil, errors.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}

	return &Client{
		endpoint: endpoint,
		isCloud:  isCloud,
		token:    token,
	}, nil
}

// Connect establishes connection to the stigmer-server
func (c *Client) Connect(ctx context.Context) error {
	log.Debug().
		Str("endpoint", c.endpoint).
		Bool("is_cloud", c.isCloud).
		Msg("Connecting to stigmer-server")

	var opts []grpc.DialOption

	// Configure transport security
	if c.isCloud {
		// Cloud mode: Use TLS
		creds := credentials.NewClientTLSFromCert(nil, "")
		opts = append(opts, grpc.WithTransportCredentials(creds))

		// Add auth token interceptor
		if c.token != "" {
			opts = append(opts, grpc.WithUnaryInterceptor(c.authInterceptor))
		}
	} else {
		// Local mode: Insecure (localhost)
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	}

	// IMPORTANT: Use WithBlock() to block until connection is established
	// This ensures the connection is ready before returning, avoiding race conditions
	// The context timeout controls how long we wait (default 10s in most callers)
	opts = append(opts, grpc.WithBlock())

	// Establish connection - blocks until ready or context times out
	conn, err := grpc.DialContext(ctx, c.endpoint, opts...)
	if err != nil {
		return errors.Wrapf(err, "failed to connect to %s", c.endpoint)
	}
	c.conn = conn

	// Create service clients
	c.agentCommand = agentv1.NewAgentCommandControllerClient(conn)
	c.agentQuery = agentv1.NewAgentQueryControllerClient(conn)
	c.workflowCommand = workflowv1.NewWorkflowCommandControllerClient(conn)
	c.workflowQuery = workflowv1.NewWorkflowQueryControllerClient(conn)

	// Connection is guaranteed to be ready at this point (thanks to WithBlock)
	// No need for additional verification - the dial itself proves the server is reachable

	log.Info().
		Str("endpoint", c.endpoint).
		Str("mode", c.mode()).
		Msg("Connected to stigmer-server")

	return nil
}

// Close closes the gRPC connection
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// mode returns a human-readable mode string
func (c *Client) mode() string {
	if c.isCloud {
		return "cloud"
	}
	return "local"
}

// authInterceptor adds the authorization header for cloud mode
func (c *Client) authInterceptor(
	ctx context.Context,
	method string,
	req, reply interface{},
	cc *grpc.ClientConn,
	invoker grpc.UnaryInvoker,
	opts ...grpc.CallOption,
) error {
	// Add auth header to context
	ctx = c.addAuthHeader(ctx)
	return invoker(ctx, method, req, reply, cc, opts...)
}

// addAuthHeader adds the authorization header to context
func (c *Client) addAuthHeader(ctx context.Context) context.Context {
	if c.token == "" {
		return ctx
	}
	// TODO: Add actual auth header implementation
	// For now, just return context as-is
	return ctx
}

// Agent Operations

func (c *Client) CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	return c.agentCommand.Create(ctx, agent)
}

func (c *Client) GetAgent(ctx context.Context, id string) (*agentv1.Agent, error) {
	input := &agentv1.AgentId{Value: id}
	return c.agentQuery.Get(ctx, input)
}

func (c *Client) ListAgents(ctx context.Context) ([]*agentv1.Agent, error) {
	// TODO: List endpoint doesn't exist in proto yet
	// Return empty list for now
	return []*agentv1.Agent{}, nil
}

func (c *Client) UpdateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	return c.agentCommand.Update(ctx, agent)
}

func (c *Client) DeleteAgent(ctx context.Context, id string) error {
	input := &agentv1.AgentId{Value: id}
	_, err := c.agentCommand.Delete(ctx, input)
	return err
}

// Workflow Operations

func (c *Client) CreateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return c.workflowCommand.Create(ctx, workflow)
}

func (c *Client) GetWorkflow(ctx context.Context, id string) (*workflowv1.Workflow, error) {
	input := &workflowv1.WorkflowId{Value: id}
	return c.workflowQuery.Get(ctx, input)
}

func (c *Client) ListWorkflows(ctx context.Context) ([]*workflowv1.Workflow, error) {
	// TODO: List endpoint doesn't exist in proto yet
	// Return empty list for now
	return []*workflowv1.Workflow{}, nil
}

func (c *Client) UpdateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return c.workflowCommand.Update(ctx, workflow)
}

func (c *Client) DeleteWorkflow(ctx context.Context, id string) error {
	input := &workflowv1.WorkflowId{Value: id}
	_, err := c.workflowCommand.Delete(ctx, input)
	return err
}

// Ping tests connectivity to the server
// With grpc.WithBlock(), the connection is already verified during Connect()
// This method is kept for explicit health checks if needed
func (c *Client) Ping(ctx context.Context) error {
	if c.conn == nil {
		return errors.New("not connected - call Connect() first")
	}
	
	// Make a lightweight RPC call to verify server is still responsive
	// We use getByReference with an empty reference - the result doesn't matter
	ref := &apiresource.ApiResourceReference{}
	_, err := c.agentQuery.GetByReference(ctx, ref)
	
	// We expect NotFound or InvalidArgument - that's fine, server is reachable
	// We only care about Unavailable (server not running) or connection errors
	if err != nil {
		if st, ok := status.FromError(err); ok {
			// NotFound and InvalidArgument mean server is up (just didn't find the resource)
			if st.Code() != codes.NotFound && st.Code() != codes.InvalidArgument {
				return errors.Wrapf(err, "server not reachable at %s", c.endpoint)
			}
		} else {
			return errors.Wrapf(err, "failed to connect to %s", c.endpoint)
		}
	}
	
	log.Debug().
		Str("endpoint", c.endpoint).
		Str("mode", c.mode()).
		Msg("Server is responsive")
	
	return nil
}
