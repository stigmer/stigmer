package main

import (
	"strings"
	"testing"
)

// The join-mode env contract: all three coordinates or none — a partial set
// must refuse loudly rather than silently running standalone against a
// different store than the caller intended.
func TestExternalOpenFGAFromEnv(t *testing.T) {
	setAll := func(t *testing.T, apiURL, storeID, modelID string) {
		t.Helper()
		t.Setenv(envExternalFGAAPIURL, apiURL)
		t.Setenv(envExternalFGAStoreID, storeID)
		t.Setenv(envExternalFGAModelID, modelID)
	}

	t.Run("unset yields standalone mode", func(t *testing.T) {
		setAll(t, "", "", "")
		got, err := externalOpenFGAFromEnv()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != nil {
			t.Fatalf("expected nil (standalone mode), got %+v", got)
		}
	})

	t.Run("full set yields a container-less handle", func(t *testing.T) {
		setAll(t, "http://127.0.0.1:56080", "store-1", "model-1")
		got, err := externalOpenFGAFromEnv()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got == nil {
			t.Fatal("expected a handle, got nil")
		}
		if got.Container != nil {
			t.Fatalf("join-mode handle must carry no container, got %+v", got.Container)
		}
		if got.HTTPEndpoint != "http://127.0.0.1:56080" || got.StoreID != "store-1" || got.ModelID != "model-1" {
			t.Fatalf("coordinates not carried through: %+v", got)
		}
	})

	partials := []struct {
		name                     string
		apiURL, storeID, modelID string
	}{
		{"api url only", "http://127.0.0.1:56080", "", ""},
		{"store id only", "", "store-1", ""},
		{"model id only", "", "", "model-1"},
		{"missing model id", "http://127.0.0.1:56080", "store-1", ""},
		{"missing store id", "http://127.0.0.1:56080", "", "model-1"},
		{"missing api url", "", "store-1", "model-1"},
	}
	for _, tc := range partials {
		t.Run("partial set refuses: "+tc.name, func(t *testing.T) {
			setAll(t, tc.apiURL, tc.storeID, tc.modelID)
			got, err := externalOpenFGAFromEnv()
			if err == nil {
				t.Fatalf("expected a loud misconfiguration error, got handle %+v", got)
			}
			if !strings.Contains(err.Error(), "must all be set together") {
				t.Fatalf("error should name the all-or-none contract, got: %v", err)
			}
		})
	}
}
