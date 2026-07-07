package session

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestUpdateSubject_EmptyIdReturnsInvalidArgument(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	// Direct-call path (no interceptor); the handler's own guard must return
	// InvalidArgument rather than the old plain error (Unknown).
	_, err := controller.UpdateSubject(context.Background(), &sessionv1.UpdateSessionSubjectRequest{Id: ""})

	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err))
}

func TestUpdateSubject_MissingSessionReturnsNotFound(t *testing.T) {
	controller, store := setupTestController(t)
	defer store.Close()

	_, err := controller.UpdateSubject(context.Background(), &sessionv1.UpdateSessionSubjectRequest{
		Id:      "ses_missing",
		Subject: "anything",
	})

	require.Error(t, err)
	require.Equal(t, codes.NotFound, status.Code(err),
		"a missing session must surface as NotFound, not Unknown")
}
