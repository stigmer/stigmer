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

package utils_test

import (
	"testing"
	"time"

	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/utils"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestToDuration(t *testing.T) {
	tests := []struct {
		Name     string
		Duration model.DurationInline
		Expected time.Duration
	}{
		{
			Name:     "nil",
			Expected: 0,
		},
		{
			Name: "10 second",
			Duration: model.DurationInline{
				Seconds: 10,
			},
			Expected: time.Second * 10,
		},
		{
			Name: "1 minute",
			Duration: model.DurationInline{
				Minutes: 1,
			},
			Expected: time.Minute,
		},
		{
			Name: "Complete",
			Duration: model.DurationInline{
				Days:         4,
				Hours:        6,
				Minutes:      43,
				Seconds:      32,
				Milliseconds: 472,
			},
			Expected: (time.Hour * 24 * 4) + (time.Hour * 6) + (time.Minute * 43) + (time.Second * 32) + (time.Millisecond * 472),
		},
	}

	for _, test := range tests {
		t.Run(test.Name, func(t *testing.T) {
			assert.Equal(t, test.Expected, utils.ToDuration(&model.Duration{
				Value: test.Duration,
			}))
		})
	}
}

func TestProtoToSDKDuration(t *testing.T) {
	t.Run("nil input returns nil", func(t *testing.T) {
		result := utils.ProtoToSDKDuration(nil)
		assert.Nil(t, result)
	})

	t.Run("converts all fields correctly", func(t *testing.T) {
		proto := &tasksv1.Duration{
			Days:         7,
			Hours:        12,
			Minutes:      30,
			Seconds:      45,
			Milliseconds: 500,
		}

		result := utils.ProtoToSDKDuration(proto)
		require.NotNil(t, result)

		inline := result.AsInline()
		require.NotNil(t, inline)
		assert.Equal(t, int32(7), inline.Days)
		assert.Equal(t, int32(12), inline.Hours)
		assert.Equal(t, int32(30), inline.Minutes)
		assert.Equal(t, int32(45), inline.Seconds)
		assert.Equal(t, int32(500), inline.Milliseconds)
	})

	t.Run("handles partial fields", func(t *testing.T) {
		proto := &tasksv1.Duration{
			Days: 1,
			// All other fields default to 0
		}

		result := utils.ProtoToSDKDuration(proto)
		require.NotNil(t, result)

		inline := result.AsInline()
		require.NotNil(t, inline)
		assert.Equal(t, int32(1), inline.Days)
		assert.Equal(t, int32(0), inline.Hours)
		assert.Equal(t, int32(0), inline.Minutes)
		assert.Equal(t, int32(0), inline.Seconds)
		assert.Equal(t, int32(0), inline.Milliseconds)
	})
}

func TestProtoToTimeDuration(t *testing.T) {
	t.Run("nil input returns zero", func(t *testing.T) {
		result := utils.ProtoToTimeDuration(nil)
		assert.Equal(t, time.Duration(0), result)
	})

	t.Run("converts 1 week correctly", func(t *testing.T) {
		proto := &tasksv1.Duration{
			Days: 7,
		}

		result := utils.ProtoToTimeDuration(proto)
		assert.Equal(t, 7*24*time.Hour, result)
	})

	t.Run("converts composite duration correctly", func(t *testing.T) {
		proto := &tasksv1.Duration{
			Days:         1,
			Hours:        2,
			Minutes:      30,
			Seconds:      45,
			Milliseconds: 100,
		}

		expected := (24 * time.Hour) + (2 * time.Hour) + (30 * time.Minute) + (45 * time.Second) + (100 * time.Millisecond)
		result := utils.ProtoToTimeDuration(proto)
		assert.Equal(t, expected, result)
	})
}
