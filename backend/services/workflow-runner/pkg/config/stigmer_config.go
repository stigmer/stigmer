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
	"fmt"
	"os"
)

// StigmerConfig holds configuration for connecting to Stigmer backend service
// for progress callback reporting.
//
// This configuration follows the same pattern as agent-runner for consistency:
// - STIGMER_BACKEND_ENDPOINT: gRPC endpoint (unified variable name)
// - STIGMER_API_KEY: API key for authentication (unified with agent-runner)
// - STIGMER_SERVICE_USE_TLS: TLS flag (workflow-runner specific)
type StigmerConfig struct {
	// Endpoint is the gRPC endpoint for Stigmer backend service
	// Example: stigmer-prod-api.planton.live:443
	Endpoint string

	// APIKey is the authentication token for Stigmer backend service
	// Sent as Bearer token in Authorization header
	APIKey string

	// UseTLS enables TLS connection to Stigmer backend service
	UseTLS bool
}

// LoadStigmerConfig loads Stigmer backend service configuration from environment variables.
//
// Required environment variables:
// - STIGMER_BACKEND_ENDPOINT: gRPC endpoint (unified with agent-runner)
// - STIGMER_API_KEY: API key (unified with agent-runner)
// - STIGMER_SERVICE_USE_TLS: TLS flag (defaults to true)
func LoadStigmerConfig() (*StigmerConfig, error) {
	endpoint := os.Getenv("STIGMER_BACKEND_ENDPOINT")
	if endpoint == "" {
		return nil, fmt.Errorf("STIGMER_BACKEND_ENDPOINT environment variable is required")
	}

	apiKey := os.Getenv("STIGMER_API_KEY")
	if apiKey == "" {
		return nil, fmt.Errorf("STIGMER_API_KEY environment variable is required")
	}

	useTLS := os.Getenv("STIGMER_SERVICE_USE_TLS") != "false" // Default to true

	return &StigmerConfig{
		Endpoint: endpoint,
		APIKey:   apiKey,
		UseTLS:   useTLS,
	}, nil
}

// Validate checks if the configuration is valid
func (c *StigmerConfig) Validate() error {
	if c.Endpoint == "" {
		return fmt.Errorf("Stigmer backend endpoint is required")
	}
	if c.APIKey == "" {
		return fmt.Errorf("Stigmer API key is required")
	}
	return nil
}
