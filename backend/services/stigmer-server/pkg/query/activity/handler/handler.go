// Package handler implements the unified recent-activity query for the OSS
// server: sessions and workflow executions merged into one time-sorted list
// for the console's Recents sidebar.
//
// This is the OSS twin of the cloud's ListRecentActivityHandler
// (stigmer-cloud, ai.stigmer.query.activity.handler). The merge, ordering,
// projection, and filtering semantics are deliberately identical — a client
// switching editions must see the same sidebar behavior (stigmer#461). What
// differs is only what single-tenancy removes:
//
//   - No FGA id enumeration: OSS has no per-resource authorization, so the
//     candidate set is every stored row of each kind instead of the caller's
//     can_view set.
//   - The request's org is a no-op: the local edition is single-tenant, so
//     org scoping (added for the cloud dashboard's org-context views) has
//     nothing to narrow. This matches the other OSS list handlers that feed
//     the same sidebar data (session list, workflow-execution list) — a
//     recents filter stricter than the lists it summarizes would hide
//     locally-owned rows (metadata.org carries no validation constraint and
//     may be empty on rows created outside the console).
//   - Load-all-then-sort-in-memory instead of per-kind SQL LIMIT windows:
//     the cloud caps each kind's DB read at page_size via ORDER BY ... LIMIT
//     and then merge-sorts; loading all rows, merge-sorting, and trimming
//     yields the identical final list (each kind's newest page_size rows are
//     a superset of its contribution to the merged page). SQLite stores
//     resources as opaque proto blobs, so the scan is the storage contract
//     here — the same pattern every OSS list handler uses.
package handler

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	activityv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/activity/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	// defaultPageSize / maxPageSize mirror the cloud handler's
	// DEFAULT_PAGE_SIZE / MAX_PAGE_SIZE — the page contract is part of the
	// cross-edition behavior, not an implementation detail.
	defaultPageSize = 30
	maxPageSize     = 100

	// autoCreatedSessionSubject is the platform-wide sentinel subject stamped
	// on sessions created without a user-provided title (the SDK's
	// PENDING_SUBJECT, the CLI's resume flow, the runner's call-agent, and
	// this server's agent-execution create all use the same literal). The
	// sidebar shows the friendlier placeholder until subject generation
	// replaces the sentinel.
	autoCreatedSessionSubject = "Auto-created session"

	untitledSessionSubject   = "Untitled session"
	untitledExecutionSubject = "Untitled execution"
)

// runtimeOriginLabels marks a session as runtime-originated. Recents shows
// personal sessions only (cloud design decision 012): channel conversations
// (Slack/WhatsApp turns), guest/share sessions, and schedule-triggered
// sessions are excluded for every caller — each runtime surface owns its own
// list (the per-channel Conversations view; the share surface; the schedule
// history). A console session never carries any of these labels, and a
// session a user explicitly shares carries none of them either — that is a
// deliberate human-to-human grant, not runtime noise.
//
// Keys match the cloud's RUNTIME_ORIGIN_LABELS exactly. Channel and schedule
// labels are stamped OSS-side too (session list_by_channel, the schedule run
// starter); share/guest are cloud-only today but excluded identically so a
// future OSS share surface cannot silently regress the recents policy.
var runtimeOriginLabels = []string{
	"stigmer.ai/channel-id",
	"stigmer.ai/share-id",
	"stigmer.ai/guest-cookie-id",
	"stigmer.ai/schedule-id",
}

// Handler answers ActivityQueryController.listRecentActivity against the
// OSS store.
type Handler struct {
	store store.Store
}

func NewHandler(store store.Store) *Handler {
	return &Handler{store: store}
}

// ListRecentActivity loads both activity kinds, projects them to sidebar
// entries, merge-sorts newest-first, and trims to the requested page size.
func (h *Handler) ListRecentActivity(ctx context.Context, req *activityv1.ListRecentActivityRequest) (*activityv1.ListRecentActivityResponse, error) {
	pageSize := normalizePageSize(req.GetPageSize())

	sessions, err := h.loadSessions(ctx)
	if err != nil {
		return nil, err
	}
	executions, err := h.loadExecutions(ctx)
	if err != nil {
		return nil, err
	}

	// Sessions before executions, then a stable sort: entries with equal
	// timestamps keep this insertion order — the same tie-break the cloud
	// gets from java.util.List.sort's stability over the same load order.
	entries := make([]*activityv1.RecentActivityEntry, 0, len(sessions)+len(executions))
	entries = append(entries, sessions...)
	entries = append(entries, executions...)

	sort.SliceStable(entries, func(i, j int) bool {
		return timestampAfter(entries[i].GetUpdatedAt(), entries[j].GetUpdatedAt())
	})

	if len(entries) > pageSize {
		entries = entries[:pageSize]
	}

	log.Debug().
		Int("entries", len(entries)).
		Int("page_size", pageSize).
		Msg("Recent activity merged")

	return &activityv1.ListRecentActivityResponse{Entries: entries}, nil
}

