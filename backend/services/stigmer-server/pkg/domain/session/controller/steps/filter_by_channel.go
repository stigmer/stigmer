package steps

import (
	"github.com/rs/zerolog/log"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// channelIDLabelKey is the session label the channel runtime stamps at
// create time to record which agent channel originated the conversation.
// Mirrors ChannelRuntimeConstants.CHANNEL_ID_METADATA_KEY in Stigmer Cloud.
const channelIDLabelKey = "stigmer.ai/channel-id"

// filterByChannelStep loads all sessions and filters by the channel-id label
//
// This step:
// 1. Extracts channel_id from ListSessionsByChannelRequest
// 2. Lists all sessions from database
// 3. Filters sessions where metadata.labels["stigmer.ai/channel-id"] matches
// 4. Stores filtered sessions in context for the handler to return
//
// Note: channel sessions are created by the cloud channel runtime; the OSS
// runtime has no channel broker, so this filter typically matches nothing.
// The step exists for contract parity with Stigmer Cloud, which additionally
// gates on can_view of the agent_channel and intersects with FGA-authorized
// session IDs.
type filterByChannelStep struct {
	store store.Store
}

// NewFilterByChannelStep creates a new filter-by-channel step
func NewFilterByChannelStep(store store.Store) *filterByChannelStep {
	return &filterByChannelStep{store: store}
}

func (s *filterByChannelStep) Name() string {
	return "FilterByChannel"
}

func (s *filterByChannelStep) Execute(ctx *pipeline.RequestContext[*sessionv1.ListSessionsByChannelRequest]) error {
	req := ctx.Input()
	channelID := req.GetChannelId()

	if channelID == "" {
		return grpclib.InvalidArgumentError("channel_id is required")
	}

	log.Debug().
		Str("channel_id", channelID).
		Msg("Filtering sessions by channel")

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// List all sessions from database
	data, err := s.store.ListResources(ctx.Context(), kind)
	if err != nil {
		log.Error().
			Err(err).
			Str("kind", kind.String()).
			Msg("Failed to list sessions")
		return grpclib.InternalError(err, "failed to list sessions")
	}

	// Filter sessions by the channel-id label
	var filteredSessions []*sessionv1.Session
	for _, d := range data {
		session := &sessionv1.Session{}
		if err := proto.Unmarshal(d, session); err != nil {
			log.Warn().
				Err(err).
				Msg("Failed to unmarshal session, skipping")
			continue
		}

		if session.GetMetadata().GetLabels()[channelIDLabelKey] == channelID {
			filteredSessions = append(filteredSessions, session)
		}
	}

	log.Info().
		Str("channel_id", channelID).
		Int("total_sessions", len(data)).
		Int("filtered_sessions", len(filteredSessions)).
		Msg("Filtered sessions by channel")

	// Build response and store in context
	sessionList := &sessionv1.SessionList{
		Entries: filteredSessions,
	}
	ctx.Set("listResult", sessionList)

	return nil
}
