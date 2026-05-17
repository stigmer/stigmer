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

// StigmerConfig holds configuration for connecting to Stigmer backend service.
//
// Authentication:
//   - STIGMER_TOKEN: Primary credential (user JWT injected by the sandbox launcher)
//   - STIGMER_API_KEY: Fallback credential (API key for OSS/local mode)
//   - STIGMER_BACKEND_ENDPOINT: gRPC endpoint
//   - STIGMER_SERVICE_USE_TLS: TLS flag (defaults to true)
//
// In cloud/sandbox mode the DaytonaSandboxRunnerLauncher injects the invoking
// user's JWT as STIGMER_TOKEN. The runner authenticates as that user directly
// on every gRPC call — no on-behalf-of impersonation is needed.
type StigmerConfig struct {
	// Endpoint is the gRPC endpoint for Stigmer backend service
	// Example: api.stigmer.ai:443
	Endpoint string

	// APIKey is the authentication token for Stigmer backend service.
	// In sandbox mode this is the user's JWT (from STIGMER_TOKEN).
	// In OSS/local mode this is a platform API key (from STIGMER_API_KEY).
	// Sent as Bearer token in the Authorization header.
	APIKey string

	// UseTLS enables TLS connection to Stigmer backend service
	UseTLS bool
}

// LoadStigmerConfig loads Stigmer backend service configuration from environment variables.
//
// Required environment variables:
//   - STIGMER_BACKEND_ENDPOINT: gRPC endpoint
//   - STIGMER_TOKEN or STIGMER_API_KEY: Auth credential (STIGMER_TOKEN takes precedence)
//   - STIGMER_SERVICE_USE_TLS: TLS flag (defaults to true)
func LoadStigmerConfig() (*StigmerConfig, error) {
	endpoint := os.Getenv("STIGMER_BACKEND_ENDPOINT")
	if endpoint == "" {
		return nil, fmt.Errorf("STIGMER_BACKEND_ENDPOINT environment variable is required")
	}

	apiKey := os.Getenv("STIGMER_TOKEN")
	if apiKey == "" {
		apiKey = os.Getenv("STIGMER_API_KEY")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("STIGMER_TOKEN or STIGMER_API_KEY environment variable is required")
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
		return fmt.Errorf("Stigmer auth token is required (STIGMER_TOKEN or STIGMER_API_KEY)")
	}
	return nil
}
