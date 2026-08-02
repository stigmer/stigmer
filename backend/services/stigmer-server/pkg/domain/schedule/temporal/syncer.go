package temporal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ErrTemporalUnavailable is the syncer's answer when no Temporal client
// exists right now. Callers on the write path treat it as "converge
// later" (arming is best-effort — DD-015 D-A); the trigger handler
// relays it as UNAVAILABLE because a manual fire cannot converge later.
var ErrTemporalUnavailable = errors.New("temporal is not connected")

// Syncer converges one Schedule resource's Temporal artifact to its
// desired state and records the result on the resource's status — the
// ONE arming/teardown/trigger authority, shared by the write-path steps,
// the reconciliation pass, and the trigger handler.
//
// The client arrives through a provider, not a field: the server
// hot-swaps its Temporal client on reconnect (temporal_manager.go), and
// a component holding a stale client silently dies after the first blip.
// Reading through the provider on every call makes that entire bug class
// unrepresentable here.
//
// Status writes go through store.UpdateResource — the OSS equivalent of
// the cloud's targeted leaf patches (DD-015 D-C): SQLite stores one
// protobuf blob, so the atomic read-modify-write under the store's write
// lock is what keeps a concurrent stigmer apply from clobbering the
// stamp (and vice versa). status.next_fire_at is the contract's arming
// witness: stamped from Temporal's own answer when armed, cleared when
// the artifact is paused, absent while nothing has converged.
type Syncer struct {
	clientProvider func() client.Client
	store          store.Store
	artifact       *Artifact
}

// NewSyncer creates the syncer. clientProvider may return nil (Temporal
// down or never configured) — every method degrades to
// ErrTemporalUnavailable rather than panicking.
func NewSyncer(clientProvider func() client.Client, st store.Store, artifact *Artifact) *Syncer {
	return &Syncer{clientProvider: clientProvider, store: st, artifact: artifact}
}

// EnsureAndRecord creates or updates the resource's artifact to the
// desired state, then stamps status.next_fire_at from Temporal's answer.
// Returns the stamped time (nil when the artifact is paused) so write
// paths can mirror it into their response state.
func (s *Syncer) EnsureAndRecord(ctx context.Context, schedule *schedulev1.Schedule) (*time.Time, error) {
	temporalClient := s.clientProvider()
	if temporalClient == nil {
		return nil, ErrTemporalUnavailable
	}

	resourceID := schedule.GetMetadata().GetId()
	artifactID := ArtifactID(resourceID)

	_, err := temporalClient.ScheduleClient().Create(ctx, s.artifact.CreateOptions(schedule))
	switch {
	case err == nil:
		log.Info().Str("artifact_id", artifactID).Str("note", Note(schedule)).
			Bool("paused", DesiredPaused(schedule)).Msg("Created schedule artifact")
	case errors.Is(err, temporal.ErrScheduleAlreadyRunning):
		// Create-or-update convergence: rewrite the existing artifact to
		// the complete desired state. A lost race between two writers is
		// benign — both write the same desired state.
		handle := temporalClient.ScheduleClient().GetHandle(ctx, artifactID)
		updateErr := handle.Update(ctx, client.ScheduleUpdateOptions{
			DoUpdate: func(input client.ScheduleUpdateInput) (*client.ScheduleUpdate, error) {
				return s.artifact.ApplyDesiredState(&input.Description, schedule), nil
			},
		})
		if updateErr != nil {
			return nil, fmt.Errorf("update schedule artifact %s: %w", artifactID, updateErr)
		}
		log.Info().Str("artifact_id", artifactID).Str("note", Note(schedule)).
			Bool("paused", DesiredPaused(schedule)).Msg("Updated schedule artifact")
	default:
		return nil, fmt.Errorf("create schedule artifact %s: %w", artifactID, err)
	}

	return s.recordNextFireAt(ctx, schedule)
}

// PeekNextFireAt reads the next fire time from the LIVE artifact —
// Temporal's answer is authoritative (it accounts for the catch-up
// window; the platform computes nothing). Nil while paused, per
// status.next_fire_at's contract.
func (s *Syncer) PeekNextFireAt(ctx context.Context, schedule *schedulev1.Schedule) (*time.Time, error) {
	if DesiredPaused(schedule) {
		return nil, nil
	}
	temporalClient := s.clientProvider()
	if temporalClient == nil {
		return nil, ErrTemporalUnavailable
	}
	desc, err := temporalClient.ScheduleClient().
		GetHandle(ctx, ArtifactID(schedule.GetMetadata().GetId())).Describe(ctx)
	if err != nil {
		return nil, fmt.Errorf("describe schedule artifact: %w", err)
	}
	if len(desc.Info.NextActionTimes) == 0 {
		return nil, nil
	}
	next := desc.Info.NextActionTimes[0]
	return &next, nil
}

