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

package config

import (
	"os"
	"testing"
)

func setTestEnv(t *testing.T, key, value string) {
	t.Helper()
	old, existed := os.LookupEnv(key)
	t.Cleanup(func() {
		if existed {
			os.Setenv(key, old)
		} else {
			os.Unsetenv(key)
		}
	})
	if value == "" {
		os.Unsetenv(key)
	} else {
		os.Setenv(key, value)
	}
}

func setRequiredEnv(t *testing.T) {
	t.Helper()
	setTestEnv(t, "TEMPORAL_SERVICE_ADDRESS", "localhost:7233")
	setTestEnv(t, "STIGMER_BACKEND_ENDPOINT", "localhost:7234")
	setTestEnv(t, "STIGMER_API_KEY", "test-key")
	setTestEnv(t, "STIGMER_SERVICE_USE_TLS", "false")
}

func TestLoadFromEnv_SandboxMode_DerivesQueueSuffixes(t *testing.T) {
	setRequiredEnv(t)
	setTestEnv(t, "STIGMER_TASK_QUEUE", "runner:abc")
	setTestEnv(t, "STIGMER_RUNNER_ID", "runner-123")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() failed: %v", err)
	}

	if !cfg.SandboxMode {
		t.Error("expected SandboxMode=true when STIGMER_TASK_QUEUE is set")
	}
	if cfg.BaseTaskQueue != "runner:abc" {
		t.Errorf("BaseTaskQueue = %q, want %q", cfg.BaseTaskQueue, "runner:abc")
	}
	if cfg.OrchestrationTaskQueue != "runner:abc"+QueueSuffixOrchestration {
		t.Errorf("OrchestrationTaskQueue = %q, want %q",
			cfg.OrchestrationTaskQueue, "runner:abc"+QueueSuffixOrchestration)
	}
	if cfg.ExecutionTaskQueue != "runner:abc"+QueueSuffixExecution {
		t.Errorf("ExecutionTaskQueue = %q, want %q",
			cfg.ExecutionTaskQueue, "runner:abc"+QueueSuffixExecution)
	}
	if cfg.ValidationTaskQueue != "" {
		t.Errorf("ValidationTaskQueue = %q, want empty (sandbox mode)", cfg.ValidationTaskQueue)
	}
	if cfg.RunnerID != "runner-123" {
		t.Errorf("RunnerID = %q, want %q", cfg.RunnerID, "runner-123")
	}
}

func TestLoadFromEnv_OSSMode_UsesHardcodedDefaults(t *testing.T) {
	setRequiredEnv(t)
	setTestEnv(t, "STIGMER_TASK_QUEUE", "")
	setTestEnv(t, "STIGMER_RUNNER_ID", "")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() failed: %v", err)
	}

	if cfg.SandboxMode {
		t.Error("expected SandboxMode=false when STIGMER_TASK_QUEUE is unset")
	}
	if cfg.OrchestrationTaskQueue != "workflow_execution_runner" {
		t.Errorf("OrchestrationTaskQueue = %q, want %q",
			cfg.OrchestrationTaskQueue, "workflow_execution_runner")
	}
	if cfg.ExecutionTaskQueue != "zigflow_execution" {
		t.Errorf("ExecutionTaskQueue = %q, want %q",
			cfg.ExecutionTaskQueue, "zigflow_execution")
	}
	if cfg.ValidationTaskQueue != "workflow_validation_runner" {
		t.Errorf("ValidationTaskQueue = %q, want %q",
			cfg.ValidationTaskQueue, "workflow_validation_runner")
	}
	if cfg.RunnerID != "" {
		t.Errorf("RunnerID = %q, want empty", cfg.RunnerID)
	}
}

func TestLoadFromEnv_SandboxMode_NoValidationQueue(t *testing.T) {
	setRequiredEnv(t)
	setTestEnv(t, "STIGMER_TASK_QUEUE", "runner:xyz")

	cfg, err := LoadFromEnv()
	if err != nil {
		t.Fatalf("LoadFromEnv() failed: %v", err)
	}

	if cfg.ValidationTaskQueue != "" {
		t.Errorf("sandbox mode should NOT set ValidationTaskQueue, got %q",
			cfg.ValidationTaskQueue)
	}
}
