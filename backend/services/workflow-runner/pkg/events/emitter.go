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

package events

import (
	"sync/atomic"
	"time"

	"github.com/google/uuid"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	wfexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// Emitter builds WorkflowExecutionEvent protos with auto-incrementing
// sequence numbers. It does NOT persist events — callers batch them
// into updateStatus RPC calls.
//
// Emitter is not goroutine-safe; Temporal workflows are single-threaded.
type Emitter struct {
	seq atomic.Uint64
}

// NewEmitter creates an emitter starting from the given last-known sequence.
// Pass 0 for a fresh execution.
func NewEmitter(lastSequence uint64) *Emitter {
	e := &Emitter{}
	e.seq.Store(lastSequence)
	return e
}

func (e *Emitter) next() uint64 {
	return e.seq.Add(1)
}

func (e *Emitter) base(eventType wfexecv1.WorkflowEventType, taskName string, now time.Time) *wfexecv1.WorkflowExecutionEvent {
	return &wfexecv1.WorkflowExecutionEvent{
		EventId:        uuid.New().String(),
		EventType:      eventType,
		SequenceNumber: e.next(),
		OccurredAt:     now.UTC().Format(time.RFC3339Nano),
		TaskName:       taskName,
	}
}

// ── Execution lifecycle ─────────────────────────────────────────────────

func (e *Emitter) ExecutionStarted(now time.Time, totalTasks int32, workflowID, instanceID string) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_execution_started, "", now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_ExecutionStarted{
		ExecutionStarted: &wfexecv1.ExecutionStartedPayload{
			TotalTasks:         totalTasks,
			WorkflowId:         workflowID,
			WorkflowInstanceId: instanceID,
		},
	}
	return ev
}

func (e *Emitter) ExecutionCompleted(now time.Time, durationMs, costMicros, totalTokens int64, outputSummary *structpb.Struct) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_execution_completed, "", now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_ExecutionCompleted{
		ExecutionCompleted: &wfexecv1.ExecutionCompletedPayload{
			OutputSummary:   outputSummary,
			DurationMs:      durationMs,
			TotalCostMicros: costMicros,
			TotalTokens:     totalTokens,
		},
	}
	return ev
}

func (e *Emitter) ExecutionFailed(now time.Time, errMsg, failedTask string, durationMs int64) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_execution_failed, "", now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_ExecutionFailed{
		ExecutionFailed: &wfexecv1.ExecutionFailedPayload{
			Error:          errMsg,
			FailedTaskName: failedTask,
			DurationMs:     durationMs,
		},
	}
	return ev
}

// ── Task lifecycle ──────────────────────────────────────────────────────

func (e *Emitter) TaskStarted(now time.Time, taskName string, taskKind workflowv1.WorkflowTaskKind, attempt int32, inputSummary *structpb.Struct) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_task_started, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_TaskStarted{
		TaskStarted: &wfexecv1.TaskStartedPayload{
			TaskKind:      taskKind,
			InputSummary:  inputSummary,
			AttemptNumber: attempt,
		},
	}
	return ev
}

func (e *Emitter) TaskCompleted(now time.Time, taskName string, taskKind workflowv1.WorkflowTaskKind, durationMs, costMicros, tokensUsed int64, outputSummary *structpb.Struct) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_task_completed, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_TaskCompleted{
		TaskCompleted: &wfexecv1.TaskCompletedPayload{
			TaskKind:      taskKind,
			DurationMs:    durationMs,
			OutputSummary: outputSummary,
			CostMicros:    costMicros,
			TokensUsed:    tokensUsed,
		},
	}
	return ev
}

func (e *Emitter) TaskFailed(now time.Time, taskName string, taskKind workflowv1.WorkflowTaskKind, errMsg string, attempt, maxAttempts int32, willRetry bool, durationMs int64) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_task_failed, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_TaskFailed{
		TaskFailed: &wfexecv1.TaskFailedPayload{
			TaskKind:      taskKind,
			Error:         errMsg,
			AttemptNumber: attempt,
			MaxAttempts:   maxAttempts,
			WillRetry:     willRetry,
			DurationMs:    durationMs,
		},
	}
	return ev
}

func (e *Emitter) TaskSkipped(now time.Time, taskName string, taskKind workflowv1.WorkflowTaskKind, reason string) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_task_skipped, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_TaskSkipped{
		TaskSkipped: &wfexecv1.TaskSkippedPayload{
			TaskKind: taskKind,
			Reason:   reason,
		},
	}
	return ev
}

// ── Budget ──────────────────────────────────────────────────────────────

func (e *Emitter) BudgetCheckpoint(now time.Time, taskName string, costConsumed, costRemaining, tokensConsumed, tokensRemaining int64, breached bool, policy workflowv1.BudgetExceededPolicy) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_budget_checkpoint, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_BudgetCheckpoint{
		BudgetCheckpoint: &wfexecv1.BudgetCheckpointPayload{
			CostConsumedMicros:  costConsumed,
			CostRemainingMicros: costRemaining,
			TokensConsumed:      tokensConsumed,
			TokensRemaining:     tokensRemaining,
			ThresholdBreached:   breached,
			OnExceededPolicy:    policy,
		},
	}
	return ev
}

// ── Approval ────────────────────────────────────────────────────────────

func (e *Emitter) ApprovalRequested(now time.Time, taskName, prompt string, approvers []string, timeoutSeconds int32) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_approval_requested, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_ApprovalRequested{
		ApprovalRequested: &wfexecv1.ApprovalRequestedPayload{
			Prompt:         prompt,
			Approvers:      approvers,
			TimeoutSeconds: timeoutSeconds,
		},
	}
	return ev
}

// ── Events / Signals ────────────────────────────────────────────────────

func (e *Emitter) EventEmitted(now time.Time, taskName, eventType, eventSource, eventSubject string) *wfexecv1.WorkflowExecutionEvent {
	ev := e.base(wfexecv1.WorkflowEventType_event_emitted, taskName, now)
	ev.Payload = &wfexecv1.WorkflowExecutionEvent_EventEmitted{
		EventEmitted: &wfexecv1.EventEmittedPayload{
			EventType:    eventType,
			EventSource:  eventSource,
			EventSubject: eventSubject,
		},
	}
	return ev
}