// Teardown deletes the resource's artifact. Not-found is success —
// delete is idempotent from the platform's point of view even though
// Temporal's is not.
func (s *Syncer) Teardown(ctx context.Context, resourceID string) error {
	temporalClient := s.clientProvider()
	if temporalClient == nil {
		return ErrTemporalUnavailable
	}
	artifactID := ArtifactID(resourceID)
	err := temporalClient.ScheduleClient().GetHandle(ctx, artifactID).Delete(ctx)
	if err != nil {
		var notFound *serviceerror.NotFound
		if errors.As(err, &notFound) {
			log.Info().Str("artifact_id", artifactID).Msg("Schedule artifact already gone")
			return nil
		}
		return fmt.Errorf("delete schedule artifact %s: %w", artifactID, err)
	}
	log.Info().Str("artifact_id", artifactID).Msg("Deleted schedule artifact")
	return nil
}

// Trigger fires the resource's artifact once, immediately (DD-014 D-C),
// bypassing the baked SKIP overlap policy with ALLOW_ALL: since a tick
// SPANS its run, SKIP would silently swallow a trigger issued while a
// previous fire is still tracking — and a human asking to run now means
// now. Cron fires keep SKIP. The fire is otherwise indistinguishable
// from a cron fire, so revalidation, idempotent recording, tracking, and
// the failure streak all apply unchanged (DD-014 D-D).
func (s *Syncer) Trigger(ctx context.Context, resourceID string) error {
	temporalClient := s.clientProvider()
	if temporalClient == nil {
		return ErrTemporalUnavailable
	}
	artifactID := ArtifactID(resourceID)
	err := temporalClient.ScheduleClient().GetHandle(ctx, artifactID).Trigger(ctx,
		client.ScheduleTriggerOptions{Overlap: enumspb.SCHEDULE_OVERLAP_POLICY_ALLOW_ALL})
	if err != nil {
		return fmt.Errorf("trigger schedule artifact %s: %w", artifactID, err)
	}
	log.Info().Str("artifact_id", artifactID).Msg("Manually triggered schedule artifact")
	return nil
}

// recordNextFireAt stamps status.next_fire_at from PeekNextFireAt onto
// the LIVE row (UpdateResource re-reads inside the lock — the stamp can
// never resurrect a stale snapshot of the rest of status).
func (s *Syncer) recordNextFireAt(ctx context.Context, schedule *schedulev1.Schedule) (*time.Time, error) {
	nextFireAt, err := s.PeekNextFireAt(ctx, schedule)
	if err != nil {
		return nil, err
	}

	updated := &schedulev1.Schedule{}
	err = s.store.UpdateResource(ctx, apiresourcekind.ApiResourceKind_schedule,
		schedule.GetMetadata().GetId(), updated, func() error {
			status := ensureStatus(updated)
			if nextFireAt == nil {
				status.NextFireAt = nil
			} else {
				status.NextFireAt = timestamppb.New(*nextFireAt)
			}
			bumpStatusAudit(status, time.Now())
			return nil
		})
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Deleted between arm and stamp: the orphaned artifact is
			// harmless (revalidation no-ops it) and the reconciliation
			// pass reaps it.
			log.Info().Str("schedule_id", schedule.GetMetadata().GetId()).
				Msg("Schedule row gone before next_fire_at stamp — skipping")
			return nextFireAt, nil
		}
		return nil, fmt.Errorf("stamp next_fire_at: %w", err)
	}
	return nextFireAt, nil
}

// ensureStatus returns the schedule's status, materializing the nested
// messages a fresh row may lack.
func ensureStatus(schedule *schedulev1.Schedule) *schedulev1.ScheduleStatus {
	if schedule.Status == nil {
		schedule.Status = &schedulev1.ScheduleStatus{}
	}
	return schedule.Status
}

// bumpStatusAudit stamps the status-audit trail for a runtime write —
// the same two leaves every cloud runtime patch bumps.
func bumpStatusAudit(status *schedulev1.ScheduleStatus, now time.Time) {
	if status.Audit == nil {
		status.Audit = &apiresource.ApiResourceAudit{}
	}
	if status.Audit.StatusAudit == nil {
		status.Audit.StatusAudit = &apiresource.ApiResourceAuditInfo{}
	}
	status.Audit.StatusAudit.UpdatedAt = timestamppb.New(now)
	status.Audit.StatusAudit.Event = "updated"
}
