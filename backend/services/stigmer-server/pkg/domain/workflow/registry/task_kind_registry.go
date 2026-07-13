package registry

import (
	"embed"
	"net/http"

	"github.com/rs/zerolog/log"
)

//go:embed data/task-kind-registry.json data/model-registry.json
var registryFS embed.FS

// ReadEmbeddedRegistry returns the raw task-kind-registry.json bytes.
// This is used by components that need the registry data at startup
// (e.g., workflow generation prompt builder) without duplicating the embed.
func ReadEmbeddedRegistry() ([]byte, error) {
	return registryFS.ReadFile("data/task-kind-registry.json")
}

// Handler serves the task kind registry as a cacheable HTTP endpoint.
//
// The task kind registry is a build-time artifact generated from proto
// definitions and sidecar metadata. It provides SDK/CLI consumers with
// task metadata for form generation, YAML editor autocomplete, task palette
// rendering, and client-side pre-validation.
type Handler struct {
	registryJSON []byte
}

// NewHandler creates a new task kind registry handler.
// It loads the embedded registry JSON at construction time and panics
// if the build-time artifact is missing.
func NewHandler() *Handler {
	data, err := registryFS.ReadFile("data/task-kind-registry.json")
	if err != nil {
		log.Fatal().Err(err).Msg("Failed to load embedded task-kind-registry.json — was codegen run?")
	}
	log.Info().Int("bytes", len(data)).Msg("Loaded task-kind-registry.json")
	return &Handler{registryJSON: data}
}

// ServeHTTP handles GET /v1/proxy/task-kind-registry.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.Write(h.registryJSON)
}
