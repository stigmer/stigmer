package organization

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadFromBytes_ValidYAML(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Test Organization
  slug: test-org
spec:
  description: A test organization
`)

	result, err := LoadFromBytes(content)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Test Organization", result.Organization.Metadata.Name)
	assert.Equal(t, "test-org", result.Organization.Metadata.Slug)
	assert.Equal(t, "A test organization", result.Organization.Spec.Description)
	assert.Equal(t, "memory", result.SourcePath)
}

func TestLoadFromBytes_MinimalValid(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Minimal Org
  slug: minimal
`)

	result, err := LoadFromBytes(content)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Minimal Org", result.Organization.Metadata.Name)
	assert.Equal(t, "minimal", result.Organization.Metadata.Slug)
}

func TestLoadFromBytes_InvalidYAML(t *testing.T) {
	content := []byte(`{invalid yaml: [}`)

	result, err := LoadFromBytes(content)

	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestLoadFromBytes_WrongApiVersion(t *testing.T) {
	content := []byte(`apiVersion: agentic.stigmer.ai/v1
kind: Organization
metadata:
  name: Wrong Version
  slug: wrong
`)

	result, err := LoadFromBytes(content)

	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestLoadFromBytes_WrongKind(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Agent
metadata:
  name: Wrong Kind
  slug: wrong
`)

	result, err := LoadFromBytes(content)

	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestLoadFromBytes_InvalidSlug_TooShort(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Short Slug
  slug: x
`)

	result, err := LoadFromBytes(content)

	assert.Error(t, err)
	assert.Nil(t, result)
	assert.Contains(t, err.Error(), "slug")
}

func TestLoadFromBytes_InvalidSlug_Uppercase(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Bad Slug
  slug: BadSlug
`)

	result, err := LoadFromBytes(content)

	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestLoadFromBytes_EmptyContent(t *testing.T) {
	result, err := LoadFromBytes([]byte(""))

	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestLoadFromBytes_PreservesSpec(t *testing.T) {
	content := []byte(`apiVersion: tenancy.stigmer.ai/v1
kind: Organization
metadata:
  name: Full Spec Org
  slug: fullspec
spec:
  description: Detailed description of the organization
  logo_url: https://example.com/logo.png
`)

	result, err := LoadFromBytes(content)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, "Detailed description of the organization", result.Organization.Spec.Description)
	assert.Equal(t, "https://example.com/logo.png", result.Organization.Spec.LogoUrl)
}
