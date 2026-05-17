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
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	stigmerconfig "github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
)

// Queue suffix constants appended to the runner's base task queue in cloud
// (sandbox) mode. Mirrors the ":cursor" suffix used by cursor-runner.
const (
	QueueSuffixOrchestration = ":wf-orch"
	QueueSuffixExecution     = ":wf-exec"
)

// Config holds Temporal worker configuration loaded from environment variables.
//
// Queue resolution:
//   - Cloud/sandbox mode (STIGMER_TASK_QUEUE set): queues are derived from the
//     base queue with suffixes (:wf-orch, :wf-exec). Validation is not registered
//     in sandbox mode — it stays on the global K8s pod.
//   - OSS/local mode (STIGMER_TASK_QUEUE unset): uses hardcoded defaults
//     (workflow_execution_runner, zigflow_execution, workflow_validation_runner).
type Config struct {
	TemporalServiceAddress string
	TemporalNamespace      string

	// BaseTaskQueue is the runner's base queue (STIGMER_TASK_QUEUE).
	// Empty in OSS/local mode; set by DaytonaSandboxRunnerLauncher in cloud mode.
	BaseTaskQueue string

	// Three-Queue Architecture:
	// - OrchestrationTaskQueue: For ExecuteWorkflowActivity (Java → Go polyglot)
	// - ExecutionTaskQueue: For ExecuteServerlessWorkflow + Zigflow activities
	// - ValidationTaskQueue: For validation activities (global K8s pod only)
	OrchestrationTaskQueue string
	ExecutionTaskQueue     string
	ValidationTaskQueue    string

	// SandboxMode is true when STIGMER_TASK_QUEUE is set (cloud/Daytona).
	// In sandbox mode, the validation queue is not registered.
	SandboxMode bool

	// RunnerID is the ephemeral runner's ID (STIGMER_RUNNER_ID).
	// Empty in OSS/local mode. Set as runner_id on sessions created for agent calls.
	RunnerID string

	MaxConcurrency int

	// Claim Check Pattern configuration
	ClaimCheckEnabled            bool
	ClaimCheckThresholdBytes     int64
	ClaimCheckCompressionEnabled bool
	ClaimCheckTTLDays            int

	// Cloudflare R2 configuration (direct mode — OSS/local only)
	R2Bucket          string
	R2Endpoint        string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string

	// Claim check storage mode: "proxy" when STIGMER_PROXY_ENDPOINT is set,
	// "r2" otherwise. Determined automatically in LoadFromEnv.
	ClaimCheckStorageType string

	// Proxy configuration (cloud mode — when STIGMER_PROXY_ENDPOINT is set)
	ClaimCheckProxyEndpoint  string
	ClaimCheckProxyAuthToken string

	// Stigmer backend configuration (for progress callbacks and workflow queries)
	StigmerConfig *stigmerconfig.StigmerConfig
}

