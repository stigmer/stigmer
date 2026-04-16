// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"context"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/reference"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
)

// GetFromBackend fetches a skill from the backend by reference.
func GetFromBackend(client *stigmer.Client, orgID, ref string) (*skillv1.Skill, error) {
	parsed, err := reference.Parse(ref, orgID)
	if err != nil {
		return nil, errors.Wrap(err, "invalid skill reference")
	}

	ctx := context.Background()

	var result *skillv1.Skill

	if parsed.IsID {
		result, err = client.Skill.Get(ctx, parsed.ID)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get skill by ID '%s'", parsed.ID)
		}
	} else {
		result, err = client.Skill.GetByReference(ctx, stigmer.ResourceRef{
			Org:  parsed.Org,
			Slug: parsed.Slug,
		})
		if err != nil {
			return nil, errors.Wrapf(err, "failed to get skill '%s/%s'", parsed.Org, parsed.Slug)
		}
	}

	return result, nil
}
