package oauthapp

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	oauthappv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/iam/oauthapp/v1"
)

// DeleteFromBackend deletes an OAuth app by resource ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, resourceID string) (*oauthappv1.OAuthApp, error) {
	if resourceID == "" {
		return nil, errors.New("oauth app ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.OAuthApp.Delete(ctx, &stigmer.DeleteResourceInput{
		ResourceID: resourceID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete oauth app '%s'", resourceID)
	}

	return deleted, nil
}
