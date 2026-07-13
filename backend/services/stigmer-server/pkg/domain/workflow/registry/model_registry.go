package registry

import (
	"net/http"

	"github.com/rs/zerolog/log"
)

// model-registry.json is embedded via the shared registryFS declared in
// task_kind_registry.go.

// ReadEmbeddedModelRegistry returns the raw model-registry.json bytes.
// This is used by components that need the registry data at startup
// (e.g., workflow model validation) without duplicating the embed.
func ReadEmbeddedModelRegistry() ([]byte, error) {
	return registryFS.ReadFile("data/model-registry.json")
}

// ModelRegistryHandler serves the model registry as a cacheable HTTP endpoint.
//
// The model registry is a verbatim copy of stigmer-cloud's model-registry.json
// (synced via `make sync-model-registry`). It maps Stigmer canonical model ids
// (e.g. "claude-haiku-4.5") to provider API ids (e.g.
// "claude-haiku-4-5-20251001") along with provider, harness, cost tier, and
// pricing metadata.
//
// Serving it locally is what makes llm_call work in local/direct mode: the
// runner resolves canonical ids against this endpoint instead of requiring an
// authenticated fetch from the hosted API (stigmer/stigmer#240). The web
// console's model picker fetches the same path from its client base URL.
type ModelRegistryHandler struct {
	registryJSON []byte
}

// NewModelRegistryHandler creates a new model registry handler.
// It loads the embedded registry JSON at construction time and panics
// if the build-time artifact is missing.
func NewModelRegistryHandler() *ModelRegistryHandler {
	data, err := registryFS.ReadFile("data/model-registry.json")
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load embedded model-registry.json — was 'make sync-model-registry' run?")
	}
	log.Info().Int("bytes", len(data)).Msg("Loaded model-registry.json")
	return &ModelRegistryHandler{registryJSON: data}
}

// ServeHTTP handles GET /v1/proxy/model-registry.
func (h *ModelRegistryHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(h.registryJSON)
}
