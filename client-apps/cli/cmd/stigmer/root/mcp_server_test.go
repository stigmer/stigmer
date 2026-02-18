package root

import (
	"testing"

	"github.com/stigmer/stigmer/mcp-server/pkg/mcpserver"
)

func TestNewMCPServerCommand_metadata(t *testing.T) {
	cmd := NewMCPServerCommand()

	if cmd.Use != "mcp-server" {
		t.Errorf("Use = %q, want %q", cmd.Use, "mcp-server")
	}
	if cmd.Short == "" {
		t.Error("Short description must not be empty")
	}
	if cmd.Long == "" {
		t.Error("Long description must not be empty")
	}
	if cmd.RunE == nil {
		t.Error("RunE must be set")
	}
}

func TestNewMCPServerCommand_flags(t *testing.T) {
	cmd := NewMCPServerCommand()

	flags := []string{
		"transport",
		"port",
		"server-address",
		"api-key",
		"log-format",
		"log-level",
	}

	for _, name := range flags {
		if cmd.Flags().Lookup(name) == nil {
			t.Errorf("expected flag %q to be registered", name)
		}
	}
}

func TestApplyFlagOverrides_setsOnlyExplicitFlags(t *testing.T) {
	cmd := NewMCPServerCommand()

	cfg := &mcpserver.Config{
		StigmerServerAddress: "original:9090",
		APIKey:               "original-key",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	// No flags set — config should remain unchanged.
	applyFlagOverrides(cmd, cfg)

	if cfg.StigmerServerAddress != "original:9090" {
		t.Errorf("StigmerServerAddress changed to %q", cfg.StigmerServerAddress)
	}
	if cfg.APIKey != "original-key" {
		t.Errorf("APIKey changed to %q", cfg.APIKey)
	}
	if cfg.Transport != "stdio" {
		t.Errorf("Transport changed to %q", cfg.Transport)
	}
	if cfg.HTTPPort != "8080" {
		t.Errorf("HTTPPort changed to %q", cfg.HTTPPort)
	}
	if cfg.LogFormat != "text" {
		t.Errorf("LogFormat changed to %q", cfg.LogFormat)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel changed to %q", cfg.LogLevel)
	}
}

func TestApplyFlagOverrides_appliesValues(t *testing.T) {
	cmd := NewMCPServerCommand()

	if err := cmd.Flags().Set("transport", "http"); err != nil {
		t.Fatalf("setting transport flag: %v", err)
	}
	if err := cmd.Flags().Set("port", "3000"); err != nil {
		t.Fatalf("setting port flag: %v", err)
	}
	if err := cmd.Flags().Set("server-address", "api.example.com:443"); err != nil {
		t.Fatalf("setting server-address flag: %v", err)
	}
	if err := cmd.Flags().Set("api-key", "new-key"); err != nil {
		t.Fatalf("setting api-key flag: %v", err)
	}
	if err := cmd.Flags().Set("log-format", "json"); err != nil {
		t.Fatalf("setting log-format flag: %v", err)
	}
	if err := cmd.Flags().Set("log-level", "debug"); err != nil {
		t.Fatalf("setting log-level flag: %v", err)
	}

	cfg := &mcpserver.Config{
		StigmerServerAddress: "original:9090",
		APIKey:               "original-key",
		Transport:            "stdio",
		HTTPPort:             "8080",
		LogFormat:            "text",
		LogLevel:             "info",
	}

	applyFlagOverrides(cmd, cfg)

	if cfg.Transport != "http" {
		t.Errorf("Transport = %q, want %q", cfg.Transport, "http")
	}
	if cfg.HTTPPort != "3000" {
		t.Errorf("HTTPPort = %q, want %q", cfg.HTTPPort, "3000")
	}
	if cfg.StigmerServerAddress != "api.example.com:443" {
		t.Errorf("StigmerServerAddress = %q, want %q", cfg.StigmerServerAddress, "api.example.com:443")
	}
	if cfg.APIKey != "new-key" {
		t.Errorf("APIKey = %q, want %q", cfg.APIKey, "new-key")
	}
	if cfg.LogFormat != "json" {
		t.Errorf("LogFormat = %q, want %q", cfg.LogFormat, "json")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}
