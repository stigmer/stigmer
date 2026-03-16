package stigmer

import (
	"testing"
)

func TestNewClient_EmptyAPIKey(t *testing.T) {
	_, err := NewClient("")
	if err == nil {
		t.Fatal("expected error for empty API key")
	}
}
