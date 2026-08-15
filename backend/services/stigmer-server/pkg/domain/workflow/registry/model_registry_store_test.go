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

func TestModelRegistryStore_PricingVariantCapabilityIndex(t *testing.T) {
	s := newStoreFromEmbed(t)

	// composer-2.5 carries pricingVariants.fast in the bundle — the
	// capability that makes SERVICE_TIER_FAST selectable (#357).
	if !s.HasPricingVariant("composer-2.5", "fast") {
		t.Error("composer-2.5 must price the fast variant in the bundled registry")
	}
	// A native-harness model with no variant block must fail closed.
	if s.HasPricingVariant("claude-sonnet-4.6", "fast") {
		t.Error("claude-sonnet-4.6 must not report a fast variant")
	}
	if s.HasPricingVariant("not-a-model", "fast") {
		t.Error("unknown models must not report variants")
	}
	if s.HasPricingVariant("composer-2.5", "turbo") {
		t.Error("unknown variant keys must not match")
	}

	withFast := s.CanonicalModelsWithVariant("fast")
	if len(withFast) == 0 {
		t.Fatal("expected at least one model pricing the fast variant")
	}
	found := false
	for i, id := range withFast {
		if id == "composer-2.5" {
			found = true
		}
		if i > 0 && withFast[i-1] > id {
			t.Errorf("CanonicalModelsWithVariant must be sorted; %q before %q", withFast[i-1], id)
		}
	}
	if !found {
		t.Error("CanonicalModelsWithVariant(\"fast\") must include composer-2.5")
	}
}

// The harness-scoped variant lookup backs the workflow validators: the fast
// variant must be priced FOR THE TASK'S HARNESS, so a variant priced only
// under cursor never validates a native task (the silent-no-op leak, #357).
func TestModelRegistryStore_PricingVariantHarnessScope(t *testing.T) {
	s := Store()

	if !s.HasPricingVariantForHarness("cursor", "composer-2.5", "fast") {
		t.Error("composer-2.5 must price the fast variant under the cursor harness")
	}
	// The bundle prices composer-2.5's fast variant under cursor only — the
	// native scope must fail closed even though the any-harness form passes.
	if s.HasPricingVariantForHarness("native", "composer-2.5", "fast") {
		t.Error("composer-2.5 must not report a fast variant under the native harness")
	}
	if s.HasPricingVariantForHarness("cursor", "not-a-model", "fast") {
		t.Error("unknown models must not report variants under any harness")
	}

	cursorFast := s.CanonicalModelsWithVariantForHarness("cursor", "fast")
	if len(cursorFast) == 0 {
		t.Fatal("expected cursor-harness models pricing the fast variant")
	}
	for i := 1; i < len(cursorFast); i++ {
		if cursorFast[i-1] > cursorFast[i] {
			t.Errorf("CanonicalModelsWithVariantForHarness must be sorted; %q before %q",
				cursorFast[i-1], cursorFast[i])
		}
	}
	if got := s.CanonicalModelsWithVariantForHarness("native", "fast"); len(got) != 0 {
		t.Errorf("expected no native-harness fast models in the bundle, got %v", got)
	}
}

// The harness-scoped capability lookup backs THINKING_MODE_ENABLED
// validation (stigmer/stigmer#772): the thinking capability must be
// declared FOR THE HARNESS THAT CAN HONOR IT. The bundle declares
// capabilities.thinking on cursor entries (claude-opus-4-6) and on native
// entries (claude-sonnet-4.6) — but v1 has no native thinking wire
// mapping, so validators query the cursor scope and a native-only
// declaration must not leak through.
func TestModelRegistryStore_CapabilityIndex(t *testing.T) {
	s := newStoreFromEmbed(t)

	if !s.HasCapabilityForHarness("cursor", "claude-opus-4-6", ThinkingCapabilityKey) {
		t.Error("claude-opus-4-6 must declare the thinking capability under the cursor harness")
	}
	// composer-2.5's capabilities block declares thinking=false — a false
	// flag must index nothing (only literal true declares the capability).
	if s.HasCapabilityForHarness("cursor", "composer-2.5", ThinkingCapabilityKey) {
		t.Error("composer-2.5 declares thinking=false and must not index the capability")
	}
	// claude-sonnet-4.6 declares thinking on its NATIVE entry only.
	if !s.HasCapabilityForHarness("native", "claude-sonnet-4.6", ThinkingCapabilityKey) {
		t.Error("claude-sonnet-4.6 must declare the thinking capability under the native harness")
	}
	if s.HasCapabilityForHarness("cursor", "claude-sonnet-4.6", ThinkingCapabilityKey) {
		t.Error("claude-sonnet-4.6 has no cursor entry — the cursor scope must fail closed")
	}
	// The id -> apiModelId contract (stigmer/stigmer#240) extends to the
	// capability index: both reference forms resolve.
	if !s.HasCapabilityForHarness("native", "claude-sonnet-4-6", ThinkingCapabilityKey) {
		t.Error("api id claude-sonnet-4-6 must resolve the native thinking capability")
	}
	if s.HasCapabilityForHarness("cursor", "not-a-model", ThinkingCapabilityKey) {
		t.Error("unknown models must not report capabilities")
	}
	if s.HasCapabilityForHarness("cursor", "claude-opus-4-6", "levitation") {
		t.Error("unknown capability keys must not match")
	}

	cursorThinking := s.CanonicalModelsWithCapabilityForHarness("cursor", ThinkingCapabilityKey)
	if len(cursorThinking) == 0 {
		t.Fatal("expected cursor-harness models declaring the thinking capability")
	}
	found := false
	for i, id := range cursorThinking {
		if id == "claude-opus-4-6" {
			found = true
		}
		if i > 0 && cursorThinking[i-1] > id {
			t.Errorf("CanonicalModelsWithCapabilityForHarness must be sorted; %q before %q",
				cursorThinking[i-1], id)
		}
	}
	if !found {
		t.Error("cursor thinking capability list must include claude-opus-4-6")
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
