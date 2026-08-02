package schedule

import (
	"context"
	"errors"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// Update updates an existing schedule using the pipeline framework.
//
// The spec is replaced wholesale (declarative semantics): a manifest
// that omits enabled disables firing — fails closed, matching every
// other resource. Status is never written by this path AT ALL: the
// persist grafts the update's metadata+spec (and its audit bump) onto
// the LIVE row inside one atomic read-modify-write, so the firing
// observations and the platform pause are immune to declarative clobber
// BY MECHANISM — including against a tick that writes status between
// this pipeline's load and its persist, a window the previous full-row
// save left open (the scheduling runtime is their sole writer — DD-008
// D7 / DD-013 D-D / DD-015 D-C). Update deliberately does NOT clear a
// platform pause: apply routes through this handler, and
// update-clears-pause would let a routine GitOps re-apply silently
// un-pause a failing schedule. Resume is the one clearing path.
//
// Pipeline:
//  1. ValidateProto - Proto field constraints
//  2. ResolveSlug - Generate slug from metadata.name if unset
//  3. LoadExisting - Load the existing schedule by ID
//  4. ValidateScheduleUpdate - agent_ref and the target arm are
//     immutable; cron/timezone re-validated
//  5. BuildUpdateState - Merge spec, preserve id/slug/org, stamp audit
//  6. NormalizeReferences - Make references absolute (fill org)
//  7. PersistScheduleUpdate - Graft metadata+spec+status.audit onto the
//     live row (atomic; never touches the runtime's status leaves)
//  8. ArmScheduleArtifact - Converge the Temporal artifact and stamp
//     next_fire_at (non-critical; also how an owner-toggled enabled
//     flag reaches the artifact)
//
// Note: Unlike Stigmer Cloud, OSS excludes the authorization step
// (cloud requires can_edit on the schedule).
func (c *ScheduleController) Update(ctx context.Context, schedule *schedulev1.Schedule) (*schedulev1.Schedule, error) {
	reqCtx := pipeline.NewRequestContext(ctx, schedule)

	p := c.buildUpdatePipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.NewState(), nil
}

func (c *ScheduleController) buildUpdatePipeline() *pipeline.Pipeline[*schedulev1.Schedule] {
	return pipeline.NewPipeline[*schedulev1.Schedule]("schedule-update").
		AddStep(steps.NewValidateProtoStep[*schedulev1.Schedule]()).
		AddStep(steps.NewResolveSlugStep[*schedulev1.Schedule]()).
		AddStep(steps.NewLoadExistingStep[*schedulev1.Schedule](c.store)).
		AddStep(&validateScheduleUpdateStep{}).
		AddStep(steps.NewBuildUpdateStateStep[*schedulev1.Schedule]()).
		AddStep(steps.NewNormalizeReferencesStep[*schedulev1.Schedule]()).
		AddStep(&persistScheduleUpdateStep{store: c.store}).
		AddStep(&armScheduleStep{controller: c}).
		Build()
}

// persistScheduleUpdateStep persists an update as a graft of exactly
// what the request path owns — apiVersion/kind/metadata/spec plus the
// audit bump BuildUpdateState stamped — onto the LIVE row, inside one
// store.UpdateResource closure. NOT the generic PersistStep: schedule
// status has a concurrent writer (the tick), and a full-row save of the
// load-time snapshot could silently revert a fire record, a streak
// write, or a PAUSE — breaking the "resume is the one clearing path"
// pin. The OSS twin of the cloud's targeted metadata+spec+status.audit
// patch (workstream 0), shaped for a store whose unit of write is the
// whole protobuf blob (DD-015 D-C).
//
// Unlike a save, the graft never resurrects a concurrently deleted row:
// UpdateResource answers not-found, relayed as NOT_FOUND — the delete
// won, honestly.
type persistScheduleUpdateStep struct {
	store store.Store
}

func (s *persistScheduleUpdateStep) Name() string {
	return "PersistScheduleUpdate"
}

func (s *persistScheduleUpdateStep) Execute(ctx *pipeline.RequestContext[*schedulev1.Schedule]) error {
	newState := ctx.NewState()
	scheduleID := newState.GetMetadata().GetId()

	live := &schedulev1.Schedule{}
	err := s.store.UpdateResource(ctx.Context(), apiresourcekind.ApiResourceKind_schedule,
		scheduleID, live, func() error {
			live.ApiVersion = newState.GetApiVersion()
			live.Kind = newState.GetKind()
			live.Metadata = newState.GetMetadata()
			live.Spec = newState.GetSpec()
			// The one status subtree the request path owns: its own audit
			// bump. Every other status leaf stays exactly as the
			// concurrent runtime last wrote it.
			if newState.GetStatus().GetAudit() != nil {
				if live.Status == nil {
					live.Status = &schedulev1.ScheduleStatus{}
				}
				live.Status.Audit = newState.GetStatus().GetAudit()
			}
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return grpclib.NotFoundError("Schedule", scheduleID)
		}
		return grpclib.InternalError(err, "failed to persist schedule update")
	}

	// Answer with the persisted post-image: the new spec plus the LIVE
	// status — fresher than the load-time snapshot, and honest about
	// anything the runtime wrote mid-request.
	ctx.SetNewState(live)
	return nil
}
