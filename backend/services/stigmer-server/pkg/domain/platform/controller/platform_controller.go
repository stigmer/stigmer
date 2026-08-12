package platform

import (
	"context"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerauth"
)

// Version is set at build time via -ldflags.
var Version = "dev"

// PlatformController implements the PlatformQueryController gRPC service.
type PlatformController struct {
	platformv1.UnimplementedPlatformQueryControllerServer

	// Temporal coordinates this server runs against, published to embedded
	// runners via GetRunnerBootstrapConfig. In OSS the server and its runners
	// are co-located, so the address the server itself dials is the one runners
	// should dial too — no internal/external split (unlike Stigmer Cloud).
	temporalHostPort  string
	temporalNamespace string

	// Mints the execution-scoped tokens GetRunnerScopedToken hands to
	// runners for the ExecutionContext decrypt lane (oss#535). Nil or
	// keyless yields the presence-based "not minted" response.
	runnerAuth *runnerauth.Service
}

// NewPlatformController creates a new PlatformController.
//
// temporalHostPort and temporalNamespace are the coordinates returned by
// GetRunnerBootstrapConfig so embedded runners can self-bootstrap.
// runnerAuth mints the execution-scoped runner tokens (may be nil in tests
// that never exercise the exchange).
func NewPlatformController(temporalHostPort, temporalNamespace string, runnerAuth *runnerauth.Service) *PlatformController {
	return &PlatformController{
		temporalHostPort:  temporalHostPort,
		temporalNamespace: temporalNamespace,
		runnerAuth:        runnerAuth,
	}
}

// GetServerInfo returns the server edition and build version.
func (c *PlatformController) GetServerInfo(
	_ context.Context,
	_ *platformv1.GetServerInfoInput,
) (*platformv1.GetServerInfoOutput, error) {
	return &platformv1.GetServerInfoOutput{
		Edition: platformv1.ServerEdition_oss,
		Version: Version,
	}, nil
}
