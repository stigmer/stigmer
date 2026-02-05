// Package skill provides in-process gRPC calls to the Skill service.
//
// This client is used by the reconciliation engine to create, update, and delete
// skill resources during project reconciliation. Skills use Push for create/update
// (idempotent operation) rather than separate Create/Update methods.
package skill

import (
	"context"

	"github.com/rs/zerolog/log"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc"
)

// Client provides in-process gRPC calls to the Skill service.
//
// Architecture Note: This client lives OUTSIDE the skill domain because it's
// infrastructure for calling the skill service from other domains. When services
// are split into separate microservices, this client will be used by external services to
// make network gRPC calls to the skill service.
//
// Implementation Notes:
//   - Skills use Push for create/update (idempotent operation)
//   - Delete uses SkillId wrapper type
//   - All calls go through in-process gRPC with full interceptor chain
type Client struct {
	conn      *grpc.ClientConn
	cmdClient skillv1.SkillCommandControllerClient
}

// NewClient creates a new in-process Skill client using a gRPC connection.
// The connection should be an in-process gRPC connection created via NewInProcessConnection.
func NewClient(conn *grpc.ClientConn) *Client {
	return &Client{
		conn:      conn,
		cmdClient: skillv1.NewSkillCommandControllerClient(conn),
	}
}

// Push creates or updates a skill (idempotent operation).
//
// This makes an in-process gRPC call to SkillCommandController.Push()
// ensuring all gRPC interceptors run before reaching the handler.
//
// Push is used for both create and update operations:
//   - If skill with same slug exists, it updates the existing skill
//   - If skill doesn't exist, it creates a new one
func (c *Client) Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	log.Debug().
		Str("org", req.GetOrg()).
		Str("tag", req.GetTag()).
		Msg("Pushing skill via in-process gRPC")

	skill, err := c.cmdClient.Push(ctx, req)
	if err != nil {
		log.Error().
			Err(err).
			Str("org", req.GetOrg()).
			Msg("Failed to push skill")
		return nil, err
	}

	log.Debug().
		Str("id", skill.GetMetadata().GetId()).
		Str("name", skill.GetMetadata().GetName()).
		Msg("Successfully pushed skill")

	return skill, nil
}

// Delete deletes a skill by ID.
//
// This makes an in-process gRPC call to SkillCommandController.Delete()
// using SkillId wrapper type.
func (c *Client) Delete(ctx context.Context, resourceID string) (*skillv1.Skill, error) {
	log.Debug().
		Str("skill_id", resourceID).
		Msg("Deleting skill via in-process gRPC")

	skillId := &skillv1.SkillId{
		Value: resourceID,
	}

	deleted, err := c.cmdClient.Delete(ctx, skillId)
	if err != nil {
		log.Error().
			Err(err).
			Str("skill_id", resourceID).
			Msg("Failed to delete skill")
		return nil, err
	}

	log.Debug().
		Str("id", deleted.GetMetadata().GetId()).
		Msg("Successfully deleted skill")

	return deleted, nil
}

// Close closes the underlying gRPC connection.
func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}
