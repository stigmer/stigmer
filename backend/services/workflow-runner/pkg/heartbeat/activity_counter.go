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

package heartbeat

import (
	"context"
	"sync/atomic"

	"go.temporal.io/sdk/interceptor"
)

// ActivityCounter tracks the number of concurrently executing Temporal
// activities. The heartbeat client reads this to report current_executions
// in each heartbeat message.
//
// Thread-safe: uses atomic operations for lock-free concurrent access
// from multiple Temporal worker goroutines.
type ActivityCounter struct {
	count atomic.Int32
}

// NewActivityCounter creates a zero-valued counter.
func NewActivityCounter() *ActivityCounter {
	return &ActivityCounter{}
}

// Count returns the current number of in-flight activities.
func (c *ActivityCounter) Count() int32 {
	return c.count.Load()
}

// ActivityCounterInterceptor is a Temporal WorkerInterceptor that increments
// the counter when an activity starts and decrements it when the activity
// completes (success or failure). Wire this into the Temporal worker options
// to get accurate execution counts for heartbeat reporting.
type ActivityCounterInterceptor struct {
	interceptor.WorkerInterceptorBase
	counter *ActivityCounter
}

// NewActivityCounterInterceptor creates an interceptor bound to the given counter.
func NewActivityCounterInterceptor(counter *ActivityCounter) *ActivityCounterInterceptor {
	return &ActivityCounterInterceptor{counter: counter}
}

func (i *ActivityCounterInterceptor) InterceptActivity(
	ctx context.Context,
	next interceptor.ActivityInboundInterceptor,
) interceptor.ActivityInboundInterceptor {
	return &activityCounterInbound{
		ActivityInboundInterceptorBase: interceptor.ActivityInboundInterceptorBase{Next: next},
		counter:                        i.counter,
	}
}

type activityCounterInbound struct {
	interceptor.ActivityInboundInterceptorBase
	counter *ActivityCounter
}

func (a *activityCounterInbound) ExecuteActivity(
	ctx context.Context,
	input *interceptor.ExecuteActivityInput,
) (any, error) {
	a.counter.count.Add(1)
	defer a.counter.count.Add(-1)
	return a.Next.ExecuteActivity(ctx, input)
}
