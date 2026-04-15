package agentinstance

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: AgentInstance
metadata:
  name: my-assistant
  org: test-org
spec:
  agent_id: agt_01ARZ3NDEKTSV4RRFFQ69G5FAV
  description: "Personal assistant instance"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "my-assistant", result.AgentInstance.Metadata.Name)
	assert.Equal(t, "agt_01ARZ3NDEKTSV4RRFFQ69G5FAV", result.AgentInstance.Spec.AgentId)
	assert.Equal(t, "Personal assistant instance", result.AgentInstance.Spec.Description)
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
kind: AgentInstance
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
