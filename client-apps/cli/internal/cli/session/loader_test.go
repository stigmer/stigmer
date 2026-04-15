package session

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: debug-session
  org: test-org
spec:
  agent_instance_id: ain_01ARZ3NDEKTSV4RRFFQ69G5FAV
  subject: "Debugging the auth flow"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "debug-session", result.Session.Metadata.Name)
	assert.Equal(t, "ain_01ARZ3NDEKTSV4RRFFQ69G5FAV", result.Session.Spec.AgentInstanceId)
	assert.Equal(t, "Debugging the auth flow", result.Session.Spec.Subject)
}

func TestLoadFromBytes_MinimalSession(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: Session
metadata:
  name: minimal-session
  org: test-org
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "minimal-session", result.Session.Metadata.Name)
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
kind: Session
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