// LoadFromEnv loads configuration from environment variables.
//
// Queue resolution:
//   - STIGMER_TASK_QUEUE set (cloud/sandbox): derives :wf-orch and :wf-exec
//     from the base queue. Validation queue is not set (sandbox does not serve
//     validation — a global K8s pod handles it).
//   - STIGMER_TASK_QUEUE unset (OSS/local): uses hardcoded defaults.
func LoadFromEnv() (*Config, error) {
	stigmerCfg, err := stigmerconfig.LoadStigmerConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load Stigmer config: %w", err)
	}

	baseQueue := os.Getenv("STIGMER_TASK_QUEUE")
	sandboxMode := baseQueue != ""

	var orchQueue, execQueue, validationQueue string
	if sandboxMode {
		orchQueue = baseQueue + QueueSuffixOrchestration
		execQueue = baseQueue + QueueSuffixExecution
		// Validation is not served in sandbox mode — global K8s pod only
		validationQueue = ""
	} else {
		orchQueue = "workflow_execution_runner"
		execQueue = "zigflow_execution"
		validationQueue = "workflow_validation_runner"
	}

	cfg := &Config{
		TemporalServiceAddress: getEnvOrDefault("TEMPORAL_SERVICE_ADDRESS", "localhost:7233"),
		TemporalNamespace:      getEnvOrDefault("TEMPORAL_NAMESPACE", "default"),
		BaseTaskQueue:          baseQueue,
		OrchestrationTaskQueue: orchQueue,
		ExecutionTaskQueue:     execQueue,
		ValidationTaskQueue:    validationQueue,
		SandboxMode:            sandboxMode,
		RunnerID:               os.Getenv("STIGMER_RUNNER_ID"),
		MaxConcurrency:         getEnvAsIntOrDefault("TEMPORAL_MAX_CONCURRENCY", 10),

		ClaimCheckEnabled:            getEnvAsBoolOrDefault("CLAIMCHECK_ENABLED", false),
		ClaimCheckThresholdBytes:     getEnvAsInt64OrDefault("CLAIMCHECK_THRESHOLD_BYTES", 51200),
		ClaimCheckCompressionEnabled: getEnvAsBoolOrDefault("CLAIMCHECK_COMPRESSION_ENABLED", true),
		ClaimCheckTTLDays:            getEnvAsIntOrDefault("CLAIMCHECK_TTL_DAYS", 30),

		R2Bucket:          getEnvOrDefault("R2_BUCKET", ""),
		R2Endpoint:        getEnvOrDefault("R2_ENDPOINT", ""),
		R2AccessKeyID:     getEnvOrDefault("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnvOrDefault("R2_SECRET_ACCESS_KEY", ""),
		R2Region:          getEnvOrDefault("R2_REGION", "auto"),

		StigmerConfig: stigmerCfg,
	}

	// Determine claim check storage mode: proxy when STIGMER_PROXY_ENDPOINT
	// is set (cloud), direct R2 otherwise (OSS/local).
	proxyEndpoint := strings.TrimSpace(os.Getenv("STIGMER_PROXY_ENDPOINT"))
	if proxyEndpoint != "" {
		cfg.ClaimCheckStorageType = "proxy"
		cfg.ClaimCheckProxyEndpoint = proxyEndpoint

		authToken := os.Getenv("STIGMER_TOKEN")
		if authToken == "" {
			authToken = os.Getenv("STIGMER_API_KEY")
		}
		cfg.ClaimCheckProxyAuthToken = authToken
	} else {
		cfg.ClaimCheckStorageType = "r2"
	}

	if cfg.TemporalServiceAddress == "" {
		return nil, errors.New("TEMPORAL_SERVICE_ADDRESS is required")
	}
	if cfg.OrchestrationTaskQueue == "" {
		return nil, errors.New("orchestration task queue cannot be empty")
	}
	if cfg.ExecutionTaskQueue == "" {
		return nil, errors.New("execution task queue cannot be empty")
	}

	if cfg.ClaimCheckEnabled {
		switch cfg.ClaimCheckStorageType {
		case "proxy":
			if cfg.ClaimCheckProxyAuthToken == "" {
				return nil, errors.New("STIGMER_TOKEN or STIGMER_API_KEY is required when claim check uses proxy mode")
			}
		default:
			if cfg.R2Bucket == "" {
				return nil, errors.New("R2_BUCKET is required when Claim Check is enabled in direct mode")
			}
			if cfg.R2Endpoint == "" {
				return nil, errors.New("R2_ENDPOINT is required when Claim Check is enabled in direct mode")
			}
			if cfg.R2AccessKeyID == "" {
				return nil, errors.New("R2_ACCESS_KEY_ID is required when Claim Check is enabled in direct mode")
			}
			if cfg.R2SecretAccessKey == "" {
				return nil, errors.New("R2_SECRET_ACCESS_KEY is required when Claim Check is enabled in direct mode")
			}
		}
	}

	return cfg, nil
}

func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvAsIntOrDefault(key string, defaultValue int) int {
	if valueStr := os.Getenv(key); valueStr != "" {
		if value, err := strconv.Atoi(valueStr); err == nil {
			return value
		}
	}
	return defaultValue
}

func getEnvAsInt64OrDefault(key string, defaultValue int64) int64 {
	if valueStr := os.Getenv(key); valueStr != "" {
		if value, err := strconv.ParseInt(valueStr, 10, 64); err == nil {
			return value
		}
	}
	return defaultValue
}

func getEnvAsBoolOrDefault(key string, defaultValue bool) bool {
	if valueStr := os.Getenv(key); valueStr != "" {
		if value, err := strconv.ParseBool(valueStr); err == nil {
			return value
		}
	}
	return defaultValue
}

func (c *Config) String() string {
	return fmt.Sprintf("TemporalServiceAddress=%s, Namespace=%s, OrchestrationQueue=%s, ExecutionQueue=%s, ValidationQueue=%s, SandboxMode=%v, RunnerID=%s, MaxConcurrency=%d, ClaimCheckEnabled=%v, ClaimCheckStorageType=%s",
		c.TemporalServiceAddress, c.TemporalNamespace, c.OrchestrationTaskQueue, c.ExecutionTaskQueue, c.ValidationTaskQueue, c.SandboxMode, c.RunnerID, c.MaxConcurrency, c.ClaimCheckEnabled, c.ClaimCheckStorageType)
}
