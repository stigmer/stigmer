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
}

// NewPlatformController creates a new PlatformController.
func NewPlatformController() *PlatformController {
	return &PlatformController{}
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
