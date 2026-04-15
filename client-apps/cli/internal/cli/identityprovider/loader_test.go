package identityprovider

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: test-provider
  org: test-org
spec:
  display_name: "Test Provider"
  jwks_uri: "https://example.com/.well-known/jwks.json"
  allowed_issuers:
    - "https://example.com/"
  expected_audience: "https://api.example.com/"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "test-provider", result.IdentityProvider.Metadata.Name)
	assert.Equal(t, "test-org", result.IdentityProvider.Metadata.Org)
	assert.Equal(t, "Test Provider", result.IdentityProvider.Spec.DisplayName)
	assert.Equal(t, "https://example.com/.well-known/jwks.json", result.IdentityProvider.Spec.JwksUri)
	assert.Equal(t, []string{"https://example.com/"}, result.IdentityProvider.Spec.AllowedIssuers)
	assert.Equal(t, "https://api.example.com/", result.IdentityProvider.Spec.ExpectedAudience)
}

func TestLoadFromBytes_SsoProvider(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
metadata:
  name: sso-provider
  org: acme
spec:
  display_name: "Acme Okta"
  jwks_uri: "https://acme.okta.com/oauth2/default/v1/keys"
  allowed_issuers:
    - "https://acme.okta.com/oauth2/default"
  expected_audience: "stigmer-api"
  is_sso_provider: true
  oidc_client_id: "0oa1bcdef2ghijk3lmno"
`)

	result, err := LoadFromBytes(yaml)
	require.NoError(t, err)
	assert.True(t, result.IdentityProvider.Spec.IsSsoProvider)
	assert.Equal(t, "0oa1bcdef2ghijk3lmno", result.IdentityProvider.Spec.OidcClientId)
}

func TestLoadFromBytes_InvalidYAML(t *testing.T) {
	yaml := []byte(`{invalid yaml`)

	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "failed to parse YAML")
}

func TestLoadFromBytes_WrongKind(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: Agent
metadata:
  name: wrong-kind
`)

	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}

func TestLoadFromBytes_MissingMetadata(t *testing.T) {
	yaml := []byte(`
apiVersion: iam.stigmer.ai/v1
kind: IdentityProvider
`)

	_, err := LoadFromBytes(yaml)
	assert.Error(t, err)
}
