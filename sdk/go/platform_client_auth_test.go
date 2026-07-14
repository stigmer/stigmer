package stigmer

import (
	"errors"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
)

func TestNewPlatformClientAuth_MissingClientID(t *testing.T) {
	_, err := NewPlatformClientAuth(
		WithPlatformClientCredentials("", "stgm_cs_secret"),
	)
	if err == nil {
		t.Fatal("expected error when clientID is empty")
	}
}

func TestNewPlatformClientAuth_MissingClientSecret(t *testing.T) {
	_, err := NewPlatformClientAuth(
		WithPlatformClientCredentials("stgm_cid_abc", ""),
	)
	if err == nil {
		t.Fatal("expected error when clientSecret is empty")
	}
}

func TestNewPlatformClientAuth_MissingBothCredentials(t *testing.T) {
	_, err := NewPlatformClientAuth()
	if err == nil {
		t.Fatal("expected error when no credentials are provided")
	}
}

func TestNewPlatformClientAuth_ValidConfig(t *testing.T) {
	auth, err := NewPlatformClientAuth(
		WithPlatformClientCredentials("stgm_cid_abc", "stgm_cs_secret"),
		WithPlatformClientBaseURL("localhost:7234"),
		WithPlatformClientInsecure(),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer auth.Close()
}

func TestPlatformClientAuth_MintUserToken_EmptyUserID(t *testing.T) {
	auth, err := NewPlatformClientAuth(
		WithPlatformClientCredentials("stgm_cid_abc", "stgm_cs_secret"),
		WithPlatformClientBaseURL("localhost:7234"),
		WithPlatformClientInsecure(),
	)
	if err != nil {
		t.Fatalf("unexpected error creating auth: %v", err)
	}
	defer auth.Close()

	_, err = auth.MintUserToken(t.Context(), &MintUserTokenInput{UserID: ""})
	if err == nil {
		t.Fatal("expected error when userID is empty")
	}
	var sdkErr *gen.Error
	if !errors.As(err, &sdkErr) || sdkErr.Code != gen.CodeInvalidArgument {
		t.Fatalf("expected invalid-argument error, got: %v", err)
	}
}
