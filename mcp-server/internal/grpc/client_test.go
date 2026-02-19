package grpc

import (
	"testing"
)

func TestNewConnection_insecureEndpoint(t *testing.T) {
	conn, err := NewConnection("localhost:9090", "test-key")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer conn.Close()

	if got := conn.Target(); got != "localhost:9090" {
		t.Errorf("Target() = %q, want %q", got, "localhost:9090")
	}
}

func TestNewConnection_tlsEndpoint(t *testing.T) {
	conn, err := NewConnection("api.stigmer.ai:443", "test-key")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer conn.Close()

	if got := conn.Target(); got != "api.stigmer.ai:443" {
		t.Errorf("Target() = %q, want %q", got, "api.stigmer.ai:443")
	}
}

func TestNewConnection_emptyAPIKey(t *testing.T) {
	conn, err := NewConnection("localhost:9090", "")
	if err != nil {
		t.Fatalf("unexpected error for empty API key: %v", err)
	}
	defer conn.Close()

	if got := conn.Target(); got != "localhost:9090" {
		t.Errorf("Target() = %q, want %q", got, "localhost:9090")
	}
}

func TestNewConnection_emptyEndpoint(t *testing.T) {
	// grpc.NewClient accepts empty targets (resolves lazily), so this should
	// not error. Documenting the behavior rather than asserting a failure.
	conn, err := NewConnection("", "test-key")
	if err != nil {
		t.Fatalf("unexpected error for empty endpoint: %v", err)
	}
	defer conn.Close()
}
