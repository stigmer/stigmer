package registry

import (
	"net/http"
)

// model-registry.json is embedded via the shared registryFS declared in
// task_kind_registry.go; ModelRegistryStore (model_registry_store.go)
// loads it and optionally refreshes it from the public cloud endpoint.

// ReadEmbeddedModelRegistry returns the raw bundled model-registry.json
// bytes. This is the build-time bundle only — components that should see
// upstream refreshes read the Store instead.
func ReadEmbeddedModelRegistry() ([]byte, error) {
	return registryFS.ReadFile("data/model-registry.json")
}

// ModelRegistryHandler serves the model registry as a cacheable HTTP endpoint.
//
// The document comes from the shared ModelRegistryStore: the bundled
// registry (a snapshot of the cloud registry, refreshed at build time via
// `make sync-model-registry`), upgraded in-place by the background refresh
// from the public cloud endpoint when reachable (DD-004). It maps Stigmer
// canonical model ids (e.g. "claude-haiku-4.5") to provider API ids (e.g.
// "claude-haiku-4-5-20251001") along with provider, harness, cost tier, and
// pricing metadata.
//
// Serving it locally is what makes llm_call work in local/direct mode: the
// runner resolves canonical ids against this endpoint instead of requiring an
// authenticated fetch from the hosted API (stigmer/stigmer#240). The web
// console's model picker fetches the same path from its client base URL.
type ModelRegistryHandler struct {
	store *ModelRegistryStore
}

// NewModelRegistryHandler creates the handler backed by the process-wide
// registry store (fatal at construction if the build-time bundle is
// missing).
func NewModelRegistryHandler() *ModelRegistryHandler {
	return &ModelRegistryHandler{store: Store()}
}

// ServeHTTP handles GET /v1/proxy/model-registry.
func (h *ModelRegistryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(h.store.Document())
}
