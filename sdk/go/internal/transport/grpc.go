package transport

import (
	"context"
	"crypto/tls"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
)

// Config holds the settings needed to establish a gRPC connection.
type Config struct {
	Target      string
	BearerToken string
	// TokenFunc, when set, is asked for the bearer token on every call, in
	// place of BearerToken (the client refuses both).
	TokenFunc       func(ctx context.Context) (string, error)
	Insecure        bool
	KeepaliveParams *keepalive.ClientParameters
	DialOptions     []grpc.DialOption
}

// maxRecvMsgSize raises the client's receive cap to the server's own 10MB
// message limit (stigmer#702). grpc-go's default is 4MB — an invisible
// library default BELOW the platform's documented behavior, so responses
// the server would happily serve (e.g. a 4–10MB skill.getArtifact) died
// client-side with "received message larger than max". The server stays
// the single limiting authority; callers can still override via DialOptions.
const maxRecvMsgSize = 10 * 1024 * 1024

// Dial creates a gRPC client connection using the given config.
// The returned connection is lazily established (non-blocking by default).
// Use [grpc.ClientConn.Connect] followed by state checks to eagerly verify
// connectivity when needed.
func Dial(cfg Config) (*grpc.ClientConn, error) {
	if cfg.Target == "" {
		return nil, fmt.Errorf("stigmer: target URL is required")
	}

	opts := make([]grpc.DialOption, 0, len(cfg.DialOptions)+5)

	opts = append(opts, grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(maxRecvMsgSize)))

	if cfg.Insecure {
		opts = append(opts, grpc.WithTransportCredentials(insecure.NewCredentials()))
	} else {
		opts = append(opts, grpc.WithTransportCredentials(credentials.NewTLS(&tls.Config{})))
	}

	if cfg.TokenFunc != nil {
		opts = append(opts,
			grpc.WithUnaryInterceptor(unaryAuthInterceptor(cfg.TokenFunc)),
			grpc.WithStreamInterceptor(streamAuthInterceptor(cfg.TokenFunc)),
		)
	} else if cfg.BearerToken != "" {
		fixed := fixedToken(cfg.BearerToken)
		opts = append(opts,
			grpc.WithUnaryInterceptor(unaryAuthInterceptor(fixed)),
			grpc.WithStreamInterceptor(streamAuthInterceptor(fixed)),
		)
	}

	if cfg.KeepaliveParams != nil {
		opts = append(opts, grpc.WithKeepaliveParams(*cfg.KeepaliveParams))
	}

	opts = append(opts, cfg.DialOptions...)

	return grpc.NewClient(cfg.Target, opts...)
}
