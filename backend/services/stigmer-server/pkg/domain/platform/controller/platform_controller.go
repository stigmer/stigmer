package platform

import (
	"context"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
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
}

// NewPlatformController creates a new PlatformController.
//
// temporalHostPort and temporalNamespace are the coordinates returned by
// GetRunnerBootstrapConfig so embedded runners can self-bootstrap.
func NewPlatformController(temporalHostPort, temporalNamespace string) *PlatformController {
	return &PlatformController{
		temporalHostPort:  temporalHostPort,
		temporalNamespace: temporalNamespace,
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
