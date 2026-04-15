package organization

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// ApplyOptions contains options for applying an Organization configuration.
type ApplyOptions struct {
	Organization *organizationv1.Organization
	OrgID        string
	Conn         grpc.ClientConnInterface
	Quiet        bool
	DryRun       bool
}

// ApplyResult contains the result of applying an Organization configuration.
type ApplyResult struct {
	Organization *organizationv1.Organization
	Created      bool
}

// Apply applies an Organization configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if opts.Organization == nil {
		return nil, fmt.Errorf("organization is required")
	}

	if opts.Conn == nil {
		return nil, fmt.Errorf("connection is required")
	}

	if opts.Organization.Metadata == nil {
		opts.Organization.Metadata = &apiresource.ApiResourceMetadata{}
	}

	if opts.Organization.Metadata.Org == "" && opts.OrgID != "" {
		opts.Organization.Metadata.Org = opts.OrgID
	}

	if opts.DryRun {
		if !opts.Quiet {
			climsg.Info("Dry run mode - configuration is valid")
		}
		return &ApplyResult{
			Organization: opts.Organization,
			Created:      false,
		}, nil
	}

	existingID := opts.Organization.Metadata.Id
	isCreate := existingID == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating organization: %s", opts.Organization.Metadata.Name)
		} else {
			climsg.Info("Updating organization: %s", opts.Organization.Metadata.Name)
		}
	}

	client := organizationv1.NewOrganizationCommandControllerClient(opts.Conn)
	result, err := client.Apply(context.Background(), opts.Organization)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply organization")
	}

	return &ApplyResult{
		Organization: result,
		Created:      isCreate,
	}, nil
}
