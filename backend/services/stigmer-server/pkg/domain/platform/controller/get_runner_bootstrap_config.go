package platform

import (
	"context"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
)

// GetRunnerBootstrapConfig returns the Temporal coordinates an embedded runner
// should connect to so it can self-bootstrap from a token alone.
//
// In OSS the server and its runners share one host, so the address the server
// dials (TEMPORAL_HOST_PORT) is exactly the address runners should dial. Stigmer
// Cloud diverges here: it returns an external Temporal ingress that differs from
// the internal address the control plane uses — see the Cloud handler.
//
// The RunnerAccessToken / TokenType / RunnerAccessTokenExpiresInSeconds fields
// are intentionally left empty: minting an iss=stigmer proxy token is a
// cloud-only capability (OSS has no Cursor BiDi proxy to authenticate against),
// so OSS runners keep using the token they already hold.
func (c *PlatformController) GetRunnerBootstrapConfig(
	_ context.Context,
	_ *platformv1.GetRunnerBootstrapConfigInput,
) (*platformv1.GetRunnerBootstrapConfigOutput, error) {
	return &platformv1.GetRunnerBootstrapConfigOutput{
		TemporalAddress:   c.temporalHostPort,
		TemporalNamespace: c.temporalNamespace,
	}, nil
}
