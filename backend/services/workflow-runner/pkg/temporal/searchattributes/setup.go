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

package searchattributes

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/operatorservice/v1"
	"go.temporal.io/sdk/client"
)

// RequiredSearchAttribute defines a search attribute that must exist
type RequiredSearchAttribute struct {
	Name        string
	Type        enums.IndexedValueType
	Description string
}

// RequiredSearchAttributes lists all search attributes needed by workflow-runner
var RequiredSearchAttributes = []RequiredSearchAttribute{
	{
		Name:        "WorkflowExecutionID",
		Type:        enums.INDEXED_VALUE_TYPE_TEXT,
		Description: "Stores WorkflowExecutionID for progress reporting (execution ID propagation from ExecuteServerlessWorkflow to activity interceptor)",
	},
}

// EnsureSearchAttributesExist checks if required search attributes exist and creates them if missing.
// This function is idempotent and safe to call on every worker startup.
// It mimics database migration behavior - automatically setting up schema on first run.
func EnsureSearchAttributesExist(ctx context.Context, temporalClient client.Client, namespace string) error {
	log.Info().
		Str("namespace", namespace).
		Int("required_attributes", len(RequiredSearchAttributes)).
		Msg("Checking Temporal search attributes")

	// Get operator service client
	operatorClient := temporalClient.OperatorService()

	// List existing search attributes
	resp, err := operatorClient.ListSearchAttributes(ctx, &operatorservice.ListSearchAttributesRequest{
		Namespace: namespace,
	})
	if err != nil {
		return fmt.Errorf("failed to list search attributes: %w", err)
	}

	existingAttrs := make(map[string]enums.IndexedValueType)
	if resp.CustomAttributes != nil {
		for name, valueType := range resp.CustomAttributes {
			existingAttrs[name] = valueType
		}
	}

	// Check each required attribute
	missingAttrs := []RequiredSearchAttribute{}
	for _, required := range RequiredSearchAttributes {
		if existingType, exists := existingAttrs[required.Name]; exists {
			// Attribute exists - verify type matches
			if existingType != required.Type {
				log.Warn().
					Str("attribute", required.Name).
					Str("expected_type", required.Type.String()).
					Str("actual_type", existingType.String()).
					Msg("Search attribute exists but type mismatch - manual intervention required")
			} else {
				log.Debug().
					Str("attribute", required.Name).
					Str("type", required.Type.String()).
					Msg("Search attribute exists")
			}
		} else {
			// Attribute missing
			log.Info().
				Str("attribute", required.Name).
				Str("type", required.Type.String()).
				Msg("Search attribute missing - will create")
			missingAttrs = append(missingAttrs, required)
		}
	}

	// Create missing attributes
	if len(missingAttrs) == 0 {
		log.Info().Msg("All required search attributes exist")
		return nil
	}

	log.Info().
		Int("missing_count", len(missingAttrs)).
		Msg("Creating missing search attributes")

	for _, attr := range missingAttrs {
		log.Info().
			Str("attribute", attr.Name).
			Str("type", attr.Type.String()).
			Str("description", attr.Description).
			Msg("Creating search attribute")

		addReq := &operatorservice.AddSearchAttributesRequest{
			Namespace: namespace,
			SearchAttributes: map[string]enums.IndexedValueType{
				attr.Name: attr.Type,
			},
		}

		_, err := operatorClient.AddSearchAttributes(ctx, addReq)
		if err != nil {
			// Check if error is because attribute already exists (race condition with another worker)
			if isAlreadyExistsError(err) {
				log.Info().
					Str("attribute", attr.Name).
					Msg("Search attribute was created by another process - continuing")
				continue
			}
			return fmt.Errorf("failed to create search attribute %s: %w", attr.Name, err)
		}

		log.Info().
			Str("attribute", attr.Name).
			Msg("Successfully created search attribute")
	}

	log.Info().Msg("All required search attributes are now available")
	return nil
}

// isAlreadyExistsError checks if the error indicates the attribute already exists
func isAlreadyExistsError(err error) bool {
	if err == nil {
		return false
	}
	// Temporal returns specific error messages for duplicate attributes
	errMsg := err.Error()
	return contains(errMsg, "already exists") || 
		   contains(errMsg, "already registered") ||
		   contains(errMsg, "AlreadyExists")
}

// contains checks if a string contains a substring (case-sensitive)
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > len(substr) && 
		(s[:len(substr)] == substr || s[len(s)-len(substr):] == substr || 
		 hasSubstring(s, substr)))
}

func hasSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ValidateSearchAttributesSetup verifies that all required search attributes exist.
// This is useful for startup validation to fail fast if setup is incomplete.
func ValidateSearchAttributesSetup(ctx context.Context, temporalClient client.Client, namespace string) error {
	log.Debug().
		Str("namespace", namespace).
		Msg("Validating search attributes setup")

	operatorClient := temporalClient.OperatorService()

	resp, err := operatorClient.ListSearchAttributes(ctx, &operatorservice.ListSearchAttributesRequest{
		Namespace: namespace,
	})
	if err != nil {
		return fmt.Errorf("failed to list search attributes: %w", err)
	}

	existingAttrs := make(map[string]enums.IndexedValueType)
	if resp.CustomAttributes != nil {
		for name, valueType := range resp.CustomAttributes {
			existingAttrs[name] = valueType
		}
	}

	missingAttrs := []string{}
	typeMismatchAttrs := []string{}

	for _, required := range RequiredSearchAttributes {
		if existingType, exists := existingAttrs[required.Name]; exists {
			if existingType != required.Type {
				typeMismatchAttrs = append(typeMismatchAttrs, 
					fmt.Sprintf("%s (expected %s, got %s)", 
						required.Name, required.Type.String(), existingType.String()))
			}
		} else {
			missingAttrs = append(missingAttrs, required.Name)
		}
	}

	if len(missingAttrs) > 0 || len(typeMismatchAttrs) > 0 {
		errMsg := "Search attributes validation failed:"
		if len(missingAttrs) > 0 {
			errMsg += fmt.Sprintf("\n  Missing attributes: %v", missingAttrs)
		}
		if len(typeMismatchAttrs) > 0 {
			errMsg += fmt.Sprintf("\n  Type mismatches: %v", typeMismatchAttrs)
		}
		return fmt.Errorf(errMsg)
	}

	log.Debug().Msg("Search attributes validation passed")
	return nil
}
