package stigmer

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/internal/gen"
	"github.com/stigmer/stigmer/sdk/go/internal/transport"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
)

// Client is the top-level Stigmer API client.
// Create one with NewClient and use the resource-specific sub-clients
// to interact with the Stigmer platform.
//
// All resource clients (Agent, Skill, Organization, etc.) are available
// via the embedded gen.Client. The Search and GitHub clients are added separately.
type Client struct {
	*gen.Client
	Search *SearchClient
	GitHub *GitHubClient

	conn *grpc.ClientConn
}

// NewClient creates a new Stigmer API client.
//
// Authentication is configured via options:
//
//	// API key authentication (CI, scripts)
//	client, err := stigmer.NewClient(stigmer.WithAPIKey("sk_live_abc123"))
//
//	// Token authentication (interactive login)
//	client, err := stigmer.NewClient(stigmer.WithToken(loginToken))
//
//	// Local development (no credentials required)
//	client, err := stigmer.NewClient(stigmer.WithBaseURL("localhost:7234"), stigmer.WithInsecure())
//
// For non-insecure targets, either WithAPIKey or WithToken must be provided.
// The connection is established lazily; call [Client.Connect] to eagerly
// verify connectivity.
func NewClient(opts ...ClientOption) (*Client, error) {
	cfg := defaultConfig()
	for _, opt := range opts {
		opt(&cfg)
	}

	if cfg.apiKey != "" && cfg.token != "" {
		return nil, fmt.Errorf("stigmer: WithAPIKey and WithToken are mutually exclusive — use one or the other")
	}

	bearerToken := cfg.apiKey
	if bearerToken == "" {
		bearerToken = cfg.token
	}

	if bearerToken == "" && !cfg.insecure {
		return nil, fmt.Errorf("stigmer: credentials required — use WithAPIKey or WithToken (or WithInsecure for local development)")
	}

	conn, err := transport.Dial(transport.Config{
		Target:          cfg.target,
		BearerToken:     bearerToken,
		Insecure:        cfg.insecure,
		KeepaliveParams: cfg.keepaliveParams,
		DialOptions:     cfg.dialOptions,
	})
	if err != nil {
		return nil, fmt.Errorf("stigmer: failed to connect: %w", err)
	}

	return &Client{
		Client: gen.NewClient(conn),
		Search: newSearchClient(conn),
		GitHub: newGitHubClient(conn),
		conn:   conn,
	}, nil
}

// Connect triggers an eager connection attempt and blocks until the
// connection is ready or the context expires. Use this when you need to
// verify server reachability before proceeding (e.g. in CLI tools).
//
//	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
//	defer cancel()
//	if err := client.Connect(ctx); err != nil {
//	    log.Fatal("server unreachable:", err)
//	}
func (c *Client) Connect(ctx context.Context) error {
	c.conn.Connect()
	for {
		state := c.conn.GetState()
		if state == connectivity.Ready {
			return nil
		}
		if state == connectivity.Shutdown {
			return fmt.Errorf("stigmer: connection shut down")
		}
		if !c.conn.WaitForStateChange(ctx, state) {
			return fmt.Errorf("stigmer: failed to connect to %s: %w", c.conn.Target(), ctx.Err())
		}
	}
}

// Conn returns the underlying gRPC client connection.
// This is useful during incremental migration from raw gRPC stubs to SDK
// methods. Prefer using the typed sub-clients (Agent, Session, etc.) when
// the SDK covers the needed RPC.
func (c *Client) Conn() grpc.ClientConnInterface {
	return c.conn
}

// Close releases the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
