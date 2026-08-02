package temporal

import (
	"fmt"
	"strings"
	"time"

	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

// The cross-repo identity contract, pinned on three sides: the cloud
// Java ScheduleArtifact, the integration harness's ScheduleInspector,
// and here. The tick prefix is baked into every artifact's id AND base
// workflow id — changing it on any side strands every existing artifact.
const (
	// TickWorkflowType is the tick workflow's registered type and the
	// artifact-id prefix's stem: schedule/tick.
	TickWorkflowType = "schedule/tick"

	// TickIDPrefix prefixes each Schedule resource's Temporal Schedule
	// artifact id: schedule/tick/{scheduleResourceId}.
	TickIDPrefix = TickWorkflowType + "/"
)

// Artifact is the ONE resource-to-Temporal mapping (the cloud
// ScheduleArtifact's twin): whatever this writes is final for every
// artifact it creates, because the baked action is invisible to
// listSchedules and cannot be repaired by the sweep.
type Artifact struct {
	config *Config
}

// NewArtifact creates the mapping bound to the clock's config.
func NewArtifact(config *Config) *Artifact {
	return &Artifact{config: config}
}

// ArtifactID returns the Temporal Schedule artifact id for a Schedule
// resource id.
func ArtifactID(scheduleResourceID string) string {
	return TickIDPrefix + scheduleResourceID
}

// ResourceIDOf inverts ArtifactID.
func ResourceIDOf(artifactID string) string {
	return strings.TrimPrefix(artifactID, TickIDPrefix)
}

// Note is the drift fingerprint written into the artifact's state note.
// Cron itself does NOT round-trip (the Temporal server compiles it into
// calendar specs and describes cronExpressions as empty), so the note is
// the only way the reconciliation pass can detect a spec change.
func Note(schedule *schedulev1.Schedule) string {
	return fmt.Sprintf("cron=%s tz=%s",
		schedule.GetSpec().GetCron(), schedule.GetSpec().GetTimeZone())
}

// DesiredPaused: the artifact must be paused when the owner disabled the
// schedule (spec.enabled=false) OR the platform latched it
// (status.paused_reason) — two levers, one artifact state.
func DesiredPaused(schedule *schedulev1.Schedule) bool {
	return !schedule.GetSpec().GetEnabled() ||
		schedule.GetStatus().GetPausedReason() != ""
}

// CreateOptions builds the complete desired artifact for Create.
//
// Pinned policy, identical to cloud:
//   - Overlap SKIP is explicit: since a tick SPANS its run (tracking),
//     SKIP genuinely means "never start a run while the last is active".
//   - PauseOnFailure stays false: Temporal must never pause behind the
//     platform's back, or the artifact would oscillate against the
//     reconciliation pass (which converges paused-state from the row).
//   - The action carries exactly ONE argument — the schedule resource
//     id. The nominal fire time cannot ride here (Temporal bakes action
//     args once and replays them verbatim per fire); the tick derives it
//     from the fire itself.
func (a *Artifact) CreateOptions(schedule *schedulev1.Schedule) client.ScheduleOptions {
	resourceID := schedule.GetMetadata().GetId()
	return client.ScheduleOptions{
		ID: ArtifactID(resourceID),
		Spec: client.ScheduleSpec{
			CronExpressions: []string{schedule.GetSpec().GetCron()},
			TimeZoneName:    schedule.GetSpec().GetTimeZone(),
		},
		Action:         a.tickAction(resourceID),
		Overlap:        enumspb.SCHEDULE_OVERLAP_POLICY_SKIP,
		CatchupWindow:  time.Duration(a.config.CatchupWindowMinutes) * time.Minute,
		PauseOnFailure: false,
		Paused:         DesiredPaused(schedule),
		Note:           Note(schedule),
	}
}

// ApplyDesiredState rewrites a described artifact to the resource's
// complete desired state — the update half of ensure's create-or-update.
// A lost race between two writers is benign: both write the same desired
// state.
//
// The ACTION is deliberately rewritten too, even though drift detection
// cannot see it (invisible to describe-level diffing): on the update
// path rewriting it is free and self-heals a hand-edited artifact.
func (a *Artifact) ApplyDesiredState(desc *client.ScheduleDescription, schedule *schedulev1.Schedule) *client.ScheduleUpdate {
	resourceID := schedule.GetMetadata().GetId()
	desc.Schedule.Spec = &client.ScheduleSpec{
		CronExpressions: []string{schedule.GetSpec().GetCron()},
		TimeZoneName:    schedule.GetSpec().GetTimeZone(),
	}
	desc.Schedule.Action = a.tickAction(resourceID)
	desc.Schedule.Policy = &client.SchedulePolicies{
		Overlap:        enumspb.SCHEDULE_OVERLAP_POLICY_SKIP,
		CatchupWindow:  time.Duration(a.config.CatchupWindowMinutes) * time.Minute,
		PauseOnFailure: false,
	}
	desc.Schedule.State.Paused = DesiredPaused(schedule)
	desc.Schedule.State.Note = Note(schedule)
	return &client.ScheduleUpdate{Schedule: &desc.Schedule}
}

// tickAction bakes the tick workflow start: workflow id = artifact id
// (Temporal appends the nominal fire time per fire, which is the tick's
// second-tier nominal-time derivation), the schedule's own queue, and
// the 24h run-timeout backstop. Retry deliberately stays at the workflow
// default (none): a failed tick is a missed fire, not a hot loop.
func (a *Artifact) tickAction(resourceID string) *client.ScheduleWorkflowAction {
	return &client.ScheduleWorkflowAction{
		ID:                 ArtifactID(resourceID),
		Workflow:           TickWorkflowType,
		Args:               []interface{}{resourceID},
		TaskQueue:          a.config.StigmerQueue,
		WorkflowRunTimeout: time.Duration(a.config.TickRunTimeoutHours) * time.Hour,
	}
}
