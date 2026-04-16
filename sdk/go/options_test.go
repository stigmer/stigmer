package stigmer

import (
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/keepalive"
)

func TestDefaultConfig(t *testing.T) {
	cfg := defaultConfig()
	if cfg.target != "api.stigmer.ai:443" {
		t.Errorf("expected default target, got %q", cfg.target)
	}
	if cfg.insecure {
		t.Error("expected insecure to be false by default")
	}
	if cfg.apiKey != "" {
		t.Error("expected empty apiKey by default")
	}
	if cfg.token != "" {
		t.Error("expected empty token by default")
	}
	if cfg.keepaliveParams != nil {
		t.Error("expected nil keepaliveParams by default")
	}
}

func TestWithAPIKey(t *testing.T) {
	cfg := defaultConfig()
	WithAPIKey("sk_test_123")(&cfg)
	if cfg.apiKey != "sk_test_123" {
		t.Errorf("expected sk_test_123, got %q", cfg.apiKey)
	}
}

func TestWithToken(t *testing.T) {
	cfg := defaultConfig()
	WithToken("tok_login_abc")(&cfg)
	if cfg.token != "tok_login_abc" {
		t.Errorf("expected tok_login_abc, got %q", cfg.token)
	}
}

func TestWithBaseURL(t *testing.T) {
	cfg := defaultConfig()
	WithBaseURL("localhost:9090")(&cfg)
	if cfg.target != "localhost:9090" {
		t.Errorf("expected localhost:9090, got %q", cfg.target)
	}
}

func TestWithInsecure(t *testing.T) {
	cfg := defaultConfig()
	WithInsecure()(&cfg)
	if !cfg.insecure {
		t.Error("expected insecure to be true")
	}
}

func TestWithKeepaliveParams(t *testing.T) {
	cfg := defaultConfig()
	params := keepalive.ClientParameters{
		Time:                30 * time.Second,
		Timeout:             10 * time.Second,
		PermitWithoutStream: false,
	}
	WithKeepaliveParams(params)(&cfg)
	if cfg.keepaliveParams == nil {
		t.Fatal("expected keepaliveParams to be set")
	}
	if cfg.keepaliveParams.Time != 30*time.Second {
		t.Errorf("expected 30s keepalive time, got %v", cfg.keepaliveParams.Time)
	}
	if cfg.keepaliveParams.Timeout != 10*time.Second {
		t.Errorf("expected 10s keepalive timeout, got %v", cfg.keepaliveParams.Timeout)
	}
}

func TestWithDialOptions(t *testing.T) {
	cfg := defaultConfig()
	opt := grpc.WithAuthority("test")
	WithDialOptions(opt)(&cfg)
	if len(cfg.dialOptions) != 1 {
		t.Errorf("expected 1 dial option, got %d", len(cfg.dialOptions))
	}
}
