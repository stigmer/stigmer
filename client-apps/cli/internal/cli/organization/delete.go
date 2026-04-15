package organization

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
)

// DeleteOptions contains options for deleting an organization.
type DeleteOptions struct {
	OrganizationID string
	Client         *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	Organization *organizationv1.Organization
}

// Delete deletes an organization from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.OrganizationID == "" {
		return nil, errors.New("organization ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Client, opts.OrganizationID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Organization: deleted}, nil
}

// DeleteFromBackend deletes an organization by ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, orgID string) (*organizationv1.Organization, error) {
	if orgID == "" {
		return nil, errors.New("organization ID is required for delete operation")
	}

	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	deleted, err := client.Organization.Delete(ctx, orgID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete organization '%s'", orgID)
	}

	return deleted, nil
}
