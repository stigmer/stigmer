// Package testutil provides helpers for MCP server tests.
//
// This package is intended for use by test code only. It is not part of the
// public API and should not be imported by production code.
package testutil

import (
	"net"
	"testing"

	"google.golang.org/grpc"
)

// StartGRPCServer starts a gRPC server on a random port, registers services
// via the provided callback, and returns the "host:port" address. The server
// is automatically stopped when the test completes.
func StartGRPCServer(t *testing.T, register func(s *grpc.Server)) string {
	t.Helper()

	lis, err := net.Listen("tcp", "localhost:0")
	if err != nil {
		t.Fatalf("testutil: failed to listen: %v", err)
	}

	srv := grpc.NewServer()
	register(srv)

	go func() {
		if err := srv.Serve(lis); err != nil {
			// Serve returns an error after GracefulStop; this is expected.
		}
	}()

	t.Cleanup(func() { srv.GracefulStop() })

	return lis.Addr().String()
}
