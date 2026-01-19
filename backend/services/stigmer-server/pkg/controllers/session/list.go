package session

import (
	"context"

	"github.com/rs/zerolog/log"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// Context key for list results
const listResultKey = "listResult"

// List retrieves all sessions using the pipeline framework
//
// Pipeline (Stigmer OSS - simplified from Cloud):
// 1. ValidateProto - Validate input ListSessionsRequest
// 2. ListAllSessions - Load all sessions from repository
//
// Note: Compared to Stigmer Cloud, OSS excludes:
// - Authorization filtering (no IAM system - returns all sessions)
// - Pagination support (simple list all)
// - TransformResponse step (no response transformations in OSS)
// - SendResponse step (handler returns directly)
//
// In a production multi-tenant system, this would query IAM Policy service to
// filter by authorized resource IDs. For OSS local usage, we simply return all sessions.
func (c *SessionController) List(ctx context.Context, req *sessionv1.ListSessionsRequest) (*sessionv1.SessionList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve list from context
	sessionList := reqCtx.Get(listResultKey).(*sessionv1.SessionList)
	return sessionList, nil
}

// buildListPipeline constructs the pipeline for list operations
func (c *SessionController) buildListPipeline() *pipeline.Pipeline[*sessionv1.ListSessionsRequest] {
	// api_resource_kind is automatically extracted from proto service descriptor
	// by the apiresource interceptor and injected into request context
	return pipeline.NewPipeline[*sessionv1.ListSessionsRequest]("session-list").
		AddStep(steps.NewValidateProtoStep[*sessionv1.ListSessionsRequest]()). // 1. Validate input
		AddStep(newListAllSessionsStep(c.store)).                               // 2. List all sessions
		Build()
}

// listAllSessionsStep loads all sessions from the database
type listAllSessionsStep struct {
	store interface {
		ListResources(ctx context.Context, kind string) ([][]byte, error)
	}
}

func newListAllSessionsStep(store interface {
	ListResources(ctx context.Context, kind string) ([][]byte, error)
}) *listAllSessionsStep {
	return &listAllSessionsStep{store: store}
}

func (s *listAllSessionsStep) Name() string {
	return "ListAllSessions"
}

func (s *listAllSessionsStep) Execute(ctx *pipeline.RequestContext[*sessionv1.ListSessionsRequest]) error {
	log.Debug().Msg("Loading all sessions from database")

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// List all sessions from database
	data, err := s.store.ListResources(ctx.Context(), kind.String())
	if err != nil {
		log.Error().
			Err(err).
			Str("kind", kind.String()).
			Msg("Failed to list sessions")
		return grpclib.InternalError(err, "failed to list sessions")
	}

	// Unmarshal sessions
	sessions := make([]*sessionv1.Session, 0, len(data))
	for _, d := range data {
		session := &sessionv1.Session{}
		if err := protojson.Unmarshal(d, session); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal session, skipping")
			continue
		}
		sessions = append(sessions, session)
	}

	log.Info().
		Int("count", len(sessions)).
		Msg("Loaded sessions from database")

	// Build response and store in context
	sessionList := &sessionv1.SessionList{
		Entries: sessions,
	}
	ctx.Set(listResultKey, sessionList)

	return nil
}
