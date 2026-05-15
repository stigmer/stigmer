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
	"sync"
	"testing"
)

func TestActivityCounter_StartsAtZero(t *testing.T) {
	c := NewActivityCounter()
	if got := c.Count(); got != 0 {
		t.Errorf("Count() = %d, want 0", got)
	}
}

func TestActivityCounter_IncrementDecrement(t *testing.T) {
	c := NewActivityCounter()

	c.count.Add(1)
	if got := c.Count(); got != 1 {
		t.Errorf("after +1: Count() = %d, want 1", got)
	}

	c.count.Add(1)
	if got := c.Count(); got != 2 {
		t.Errorf("after +2: Count() = %d, want 2", got)
	}

	c.count.Add(-1)
	if got := c.Count(); got != 1 {
		t.Errorf("after -1: Count() = %d, want 1", got)
	}

	c.count.Add(-1)
	if got := c.Count(); got != 0 {
		t.Errorf("after -2: Count() = %d, want 0", got)
	}
}

func TestActivityCounter_ConcurrentAccess(t *testing.T) {
	c := NewActivityCounter()
	const goroutines = 100

	var wg sync.WaitGroup
	wg.Add(goroutines * 2)

	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			c.count.Add(1)
		}()
		go func() {
			defer wg.Done()
			c.count.Add(-1)
		}()
	}

	wg.Wait()
	if got := c.Count(); got != 0 {
		t.Errorf("after %d +1 and %d -1: Count() = %d, want 0",
			goroutines, goroutines, got)
	}
}

func TestNewClient_NilWhenNoRunnerID(t *testing.T) {
	// When RunnerID is empty, NewClient should return nil (local/OSS mode).
	// A nil Client is safe to call Start/Stop on (they're no-ops).
	var c *Client
	c.Start() // should not panic
	c.Stop()  // should not panic
}
