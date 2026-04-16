package stigmer

import (
	"testing"
)

func TestNewClient_NoCredentials(t *testing.T) {
	_, err := NewClient()
	if err == nil {
		t.Fatal("expected error when no credentials are provided")
	}
}

func TestNewClient_MutuallyExclusiveCredentials(t *testing.T) {
	_, err := NewClient(WithAPIKey("sk_test"), WithToken("tok_test"))
	if err == nil {
		t.Fatal("expected error when both WithAPIKey and WithToken are provided")
	}
}

func TestNewClient_InsecureNoCredentials(t *testing.T) {
	client, err := NewClient(WithBaseURL("localhost:7234"), WithInsecure())
	if err != nil {
		t.Fatalf("expected no error for insecure without credentials, got: %v", err)
	}
	defer client.Close()
}
