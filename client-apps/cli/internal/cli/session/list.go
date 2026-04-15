package session

import (
	"context"

	"github.com/pkg/errors"
	sessionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/session/v1"
	"google.golang.org/grpc"
)

const (
	// DefaultPageSize is the default number of sessions per page.
	DefaultPageSize = 20

	// MaxPageSize is the maximum allowed page size.
	MaxPageSize = 100
)

// ListOptions contains options for listing sessions.
type ListOptions struct {
	Conn      grpc.ClientConnInterface
	PageSize  int32
	PageToken string
	Tags      []string
}

// List retrieves sessions with optional filtering.
func List(opts *ListOptions) (*sessionv1.SessionList, error) {
	if opts == nil {
		return nil, errors.New("list options cannot be nil")
	}
	if opts.Conn == nil {
		return nil, errors.New("gRPC connection cannot be nil")
	}

	pageSize := opts.PageSize
	if pageSize <= 0 {
		pageSize = DefaultPageSize
	}
	if pageSize > MaxPageSize {
		pageSize = MaxPageSize
	}

	client := sessionv1.NewSessionQueryControllerClient(opts.Conn)
	ctx, cancel := context.WithTimeout(context.Background(), DefaultTimeout)
	defer cancel()

	req := &sessionv1.ListSessionsRequest{
		PageSize:  pageSize,
		PageToken: opts.PageToken,
	}
	if len(opts.Tags) > 0 {
		req.Tags = opts.Tags
	}

	result, err := client.List(ctx, req)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list sessions")
	}

	return result, nil
}
