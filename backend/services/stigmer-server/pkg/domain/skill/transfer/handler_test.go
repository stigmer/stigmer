package transfer

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
)

func newTestLane(t *testing.T) (*UploadSlots, storage.ArtifactStorage, http.Handler) {
	t.Helper()
	slots, err := NewUploadSlots(filepath.Join(t.TempDir(), "staging"), DefaultSlotTTL, testMaxSize)
	if err != nil {
		t.Fatalf("NewUploadSlots: %v", err)
	}
	artifacts, err := storage.NewLocalFileStorage(t.TempDir())
	if err != nil {
		t.Fatalf("NewLocalFileStorage: %v", err)
	}
	return slots, artifacts, NewHandler(slots, artifacts)
}

func do(t *testing.T, h http.Handler, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != nil {
		r = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, r)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

// TestHandler_UploadRoundTrip pins the wire contract end to end: mint →
// PUT → consume returns the exact bytes.
func TestHandler_UploadRoundTrip(t *testing.T) {
	slots, _, h := newTestLane(t)
	payload := []byte("artifact zip bytes")

	ref, _, err := slots.Mint(int64(len(payload)))
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	// The handler consumes the URL shape UploadURL mints — pin them together.
	url := UploadURL("http://server.example", ref)
	path := url[len("http://server.example"):]

	if w := do(t, h, http.MethodPut, path, payload); w.Code != http.StatusNoContent {
		t.Fatalf("PUT status = %d, want 204 (body: %s)", w.Code, w.Body.String())
	}

	got, err := slots.Consume(ref)
	if err != nil {
		t.Fatalf("Consume: %v", err)
	}
	if !bytes.Equal(got, payload) {
		t.Error("bytes round-tripped through the handler differ")
	}
}

// TestHandler_UploadStatusMapping pins each refusal onto its status code.
func TestHandler_UploadStatusMapping(t *testing.T) {
	slots, _, h := newTestLane(t)

	// Unknown ref → 404.
	if w := do(t, h, http.MethodPut, PathPrefix+"/uploads/sau_unknown", []byte("x")); w.Code != http.StatusNotFound {
		t.Errorf("unknown ref status = %d, want 404", w.Code)
	}

	// Size mismatch → 400.
	ref, _, _ := slots.Mint(10)
	if w := do(t, h, http.MethodPut, PathPrefix+"/uploads/"+ref, []byte("way too many bytes for ten")); w.Code != http.StatusBadRequest {
		t.Errorf("size mismatch status = %d, want 400", w.Code)
	}

	// Re-upload of a completed slot → 409.
	ref2, _, _ := slots.Mint(4)
	do(t, h, http.MethodPut, PathPrefix+"/uploads/"+ref2, []byte("four"))
	if w := do(t, h, http.MethodPut, PathPrefix+"/uploads/"+ref2, []byte("four")); w.Code != http.StatusConflict {
		t.Errorf("re-upload status = %d, want 409", w.Code)
	}

	// Wrong method → 405.
	if w := do(t, h, http.MethodGet, PathPrefix+"/uploads/"+ref2, nil); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET on upload route status = %d, want 405", w.Code)
	}
}

// TestHandler_DownloadServesStoredArtifact pins the download half: a stored
// artifact is served as application/zip at the URL DownloadURL mints.
func TestHandler_DownloadServesStoredArtifact(t *testing.T) {
	_, artifacts, h := newTestLane(t)
	payload := []byte("stored artifact")

	key, err := artifacts.Store(storage.CalculateHash(payload), payload)
	if err != nil {
		t.Fatalf("Store: %v", err)
	}

	url := DownloadURL("http://server.example", key)
	path := url[len("http://server.example"):]

	w := do(t, h, http.MethodGet, path, nil)
	if w.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("Content-Type = %q, want application/zip", ct)
	}
	if !bytes.Equal(w.Body.Bytes(), payload) {
		t.Error("downloaded bytes differ from stored bytes")
	}
}

// TestHandler_DownloadRefusals pins the download guardrails: unknown keys
// 404, non-skill-store keys 404 (this lane serves ONLY skill artifacts),
// and traversal attempts resolve to nothing.
func TestHandler_DownloadRefusals(t *testing.T) {
	_, _, h := newTestLane(t)

	cases := map[string]string{
		"unknown key":        PathPrefix + "/skills/0000000000000000000000000000000000000000000000000000000000000000.zip",
		"non-skill key":      PathPrefix + "/artifacts/aex_123/out.zip",
		"traversal attempt":  PathPrefix + "/skills/../../../etc/passwd",
		"bare prefix":        PathPrefix + "/",
		"missing key prefix": PathPrefix + "/whatever.zip",
	}
	for name, path := range cases {
		if w := do(t, h, http.MethodGet, path, nil); w.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", name, w.Code)
		}
	}

	if w := do(t, h, http.MethodPut, PathPrefix+"/skills/some.zip", []byte("x")); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("PUT on download route status = %d, want 405", w.Code)
	}
}
