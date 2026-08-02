// Package schedule implements the Schedule controllers — the recurring
// trigger that runs an agent on a cron schedule (decisions DD-008/DD-009
// of the whatsapp-proactive-messaging project).
//
// A schedule declares a target (an agent and the prompt each run starts
// from), a cron expression with an IANA time zone, and the owner's
// enablement switch. Everything the platform observes about firing
// (next fire time, failure streak, platform pause) lives in status,
// written only by the scheduling runtime and by the explicit resume
// command — a declarative apply preserves status verbatim (the
// AgentChannel decision-004 posture), so a routine manifest apply can
// never reset a failure streak or un-pause a platform-paused schedule.
//
// Vocabulary (project DD-013 D-E): "disabled" is the owner's switch
// (spec.enabled = false); "paused" is the platform's failure-streak
// latch (status.paused_reason). Two words, two levers, two writers.
//
// Firing posture (this slice): storage and validation only — the clock
// (per-resource Temporal Schedules, DD-008 D2) lands with the scheduling
// runtime in both editions. Schedules can be authored, read, updated,
// and deleted; nothing fires yet.
//
// Cron posture (DD-009 C-4): the platform parses NO cron in either
// edition — calendar/DST semantics live in the Temporal server (DD-008
// D2). Apply-time validation is purely lexical (see cron.go) and
// deliberately narrower than Temporal's grammar: the classic 5-field
// form plus the @daily-family shorthands, no timezone prefixes, no
// @every, no seconds column. The restriction is a structural one-minute
// firing floor; the configurable interval floor arrives with the clock,
// enforced against Temporal's own computed fire times.
//
// Authorization posture (OSS): this edition is single-user and local, so
// handlers perform no authorization — a documented no-op, not a silent
// divergence. The cloud edition enforces the same contracts via FGA
// (can_edit on the referenced agent for create, DD-009 C-6;
// schedule-level can_edit/can_delete for update and delete).
package schedule

import (
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ScheduleController implements ScheduleCommandController and
// ScheduleQueryController.
type ScheduleController struct {
	schedulev1.UnimplementedScheduleCommandControllerServer
	schedulev1.UnimplementedScheduleQueryControllerServer
	store store.Store
}

// NewScheduleController creates a new ScheduleController.
func NewScheduleController(store store.Store) *ScheduleController {
	return &ScheduleController{store: store}
}
