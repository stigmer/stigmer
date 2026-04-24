package runner

import (
	"context"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// CreateLaunchToken returns UNIMPLEMENTED in the OSS server.
//
// Launch tokens are a cloud-only feature for the browser-to-CLI credential
// handshake. In OSS mode, the user authenticates the CLI directly via
// 'stigmer login'.
func (c *RunnerController) CreateLaunchToken(
	_ context.Context,
	_ *runnerv1.CreateLaunchTokenRequest,
) (*runnerv1.CreateLaunchTokenResponse, error) {
	return nil, status.Error(codes.Unimplemented,
		"launch tokens are not supported in OSS mode — use 'stigmer login' to authenticate the CLI directly")
}

// ExchangeLaunchToken returns UNIMPLEMENTED in the OSS server.
//
// Launch tokens are a cloud-only feature. See CreateLaunchToken for details.
func (c *RunnerController) ExchangeLaunchToken(
	_ context.Context,
	_ *runnerv1.ExchangeLaunchTokenRequest,
) (*runnerv1.ExchangeLaunchTokenResponse, error) {
	return nil, status.Error(codes.Unimplemented,
		"launch tokens are not supported in OSS mode")
}
