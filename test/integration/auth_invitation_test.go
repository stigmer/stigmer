//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	invitationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/invitation/v1"
	iamv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func requireInvitationClients(t *testing.T) *harness.Clients {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	return harness.NewClients(grpcConn)
}

func TestInvitation_Create_7DayExpiry_Succeeds(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-7day",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:           iamv1.IamRole_viewer,
			MaxRedemptions: 0,
			ExpiresAt:      timestamppb.New(expiresAt),
			Label:          "7-day invite link",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err, "create invitation with 7-day expiry should succeed")

	assert.NotEmpty(t, created.GetMetadata().GetId())
	assert.NotEmpty(t, created.GetStatus().GetToken(), "server must generate a token")
	assert.Equal(t, iamv1.IamRole_viewer, created.GetSpec().GetRole())
	assert.Equal(t, "7-day invite link", created.GetSpec().GetLabel())

	storedExpiry := created.GetSpec().GetExpiresAt().AsTime()
	diff := storedExpiry.Sub(expiresAt).Abs()
	assert.Less(t, diff, 2*time.Second,
		"stored expiry should be within 2s of the requested expiry")

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
	})
}

func TestInvitation_Create_14DayExpiry_Succeeds(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	expiresAt := time.Now().Add(14 * 24 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-14day",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:           iamv1.IamRole_member,
			MaxRedemptions: 1,
			ExpiresAt:      timestamppb.New(expiresAt),
			Label:          "14-day single-use invite",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err, "create invitation with 14-day expiry should succeed")

	assert.NotEmpty(t, created.GetStatus().GetToken())
	assert.Equal(t, int32(1), created.GetSpec().GetMaxRedemptions())

	storedExpiry := created.GetSpec().GetExpiresAt().AsTime()
	diff := storedExpiry.Sub(expiresAt).Abs()
	assert.Less(t, diff, 2*time.Second)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
	})
}

func TestInvitation_Create_30DayExpiry_Succeeds(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-30day",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:           iamv1.IamRole_admin,
			MaxRedemptions: 0,
			ExpiresAt:      timestamppb.New(expiresAt),
			Label:          "30-day unlimited invite",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err, "create invitation with 30-day expiry should succeed")

	assert.NotEmpty(t, created.GetStatus().GetToken())
	assert.Equal(t, iamv1.IamRole_admin, created.GetSpec().GetRole())

	storedExpiry := created.GetSpec().GetExpiresAt().AsTime()
	diff := storedExpiry.Sub(expiresAt).Abs()
	assert.Less(t, diff, 2*time.Second)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
	})
}

func TestInvitation_Create_PastExpiry_FailsValidation(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pastExpiry := time.Now().Add(-1 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-expired",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_viewer,
			ExpiresAt: timestamppb.New(pastExpiry),
		},
	}

	_, err := clients.InvitationCommand.Create(ctx, invitation)
	require.Error(t, err, "creating invitation with past expiry should fail")

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"past expiry should be rejected with INVALID_ARGUMENT")
}

func TestInvitation_Create_ExceedsMaxExpiry_FailsValidation(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tooFar := time.Now().Add(31 * 24 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-too-long",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_viewer,
			ExpiresAt: timestamppb.New(tooFar),
		},
	}

	_, err := clients.InvitationCommand.Create(ctx, invitation)
	require.Error(t, err, "creating invitation exceeding 30-day max should fail")

	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.InvalidArgument, st.Code(),
		"exceeding max expiry should be rejected with INVALID_ARGUMENT")
}

func TestInvitation_ListByOrg_ReturnsCreatedInvitations(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-list",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_viewer,
			ExpiresAt: timestamppb.New(expiresAt),
			Label:     "list test invite",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err)

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
	})

	list, err := clients.InvitationQuery.ListByOrg(ctx, &invitationv1.ListInvitationsByOrgInput{
		Org: harness.TestOrg,
	})
	require.NoError(t, err, "listByOrg should succeed")
	require.NotNil(t, list)

	found := false
	for _, inv := range list.GetEntries() {
		if inv.GetMetadata().GetId() == created.GetMetadata().GetId() {
			found = true
			assert.Equal(t, "list test invite", inv.GetSpec().GetLabel())
			break
		}
	}
	assert.True(t, found, "created invitation should appear in listByOrg results")
}

func TestInvitation_Revoke_SetsRevokedState(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-revoke",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_viewer,
			ExpiresAt: timestamppb.New(time.Now().Add(7 * 24 * time.Hour)),
			Label:     "revoke test",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err)

	revoked, err := clients.InvitationCommand.Revoke(ctx, &invitationv1.InvitationId{
		Value: created.GetMetadata().GetId(),
	})
	require.NoError(t, err, "revoke should succeed")
	assert.Equal(t, invitationv1.InvitationState_revoked, revoked.GetStatus().GetState(),
		"invitation state should be revoked after revocation")
}

func TestInvitation_Revoke_Idempotent(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-revoke-idem",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_viewer,
			ExpiresAt: timestamppb.New(time.Now().Add(7 * 24 * time.Hour)),
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err)

	_, err = clients.InvitationCommand.Revoke(ctx, &invitationv1.InvitationId{
		Value: created.GetMetadata().GetId(),
	})
	require.NoError(t, err)

	_, err = clients.InvitationCommand.Revoke(ctx, &invitationv1.InvitationId{
		Value: created.GetMetadata().GetId(),
	})
	require.NoError(t, err, "revoking an already-revoked invitation should be idempotent")
}

func TestInvitation_GetByToken_ReturnsPreview(t *testing.T) {
	clients := requireInvitationClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	invitation := &invitationv1.Invitation{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "Invitation",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-invite-preview",
			Org:  harness.TestOrg,
		},
		Spec: &invitationv1.InvitationSpec{
			Role:      iamv1.IamRole_member,
			ExpiresAt: timestamppb.New(time.Now().Add(14 * 24 * time.Hour)),
			Label:     "preview test",
		},
	}

	created, err := clients.InvitationCommand.Create(ctx, invitation)
	require.NoError(t, err)
	token := created.GetStatus().GetToken()
	require.NotEmpty(t, token, "created invitation must have a token")

	t.Cleanup(func() {
		cleanCtx, c := context.WithTimeout(context.Background(), 10*time.Second)
		defer c()
		_, _ = clients.InvitationCommand.Revoke(cleanCtx, &invitationv1.InvitationId{
			Value: created.GetMetadata().GetId(),
		})
	})

	preview, err := clients.InvitationQuery.GetByToken(ctx, &invitationv1.InvitationTokenInput{
		Token: token,
	})
	require.NoError(t, err, "getByToken should succeed for a valid token")

	assert.Equal(t, iamv1.IamRole_member, preview.GetRole())
	assert.Equal(t, "preview test", preview.GetLabel())
	assert.True(t, preview.GetIsValid(), "active invitation preview should be valid")
	assert.NotNil(t, preview.GetExpiresAt(), "preview should include expiration")
}
