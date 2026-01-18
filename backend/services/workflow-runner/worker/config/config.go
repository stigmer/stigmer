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

	stigmerconfig "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/config"
)

// Config holds Temporal worker configuration loaded from environment variables
type Config struct {
	TemporalServiceAddress string
	TemporalNamespace      string
	
	// Three-Queue Architecture:
	// - OrchestrationTaskQueue: For ExecuteWorkflowActivity (workflow execution orchestration)
	//   This queue handles Go activities called by Java workflows (polyglot pattern)
	// - ExecutionTaskQueue: For ExecuteServerlessWorkflow + Zigflow activities (user workflows)
	// - ValidationTaskQueue: For validation activities (workflow validation)
	//   This queue handles Go activities called by Java validation workflows
	OrchestrationTaskQueue string // Default: "workflow_execution_runner"
	ExecutionTaskQueue     string // Default: "zigflow_execution"
	ValidationTaskQueue    string // Default: "workflow_validation_runner"
	
	MaxConcurrency         int

	// Claim Check Pattern configuration
	ClaimCheckEnabled          bool
	ClaimCheckThresholdBytes   int64
	ClaimCheckCompressionEnabled bool
	ClaimCheckTTLDays          int
	
	// Cloudflare R2 configuration
	R2Bucket          string
	R2Endpoint        string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string

	// Stigmer backend configuration (for progress callbacks and workflow queries)
	StigmerConfig *stigmerconfig.StigmerConfig
}

// LoadFromEnv loads configuration from environment variables
func LoadFromEnv() (*Config, error) {
	// Load Stigmer backend configuration
	stigmerCfg, err := stigmerconfig.LoadStigmerConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to load Stigmer config: %w", err)
	}

	cfg := &Config{
		TemporalServiceAddress: getEnvOrDefault("TEMPORAL_SERVICE_ADDRESS", "localhost:7233"),
		TemporalNamespace:      getEnvOrDefault("TEMPORAL_NAMESPACE", "default"),
		OrchestrationTaskQueue: getEnvOrDefault("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE", "workflow_execution_runner"),
		ExecutionTaskQueue:     getEnvOrDefault("TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE", "zigflow_execution"),
		ValidationTaskQueue:    getEnvOrDefault("TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE", "workflow_validation_runner"),
		MaxConcurrency:         getEnvAsIntOrDefault("TEMPORAL_MAX_CONCURRENCY", 10),
		
		// Claim Check configuration
		ClaimCheckEnabled:            getEnvAsBoolOrDefault("CLAIMCHECK_ENABLED", false),
		ClaimCheckThresholdBytes:     getEnvAsInt64OrDefault("CLAIMCHECK_THRESHOLD_BYTES", 51200), // 50KB default
		ClaimCheckCompressionEnabled: getEnvAsBoolOrDefault("CLAIMCHECK_COMPRESSION_ENABLED", true),
		ClaimCheckTTLDays:            getEnvAsIntOrDefault("CLAIMCHECK_TTL_DAYS", 30),
		
		// Cloudflare R2 configuration
		R2Bucket:          getEnvOrDefault("R2_BUCKET", ""),
		R2Endpoint:        getEnvOrDefault("R2_ENDPOINT", ""),
		R2AccessKeyID:     getEnvOrDefault("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnvOrDefault("R2_SECRET_ACCESS_KEY", ""),
		R2Region:          getEnvOrDefault("R2_REGION", "auto"),

		// Stigmer backend configuration
		StigmerConfig: stigmerCfg,
	}

	// Validate required Temporal fields
	if cfg.TemporalServiceAddress == "" {
		return nil, errors.New("TEMPORAL_SERVICE_ADDRESS is required")
	}
	if cfg.OrchestrationTaskQueue == "" {
		return nil, errors.New("TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE cannot be empty")
	}
	if cfg.ExecutionTaskQueue == "" {
		return nil, errors.New("TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE cannot be empty")
	}
	if cfg.ValidationTaskQueue == "" {
		return nil, errors.New("TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE cannot be empty")
	}
	
	// Validate Claim Check configuration if enabled
	if cfg.ClaimCheckEnabled {
		if cfg.R2Bucket == "" {
			return nil, errors.New("R2_BUCKET is required when Claim Check is enabled")
		}
		if cfg.R2Endpoint == "" {
			return nil, errors.New("R2_ENDPOINT is required when Claim Check is enabled")
		}
		if cfg.R2AccessKeyID == "" {
			return nil, errors.New("R2_ACCESS_KEY_ID is required when Claim Check is enabled")
		}
		if cfg.R2SecretAccessKey == "" {
			return nil, errors.New("R2_SECRET_ACCESS_KEY is required when Claim Check is enabled")
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
	return fmt.Sprintf("TemporalServiceAddress=%s, Namespace=%s, OrchestrationQueue=%s, ExecutionQueue=%s, ValidationQueue=%s, MaxConcurrency=%d, ClaimCheckEnabled=%v",
		c.TemporalServiceAddress, c.TemporalNamespace, c.OrchestrationTaskQueue, c.ExecutionTaskQueue, c.ValidationTaskQueue, c.MaxConcurrency, c.ClaimCheckEnabled)
}
