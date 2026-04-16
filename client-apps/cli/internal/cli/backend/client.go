package backend

import (
	"context"
	"os"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"google.golang.org/grpc/keepalive"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// resolveCloudToken returns the bearer token for cloud mode with the
// documented priority:
//
//  1. STIGMER_API_KEY env var (highest — for CI/CD, scripts, --api-key flag)
//  2. backend.cloud.token from config (normal interactive login flow)
func resolveCloudToken(cfg *config.Config) string {
	if apiKey := os.Getenv("STIGMER_API_KEY"); apiKey != "" {
		return apiKey
	}
	if cfg.Backend.Cloud != nil {
		return cfg.Backend.Cloud.Token
	}
	return ""
}

// NewStigmerClient creates a Stigmer SDK client based on the current CLI config.
//
// Works with both local daemon (localhost:7234) and cloud (api.stigmer.ai:443).
// The client connection is eagerly established (blocks until ready or timeout).
func NewStigmerClient() (*stigmer.Client, error) {
	cfg, err := config.Load()
	if err != nil {
		return nil, errors.Wrap(err, "failed to load config")
	}

	return NewStigmerClientFromConfig(cfg)
}

// NewStigmerClientFromConfig creates a Stigmer SDK client from an already-loaded config.
func NewStigmerClientFromConfig(cfg *config.Config) (*stigmer.Client, error) {
	opts := []stigmer.ClientOption{
		stigmer.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                30 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: false,
		}),
	}

	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		endpoint := "localhost:7234"
		if testAddr := os.Getenv("STIGMER_SERVER_ADDR"); testAddr != "" {
			endpoint = testAddr
		}
		opts = append(opts, stigmer.WithBaseURL(endpoint), stigmer.WithInsecure())

	case config.BackendTypeCloud:
		if cfg.Backend.Cloud == nil {
			cfg.Backend.Cloud = &config.CloudBackendConfig{}
		}
		endpoint := cfg.Backend.Cloud.Endpoint
		if endpoint == "" {
			endpoint = "api.stigmer.ai:443"
		}
		opts = append(opts, stigmer.WithBaseURL(endpoint))

		token := resolveCloudToken(cfg)
		if token == "" {
			return nil, errors.New("cloud backend requires authentication — run 'stigmer auth login' or set STIGMER_API_KEY")
		}
		opts = append(opts, stigmer.WithToken(token))

	default:
		return nil, errors.Errorf("unknown backend type: %s", cfg.Backend.Type)
	}

	client, err := stigmer.NewClient(opts...)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create client")
	}

	log.Debug().
		Str("backend", string(cfg.Backend.Type)).
		Msg("Stigmer SDK client created")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Connect(ctx); err != nil {
		client.Close()
		return nil, err
	}

	return client, nil
}
