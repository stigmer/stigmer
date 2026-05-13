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
	"text/template"

	"github.com/itchyny/gojq"
	workflowtasks "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"go.temporal.io/sdk/activity"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &TransformActivities{})
}

// TransformActivities implements the Temporal activity for transform tasks.
type TransformActivities struct{}

// TransformActivity executes a deterministic data transformation.
func (a *TransformActivities) TransformActivity(
	ctx context.Context,
	config *workflowtasks.TransformTaskConfig,
	input any,
	runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	switch config.Engine {
	case workflowtasks.TransformEngine_TRANSFORM_ENGINE_JQ:
		logger.Info("Executing JQ transform", "expression_len", len(config.Expression))
		return executeJQ(config.Expression, input)

	case workflowtasks.TransformEngine_TRANSFORM_ENGINE_TEMPLATE:
		logger.Info("Executing template transform")
		return executeTemplate(config.Expression, input)

	case workflowtasks.TransformEngine_TRANSFORM_ENGINE_JSONATA:
		return nil, fmt.Errorf("JSONata engine is not yet implemented; use JQ or template")

	default:
		return nil, fmt.Errorf("unknown transform engine: %v", config.Engine)
	}
}

func executeJQ(expression string, input any) (any, error) {
	query, err := gojq.Parse(expression)
	if err != nil {
		return nil, fmt.Errorf("invalid JQ expression: %w", err)
	}

	code, err := gojq.Compile(query)
	if err != nil {
		return nil, fmt.Errorf("failed to compile JQ expression: %w", err)
	}

	// gojq expects the input as a Go map/slice/scalar
	normalizedInput, err := normalizeForJQ(input)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize input for JQ: %w", err)
	}

	iter := code.Run(normalizedInput)

	// Collect all results; most expressions produce a single value
	var results []any
	for {
		v, ok := iter.Next()
		if !ok {
			break
		}
		if err, isErr := v.(error); isErr {
			return nil, fmt.Errorf("JQ evaluation error: %w", err)
		}
		results = append(results, v)
	}

	if len(results) == 0 {
		return nil, nil
	}
	if len(results) == 1 {
		return results[0], nil
	}
	return results, nil
}

// normalizeForJQ round-trips through JSON to ensure the input is a plain
// Go value that gojq can process (map[string]any, []any, float64, etc.).
func normalizeForJQ(input any) (any, error) {
	b, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	var normalized any
	if err := json.Unmarshal(b, &normalized); err != nil {
		return nil, err
	}
	return normalized, nil
}

func executeTemplate(expression string, input any) (any, error) {
	tmpl, err := template.New("transform").Parse(expression)
	if err != nil {
		return nil, fmt.Errorf("invalid template expression: %w", err)
	}

	// Normalize input so template can access fields with {{ .fieldName }}
	normalized, err := normalizeForJQ(input)
	if err != nil {
		return nil, fmt.Errorf("failed to normalize input for template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, normalized); err != nil {
		return nil, fmt.Errorf("template execution error: %w", err)
	}

	return buf.String(), nil
}
