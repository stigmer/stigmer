package stigmer

import "google.golang.org/grpc"

const defaultTarget = "api.stigmer.ai:443"

// clientConfig holds resolved configuration for Client construction.
type clientConfig struct {
	target      string
	insecure    bool
	dialOptions []grpc.DialOption
}

func defaultConfig() clientConfig {
	return clientConfig{
		target: defaultTarget,
	}
}

// ClientOption configures the Stigmer client.
type ClientOption func(*clientConfig)

// WithBaseURL sets the gRPC target address (host:port).
func WithBaseURL(target string) ClientOption {
	return func(c *clientConfig) {
		c.target = target
	}
}

// WithInsecure disables TLS. Use only for local development.
func WithInsecure() ClientOption {
	return func(c *clientConfig) {
		c.insecure = true
	}
}

// WithDialOptions appends additional gRPC dial options.
func WithDialOptions(opts ...grpc.DialOption) ClientOption {
	return func(c *clientConfig) {
		c.dialOptions = append(c.dialOptions, opts...)
	}
}