// loadSessions projects every stored personal session to a recents entry.
// Runtime-originated sessions (see runtimeOriginLabels) are excluded.
func (h *Handler) loadSessions(ctx context.Context) ([]*activityv1.RecentActivityEntry, error) {
	rows, err := h.store.ListResources(ctx, apiresourcekind.ApiResourceKind_session)
	if err != nil {
		return nil, err
	}

	entries := make([]*activityv1.RecentActivityEntry, 0, len(rows))
	for _, row := range rows {
		session := &sessionv1.Session{}
		if err := proto.Unmarshal(row, session); err != nil {
			log.Warn().Err(err).Msg("Skipping undecodable session row in recent activity")
			continue
		}
		if hasRuntimeOriginLabel(session.GetMetadata()) {
			continue
		}
		entries = append(entries, &activityv1.RecentActivityEntry{
			Id:        session.GetMetadata().GetId(),
			Type:      "session",
			Subject:   resolveSubject(session.GetSpec().GetSubject()),
			UpdatedAt: extractUpdatedAt(session.GetStatus().GetAudit()),
		})
	}
	return entries, nil
}

// loadExecutions projects every stored workflow execution to a recents entry.
func (h *Handler) loadExecutions(ctx context.Context) ([]*activityv1.RecentActivityEntry, error) {
	rows, err := h.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_execution)
	if err != nil {
		return nil, err
	}

	entries := make([]*activityv1.RecentActivityEntry, 0, len(rows))
	for _, row := range rows {
		execution := &workflowexecutionv1.WorkflowExecution{}
		if err := proto.Unmarshal(row, execution); err != nil {
			log.Warn().Err(err).Msg("Skipping undecodable workflow execution row in recent activity")
			continue
		}
		name := execution.GetMetadata().GetName()
		if name == "" {
			name = untitledExecutionSubject
		}
		entries = append(entries, &activityv1.RecentActivityEntry{
			Id:        execution.GetMetadata().GetId(),
			Type:      "workflow_execution",
			Subject:   name,
			UpdatedAt: extractUpdatedAt(execution.GetStatus().GetAudit()),
			Status:    resolvePhase(execution.GetStatus().GetPhase()),
		})
	}
	return entries, nil
}

func normalizePageSize(requested int32) int {
	switch {
	case requested <= 0:
		return defaultPageSize
	case requested > maxPageSize:
		return maxPageSize
	default:
		return int(requested)
	}
}

func hasRuntimeOriginLabel(metadata *apiresource.ApiResourceMetadata) bool {
	labels := metadata.GetLabels()
	if len(labels) == 0 {
		return false
	}
	for _, key := range runtimeOriginLabels {
		if _, ok := labels[key]; ok {
			return true
		}
	}
	return false
}

// resolveSubject maps missing subjects AND the auto-created sentinel to the
// display placeholder — a just-created session shows "Untitled session"
// until subject generation writes a real title.
func resolveSubject(subject string) string {
	if subject == "" || subject == autoCreatedSessionSubject {
		return untitledSessionSubject
	}
	return subject
}

// resolvePhase maps the execution's lifecycle phase to the display token the
// console's status badge renders. Unspecified (and any future value this
// build does not know) reads as "unknown" — no badge.
func resolvePhase(phase workflowexecutionv1.ExecutionPhase) string {
	switch phase {
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PENDING:
		return "pending"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS:
		return "running"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED:
		return "completed"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED:
		return "failed"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED:
		return "cancelled"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED:
		return "terminated"
	case workflowexecutionv1.ExecutionPhase_EXECUTION_PAUSED:
		return "paused"
	default:
		return "unknown"
	}
}

// extractUpdatedAt returns the entry's sort key: statusAudit.updatedAt —
// bumped on meaningful status changes (session updates, workflow phase
// transitions; heartbeats deliberately do NOT bump it, see the
// workflow-execution UpdateStatus pipeline) — falling back to
// specAudit.createdAt for rows whose status audit was never stamped. OSS
// creates always stamp both slots, so the fallback only fires for rows
// written by older builds or external tooling.
func extractUpdatedAt(audit *apiresource.ApiResourceAudit) *timestamppb.Timestamp {
	if updatedAt := audit.GetStatusAudit().GetUpdatedAt(); updatedAt != nil {
		return updatedAt
	}
	if createdAt := audit.GetSpecAudit().GetCreatedAt(); createdAt != nil {
		return createdAt
	}
	return &timestamppb.Timestamp{}
}

// timestampAfter reports whether a sorts strictly after b (newer first),
// comparing (seconds, nanos) exactly like the cloud's comparator.
func timestampAfter(a, b *timestamppb.Timestamp) bool {
	if a.GetSeconds() != b.GetSeconds() {
		return a.GetSeconds() > b.GetSeconds()
	}
	return a.GetNanos() > b.GetNanos()
}
