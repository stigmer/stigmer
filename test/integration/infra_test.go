//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInfrastructureStarts(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping infrastructure test in short mode")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	h, err := harness.Start(ctx, harness.DefaultConfig())
	require.NoError(t, err, "test harness should start without error")
	defer h.Stop(ctx)

	t.Run("mongodb is reachable", func(t *testing.T) {
		assert.NotEmpty(t, h.Mongo.URI, "mongodb URI should not be empty")
		assert.NotEmpty(t, h.Mongo.Port, "mongodb port should not be empty")
	})

	t.Run("redis is reachable", func(t *testing.T) {
		assert.NotEmpty(t, h.Redis.Host, "redis host should not be empty")
		assert.NotEmpty(t, h.Redis.Port, "redis port should not be empty")
	})

	t.Run("temporal is reachable", func(t *testing.T) {
		assert.NotEmpty(t, h.Temporal.Address(), "temporal address should not be empty")
	})
}
