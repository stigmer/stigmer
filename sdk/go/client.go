package stigmer

import (
	"fmt"

	"github.com/stigmer/stigmer/sdk/go/internal/gen"
	"github.com/stigmer/stigmer/sdk/go/internal/transport"
	"google.golang.org/grpc"
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
//	client, err := stigmer.NewClient("sk_live_abc123")
//	client, err := stigmer.NewClient("sk_live_abc123", stigmer.WithBaseURL("localhost:9090"), stigmer.WithInsecure())
func NewClient(apiKey string, opts ...ClientOption) (*Client, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("stigmer: API key is required")
	}

	cfg := defaultConfig()
	for _, opt := range opts {
		opt(&cfg)
	}

	conn, err := transport.Dial(transport.Config{
		Target:      cfg.target,
		APIKey:      apiKey,
		Insecure:    cfg.insecure,
		DialOptions: cfg.dialOptions,
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

// Close releases the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
