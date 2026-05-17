/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package budget

import (
	"fmt"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)

// LimitKind identifies which budget limit was breached.
type LimitKind int

const (
	LimitCost     LimitKind = iota // max_cost_micros exceeded
	LimitTokens                    // max_total_tokens exceeded
	LimitDuration                  // max_duration_seconds exceeded
)

func (k LimitKind) String() string {
	switch k {
	case LimitCost:
		return "cost"
	case LimitTokens:
		return "tokens"
	case LimitDuration:
		return "duration"
	default:
		return "unknown"
	}
}

// CheckResult describes the outcome of a budget check.
type CheckResult struct {
	OK              bool
	WarningPct      float64 // 0–1 utilisation of the tightest limit
	Exceeded        bool
	ExceededLimit   LimitKind
	ExceededMessage string
	Policy          workflowv1.BudgetExceededPolicy
}

// Tracker accumulates cost, token, and duration usage against a WorkflowBudget.
// It is safe for sequential use within a single workflow; it is NOT goroutine-safe
// (Temporal workflows are single-threaded by design).
type Tracker struct {
	budget    *workflowv1.WorkflowBudget
	startedAt time.Time

	CostMicros   int64
	InputTokens  int64
	OutputTokens int64
}

// NewTracker creates a tracker bound to the given budget.
// If budget is nil, the tracker permits unlimited usage.
func NewTracker(budget *workflowv1.WorkflowBudget, startedAt time.Time) *Tracker {
	return &Tracker{
		budget:    budget,
		startedAt: startedAt,
	}
}

// Record adds cost and token usage from a completed task.
func (t *Tracker) Record(costMicros, inputTokens, outputTokens int64) {
	t.CostMicros += costMicros
	t.InputTokens += inputTokens
	t.OutputTokens += outputTokens
}

// TotalTokens returns the combined input + output token count.
func (t *Tracker) TotalTokens() int64 {
	return t.InputTokens + t.OutputTokens
}

// Check evaluates accumulated usage against the budget limits.
// now is passed explicitly so the caller can use Temporal's deterministic clock.
func (t *Tracker) Check(now time.Time) CheckResult {
	if t.budget == nil {
		return CheckResult{OK: true}
	}

	policy := t.budget.GetOnExceeded()
	if policy == workflowv1.BudgetExceededPolicy_budget_exceeded_policy_unspecified {
		policy = workflowv1.BudgetExceededPolicy_budget_exceeded_terminate
	}

	var highestPct float64

	if limit := t.budget.GetMaxCostMicros(); limit > 0 {
		pct := float64(t.CostMicros) / float64(limit)
		if pct > highestPct {
			highestPct = pct
		}
		if t.CostMicros > limit {
			return CheckResult{
				Exceeded:        true,
				ExceededLimit:   LimitCost,
				ExceededMessage: fmt.Sprintf("cost budget exceeded: %d/%d micro-USD", t.CostMicros, limit),
				Policy:          policy,
				WarningPct:      pct,
			}
		}
	}

	if limit := t.budget.GetMaxTotalTokens(); limit > 0 {
		total := t.TotalTokens()
		pct := float64(total) / float64(limit)
		if pct > highestPct {
			highestPct = pct
		}
		if total > limit {
			return CheckResult{
				Exceeded:        true,
				ExceededLimit:   LimitTokens,
				ExceededMessage: fmt.Sprintf("token budget exceeded: %d/%d tokens", total, limit),
				Policy:          policy,
				WarningPct:      pct,
			}
		}
	}

	if limit := t.budget.GetMaxDurationSeconds(); limit > 0 {
		elapsed := now.Sub(t.startedAt)
		maxDuration := time.Duration(limit) * time.Second
		pct := float64(elapsed) / float64(maxDuration)
		if pct > highestPct {
			highestPct = pct
		}
		if elapsed > maxDuration {
			return CheckResult{
				Exceeded:        true,
				ExceededLimit:   LimitDuration,
				ExceededMessage: fmt.Sprintf("duration budget exceeded: %s/%s", elapsed.Round(time.Second), maxDuration),
				Policy:          policy,
				WarningPct:      pct,
			}
		}
	}

	return CheckResult{
		OK:         true,
		WarningPct: highestPct,
	}
}

// CostRemaining returns remaining cost budget in micro-USD, or -1 if unlimited.
func (t *Tracker) CostRemaining() int64 {
	if t.budget == nil || t.budget.GetMaxCostMicros() == 0 {
		return -1
	}
	rem := t.budget.GetMaxCostMicros() - t.CostMicros
	if rem < 0 {
		return 0
	}
	return rem
}

// TokensRemaining returns remaining token budget, or -1 if unlimited.
func (t *Tracker) TokensRemaining() int64 {
	if t.budget == nil || t.budget.GetMaxTotalTokens() == 0 {
		return -1
	}
	rem := t.budget.GetMaxTotalTokens() - t.TotalTokens()
	if rem < 0 {
		return 0
	}
	return rem
}
