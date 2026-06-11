//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
)

// instanceKind abstracts standalone (user-created) instance kinds. Unlike
// blueprints, instances have no org floor — exactly one viewer tuple is written
// per level — and they are personal resources (can_edit is owner-only). Each
// instance is created standalone from a fresh parent blueprint; the parent's
// visibility is irrelevant because standalone instances do NOT inherit parent
// viewer (only default instances do, via default_of).
type instanceKind struct {
	name             string
	create           func(t *testing.T, ctx context.Context, c *harness.Clients) string
	get              func(ctx context.Context, c *harness.Clients, id string) error
	getVisibility    func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error)
	updateVisibility func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error
}

func instanceKinds() []instanceKind {
	return []instanceKind{
		{
			name: "agent_instance",
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				agent := createAgentBlueprint(t, ctx, c)
				return createAgentInstanceFor(t, ctx, c, agent.GetMetadata().GetId()).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.AgentInstanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				inst, err := c.AgentInstanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: id})
				return inst.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.AgentInstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
		},
		{
			name: "workflow_instance",
			create: func(t *testing.T, ctx context.Context, c *harness.Clients) string {
				wf := createWorkflowBlueprint(t, ctx, c)
				return createWorkflowInstanceFor(t, ctx, c, wf.GetMetadata().GetId()).GetMetadata().GetId()
			},
			get: func(ctx context.Context, c *harness.Clients, id string) error {
				_, err := c.InstanceQuery.Get(ctx, &workflowinstancev1.WorkflowInstanceId{Value: id})
				return err
			},
			getVisibility: func(ctx context.Context, c *harness.Clients, id string) (apiresource.ApiResourceVisibility, error) {
				inst, err := c.InstanceQuery.Get(ctx, &workflowinstancev1.WorkflowInstanceId{Value: id})
				return inst.GetMetadata().GetVisibility(), err
			},
			updateVisibility: func(ctx context.Context, c *harness.Clients, id string, v apiresource.ApiResourceVisibility) error {
				_, err := c.InstanceCommand.UpdateVisibility(ctx, &apiresource.UpdateVisibilityInput{ResourceId: id, Visibility: v})
				return err
			},
		},
	}
}

// TestVisibilityInstanceEnforcement proves standalone instances enforce
// private / org / public per caller. Instances default to visibility_private on
// create — the conservative default for personal resources.
func TestVisibilityInstanceEnforcement(t *testing.T) {
	requireVisibilityHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	member := actors.Member()
	stranger := actors.Stranger()

	for _, ik := range instanceKinds() {
		ik := ik
		t.Run(ik.name, func(t *testing.T) {
			// private (the create default).
			t.Run("private_default", func(t *testing.T) {
				id := ik.create(t, ctx, owner.Clients)
				got, err := ik.getVisibility(ctx, owner.Clients, id)
				require.NoError(t, err)
				require.Equal(t, visPrivate, got, "instances default to private")

				owner.RequireCanView(t, ctx, ik.name, id)
				member.RequireCannotView(t, ctx, ik.name, id)
				require.True(t, isAccessDenied(ik.get(ctx, member.Clients, id)), "member Get on private instance must be denied")
				stranger.RequireCannotView(t, ctx, ik.name, id)
			})

			t.Run("org", func(t *testing.T) {
				id := ik.create(t, ctx, owner.Clients)
				require.NoError(t, ik.updateVisibility(ctx, owner.Clients, id, visOrg))

				owner.RequireCanView(t, ctx, ik.name, id)
				member.RequireCanView(t, ctx, ik.name, id)
				require.NoError(t, ik.get(ctx, member.Clients, id), "member Get on org instance")
				stranger.RequireCannotView(t, ctx, ik.name, id)

				// Instances are personal: visibility never confers edit, even to
				// org members (org admins are deliberately excluded too).
				member.RequirePermission(t, ctx, ik.name, id, "can_edit", false)
			})

			t.Run("public", func(t *testing.T) {
				id := ik.create(t, ctx, owner.Clients)
				require.NoError(t, ik.updateVisibility(ctx, owner.Clients, id, visPublic))

				for _, a := range []*harness.Actor{owner, member, stranger} {
					a.RequireCanView(t, ctx, ik.name, id)
					require.NoErrorf(t, ik.get(ctx, a.Clients, id), "%s Get on public instance", a.Name)
				}
			})
		})
	}
}

// TestVisibilityDefaultInstanceInheritance is the headline of the default_of
// design: a blueprint's default instance is exactly as reachable as the
// blueprint itself, achieved structurally (a single default_of tuple) rather
// than by mirroring the parent's visibility onto the instance. Flipping the
// parent's visibility flips default-instance access with ZERO writes on the
// instance — and default instances reject direct visibility updates.
func TestVisibilityDefaultInstanceInheritance(t *testing.T) {
	requireVisibilityHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	member := actors.Member()
	stranger := actors.Stranger()

	for _, bk := range blueprintKinds() {
		bk := bk
		if bk.defaultInstanceID == nil || bk.instanceKindName == "" {
			continue // only agent / workflow have default instances
		}
		t.Run(bk.name, func(t *testing.T) {
			id := bk.create(t, ctx, owner.Clients) // org-visible by default

			instID, ok, err := bk.defaultInstanceID(ctx, owner.Clients, id)
			require.NoError(t, err, "read default instance id")
			require.True(t, ok, "%s should have an eagerly-created default instance", bk.name)
			instKind := bk.instanceKindName

			// Parent is org-visible -> default instance is reachable by members.
			member.RequireCanView(t, ctx, instKind, instID)
			require.NoError(t, bk.get(ctx, member.Clients, id))
			stranger.RequireCannotView(t, ctx, instKind, instID)

			// Make the parent private -> default instance follows, no instance write.
			require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPrivate))
			member.RequireCannotView(t, ctx, instKind, instID)
			stranger.RequireCannotView(t, ctx, instKind, instID)

			// Make the parent public -> default instance becomes world-readable.
			require.NoError(t, bk.updateVisibility(ctx, owner.Clients, id, visPublic))
			member.RequireCanView(t, ctx, instKind, instID)
			stranger.RequireCanView(t, ctx, instKind, instID)

			// Default instances have no visibility of their own to set — a direct
			// UpdateVisibility must be rejected with FAILED_PRECONDITION.
			err = bk.updateInstanceVisibility(ctx, owner.Clients, instID, visOrg)
			requireStatusCode(t, err, codes.FailedPrecondition,
				"UpdateVisibility on a default instance must be rejected")
		})
	}
}
