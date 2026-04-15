package workflowinstance

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowInstance
metadata:
  name: prod-deploy
  org: test-org
spec:
  workflow_id: wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV
  description: "Production deployment instance"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "prod-deploy", result.WorkflowInstance.Metadata.Name)
	assert.Equal(t, "wfl_01ARZ3NDEKTSV4RRFFQ69G5FAV", result.WorkflowInstance.Spec.WorkflowId)
	assert.Equal(t, "Production deployment instance", result.WorkflowInstance.Spec.Description)
}

func TestLoadFromBytes_InvalidYAML(t *testing.T) {
	_, err := LoadFromBytes([]byte(`{invalid yaml`))
	assert.Error(t, err)
}

func TestLoadFromBytes_WrongKind(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: wrong
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}

func TestLoadFromBytes_MissingMetadata(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: WorkflowInstance
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
