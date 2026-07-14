package stigmer

import (
	sessionv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
)

const defaultTarget = "api.stigmer.ai:443"

// clientConfig holds resolved configuration for Client construction.
type clientConfig struct {
	target          string
	apiKey          string
	token           string
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

// WithAPIKey authenticates using a Stigmer API key (e.g. "sk_live_...").
// Mutually exclusive with WithToken.
func WithAPIKey(key string) ClientOption {
	return func(c *clientConfig) {
		c.apiKey = key
	}
}

// WithToken authenticates using a bearer token obtained from interactive login
// (e.g. "stigmer auth login"). Mutually exclusive with WithAPIKey.
func WithToken(token string) ClientOption {
	return func(c *clientConfig) {
		c.token = token
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
// Useful for long-running streams (e.g. execution subscriptions) where
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

// WithExecutionTarget sets the default execution target for all sessions
// and workflow executions created through this client.
//
// When set, Session.Create() and WorkflowExecution.Create() apply this
// as the default when the per-call input does not specify an explicit
// ExecutionTarget. This is an app-level setting, not a per-session choice.
//
//	client, _ := stigmer.NewClient(
//	    stigmer.WithAPIKey("sk_live_..."),
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
// after session/execution creation and on terminal phase detection. Cloud
// consumers omit this option entirely.
//
//	client, _ := stigmer.NewClient(
//	    stigmer.WithAPIKey("sk_live_..."),
//	    stigmer.WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
//	    stigmer.WithRunnerAdapter(myAdapter),
//	)
func WithRunnerAdapter(adapter RunnerAdapter) ClientOption {
	return func(c *clientConfig) {
		c.runnerAdapter = adapter
	}
}
