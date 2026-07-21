package registry

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// A minimal upstream registry document: one model the bundle does not have.
const upstreamRegistryDoc = `{
  "models": [
    {
      "id": "claude-nova-6",
      "apiModelId": "claude-nova-6-20270101",
      "provider": "anthropic",
      "harness": "native",
      "pricing": {"inputPricePerMillion": 1.0, "outputPricePerMillion": 5.0}
    }
  ]
}`

func newStoreFromEmbed(t *testing.T) *ModelRegistryStore {
	t.Helper()
	data, err := ReadEmbeddedModelRegistry()
	if err != nil {
		t.Fatalf("ReadEmbeddedModelRegistry failed: %v", err)
	}
	s := &ModelRegistryStore{}
	if err := s.applyDocument(data); err != nil {
		t.Fatalf("bundled registry failed the sanity gate: %v", err)
	}
	return s
}

func TestModelRegistryStore_BundleLoadsAndIndexes(t *testing.T) {
	s := newStoreFromEmbed(t)

	if !s.HasAnyModels() {
		t.Fatal("expected the bundled registry to index models")
	}
	if !s.HasHarness("native") || !s.HasHarness("cursor") {
		t.Fatal("expected both native and cursor harnesses in the bundle")
	}
	// The id -> apiModelId contract (stigmer/stigmer#240): both forms are valid.
	if !s.IsValidModel("native", "claude-sonnet-4.6") {
		t.Error("canonical id claude-sonnet-4.6 must be a valid native model")
	}
	if !s.IsValidModel("native", "claude-sonnet-4-6") {
		t.Error("api id claude-sonnet-4-6 must be a valid native model")
	}
	if s.IsValidModel("native", "not-a-model") {
		t.Error("unknown models must not validate")
	}
	// Suggestions surface canonical ids only.
	for _, id := range s.CanonicalModels("native") {
		if id == "claude-sonnet-4-6" {
			t.Error("CanonicalModels must not contain provider api ids")
		}
	}
}

func TestModelRegistryStore_RefreshAppliesUpstreamToDocumentAndValidation(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != publicModelRegistryPath {
			t.Errorf("expected fetch of %s, got %s", publicModelRegistryPath, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(upstreamRegistryDoc))
	}))
	defer upstream.Close()

	s := newStoreFromEmbed(t)
	if s.IsValidModel("native", "claude-nova-6") {
		t.Fatal("fixture assumption: the bundle must not know claude-nova-6")
	}

	s.refreshOnce(context.Background(), upstream.URL+publicModelRegistryPath)

	// The served document IS the upstream document...
	var doc modelRegistryData
	if err := json.Unmarshal(s.Document(), &doc); err != nil {
		t.Fatalf("refreshed document is not valid JSON: %v", err)
	}
	if len(doc.Models) != 1 || doc.Models[0].ID != "claude-nova-6" {
		t.Fatalf("expected the upstream document to be served, got %d models", len(doc.Models))
	}
	// ...and validation moved with it — the endpoint and the valid-model
	// sets can never drift (DD-004).
	if !s.IsValidModel("native", "claude-nova-6") {
		t.Error("a refreshed model must validate")
	}
	if !s.IsValidModel("native", "claude-nova-6-20270101") {
		t.Error("a refreshed model's api id must validate")
	}
	if s.IsValidModel("native", "claude-sonnet-4.6") {
		t.Error("the store must swap, not merge — bundle models are gone after a refresh")
	}
}

func TestModelRegistryStore_UnreachableUpstreamKeepsCurrentRegistry(t *testing.T) {
	s := newStoreFromEmbed(t)
	before := s.Document()

	// A closed server: connection refused immediately.
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := dead.URL
	dead.Close()

	s.refreshOnce(context.Background(), deadURL+publicModelRegistryPath)

	if string(s.Document()) != string(before) {
		t.Error("an unreachable upstream must not change the served registry")
	}
	if !s.IsValidModel("native", "claude-sonnet-4.6") {
		t.Error("validation must keep working from the previous registry")
	}
}

func TestModelRegistryStore_MalformedUpstreamIsRejected(t *testing.T) {
	cases := map[string]string{
		"not json":     `registry? what registry`,
		"empty models": `{"models": []}`,
		"no ids":       `{"models": [{"$comment": "only dividers"}]}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(
				func(w http.ResponseWriter, r *http.Request) {
					w.Write([]byte(body))
				}))
			defer upstream.Close()

			s := newStoreFromEmbed(t)
			before := s.Document()
			s.refreshOnce(context.Background(), upstream.URL+publicModelRegistryPath)

			if string(s.Document()) != string(before) {
				t.Error("a response failing the sanity gate must never replace the registry")
			}
		})
	}
}

func TestModelRegistryStore_ErrorStatusIsRejected(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusServiceUnavailable)
	}))
	defer upstream.Close()

	s := newStoreFromEmbed(t)
	before := s.Document()
	s.refreshOnce(context.Background(), upstream.URL+publicModelRegistryPath)

	if string(s.Document()) != string(before) {
		t.Error("a non-200 upstream must not change the served registry")
	}
}

func TestModelRegistryStore_RefreshOffMakesNoRequests(t *testing.T) {
	var requests atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write([]byte(upstreamRegistryDoc))
	}))
	defer upstream.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := newStoreFromEmbed(t)
	s.startRefresh(ctx, upstream.URL, "off")

	// The refresh goroutine, had it started, fetches immediately — give it
	// ample time to prove it did not.
	time.Sleep(150 * time.Millisecond)
	if got := requests.Load(); got != 0 {
		t.Fatalf("refresh=off must make zero outbound calls, saw %d", got)
	}
}

func TestModelRegistryStore_StartRefreshFetchesImmediately(t *testing.T) {
	applied := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(upstreamRegistryDoc))
	}))
	defer upstream.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := newStoreFromEmbed(t)
	s.startRefresh(ctx, upstream.URL, "")

	// Poll (no fixed sleep): the first fetch is immediate, not TTL-delayed.
	go func() {
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if s.IsValidModel("native", "claude-nova-6") {
				close(applied)
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}()

	select {
	case <-applied:
	case <-time.After(6 * time.Second):
		t.Fatal("the initial refresh did not apply within the deadline")
	}
}
