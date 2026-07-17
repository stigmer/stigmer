package session

import (
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestSessionController_ListByChannel pins the label-filter contract parity
// with Stigmer Cloud: only sessions carrying the exact
// stigmer.ai/channel-id label are returned, and an unknown channel yields an
// empty list (channel sessions are created by the cloud channel runtime, so
// OSS stores typically hold none).
func TestSessionController_ListByChannel(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	createSession := func(t *testing.T, name string, labels map[string]string) *sessionv1.Session {
		t.Helper()
		created, err := controller.Create(contextWithSessionKind(), &sessionv1.Session{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Session",
			Metadata: &apiresource.ApiResourceMetadata{
				Name:   name,
				Org:    "test-org",
				Labels: labels,
			},
			Spec: &sessionv1.SessionSpec{
				AgentInstanceId: "test-agent-instance-id",
				Subject:         name,
			},
		})
		if err != nil {
			t.Fatalf("Create failed for %s: %v", name, err)
		}
		return created
	}

	channelSession := createSession(t, "Channel Conversation", map[string]string{
		"stigmer.ai/channel-id": "ach-1",
	})
	createSession(t, "Other Channel Conversation", map[string]string{
		"stigmer.ai/channel-id": "ach-2",
	})
	createSession(t, "Console Session", nil)

	t.Run("returns only sessions labeled with the requested channel", func(t *testing.T) {
		list, err := controller.ListByChannel(contextWithSessionKind(),
			&sessionv1.ListSessionsByChannelRequest{ChannelId: "ach-1"})
		if err != nil {
			t.Fatalf("ListByChannel failed: %v", err)
		}

		if len(list.Entries) != 1 {
			t.Fatalf("Expected 1 session for channel ach-1, got %d", len(list.Entries))
		}
		if list.Entries[0].Metadata.Id != channelSession.Metadata.Id {
			t.Errorf("Expected session %s, got %s",
				channelSession.Metadata.Id, list.Entries[0].Metadata.Id)
		}
	})

	t.Run("unknown channel yields an empty list", func(t *testing.T) {
		list, err := controller.ListByChannel(contextWithSessionKind(),
			&sessionv1.ListSessionsByChannelRequest{ChannelId: "ach-unknown"})
		if err != nil {
			t.Fatalf("ListByChannel failed: %v", err)
		}
		if len(list.Entries) != 0 {
			t.Errorf("Expected empty list for unknown channel, got %d entries", len(list.Entries))
		}
	})

	t.Run("missing channel_id is rejected", func(t *testing.T) {
		if _, err := controller.ListByChannel(contextWithSessionKind(),
			&sessionv1.ListSessionsByChannelRequest{}); err == nil {
			t.Error("Expected validation error for missing channel_id")
		}
	})
}
