package oauthapp

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: OAuthApp
metadata:
  name: slack-oauth
  org: acme
spec:
  provider: "Slack"
  client_id: "1234567890.abcdef"
  client_secret: "xoxs-test-secret"
  authorization_url: "https://slack.com/oauth/v2/authorize"
  token_url: "https://slack.com/api/oauth.v2.access"
  scopes:
    - "channels:read"
    - "chat:write"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "slack-oauth", result.OAuthApp.Metadata.Name)
	assert.Equal(t, "Slack", result.OAuthApp.Spec.Provider)
	assert.Equal(t, "1234567890.abcdef", result.OAuthApp.Spec.ClientId)
	assert.Equal(t, "xoxs-test-secret", result.OAuthApp.Spec.ClientSecret)
	assert.Equal(t, []string{"channels:read", "chat:write"}, result.OAuthApp.Spec.Scopes)
}

func TestLoadFromBytes_InvalidYAML(t *testing.T) {
	_, err := LoadFromBytes([]byte(`{invalid yaml`))
	assert.Error(t, err)
}

func TestLoadFromBytes_WrongKind(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: Agent
metadata:
  name: wrong
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}

func TestLoadFromBytes_MissingMetadata(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: OAuthApp
`)
	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
