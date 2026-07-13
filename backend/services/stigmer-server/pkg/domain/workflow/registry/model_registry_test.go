package registry

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestModelRegistryHandler_ServesEmbeddedRegistry(t *testing.T) {
	h := NewModelRegistryHandler()

	req := httptest.NewRequest(http.MethodGet, "/v1/proxy/model-registry", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("Expected 200, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Expected application/json content type, got %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=3600" {
		t.Errorf("Expected cacheable response, got Cache-Control %q", cc)
	}

	var body struct {
		Models []map[string]any `json:"models"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("Response is not valid JSON: %v", err)
	}
	if len(body.Models) == 0 {
		t.Fatal("Expected a non-empty models array")
	}
}

// TestModelRegistryHandler_RegistryContainsResolvableMapping guards the
// contract behind stigmer/stigmer#240: the served registry must let a local
// runner resolve canonical ids to provider api ids. If the synced registry
// ever loses the id -> apiModelId mapping shape, llm_call breaks in local
// mode and this test fails before any runner sees it.
func TestModelRegistryHandler_RegistryContainsResolvableMapping(t *testing.T) {
	data, err := ReadEmbeddedModelRegistry()
	if err != nil {
		t.Fatalf("ReadEmbeddedModelRegistry failed: %v", err)
	}

	var body struct {
		Models []struct {
			ID         string `json:"id"`
			ApiModelID string `json:"apiModelId"`
			Harness    string `json:"harness"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatalf("Embedded registry is not valid JSON: %v", err)
	}

	nativeWithAPIID := 0
	for _, m := range body.Models {
		if m.Harness == "native" && m.ID != "" && m.ApiModelID != "" {
			nativeWithAPIID++
		}
	}
	if nativeWithAPIID == 0 {
		t.Fatal("Expected at least one native model with an apiModelId mapping — " +
			"was a stripped registry synced by mistake? Run 'make sync-model-registry'.")
	}
}

func TestModelRegistryHandler_RejectsNonGET(t *testing.T) {
	h := NewModelRegistryHandler()

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
		req := httptest.NewRequest(method, "/v1/proxy/model-registry", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s: expected 405, got %d", method, rec.Code)
		}
	}
}
