// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"context"

	"github.com/pkg/errors"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	"google.golang.org/grpc"
)

// GetFromBackend fetches a skill from the backend by reference.
// The reference can be a slug (e.g., "calculator"), org/slug (e.g., "stigmer/calculator"),
// or a resource ID (e.g., "skl_abc123").
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - orgID: Organization ID for context (used when reference is slug-only)
//   - ref: Resource reference string
//
// Returns the Skill proto or an error with context.
func GetFromBackend(conn grpc.ClientConnInterface, orgID, ref string) (*skillv1.Skill, error) {
	// Parse the reference (handles slug, org/slug, and resource ID)
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid skill reference")
	}

	client := skillv1.NewSkillQueryControllerClient(conn)
	ctx := context.Background()

	var result *skillv1.Skill

	if parsed.IsID {
		// Get by resource ID
		result, err = client.Get(ctx, &skillv1.SkillId{
			Value: parsed.ID,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get skill by ID '%s'", parsed.ID)
		}
	} else {
		// Get by org/slug reference
		result, err = client.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  parsed.Org,
			Kind: apiresourcekind.ApiResourceKind_skill,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get skill '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}
