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

package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &ValidateActivities{})
}

// ValidateActivities implements the Temporal activity for validate tasks.
type ValidateActivities struct{}

// ValidationError represents a single validation failure.
type ValidationError struct {
	Rule    string `json:"rule,omitempty"`
	Path    string `json:"path,omitempty"`
	Message string `json:"message"`
}

// ValidateActivity executes schema and business-rule validation.
func (a *ValidateActivities) ValidateActivity(
	ctx context.Context,
	config *workflowtasks.ValidateTaskConfig,
	input any,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	var errors []ValidationError

	// JSON Schema validation
	if config.Schema != nil && len(config.Schema.AsMap()) > 0 {
		schemaErrors, err := validateJSONSchema(config.Schema.AsMap(), input)
		if err != nil {
			return nil, fmt.Errorf("schema validation setup failed: %w", err)
		}
		errors = append(errors, schemaErrors...)
	}

	// Business rule validation
	for _, rule := range config.Rules {
		passed, err := evaluateRule(rule, input)
		if err != nil {
			logger.Warn("Rule evaluation failed", "rule", rule.Name, "error", err)
			errors = append(errors, ValidationError{
				Rule:    rule.Name,
				Message: fmt.Sprintf("rule evaluation error: %s", err),
			})
			continue
		}
		if !passed {
			msg := rule.Message
			if msg == "" {
				msg = fmt.Sprintf("rule '%s' failed", rule.Name)
			}
			errors = append(errors, ValidationError{
				Rule:    rule.Name,
				Message: msg,
			})
		}
	}

	valid := len(errors) == 0
	output := map[string]any{
		"valid":  valid,
		"errors": errors,
		"data":   input,
	}

	if !valid {
		switch config.OnFail {
		case workflowtasks.ValidationFailPolicy_VALIDATION_FAIL_RAISE,
			workflowtasks.ValidationFailPolicy_VALIDATION_FAIL_POLICY_UNSPECIFIED:
			return nil, fmt.Errorf("validation failed: %d error(s)", len(errors))

		case workflowtasks.ValidationFailPolicy_VALIDATION_FAIL_BRANCH:
			if config.FallbackTask != "" {
				output["__stigmer_branch_override"] = config.FallbackTask
			} else {
				return nil, fmt.Errorf("validation failed with BRANCH policy but no fallback_task set")
			}

		case workflowtasks.ValidationFailPolicy_VALIDATION_FAIL_WARN:
			logger.Warn("Validation warnings", "count", len(errors))
		}
	}

	return output, nil
}

func validateJSONSchema(schemaMap map[string]any, input any) ([]ValidationError, error) {
	schemaBytes, err := json.Marshal(schemaMap)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal schema: %w", err)
	}

	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(schemaBytes))
	if err != nil {
		return nil, fmt.Errorf("failed to parse schema JSON: %w", err)
	}

	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("schema.json", doc); err != nil {
		return nil, fmt.Errorf("failed to add schema resource: %w", err)
	}

	schema, err := compiler.Compile("schema.json")
	if err != nil {
		return nil, fmt.Errorf("failed to compile schema: %w", err)
	}

	normalized, err := normalizeForJQ(input)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize input: %w", err)
	}

	validationErr := schema.Validate(normalized)
	if validationErr == nil {
		return nil, nil
	}

	valErr, ok := validationErr.(*jsonschema.ValidationError)
	if !ok {
		return []ValidationError{{Message: validationErr.Error()}}, nil
	}

	var errors []ValidationError
	collectSchemaErrors(valErr, &errors)
	return errors, nil
}

func collectSchemaErrors(err *jsonschema.ValidationError, errors *[]ValidationError) {
	if len(err.Causes) == 0 {
		instanceLoc := ""
		if len(err.InstanceLocation) > 0 {
			instanceLoc = strings.Join(err.InstanceLocation, "/")
		}
		*errors = append(*errors, ValidationError{
			Path:    instanceLoc,
			Message: err.ErrorKind.LocalizedString(nil),
		})
		return
	}
	for _, cause := range err.Causes {
		collectSchemaErrors(cause, errors)
	}
}

func evaluateRule(rule *workflowtasks.ValidationRule, input any) (bool, error) {
	// Use gojq to evaluate the rule expression as a boolean.
	// The expression should return true (pass) or false (fail).
	result, err := executeJQ(rule.Expression, input)
	if err != nil {
		return false, err
	}

	switch v := result.(type) {
	case bool:
		return v, nil
	case nil:
		return false, nil
	default:
		return false, fmt.Errorf("rule expression must evaluate to boolean, got %T", result)
	}
}
