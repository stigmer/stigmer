package auth

import (
	"context"
	"testing"
)

func TestAPIKey_roundTrip(t *testing.T) {
	const key = "sk-test-1234"
	ctx := WithAPIKey(context.Background(), key)

	got, err := GetAPIKey(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != key {
		t.Errorf("GetAPIKey = %q, want %q", got, key)
	}
}

func TestGetAPIKey_missingFromContext(t *testing.T) {
	_, err := GetAPIKey(context.Background())
	if err == nil {
		t.Fatal("expected error when API key is absent from context, got nil")
	}
}

func TestGetAPIKey_emptyString(t *testing.T) {
	ctx := WithAPIKey(context.Background(), "")

	_, err := GetAPIKey(ctx)
	if err == nil {
		t.Fatal("expected error when API key is empty string, got nil")
	}
}

func TestGetAPIKey_nestedContexts(t *testing.T) {
	ctx := WithAPIKey(context.Background(), "first")
	ctx = WithAPIKey(ctx, "second")

	got, err := GetAPIKey(ctx)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "second" {
		t.Errorf("GetAPIKey = %q, want %q (most recent value)", got, "second")
	}
}

func TestAPIKey_returnsKey(t *testing.T) {
	const key = "sk-test-1234"
	ctx := WithAPIKey(context.Background(), key)

	if got := APIKey(ctx); got != key {
		t.Errorf("APIKey = %q, want %q", got, key)
	}
}

func TestAPIKey_emptyWhenAbsent(t *testing.T) {
	if got := APIKey(context.Background()); got != "" {
		t.Errorf("APIKey = %q, want empty string when no key in context", got)
	}
}

func TestAPIKey_emptyWhenSetToEmpty(t *testing.T) {
	ctx := WithAPIKey(context.Background(), "")
	if got := APIKey(ctx); got != "" {
		t.Errorf("APIKey = %q, want empty string", got)
	}
}

func TestTokenAuth_GetRequestMetadata(t *testing.T) {
	ta := NewTokenAuth("my-secret-token")

	md, err := ta.GetRequestMetadata(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := "Bearer my-secret-token"
	if got := md["Authorization"]; got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	if len(md) != 1 {
		t.Errorf("metadata has %d entries, want 1", len(md))
	}
}

func TestTokenAuth_RequireTransportSecurity(t *testing.T) {
	ta := NewTokenAuth("any")
	if ta.RequireTransportSecurity() {
		t.Error("RequireTransportSecurity = true, want false")
	}
}
