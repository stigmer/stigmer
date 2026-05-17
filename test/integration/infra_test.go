//go:build integration

package integration

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInfrastructureStarts(t *testing.T) {
	require.NotNil(t, testHarness, "suite harness must be initialized via TestMain")

	t.Run("mongodb is reachable", func(t *testing.T) {
		assert.NotEmpty(t, testHarness.Mongo.URI, "mongodb URI should not be empty")
		assert.NotEmpty(t, testHarness.Mongo.Port, "mongodb port should not be empty")
	})

	t.Run("redis is reachable", func(t *testing.T) {
		assert.NotEmpty(t, testHarness.Redis.Host, "redis host should not be empty")
		assert.NotEmpty(t, testHarness.Redis.Port, "redis port should not be empty")
	})

	t.Run("temporal is reachable", func(t *testing.T) {
		assert.NotEmpty(t, testHarness.Temporal.Address(), "temporal address should not be empty")
	})
}
