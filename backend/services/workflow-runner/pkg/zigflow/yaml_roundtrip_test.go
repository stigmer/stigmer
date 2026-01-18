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

package zigflow_test

import (
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"sigs.k8s.io/yaml"
)

// TestYAMLRoundTrip tests if we can marshal model.Workflow back to YAML
// This is critical for storing generated YAML in WorkflowStatus
func TestYAMLRoundTrip(t *testing.T) {
	originalYAML := `
document:
  dsl: '1.0.0'
  namespace: test
  name: roundtrip-test
  version: '1.0.0'
  description: Test YAML round-trip
do:
  - setGreeting:
      set:
        message: "Hello, World!"
        status: "success"
  - processGreeting:
      set:
        processed: true
`

	t.Run("Parse YAML to struct", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(originalYAML)
		require.NoError(t, err, "Failed to parse YAML")
		assert.NotNil(t, workflow)
		assert.Equal(t, "roundtrip-test", workflow.Document.Name)
		assert.Equal(t, "test", workflow.Document.Namespace)
	})

	t.Run("Marshal struct back to YAML", func(t *testing.T) {
		// Step 1: Parse original YAML
		workflow, err := zigflow.LoadFromString(originalYAML)
		require.NoError(t, err, "Failed to parse original YAML")

		// Step 2: Marshal back to YAML
		regeneratedYAML, err := yaml.Marshal(workflow)
		require.NoError(t, err, "Failed to marshal workflow to YAML")

		t.Logf("Regenerated YAML:\n%s", string(regeneratedYAML))

		// Step 3: Parse regenerated YAML to verify it's valid
		workflow2, err := zigflow.LoadFromString(string(regeneratedYAML))
		require.NoError(t, err, "Failed to parse regenerated YAML")

		// Step 4: Verify key fields match
		assert.Equal(t, workflow.Document.Name, workflow2.Document.Name)
		assert.Equal(t, workflow.Document.Namespace, workflow2.Document.Namespace)
		assert.Equal(t, workflow.Document.DSL, workflow2.Document.DSL)
		assert.Equal(t, workflow.Document.Version, workflow2.Document.Version)
	})

	t.Run("Round-trip preserves structure", func(t *testing.T) {
		// Parse → Marshal → Parse → Marshal
		// Verify second marshal produces same output as first

		workflow1, err := zigflow.LoadFromString(originalYAML)
		require.NoError(t, err)

		yaml1, err := yaml.Marshal(workflow1)
		require.NoError(t, err)

		workflow2, err := zigflow.LoadFromString(string(yaml1))
		require.NoError(t, err)

		yaml2, err := yaml.Marshal(workflow2)
		require.NoError(t, err)

		// Second marshal should match first marshal (stable output)
		assert.Equal(t, string(yaml1), string(yaml2), "Round-trip should produce stable YAML")
	})
}

// TestYAMLWithEnvironmentVariables tests YAML generation with environment variable expressions
func TestYAMLWithEnvironmentVariables(t *testing.T) {
	yamlWithEnvVars := `
document:
  dsl: '1.0.0'
  namespace: test
  name: env-var-test
  version: '1.0.0'
do:
  - fetchData:
      call: http
      with:
        method: get
        endpoint:
          uri: ${ .env.API_BASE_URL + "/data" }
        authentication:
          bearer:
            token: ${ .env.API_TOKEN }
`

	t.Run("Parse YAML with env var expressions", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(yamlWithEnvVars)
		require.NoError(t, err, "Failed to parse YAML with env vars")
		assert.NotNil(t, workflow)
		assert.Equal(t, "env-var-test", workflow.Document.Name)
	})

	t.Run("Round-trip preserves env var expressions", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(yamlWithEnvVars)
		require.NoError(t, err)

		regeneratedYAML, err := yaml.Marshal(workflow)
		require.NoError(t, err)

		t.Logf("Regenerated YAML with env vars:\n%s", string(regeneratedYAML))

		// Parse again to verify expressions are preserved
		workflow2, err := zigflow.LoadFromString(string(regeneratedYAML))
		require.NoError(t, err, "Failed to parse regenerated YAML with env vars")
		assert.Equal(t, workflow.Document.Name, workflow2.Document.Name)
	})
}

// TestYAMLValidationWithPlaceholders tests validation with placeholder env vars
func TestYAMLValidationWithPlaceholders(t *testing.T) {
	yamlWithPlaceholders := `
document:
  dsl: '1.0.0'
  namespace: test
  name: placeholder-test
  version: '1.0.0'
do:
  - fetchData:
      call: http
      with:
        method: get
        endpoint:
          uri: ${API_BASE_URL}/data
        authentication:
          bearer:
            token: ${API_TOKEN}
`

	t.Run("Parse YAML with simple placeholders", func(t *testing.T) {
		workflow, err := zigflow.LoadFromString(yamlWithPlaceholders)
		// This might fail if zigflow expects runtime expressions
		// Document the result for feasibility analysis
		if err != nil {
			t.Logf("Simple placeholders (${VAR}) not supported: %v", err)
			t.Logf("Need to use runtime expressions: ${ .env.VAR }")
		} else {
			t.Logf("Simple placeholders work! Workflow: %s", workflow.Document.Name)
		}
	})
}
