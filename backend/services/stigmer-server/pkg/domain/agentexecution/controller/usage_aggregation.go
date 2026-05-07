package agentexecution

import (
	"sort"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// OSS usage aggregation
//
// In OSS mode, runners no longer stamp per-message llm_metrics and there
// is no llm_call_usage_record collection (that is a cloud billing concern).
// All aggregation functions return zero-valued, structurally valid results.
// The cloud edition provides real usage data via its billing domain.

// executionSubAgentCount returns the number of sub-agent invocations.
func executionSubAgentCount(exec *agentexecutionv1.AgentExecution) int32 {
	return int32(len(exec.GetStatus().GetSubAgentExecutions()))
}

// aggregateUsageReport returns a zero-valued UsageReportAggregate.
// In cloud mode, usage is sourced from LlmCallUsageRecord; in OSS mode,
// no usage data is available.
func aggregateUsageReport(_ []*agentexecutionv1.AgentExecution) *agentexecutionv1.UsageReportAggregate {
	return &agentexecutionv1.UsageReportAggregate{}
}

// mergeModelBreakdowns returns an empty model breakdown.
// In OSS mode, per-model usage data is not available.
func mergeModelBreakdowns(_ []*agentexecutionv1.AgentExecution) []*agentexecutionv1.ModelUsage {
	return nil
}

// buildExecutionSummary projects a full AgentExecution into a lightweight
// ExecutionUsageSummary suitable for report responses. Token and cost
// fields are zero in OSS mode.
func buildExecutionSummary(exec *agentexecutionv1.AgentExecution) *agentexecutionv1.ExecutionUsageSummary {
	return &agentexecutionv1.ExecutionUsageSummary{
		ExecutionId:   exec.GetMetadata().GetId(),
		StartedAt:     exec.GetStatus().GetStartedAt(),
		CompletedAt:   exec.GetStatus().GetCompletedAt(),
		SubAgentCount: executionSubAgentCount(exec),
		Phase:         exec.GetStatus().GetPhase(),
	}
}

// filterByDateRange returns executions whose started_at falls within
// [from, to] (inclusive, ISO 8601 string comparison).
// Empty from/to strings disable that bound.
func filterByDateRange(executions []*agentexecutionv1.AgentExecution, from, to string) []*agentexecutionv1.AgentExecution {
	if from == "" && to == "" {
		return executions
	}
	filtered := make([]*agentexecutionv1.AgentExecution, 0, len(executions))
	for _, exec := range executions {
		startedAt := exec.GetStatus().GetStartedAt()
		if startedAt == "" {
			continue
		}
		if from != "" && startedAt < from {
			continue
		}
		if to != "" && startedAt > to {
			continue
		}
		filtered = append(filtered, exec)
	}
	return filtered
}

// groupBySessionID groups executions by their spec.session_id.
func groupBySessionID(executions []*agentexecutionv1.AgentExecution) map[string][]*agentexecutionv1.AgentExecution {
	groups := make(map[string][]*agentexecutionv1.AgentExecution)
	for _, exec := range executions {
		sid := exec.GetSpec().GetSessionId()
		groups[sid] = append(groups[sid], exec)
	}
	return groups
}

// groupByAgentID groups executions by their spec.agent_id.
// Executions without an agent_id are grouped under the empty string key.
func groupByAgentID(executions []*agentexecutionv1.AgentExecution) map[string][]*agentexecutionv1.AgentExecution {
	groups := make(map[string][]*agentexecutionv1.AgentExecution)
	for _, exec := range executions {
		aid := exec.GetSpec().GetAgentId()
		groups[aid] = append(groups[aid], exec)
	}
	return groups
}

// groupByDate groups executions by the date portion (YYYY-MM-DD) of
// their started_at timestamp.
func groupByDate(executions []*agentexecutionv1.AgentExecution) map[string][]*agentexecutionv1.AgentExecution {
	groups := make(map[string][]*agentexecutionv1.AgentExecution)
	for _, exec := range executions {
		date := extractDate(exec.GetStatus().GetStartedAt())
		if date == "" {
			continue
		}
		groups[date] = append(groups[date], exec)
	}
	return groups
}

// extractDate returns the YYYY-MM-DD prefix from an ISO 8601 timestamp.
// Returns empty string if the timestamp is too short.
func extractDate(ts string) string {
	if len(ts) < 10 {
		return ""
	}
	return ts[:10]
}

// earliestStartedAt returns the earliest started_at across executions.
func earliestStartedAt(executions []*agentexecutionv1.AgentExecution) string {
	earliest := ""
	for _, exec := range executions {
		sa := exec.GetStatus().GetStartedAt()
		if sa == "" {
			continue
		}
		if earliest == "" || sa < earliest {
			earliest = sa
		}
	}
	return earliest
}

// latestStartedAt returns the latest started_at across executions.
func latestStartedAt(executions []*agentexecutionv1.AgentExecution) string {
	latest := ""
	for _, exec := range executions {
		sa := exec.GetStatus().GetStartedAt()
		if sa == "" {
			continue
		}
		if latest == "" || sa > latest {
			latest = sa
		}
	}
	return latest
}

// buildSessionSummary creates a SessionUsageSummary from a group of
// executions that belong to the same session. Token and cost fields are
// zero in OSS mode.
func buildSessionSummary(sessionID string, executions []*agentexecutionv1.AgentExecution) *agentexecutionv1.SessionUsageSummary {
	return &agentexecutionv1.SessionUsageSummary{
		SessionId:        sessionID,
		ExecutionCount:   int32(len(executions)),
		FirstExecutionAt: earliestStartedAt(executions),
		LastExecutionAt:  latestStartedAt(executions),
	}
}

// buildAgentSummary creates an AgentUsageSummary from a group of
// executions that belong to the same agent. Token and cost fields are
// zero in OSS mode.
func buildAgentSummary(agentID, agentName string, executions []*agentexecutionv1.AgentExecution) *agentexecutionv1.AgentUsageSummary {
	return &agentexecutionv1.AgentUsageSummary{
		AgentId:        agentID,
		AgentName:      agentName,
		ExecutionCount: int32(len(executions)),
	}
}

// buildDailyCostEntries creates a chronologically sorted slice of
// DailyCostEntry from the given executions. Cost and token fields are
// zero in OSS mode.
func buildDailyCostEntries(executions []*agentexecutionv1.AgentExecution) []*agentexecutionv1.DailyCostEntry {
	byDate := groupByDate(executions)
	entries := make([]*agentexecutionv1.DailyCostEntry, 0, len(byDate))
	for date, group := range byDate {
		entries = append(entries, &agentexecutionv1.DailyCostEntry{
			Date:           date,
			ExecutionCount: int32(len(group)),
		})
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].GetDate() < entries[j].GetDate()
	})
	return entries
}

