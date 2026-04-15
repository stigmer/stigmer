// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"context"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
)

// DeleteOptions contains options for deleting a skill.
type DeleteOptions struct {
	SkillID string
	Client  *stigmer.Client
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	Skill *skillv1.Skill
}

// Delete deletes a skill from the backend.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Client == nil {
		return nil, errors.New("client cannot be nil")
	}
	if opts.SkillID == "" {
		return nil, errors.New("skill ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Client, opts.SkillID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Skill: deleted}, nil
}

// DeleteFromBackend deletes a skill by ID via the SDK.
func DeleteFromBackend(client *stigmer.Client, skillID string) (*skillv1.Skill, error) {
	if skillID == "" {
		return nil, errors.New("skill ID is required for delete operation")
	}

	ctx := context.Background()

	deleted, err := client.Skill.Delete(ctx, skillID)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete skill '%s'", skillID)
	}

	return deleted, nil
}
