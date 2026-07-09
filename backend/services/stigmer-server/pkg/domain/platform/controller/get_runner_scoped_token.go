package platform

import (
	"context"

	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
)

// GetRunnerScopedToken returns an empty token: scoped runner-token minting is a
// cloud-only capability.
//
// On Stigmer Cloud this RPC exchanges a desktop runner's bootstrap credential
// for a session/execution-scoped token that the ExecutionContext decrypt gate
// binds (stigmer-cloud#156). OSS has neither token minting nor secret
// redaction — ExecutionContext reads return values as stored — so there is
// nothing to scope a token against. The empty response tells the runner to
// keep using its existing credential, the same presence-based contract as the
// token fields of GetRunnerBootstrapConfig. (Runners gate the call on having
// adopted a minted bootstrap token, so OSS servers do not normally receive it.)
func (c *PlatformController) GetRunnerScopedToken(
	_ context.Context,
	_ *platformv1.GetRunnerScopedTokenInput,
) (*platformv1.GetRunnerScopedTokenOutput, error) {
	return &platformv1.GetRunnerScopedTokenOutput{}, nil
}
