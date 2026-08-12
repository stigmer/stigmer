// Package controller provides the gRPC service implementation for
// ActivityQueryController.
//
// This controller is the thin adapter layer between gRPC and the activity
// handler, following the pattern established by the search controller
// (pkg/query/search/controller): implement the generated server interface,
// embed the Unimplemented server for forward compatibility, delegate all
// logic to the handler, and convert handler errors to gRPC status codes.
package controller

import (
	"context"

	"github.com/rs/zerolog/log"
	activityv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/activity/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/query/activity/handler"
)

// ActivityController implements the ActivityQueryControllerServer gRPC
// interface, serving the console's unified Recents sidebar.
type ActivityController struct {
	activityv1.UnimplementedActivityQueryControllerServer
	handler *handler.Handler
}

// NewActivityController creates a new ActivityController with the provided
// handler.
func NewActivityController(handler *handler.Handler) *ActivityController {
	return &ActivityController{handler: handler}
}

// ListRecentActivity implements ActivityQueryController.listRecentActivity.
func (c *ActivityController) ListRecentActivity(ctx context.Context, req *activityv1.ListRecentActivityRequest) (*activityv1.ListRecentActivityResponse, error) {
	resp, err := c.handler.ListRecentActivity(ctx, req)
	if err != nil {
		// The handler's only failure mode is a storage read error — server
		// internals that must stay off the wire (stigmer#478); the full
		// error is logged here at the boundary.
		log.Error().Err(err).Msg("ListRecentActivity failed")
		return nil, grpclib.InternalError(err, "failed to list recent activity")
	}
	return resp, nil
}