// sortExecutionsByStartedAt sorts executions chronologically by started_at.
func sortExecutionsByStartedAt(executions []*agentexecutionv1.AgentExecution) {
	sort.Slice(executions, func(i, j int) bool {
		return executions[i].GetStatus().GetStartedAt() < executions[j].GetStatus().GetStartedAt()
	})
}

// resolveAgentName attempts to extract a human-readable name from the
// first execution's metadata. Falls back to the agent_id itself.
func resolveAgentName(agentID string, executions []*agentexecutionv1.AgentExecution) string {
	for _, exec := range executions {
		if name := exec.GetMetadata().GetName(); name != "" {
			return name
		}
	}
	return agentID
}

// distinctAgentIDs returns a deduplicated list of agent IDs from
// executions, excluding the empty string.
func distinctAgentIDs(executions []*agentexecutionv1.AgentExecution) []string {
	seen := make(map[string]struct{})
	for _, exec := range executions {
		aid := exec.GetSpec().GetAgentId()
		if aid != "" {
			seen[aid] = struct{}{}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// distinctSessionIDs returns a deduplicated list of session IDs.
func distinctSessionIDs(executions []*agentexecutionv1.AgentExecution) []string {
	seen := make(map[string]struct{})
	for _, exec := range executions {
		sid := exec.GetSpec().GetSessionId()
		if sid != "" {
			seen[sid] = struct{}{}
		}
	}
	ids := make([]string, 0, len(seen))
	for id := range seen {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// topAgentsByCost returns the top N AgentUsageSummary entries sorted by
// cost descending. If n <= 0, all entries are returned.
func topAgentsByCost(summaries []*agentexecutionv1.AgentUsageSummary, n int) []*agentexecutionv1.AgentUsageSummary {
	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].GetBillableCostMicros() > summaries[j].GetBillableCostMicros()
	})
	if n > 0 && len(summaries) > n {
		return summaries[:n]
	}
	return summaries
}

// filterByOrg returns executions belonging to the given organization.
func filterByOrg(executions []*agentexecutionv1.AgentExecution, orgID string) []*agentexecutionv1.AgentExecution {
	filtered := make([]*agentexecutionv1.AgentExecution, 0)
	for _, exec := range executions {
		if strings.EqualFold(exec.GetMetadata().GetOrg(), orgID) {
			filtered = append(filtered, exec)
		}
	}
	return filtered
}

// filterByAgentID returns executions with the given agent_id.
func filterByAgentID(executions []*agentexecutionv1.AgentExecution, agentID string) []*agentexecutionv1.AgentExecution {
	filtered := make([]*agentexecutionv1.AgentExecution, 0)
	for _, exec := range executions {
		if exec.GetSpec().GetAgentId() == agentID {
			filtered = append(filtered, exec)
		}
	}
	return filtered
}
