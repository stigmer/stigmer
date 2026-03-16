package transport

import (
	"crypto/tls"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// Config holds the settings needed to establish a gRPC connection.
type Config struct {
	Target      string
	APIKey      string
	Insecure    bool
	DialOptions []grpc.DialOption
}

// Dial creates a gRPC client connection using the given config.
// The returned connection is lazily established (non-blocking by default).
func Dial(cfg Config) (*grpc.ClientConn, error) {
	if cfg.Target == "" {
		return nil, fmt.Errorf("stigmer: target URL is required")
	}

	opts := make([]grpc.DialOption, 0, len(cfg.DialOptions)+3)

	if cfg.Insecure {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{})))
	}

	if cfg.APIKey != "" {
		opts = append(opts,
			grpc.WithUnaryInterceptor(unaryAuthInterceptor(cfg.APIKey)),
			grpc.WithStreamInterceptor(streamAuthInterceptor(cfg.APIKey)),
		)
	}

	opts = append(opts, cfg.DialOptions...)

	return grpc.NewClient(cfg.Target, opts...)
}
