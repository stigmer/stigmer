package environment

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: prod-env
  org: test-org
spec:
  description: "Production environment"
  data:
    DATABASE_URL:
      value: "postgres://localhost:5432/db"
      is_secret: false
    API_SECRET:
      value: "supersecret"
      is_secret: true
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "prod-env", result.Environment.Metadata.Name)
	assert.Equal(t, "Production environment", result.Environment.Spec.Description)
	assert.Len(t, result.Environment.Spec.Data, 2)
	assert.False(t, result.Environment.Spec.Data["DATABASE_URL"].IsSecret)
	assert.True(t, result.Environment.Spec.Data["API_SECRET"].IsSecret)
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
kind: Environment
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
