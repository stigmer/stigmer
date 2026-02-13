/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
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

package utils

import (
	"time"

	"github.com/serverlessworkflow/sdk-go/v3/model"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
)

// ToDuration converts the Serverless Workflow SDK duration into a time.Duration.
func ToDuration(v *model.Duration) (duration time.Duration) {
	if v != nil {
		inline := v.AsInline()

		if inline != nil {
			duration += time.Millisecond * time.Duration(inline.Milliseconds)
			duration += time.Second * time.Duration(inline.Seconds)
			duration += time.Minute * time.Duration(inline.Minutes)
			duration += time.Hour * time.Duration(inline.Hours)
			duration += (time.Hour * 24) * time.Duration(inline.Days)
		}
	}

	return duration
}

// ProtoToSDKDuration converts a proto Duration message to the Serverless Workflow SDK Duration.
//
// This enables direct conversion from the proto API to the SDK model without going through YAML.
// Returns nil if the input is nil.
func ProtoToSDKDuration(d *tasksv1.Duration) *model.Duration {
	if d == nil {
		return nil
	}
	return &model.Duration{
		Value: model.DurationInline{
			Days:         int32(d.GetDays()),
			Hours:        int32(d.GetHours()),
			Minutes:      int32(d.GetMinutes()),
			Seconds:      int32(d.GetSeconds()),
			Milliseconds: int32(d.GetMilliseconds()),
		},
	}
}

// ProtoToTimeDuration converts a proto Duration message directly to a time.Duration.
//
// This is a convenience function that combines ProtoToSDKDuration and ToDuration.
// Returns 0 if the input is nil.
func ProtoToTimeDuration(d *tasksv1.Duration) time.Duration {
	return ToDuration(ProtoToSDKDuration(d))
}
