//go:build integration

package offline

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// The runner stamps an integer protocol version into its `ready` handshake so hosts and
// external embedders can detect compatibility. This proves the real runner subprocess
// advertises the current version end-to-end over the IPC transport.
// Contract: backend/services/runner/docs/ipc-protocol.md.
func TestOffline_RunnerManager_AdvertisesProtocolVersion(t *testing.T) {
	require.NotNil(t, testHarness.Service, "java service must be running")

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// No LLM entries needed — the handshake fires before any session is added.
	_, mgr := startOfflineRunner(t, ctx, nil)

	require.Equal(t, 1, mgr.ProtocolVersion(),
		"runner should advertise IPC protocol version 1 in its ready handshake")
}
