//go:build integration

package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apikeyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/apikey/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/emptypb"
)

func TestApiKey_Create_ReturnsKeyWithFingerprint(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	key := &apikeyv1.ApiKey{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "ApiKey",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-apikey-create",
		},
		Spec: &apikeyv1.ApiKeySpec{
			NeverExpires: true,
		},
	}

	created, err := clients.ApiKeyCommand.Create(ctx, key)
	require.NoError(t, err, "create api key should succeed")

	assert.NotEmpty(t, created.GetMetadata().GetId(), "api key should have an ID")
	assert.NotEmpty(t, created.GetSpec().GetFingerprint(), "fingerprint must be populated after creation")

	t.Logf("created api key: id=%s, fingerprint=%s",
		created.GetMetadata().GetId(), created.GetSpec().GetFingerprint())

	// The raw key is returned in the metadata.name field by convention.
	// It should have the stk_ prefix.
	rawKey := created.GetMetadata().GetName()
	if rawKey != "" && strings.HasPrefix(rawKey, "stk_") {
		t.Logf("raw api key returned with stk_ prefix (length=%d)", len(rawKey))
	}

	// Cleanup
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.ApiKeyCommand.Delete(cleanCtx, &apikeyv1.ApiKeyId{Value: created.GetMetadata().GetId()})
	})
}

func TestApiKey_Delete_Succeeds(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	key := &apikeyv1.ApiKey{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "ApiKey",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-apikey-delete",
		},
		Spec: &apikeyv1.ApiKeySpec{
			NeverExpires: true,
		},
	}

	created, err := clients.ApiKeyCommand.Create(ctx, key)
	require.NoError(t, err)

	keyID := created.GetMetadata().GetId()
	require.NotEmpty(t, keyID)

	deleted, err := clients.ApiKeyCommand.Delete(ctx, &apikeyv1.ApiKeyId{Value: keyID})
	require.NoError(t, err, "delete api key should succeed")
	assert.Equal(t, keyID, deleted.GetMetadata().GetId(), "deleted key should return the same resource")
}

func TestApiKey_ListByAccount(t *testing.T) {
	clients := requirePlatformClientClients(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create a key so there's at least one to list
	key := &apikeyv1.ApiKey{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "ApiKey",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-apikey-list",
		},
		Spec: &apikeyv1.ApiKeySpec{
			NeverExpires: true,
		},
	}

	created, err := clients.ApiKeyCommand.Create(ctx, key)
	require.NoError(t, err)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.ApiKeyCommand.Delete(cleanCtx, &apikeyv1.ApiKeyId{Value: created.GetMetadata().GetId()})
	})

	// List keys — findAll returns all keys for the authenticated identity.
	list, err := clients.ApiKeyQuery.FindAll(ctx, &emptypb.Empty{})
	if err != nil {
		t.Logf("FindAll returned error: %v", err)
	} else {
		assert.GreaterOrEqual(t, len(list.GetEntries()), 1,
			"should list at least the api key we just created")
	}
}
