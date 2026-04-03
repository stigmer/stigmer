package stigmer

import (
	"testing"

	"google.golang.org/grpc"
)

func TestDefaultConfig(t *testing.T) {
	cfg := defaultConfig()
	if cfg.target != "api.stigmer.ai:443" {
		t.Errorf("expected default target, got %q", cfg.target)
	}
	if cfg.insecure {
		t.Error("expected insecure to be false by default")
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

func TestWithDialOptions(t *testing.T) {
	cfg := defaultConfig()
	opt := grpc.WithAuthority("test")
	WithDialOptions(opt)(&cfg)
	if len(cfg.dialOptions) != 1 {
		t.Errorf("expected 1 dial option, got %d", len(cfg.dialOptions))
	}
}
