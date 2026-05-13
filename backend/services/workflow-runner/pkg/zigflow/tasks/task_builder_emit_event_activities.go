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
	"time"

	"github.com/google/uuid"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &EmitEventActivities{})
}

// EmitEventActivities implements the Temporal activity for emit_event tasks.
type EmitEventActivities struct{}

// EmitEventActivity constructs a CloudEvents envelope and returns it as the
// task output. Cross-workflow delivery is deferred to Phase 2.
func (a *EmitEventActivities) EmitEventActivity(
	ctx context.Context,
	config *workflowtasks.EmitEventTaskConfig,
	executionID string,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	spec := config.Event
	now := time.Now().UTC()

	source := spec.Source
	if source == "" {
		source = fmt.Sprintf("/workflows/executions/%s", executionID)
	}

	envelope := map[string]any{
		"id":              uuid.New().String(),
		"specversion":     "1.0",
		"type":            spec.Type,
		"source":          source,
		"time":            now.Format(time.RFC3339),
		"datacontenttype": "application/json",
	}

	if spec.Subject != "" {
		envelope["subject"] = spec.Subject
	}

	if spec.Data != nil && len(spec.Data.AsMap()) > 0 {
		envelope["data"] = spec.Data.AsMap()
	}

	logger.Info("CloudEvent envelope constructed",
		"type", spec.Type,
		"source", source,
		"id", envelope["id"])

	return envelope, nil
}
