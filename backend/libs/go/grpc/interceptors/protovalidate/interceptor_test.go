package protovalidate

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// UpdateSessionSubjectRequest.id declares required=true, which makes it a
// convenient, real message for exercising the interceptor: a non-empty id is
// valid, an empty id violates the constraint.

func TestUnaryServerInterceptor_ValidRequestPassesThrough(t *testing.T) {
	interceptor := UnaryServerInterceptor()
	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return "ok", nil
	}

	resp, err := interceptor(
		context.Background(),
		&sessionv1.UpdateSessionSubjectRequest{Id: "ses_valid"},
		&grpc.UnaryServerInfo{FullMethod: "/test/Method"},
		handler,
	)

	require.NoError(t, err)
	require.Equal(t, "ok", resp)
	require.True(t, called, "handler must run for a valid request")
}

func TestUnaryServerInterceptor_InvalidRequestRejectedBeforeHandler(t *testing.T) {
	interceptor := UnaryServerInterceptor()
	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return "ok", nil
	}

	_, err := interceptor(
		context.Background(),
		&sessionv1.UpdateSessionSubjectRequest{Id: ""},
		&grpc.UnaryServerInfo{FullMethod: "/test/Method"},
		handler,
	)

	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err),
		"constraint violation must surface as InvalidArgument")
	require.False(t, called, "handler must not run when validation fails")
}

func TestUnaryServerInterceptor_NonProtoRequestPassesThrough(t *testing.T) {
	interceptor := UnaryServerInterceptor()
	called := false
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		called = true
		return req, nil
	}

	_, err := interceptor(
		context.Background(),
		"not-a-proto",
		&grpc.UnaryServerInfo{FullMethod: "/test/Method"},
		handler,
	)

	require.NoError(t, err)
	require.True(t, called)
}

// mockServerStream lets a test inject the message that RecvMsg yields, mirroring
// how gRPC's generated server-streaming handler receives the client request.
type mockServerStream struct {
	grpc.ServerStream
	recv func(m interface{}) error
}

func (m *mockServerStream) RecvMsg(msg interface{}) error { return m.recv(msg) }
func (m *mockServerStream) Context() context.Context      { return context.Background() }

func TestStreamServerInterceptor_ValidatesReceivedMessage(t *testing.T) {
	interceptor := StreamServerInterceptor()

	// A server-streaming handler reads its single request off the stream.
	handler := func(srv interface{}, stream grpc.ServerStream) error {
		return stream.RecvMsg(&sessionv1.UpdateSessionSubjectRequest{})
	}

	seed := func(id string) func(m interface{}) error {
		return func(m interface{}) error {
			m.(*sessionv1.UpdateSessionSubjectRequest).Id = id
			return nil
		}
	}

	err := interceptor(nil, &mockServerStream{recv: seed("ses_valid")},
		&grpc.StreamServerInfo{FullMethod: "/test/Stream"}, handler)
	require.NoError(t, err, "a valid streamed request must pass")

	err = interceptor(nil, &mockServerStream{recv: seed("")},
		&grpc.StreamServerInfo{FullMethod: "/test/Stream"}, handler)
	require.Error(t, err)
	require.Equal(t, codes.InvalidArgument, status.Code(err),
		"a constraint-violating streamed request must be rejected")
}
