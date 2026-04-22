package runner

import (
	"fmt"
	"net"
	"os"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
)

// BackendInfo holds the resolved connection details for the backend that the
// runner will register with and receive work from.
type BackendInfo struct {
	Endpoint          string
	Token             string
	Org               string
	IsLocal           bool
	TemporalAddress   string
	TemporalNamespace string
}

// ResolveOptions holds inputs for resolving which backend the runner should
// connect to. Flag values override config values, which override defaults.
type ResolveOptions struct {
	EndpointOverride string
	TokenOverride    string
	Config           *config.Config
}

// ResolveBackendInfo determines the backend endpoint and credentials for a
// standalone runner. The resolution follows a strict priority chain:
//
// Token:    --token flag > STIGMER_API_KEY env > config cloud token
// Endpoint: --endpoint flag > config endpoint > api.stigmer.ai:443
//
// When no token is found and the config is local, the local server must be
// reachable. When no token is found and the config is cloud (or absent),
// an actionable error guides the user.
func ResolveBackendInfo(opts ResolveOptions) (*BackendInfo, error) {
	token := resolveToken(opts)
	endpoint := resolveEndpoint(opts)
	org := resolveOrg(opts)

	if token != "" {
		return &BackendInfo{
			Endpoint:          endpoint,
			Token:             token,
			Org:               org,
			IsLocal:           false,
			TemporalAddress:   "", // cloud Temporal routed via proxy
			TemporalNamespace: "default",
		}, nil
	}

	if opts.Config != nil && opts.Config.Backend.Type == config.BackendTypeLocal {
		return resolveLocalBackend(opts, endpoint, org)
	}

	return nil, errors.New(
		"backend not configured\n\n" +
			"To connect to Stigmer Cloud:\n" +
			"  stigmer auth login\n\n" +
			"To pass credentials directly:\n" +
			"  stigmer up --endpoint <host> --token <api-key>\n\n" +
			"For local development:\n" +
			"  stigmer up server",
	)
}

func resolveToken(opts ResolveOptions) string {
	if opts.TokenOverride != "" {
		return opts.TokenOverride
	}
	if apiKey := os.Getenv("STIGMER_API_KEY"); apiKey != "" {
		return apiKey
	}
	if opts.Config != nil && opts.Config.Backend.Cloud != nil {
		return opts.Config.Backend.Cloud.Token
	}
	return ""
}

func resolveEndpoint(opts ResolveOptions) string {
	if opts.EndpointOverride != "" {
		return opts.EndpointOverride
	}
	if opts.Config != nil {
		switch opts.Config.Backend.Type {
		case config.BackendTypeLocal:
			return fmt.Sprintf("localhost:%d", daemon.DaemonPort)
		case config.BackendTypeCloud:
			if opts.Config.Backend.Cloud != nil && opts.Config.Backend.Cloud.Endpoint != "" {
				return opts.Config.Backend.Cloud.Endpoint
			}
		}
	}
	return "api.stigmer.ai:443"
}

func resolveOrg(opts ResolveOptions) string {
	if opts.Config != nil {
		return opts.Config.ResolveContextOrganization()
	}
	return ""
}

func resolveLocalBackend(opts ResolveOptions, endpoint, org string) (*BackendInfo, error) {
	if !isServerReachable(endpoint) {
		return nil, errors.Errorf(
			"local server is not running at %s\n\n"+
				"Start the local server first:\n"+
				"  stigmer up server", endpoint,
		)
	}

	temporalAddr := "localhost:7233"
	if opts.Config.Backend.Local != nil {
		addr, _ := opts.Config.Backend.Local.ResolveTemporalAddress()
		if addr != "" {
			temporalAddr = addr
		}
	}

	return &BackendInfo{
		Endpoint:          endpoint,
		Token:             "",
		Org:               org,
		IsLocal:           true,
		TemporalAddress:   temporalAddr,
		TemporalNamespace: "default",
	}, nil
}

func isServerReachable(endpoint string) bool {
	conn, err := net.DialTimeout("tcp", endpoint, 2*time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
