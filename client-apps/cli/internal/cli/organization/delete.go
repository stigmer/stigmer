package organization

import (
	"context"

	"github.com/pkg/errors"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting an organization.
type DeleteOptions struct {
	OrganizationID string
	Conn           grpc.ClientConnInterface
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
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.OrganizationID == "" {
		return nil, errors.New("organization ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Conn, opts.OrganizationID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Organization: deleted}, nil
}

// DeleteFromBackend deletes an organization by ID via gRPC.
func DeleteFromBackend(conn grpc.ClientConnInterface, orgID string) (*organizationv1.Organization, error) {
	if orgID == "" {
		return nil, errors.New("organization ID is required for delete operation")
	}

	client := organizationv1.NewOrganizationCommandControllerClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	deleted, err := client.Delete(ctx, &organizationv1.OrganizationId{
		Value: orgID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete organization '%s'", orgID)
	}

	return deleted, nil
}
