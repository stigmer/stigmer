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

func TestNewConnection_normalizesHTTPS(t *testing.T) {
	conn, err := NewConnection("https://api.stigmer.ai", "test-key")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer conn.Close()

	if got := conn.Target(); got != "api.stigmer.ai:443" {
		t.Errorf("Target() = %q, want %q", got, "api.stigmer.ai:443")
	}
}

func TestNewConnection_normalizesBareHostname(t *testing.T) {
	conn, err := NewConnection("stigmer-prod-api.planton.live", "test-key")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer conn.Close()

	if got := conn.Target(); got != "stigmer-prod-api.planton.live:443" {
		t.Errorf("Target() = %q, want %q", got, "stigmer-prod-api.planton.live:443")
	}
}

func TestNormalizeEndpoint(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantTarget string
		wantTLS    bool
	}{
		{
			name:       "host:port with 443",
			input:      "api.stigmer.ai:443",
			wantTarget: "api.stigmer.ai:443",
			wantTLS:    true,
		},
		{
			name:       "host:port non-443",
			input:      "localhost:9090",
			wantTarget: "localhost:9090",
			wantTLS:    false,
		},
		{
			name:       "internal k8s address with port 80",
			input:      "stigmer-service.stigmer-prod.svc.cluster.local:80",
			wantTarget: "stigmer-service.stigmer-prod.svc.cluster.local:80",
			wantTLS:    false,
		},
		{
			name:       "https scheme stripped and port added",
			input:      "https://api.stigmer.ai",
			wantTarget: "api.stigmer.ai:443",
			wantTLS:    true,
		},
		{
			name:       "https scheme with explicit port",
			input:      "https://api.stigmer.ai:443",
			wantTarget: "api.stigmer.ai:443",
			wantTLS:    true,
		},
		{
			name:       "https scheme with non-443 port",
			input:      "https://internal:8443",
			wantTarget: "internal:8443",
			wantTLS:    false,
		},
		{
			name:       "http scheme stripped",
			input:      "http://internal:8080",
			wantTarget: "internal:8080",
			wantTLS:    false,
		},
		{
			name:       "bare remote hostname gets 443",
			input:      "stigmer-prod-api.planton.live",
			wantTarget: "stigmer-prod-api.planton.live:443",
			wantTLS:    true,
		},
		{
			name:       "localhost stays insecure without port",
			input:      "localhost",
			wantTarget: "localhost",
			wantTLS:    false,
		},
		{
			name:       "127.0.0.1 stays insecure without port",
			input:      "127.0.0.1",
			wantTarget: "127.0.0.1",
			wantTLS:    false,
		},
		{
			name:       "ipv6 loopback stays insecure",
			input:      "::1",
			wantTarget: "::1",
			wantTLS:    false,
		},
		{
			name:       "trailing slash stripped",
			input:      "https://api.stigmer.ai/",
			wantTarget: "api.stigmer.ai:443",
			wantTLS:    true,
		},
		{
			name:       "whitespace trimmed",
			input:      "  api.stigmer.ai:443  ",
			wantTarget: "api.stigmer.ai:443",
			wantTLS:    true,
		},
		{
			name:       "localhost with port preserved",
			input:      "localhost:7234",
			wantTarget: "localhost:7234",
			wantTLS:    false,
		},
		{
			name:       "empty string passes through",
			input:      "",
			wantTarget: "",
			wantTLS:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotTarget, gotTLS := NormalizeEndpoint(tt.input)
			if gotTarget != tt.wantTarget {
				t.Errorf("NormalizeEndpoint(%q) target = %q, want %q", tt.input, gotTarget, tt.wantTarget)
			}
			if gotTLS != tt.wantTLS {
				t.Errorf("NormalizeEndpoint(%q) tls = %v, want %v", tt.input, gotTLS, tt.wantTLS)
			}
		})
	}
}
