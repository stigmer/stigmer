// Package skill provides CLI utilities for managing Skill resources.
package skill

import (
	"context"

	"github.com/pkg/errors"
	skillv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc"
)

// DeleteOptions contains options for deleting a skill.
type DeleteOptions struct {
	// SkillID is the resource ID of the skill to delete.
	SkillID string
	// Conn is the gRPC connection to the backend.
	Conn grpc.ClientConnInterface
}

// DeleteResult contains the result of a delete operation.
type DeleteResult struct {
	// Skill is the deleted skill (returned by server for confirmation).
	Skill *skillv1.Skill
}

// Delete deletes a skill from the backend.
// Returns the deleted skill for display/confirmation purposes.
//
// Parameters:
//   - opts: Delete options including skill ID and connection
//
// Returns the deleted Skill proto or an error with context.
func Delete(opts *DeleteOptions) (*DeleteResult, error) {
	if opts == nil {
		return nil, errors.New("delete options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}
	if opts.SkillID == "" {
		return nil, errors.New("skill ID cannot be empty")
	}

	deleted, err := DeleteFromBackend(opts.Conn, opts.SkillID)
	if err != nil {
		return nil, err
	}

	return &DeleteResult{Skill: deleted}, nil
}

// DeleteFromBackend deletes a skill by ID via gRPC.
// This is the low-level function that directly calls the backend.
//
// Parameters:
//   - conn: gRPC connection to the backend
//   - skillID: Resource ID of the skill to delete (e.g., "skl_abc123")
//
// Returns the deleted Skill proto or an error with context.
func DeleteFromBackend(conn grpc.ClientConnInterface, skillID string) (*skillv1.Skill, error) {
	if skillID == "" {
		return nil, errors.New("skill ID is required for delete operation")
	}

	client := skillv1.NewSkillCommandControllerClient(conn)
	ctx := context.Background()

	deleted, err := client.Delete(ctx, &skillv1.SkillId{
		Value: skillID,
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to delete skill '%s'", skillID)
	}

	return deleted, nil
}
