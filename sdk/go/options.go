package stigmer

import (
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
