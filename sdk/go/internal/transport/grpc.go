package transport

import (
	"crypto/tls"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

// Config holds the settings needed to establish a gRPC connection.
type Config struct {
	Target          string
	BearerToken     string
	Insecure        bool
	KeepaliveParams *keepalive.ClientParameters
	DialOptions     []grpc.DialOption
}

// Dial creates a gRPC client connection using the given config.
// The returned connection is lazily established (non-blocking by default).
// Use [grpc.ClientConn.Connect] followed by state checks to eagerly verify
// connectivity when needed.
func Dial(cfg Config) (*grpc.ClientConn, error) {
	if cfg.Target == "" {
		return nil, fmt.Errorf("stigmer: target URL is required")
	}

	opts := make([]grpc.DialOption, 0, len(cfg.DialOptions)+4)

	if cfg.Insecure {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{})))
	}

	if cfg.BearerToken != "" {
		opts = append(opts,
			grpc.WithUnaryInterceptor(unaryAuthInterceptor(cfg.BearerToken)),
			grpc.WithStreamInterceptor(streamAuthInterceptor(cfg.BearerToken)),
		)
	}

	if cfg.KeepaliveParams != nil {
		opts = append(opts, grpc.WithKeepaliveParams(*cfg.KeepaliveParams))
	}

	opts = append(opts, cfg.DialOptions...)

	return grpc.NewClient(cfg.Target, opts...)
}
