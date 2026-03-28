package agentexecution

import (
	"sort"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// executionTotalCost returns the all-inclusive cost for an execution
// by summing estimated_cost_usd from every message's llm_metrics
// (main agent + sub-agents).
func executionTotalCost(exec *agentexecutionv1.AgentExecution) float64 {
	u := computeUsageFromMessages(exec)
	return u.GetEstimatedCostUsd()
}

// executionTotalSummarizationCost sums the cost of all summarization events
// in an execution's context_info.
func executionTotalSummarizationCost(exec *agentexecutionv1.AgentExecution) float64 {
	var cost float64
	for _, evt := range exec.GetStatus().GetContextInfo().GetSummarizationEvents() {
		cost += evt.GetSummarizationCostUsd()
	}
	return cost
}

// executionSubAgentCount returns the number of sub-agent invocations.
func executionSubAgentCount(exec *agentexecutionv1.AgentExecution) int32 {
	return int32(len(exec.GetStatus().GetSubAgentExecutions()))
}

// collectUsageMetrics computes a single UsageMetrics from an execution's
// per-message llm_metrics (main agent + sub-agents) and returns it as a
// one-element slice for backward compatibility with callers that iterate.
func collectUsageMetrics(exec *agentexecutionv1.AgentExecution) []*agentexecutionv1.UsageMetrics {
	u := computeUsageFromMessages(exec)
	if u.GetLlmCallCount() == 0 {
		return nil
	}
	return []*agentexecutionv1.UsageMetrics{u}
}

// computeUsageFromMessages builds a UsageMetrics on-the-fly by walking
// every message in the execution (main agent + sub-agents) and
// aggregating each message's LlmCallMetrics.
func computeUsageFromMessages(exec *agentexecutionv1.AgentExecution) *agentexecutionv1.UsageMetrics {
	agg := &agentexecutionv1.UsageMetrics{}

	allMessages := collectAllMessages(exec)
	for _, msg := range allMessages {
		m := msg.GetLlmMetrics()
		if m == nil {
			continue
		}
		promptTokens := m.GetInputTokens() + m.GetCacheCreationTokens() + m.GetCacheReadTokens()
		agg.PromptTokens += promptTokens
		agg.CompletionTokens += m.GetOutputTokens()
		agg.CacheCreationTokens += m.GetCacheCreationTokens()
		agg.CacheReadTokens += m.GetCacheReadTokens()
		agg.EstimatedCostUsd += m.GetEstimatedCostUsd()
		agg.LlmDurationMs += m.GetDurationMs()
		agg.LlmCallCount++

		if agg.PrimaryModel == "" && m.GetModel() != "" {
			agg.PrimaryModel = m.GetModel()
		}
		if agg.PrimaryProvider == "" && m.GetProvider() != "" {
			agg.PrimaryProvider = m.GetProvider()
		}
	}
	agg.TotalTokens = agg.PromptTokens + agg.CompletionTokens
	return agg
}

// collectAllMessages returns a flat slice of all messages from the main
// agent and all sub-agent executions.
func collectAllMessages(exec *agentexecutionv1.AgentExecution) []*agentexecutionv1.AgentMessage {
	msgs := exec.GetStatus().GetMessages()
	for _, sub := range exec.GetStatus().GetSubAgentExecutions() {
		msgs = append(msgs, sub.GetMessages()...)
	}
	return msgs
}

// aggregateUsageMetrics sums token counts and cost across multiple
// executions, producing a single UsageMetrics representing the total.
// model_breakdown and llm_calls are intentionally omitted from the
// aggregate since mergeModelBreakdowns handles model-level rollup.
func aggregateUsageMetrics(executions []*agentexecutionv1.AgentExecution) *agentexecutionv1.UsageMetrics {
	agg := &agentexecutionv1.UsageMetrics{}
	for _, exec := range executions {
		for _, u := range collectUsageMetrics(exec) {
			agg.PromptTokens += u.GetPromptTokens()
			agg.CompletionTokens += u.GetCompletionTokens()
			agg.TotalTokens += u.GetTotalTokens()
			agg.LlmCallCount += u.GetLlmCallCount()
			agg.CacheCreationTokens += u.GetCacheCreationTokens()
			agg.CacheReadTokens += u.GetCacheReadTokens()
			agg.EstimatedCostUsd += u.GetEstimatedCostUsd()
			agg.ToolResultCharsTruncated += u.GetToolResultCharsTruncated()
			agg.TotalDurationMs += u.GetTotalDurationMs()
			agg.LlmDurationMs += u.GetLlmDurationMs()
			agg.ToolDurationMs += u.GetToolDurationMs()
			agg.ApprovalWaitDurationMs += u.GetApprovalWaitDurationMs()
		}
	}
	return agg
}

// mergeModelBreakdowns builds per-(model, provider) ModelUsage entries
// by walking every message's LlmCallMetrics across all executions
// (main agent + sub-agents).
func mergeModelBreakdowns(executions []*agentexecutionv1.AgentExecution) []*agentexecutionv1.ModelUsage {
	type key struct{ model, provider string }
	merged := make(map[key]*agentexecutionv1.ModelUsage)

	for _, exec := range executions {
		for _, msg := range collectAllMessages(exec) {
			m := msg.GetLlmMetrics()
			if m == nil {
				continue
			}
			k := key{m.GetModel(), m.GetProvider()}
			existing, ok := merged[k]
			if !ok {
				merged[k] = &agentexecutionv1.ModelUsage{
					Model:               m.GetModel(),
					Provider:            m.GetProvider(),
					InputTokens:         m.GetInputTokens(),
					OutputTokens:        m.GetOutputTokens(),
					CacheCreationTokens: m.GetCacheCreationTokens(),
					CacheReadTokens:     m.GetCacheReadTokens(),
					CallCount:           1,
					EstimatedCostUsd:    m.GetEstimatedCostUsd(),
				}
				continue
			}
			existing.InputTokens += m.GetInputTokens()
			existing.OutputTokens += m.GetOutputTokens()
			existing.CacheCreationTokens += m.GetCacheCreationTokens()
			existing.CacheReadTokens += m.GetCacheReadTokens()
			existing.CallCount++
			existing.EstimatedCostUsd += m.GetEstimatedCostUsd()
		}
	}

	result := make([]*agentexecutionv1.ModelUsage, 0, len(merged))
	for _, mu := range merged {
		result = append(result, mu)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].GetEstimatedCostUsd() > result[j].GetEstimatedCostUsd()
	})
	return result
}

