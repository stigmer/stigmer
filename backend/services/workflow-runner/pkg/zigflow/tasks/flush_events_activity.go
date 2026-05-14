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

package tasks

import (
	"context"
	"fmt"

	wfexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"google.golang.org/protobuf/encoding/protojson"
)

// FlushEventsInput is the input for the FlushEventsActivity.
//
// Events are carried as protojson-encoded byte slices rather than raw protobuf
// messages. This is necessary because Temporal's default Go data converter
// uses encoding/json for non-proto types, and encoding/json cannot round-trip
// protobuf oneof fields (they are Go interface types). Pre-serializing with
// protojson preserves the oneof discriminator across the Temporal boundary.
type FlushEventsInput struct {
	ExecutionID string   `json:"execution_id"`
	EventsJSON  [][]byte `json:"events_json"`
}

// NewFlushEventsInput creates a FlushEventsInput by serializing each event
// with protojson. Call this from workflow code before passing to the activity.
func NewFlushEventsInput(executionID string, events []*wfexecv1.WorkflowExecutionEvent) (*FlushEventsInput, error) {
	marshaler := protojson.MarshalOptions{UseProtoNames: true}
	encoded := make([][]byte, 0, len(events))
	for i, ev := range events {
		b, err := marshaler.Marshal(ev)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal event %d: %w", i, err)
		}
		encoded = append(encoded, b)
	}
	return &FlushEventsInput{
		ExecutionID: executionID,
		EventsJSON:  encoded,
	}, nil
}

// decodeEvents deserializes the protojson-encoded events back into proto messages.
func (f *FlushEventsInput) decodeEvents() ([]*wfexecv1.WorkflowExecutionEvent, error) {
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	out := make([]*wfexecv1.WorkflowExecutionEvent, 0, len(f.EventsJSON))
	for i, raw := range f.EventsJSON {
		ev := &wfexecv1.WorkflowExecutionEvent{}
		if err := unmarshaler.Unmarshal(raw, ev); err != nil {
			return nil, fmt.Errorf("failed to unmarshal event %d: %w", i, err)
		}
		out = append(out, ev)
	}
	return out, nil
}

// FlushEventsActivity sends accumulated workflow execution events to the
// backend via the updateStatus RPC. Runs as a Temporal activity so it can
// make gRPC calls (workflow code is deterministic and cannot do I/O).
func FlushEventsActivity(ctx context.Context, input *FlushEventsInput) error {
	if input == nil || len(input.EventsJSON) == 0 {
		return nil
	}

	events, err := input.decodeEvents()
	if err != nil {
		return fmt.Errorf("failed to decode events for execution %s: %w", input.ExecutionID, err)
	}

	client, err := grpc_client.GetWorkflowExecutionCommandClient()
	if err != nil {
		return fmt.Errorf("failed to get workflow execution client: %w", err)
	}

	_, err = client.UpdateStatusWithEvents(ctx, input.ExecutionID, nil, events)
	if err != nil {
		return fmt.Errorf("failed to flush %d events for execution %s: %w",
			len(events), input.ExecutionID, err)
	}

	return nil
}

func init() {
	activitiesRegistry = append(activitiesRegistry, FlushEventsActivity)
}
