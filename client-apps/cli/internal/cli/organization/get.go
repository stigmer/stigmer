package organization

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	organizationv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
)

const defaultTimeout = 10 * time.Second

// GetFromBackend fetches an organization from the backend by reference.
// The reference can be a slug (e.g., "my-org") or a resource ID (e.g., "org_abc123").
//
// Unlike other resources, organizations don't support GetByReference, so
// this uses FindMyOrganizations and matches by slug or ID locally.
func GetFromBackend(client *stigmer.Client, ref string) (*organizationv1.Organization, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	resp, err := client.Organization.FindMyOrganizations(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to query organizations")
	}

	// Match by slug first, then by ID
	for _, org := range resp.GetEntries() {
		if org.GetMetadata().GetSlug() == ref {
			return org, nil
		}
	}
	for _, org := range resp.GetEntries() {
		if org.GetMetadata().GetId() == ref {
			return org, nil
		}
	}

	available := make([]string, 0, len(resp.GetEntries()))
	for _, org := range resp.GetEntries() {
		available = append(available, org.GetMetadata().GetSlug())
	}

	return nil, fmt.Errorf("organization '%s' not found\n\nAvailable organizations: %s",
		ref, strings.Join(available, ", "))
}

// ListFromBackend returns all organizations accessible to the current user.
func ListFromBackend(client *stigmer.Client) ([]*organizationv1.Organization, error) {
	ctx, cancel := context.WithTimeout(context.Background(), defaultTimeout)
	defer cancel()

	resp, err := client.Organization.FindMyOrganizations(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list organizations")
	}

	return resp.GetEntries(), nil
}