// buildExecutionSummary projects a full AgentExecution into a lightweight
// ExecutionUsageSummary suitable for report responses.
func buildExecutionSummary(exec *agentexecutionv1.AgentExecution) *agentexecutionv1.ExecutionUsageSummary {
	usage := computeUsageFromMessages(exec)
	return &agentexecutionv1.ExecutionUsageSummary{
		ExecutionId:      exec.GetMetadata().GetId(),
		StartedAt:        exec.GetStatus().GetStartedAt(),
		CompletedAt:      exec.GetStatus().GetCompletedAt(),
		PromptTokens:     usage.GetPromptTokens(),
		CompletionTokens: usage.GetCompletionTokens(),
		CacheReadTokens:  usage.GetCacheReadTokens(),
		EstimatedCostUsd: usage.GetEstimatedCostUsd(),
		PrimaryModel:     usage.GetPrimaryModel(),
		SubAgentCount:    executionSubAgentCount(exec),
		Phase:            exec.GetStatus().GetPhase(),
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
// executions that belong to the same session.
func buildSessionSummary(sessionID string, executions []*agentexecutionv1.AgentExecution) *agentexecutionv1.SessionUsageSummary {
	var totalTokens int32
	var totalCost float64
	for _, exec := range executions {
		for _, u := range collectUsageMetrics(exec) {
			totalTokens += u.GetTotalTokens()
		}
		totalCost += executionTotalCost(exec)
	}
	return &agentexecutionv1.SessionUsageSummary{
		SessionId:        sessionID,
		ExecutionCount:   int32(len(executions)),
		TotalTokens:      totalTokens,
		EstimatedCostUsd: totalCost,
		FirstExecutionAt: earliestStartedAt(executions),
		LastExecutionAt:  latestStartedAt(executions),
	}
}

// buildAgentSummary creates an AgentUsageSummary from a group of
// executions that belong to the same agent. agentName is resolved
// externally (e.g., from the agent resource).
func buildAgentSummary(agentID, agentName string, executions []*agentexecutionv1.AgentExecution) *agentexecutionv1.AgentUsageSummary {
	var totalTokens int32
	var totalCost float64
	for _, exec := range executions {
		for _, u := range collectUsageMetrics(exec) {
			totalTokens += u.GetTotalTokens()
		}
		totalCost += executionTotalCost(exec)
	}
	return &agentexecutionv1.AgentUsageSummary{
		AgentId:          agentID,
		AgentName:        agentName,
		ExecutionCount:   int32(len(executions)),
		TotalTokens:      totalTokens,
		EstimatedCostUsd: totalCost,
	}
}

// buildDailyCostEntries creates a chronologically sorted slice of
// DailyCostEntry from the given executions.
func buildDailyCostEntries(executions []*agentexecutionv1.AgentExecution) []*agentexecutionv1.DailyCostEntry {
	byDate := groupByDate(executions)
	entries := make([]*agentexecutionv1.DailyCostEntry, 0, len(byDate))
	for date, group := range byDate {
		var totalTokens int32
		var totalCost float64
		for _, exec := range group {
			for _, u := range collectUsageMetrics(exec) {
				totalTokens += u.GetTotalTokens()
			}
			totalCost += executionTotalCost(exec)
		}
		entries = append(entries, &agentexecutionv1.DailyCostEntry{
			Date:             date,
			ExecutionCount:   int32(len(group)),
			TotalTokens:      totalTokens,
			EstimatedCostUsd: totalCost,
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
		return summaries[i].GetEstimatedCostUsd() > summaries[j].GetEstimatedCostUsd()
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
