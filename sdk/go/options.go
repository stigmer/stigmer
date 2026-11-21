package stigmer

import (
	"context"

	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
)

const defaultTarget = "api.stigmer.ai:443"

// clientConfig holds resolved configuration for Client construction.
type clientConfig struct {
	target          string
	apiKey          string
	token           string
	tokenFunc       func(ctx context.Context) (string, error)
	insecure        bool
	keepaliveParams *keepalive.ClientParameters
	dialOptions     []grpc.DialOption
	executionTarget sessionv1.ExecutionTarget
	runnerAdapter   RunnerAdapter
}

func defaultConfig() clientConfig {
	return clientConfig{
		target: defaultTarget,
	}
}

// ClientOption configures the Stigmer client.
type ClientOption func(*clientConfig)

// WithAPIKey authenticates using a Stigmer API key (they read "stk_…").
// Mutually exclusive with WithToken and WithTokenFunc.
func WithAPIKey(key string) ClientOption {
	return func(c *clientConfig) {
		c.apiKey = key
	}
}

// WithToken authenticates with a fixed bearer token: one from interactive
// login ("stigmer auth login"), or a user token your backend minted. A minted
// token expires (15 minutes); to keep a client working past that, use
// WithTokenFunc over a TokenCache. Mutually exclusive with WithAPIKey and
// WithTokenFunc.
func WithToken(token string) ClientOption {
	return func(c *clientConfig) {
		c.token = token
	}
}

// WithTokenFunc authenticates with a bearer token fetched on every call: a
// backend acting as one of its product's signed-in users passes a
// TokenCache's Token method, which mints the person a token once and keeps
// it until a minute before it expires. What the client then starts is the
// person's own (their Session, their run).
//
//	admin, _ := stigmer.NewClient(stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")))
//	tokens := stigmer.NewTokenCache(func(ctx context.Context) (*stigmer.MintUserTokenResult, error) {
//	    return admin.Tokens.MintUserToken(ctx, &stigmer.MintUserTokenInput{Org: "acme", UserID: user.ID})
//	})
//	asUser, _ := stigmer.NewClient(stigmer.WithTokenFunc(tokens.Token))
//
// The call fails with the func's error, before any request is sent. An empty
// token is refused. Mutually exclusive with WithAPIKey and WithToken.
func WithTokenFunc(fn func(ctx context.Context) (string, error)) ClientOption {
	return func(c *clientConfig) {
		c.tokenFunc = fn
	}
}

// WithBaseURL sets the gRPC target address (host:port).
func WithBaseURL(target string) ClientOption {
	return func(c *clientConfig) {
		c.target = target
	}
}

// WithInsecure disables TLS. Use only for local development.
// Credentials are optional when insecure mode is enabled.
func WithInsecure() ClientOption {
	return func(c *clientConfig) {
		c.insecure = true
	}
}

// WithKeepaliveParams configures gRPC transport-level keepalive.
// Useful for long-running streams (e.g. run subscriptions) where
// idle-connection detection is needed.
func WithKeepaliveParams(params keepalive.ClientParameters) ClientOption {
	return func(c *clientConfig) {
		c.keepaliveParams = &params
	}
}

// WithDialOptions appends additional gRPC dial options.
func WithDialOptions(opts ...grpc.DialOption) ClientOption {
	return func(c *clientConfig) {
		c.dialOptions = append(c.dialOptions, opts...)
	}
}

// WithExecutionTarget sets the default execution target for every session
// created through this client.
//
// When set, Session.Create() applies this as the default when the per-call
// input does not specify an explicit ExecutionTarget. This is an app-level
// setting, not a per-session choice.
//
//	client, _ := stigmer.NewClient(
//	    stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")),
//	    stigmer.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
//	)
func WithExecutionTarget(target sessionv1.ExecutionTarget) ClientOption {
	return func(c *clientConfig) {
		c.executionTarget = target
	}
}

// WithRunnerAdapter sets the runner adapter for local execution lifecycle
// management.
//
// When ExecutionTarget is LOCAL, the SDK automatically calls adapter methods
// after session/run creation and on terminal phase detection. Cloud
// consumers omit this option entirely.
//
//	client, _ := stigmer.NewClient(
//	    stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")),
//	    stigmer.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
//	    stigmer.WithRunnerAdapter(myAdapter),
//	)
func WithRunnerAdapter(adapter RunnerAdapter) ClientOption {
	return func(c *clientConfig) {
		c.runnerAdapter = adapter
	}
}
