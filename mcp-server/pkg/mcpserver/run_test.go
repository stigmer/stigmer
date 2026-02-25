package mcpserver

import (
	"context"
	"strings"
	"testing"
)

func TestRun_invalidConfig(t *testing.T) {
	tests := []struct {
		name    string
		cfg     *Config
		wantErr string
	}{
		{
			name: "bad transport",
			cfg: &Config{
				StigmerServerAddress: "localhost:7234",
				APIKey:               "key",
				Transport:            "websocket",
				HTTPPort:             "8080",
				LogFormat:            "text",
				LogLevel:             "info",
			},
			wantErr: "invalid STIGMER_MCP_TRANSPORT",
		},
		{
			name: "bad log level",
			cfg: &Config{
				StigmerServerAddress: "localhost:7234",
				APIKey:               "key",
				Transport:            "stdio",
				HTTPPort:             "8080",
				LogFormat:            "text",
				LogLevel:             "trace",
			},
			wantErr: "invalid STIGMER_MCP_LOG_LEVEL",
		},
		{
			name: "empty server address",
			cfg: &Config{
				Transport:            "http",
				StigmerServerAddress: "",
				HTTPPort:             "8080",
				LogFormat:            "text",
				LogLevel:             "info",
			},
			wantErr: "STIGMER_SERVER_ADDRESS must not be empty",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := Run(context.Background(), tt.cfg)
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}
