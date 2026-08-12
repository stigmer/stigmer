package platform

import (
	"context"

	"github.com/rs/zerolog/log"
	platformv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/v1"
)

// GetRunnerScopedToken mints a token scoped to one unit of dispatched work,
// which the ExecutionContext getByExecutionId handler accepts for secret
// decryption (oss#535 — the OSS port of the cloud runner-scoped resolve
// lane, stigmer-cloud#152/#156).
//
// OSS has no caller identity, so unlike the cloud exchange there is no
// credential to verify: any caller naming an execution receives a token for
// it. That is deliberate and documented on the runnerauth package — on a
// single-user server the token is the LANE DISCRIMINATOR that lets the EC
// read RPCs redact by default without breaking the runner, not a trust
// boundary. (Before oss#535 this handler answered the "not minted" shape;
// that pin documented the pre-redaction world where OSS had nothing to
// scope a token against.)
//
// Arms:
//   - agent_execution_id / workflow_execution_id: minted. Both ids ARE the
//     ExecutionContext's spec.execution_id, so the token binds directly to
//     the one EC it may decrypt. (Cloud scopes agent tokens to the parent
//     session for warm-pool multi-turn reuse; OSS runners exchange
//     immediately before each read, so the tighter per-execution binding
//     costs nothing.)
//   - pool_claim / renewal: the presence-based "not minted" shape — OSS has
//     no warm pool, and per-read minting makes renewal moot.
//
// A keyless service (no signing key, effectively test-only — the key
// auto-generates in real deployments) also answers "not minted": the runner
// then reads tokenless and sees redacted values, the same honest degrade as
// any other unscoped caller.
func (c *PlatformController) GetRunnerScopedToken(
	_ context.Context,
	input *platformv1.GetRunnerScopedTokenInput,
) (*platformv1.GetRunnerScopedTokenOutput, error) {
	var executionID string
	switch scope := input.GetScope().(type) {
	case *platformv1.GetRunnerScopedTokenInput_AgentExecutionId:
		executionID = scope.AgentExecutionId
	case *platformv1.GetRunnerScopedTokenInput_WorkflowExecutionId:
		executionID = scope.WorkflowExecutionId
	default:
		// pool_claim, renewal, or an unset scope: nothing OSS mints for.
		return &platformv1.GetRunnerScopedTokenOutput{}, nil
	}

	if executionID == "" || c.runnerAuth == nil || !c.runnerAuth.IsEnabled() {
		return &platformv1.GetRunnerScopedTokenOutput{}, nil
	}

	token, expiresIn, err := c.runnerAuth.Mint(executionID, 0)
	if err != nil {
		// Fail soft to the "not minted" shape rather than failing the
		// exchange: the runner's no-credential path treats absence as
		// "proceed tokenless", which degrades to redacted values — a clear
		// downstream signal — while an error here would abort the activity.
		log.Warn().Err(err).
			Str("execution_id", executionID).
			Msg("Failed to mint runner scoped token — answering not-minted")
		return &platformv1.GetRunnerScopedTokenOutput{}, nil
	}

	return &platformv1.GetRunnerScopedTokenOutput{
		RunnerScopedToken: token,
		TokenType:         "Bearer",
		ExpiresInSeconds:  int32(expiresIn),
	}, nil
}
