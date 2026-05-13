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
)

// FlushEventsInput is the input for the FlushEventsActivity.
type FlushEventsInput struct {
	ExecutionID string
	Events      []*wfexecv1.WorkflowExecutionEvent
}

// FlushEventsActivity sends accumulated workflow execution events to the
// backend via the updateStatus RPC. Runs as a Temporal activity so it can
// make gRPC calls (workflow code is deterministic and cannot do I/O).
func FlushEventsActivity(ctx context.Context, input *FlushEventsInput) error {
	if input == nil || len(input.Events) == 0 {
		return nil
	}

	client, err := grpc_client.GetWorkflowExecutionCommandClient()
	if err != nil {
		return fmt.Errorf("failed to get workflow execution client: %w", err)
	}

	_, err = client.UpdateStatusWithEvents(ctx, input.ExecutionID, nil, input.Events)
	if err != nil {
		return fmt.Errorf("failed to flush %d events for execution %s: %w",
			len(input.Events), input.ExecutionID, err)
	}

	return nil
}

func init() {
	activitiesRegistry = append(activitiesRegistry, FlushEventsActivity)
}
