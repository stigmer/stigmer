//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
)

// TestAuthz_NotFoundBeforePermissionDenied proves the cross-edition error contract
// (stigmer/stigmer#224) end-to-end against the cloud service with real OpenFGA: the
// get pipeline resolves resource existence BEFORE authorization, so a missing or
// just-deleted id returns NOT_FOUND, while a resource that exists but the caller
// cannot see returns PERMISSION_DENIED. The two are distinguished — a missing
// resource is never masked as PermissionDenied by an authorize-first check.
//
// The suite is gated on real FGA (via requireVisibilityHarness): the
// existing-but-forbidden arm is only meaningful when authorization can actually
// deny, so it skips rather than passing vacuously under the permit-all stub.
func TestAuthz_NotFoundBeforePermissionDenied(t *testing.T) {
	requireVisibilityHarness(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	stranger := actors.Stranger()

	t.Run("get of a missing id returns NotFound", func(t *testing.T) {
		_, err := owner.Clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: "agt_doesnotexist"})
		requireStatusCode(t, err, codes.NotFound,
			"a missing id must be NOT_FOUND, not PERMISSION_DENIED (#224)")
	})

	t.Run("get after delete returns NotFound", func(t *testing.T) {
		agent := createAgentBlueprint(t, ctx, owner.Clients)
		id := agent.GetMetadata().GetId()

		_, err := owner.Clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: id})
		require.NoError(t, err, "owner delete should succeed")

		_, err = owner.Clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: id})
		requireStatusCode(t, err, codes.NotFound,
			"a just-deleted id must be NOT_FOUND, not PERMISSION_DENIED (#224)")
	})

	t.Run("get of an existing but forbidden resource returns PermissionDenied", func(t *testing.T) {
		// Blueprints default to org visibility; the stranger holds no org role, so
		// the resource exists but is genuinely unreachable for it.
		agent := createAgentBlueprint(t, ctx, owner.Clients)
		id := agent.GetMetadata().GetId()
		t.Cleanup(func() {
			cleanCtx, cancelClean := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancelClean()
			_, _ = owner.Clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: id})
		})

		stranger.RequireCannotView(t, ctx, "agent", id)

		_, err := stranger.Clients.AgentQuery.Get(ctx, &agentv1.AgentId{Value: id})
		requireStatusCode(t, err, codes.PermissionDenied,
			"an existing-but-forbidden resource must be PERMISSION_DENIED, not NOT_FOUND (Contract A, #224)")
	})
}
