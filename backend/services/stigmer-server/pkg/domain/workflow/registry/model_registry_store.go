package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// Where the store refreshes from, and how it is controlled. The cloud
// endpoint is public and unauthenticated (raw provider list prices only —
// DD-004); self-hosted operators can repoint or disable it entirely.
const (
	// EnvModelRegistryUpstream overrides the cloud origin the store
	// refreshes from (default: the hosted Stigmer API).
	EnvModelRegistryUpstream = "STIGMER_MODEL_REGISTRY_UPSTREAM"

	// EnvModelRegistryRefresh set to "off" disables the background
	// refresh entirely — the bundled registry serves forever. Air-gapped
	// installs work either way (a failed refresh quietly keeps the
	// bundle); "off" additionally guarantees zero outbound calls.
	EnvModelRegistryRefresh = "STIGMER_MODEL_REGISTRY_REFRESH"

	defaultModelRegistryUpstream = "https://api.stigmer.ai"
	publicModelRegistryPath      = "/api/v1/public/model-registry"

	modelRegistryRefreshInterval = time.Hour
	modelRegistryFetchTimeout    = 30 * time.Second

	// A registry document is a few hundred KB; anything near this bound
	// is not a registry.
	maxModelRegistryBytes = 8 << 20
)

// ModelRegistryStore holds the current model-registry document and the
// valid-model indexes derived from it.
//
// Both registry consumers in this server — the /v1/proxy/model-registry
// HTTP handler and workflow model validation — read this one store, so
// the document the pickers see and the set validation accepts can never
// drift (DD-004: a model added in the cloud console must not pass the
// picker and then fail workflow validation).
//
// The bundled (embedded) registry loads at construction: the store works
// fully offline and no startup path touches the network. StartRefresh
// upgrades it — a background loop pulls the public cloud endpoint and,
// when a response passes the sanity gate, swaps the document and indexes
// atomically under the write lock.
type ModelRegistryStore struct {
	mu                    sync.RWMutex
	document              []byte
	modelsByHarness       map[string]map[string]bool
	sortedModelsByHarness map[string][]string

	// Log-noise control: the first refresh failure warns, subsequent
	// consecutive failures log at debug until a refresh succeeds again.
	failureLogged bool
}

// The subset of a registry entry the store indexes. Both canonical ids
// and provider api ids are accepted as valid references because the
// runner resolves canonical ids via the registry and passes
// unknown-but-registered api ids to the provider verbatim
// (stigmer/stigmer#240).
type modelRegistryEntry struct {
	ID         string `json:"id"`
	ApiModelID string `json:"apiModelId"`
	Harness    string `json:"harness"`
}

type modelRegistryData struct {
	Models []modelRegistryEntry `json:"models"`
}

var (
	storeOnce sync.Once
	store     *ModelRegistryStore
)

// Store returns the process-wide model registry store, initialized from
// the embedded bundle on first use. Fatal if the build-time bundle is
// missing — a server without any registry cannot resolve models at all.
func Store() *ModelRegistryStore {
	storeOnce.Do(func() {
		data, err := registryFS.ReadFile("data/model-registry.json")
		if err != nil {
			log.Fatal().Err(err).Msg("Failed to load the bundled model-registry.json — " +
				"the embed is created at build time (refresh it with 'make sync-model-registry')")
		}
		s := &ModelRegistryStore{}
		if err := s.applyDocument(data); err != nil {
			log.Fatal().Err(err).Msg("Bundled model-registry.json is not a valid registry document")
		}
		log.Info().Int("bytes", len(data)).Msg("Loaded bundled model-registry.json")
		store = s
	})
	return store
}

// Document returns the current registry document bytes (bundle or the
// last good upstream response). Callers must not mutate the slice.
func (s *ModelRegistryStore) Document() []byte {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.document
}

// IsValidModel reports whether a model reference (canonical id or
// provider api id) is executable on the given harness.
func (s *ModelRegistryStore) IsValidModel(harness, model string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.modelsByHarness[harness][model]
}

// HasHarness reports whether the registry knows any models for a harness.
func (s *ModelRegistryStore) HasHarness(harness string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.modelsByHarness[harness]) > 0
}

// HasAnyModels reports whether the registry loaded at all — validation
// degrades to a no-op rather than rejecting everything when it did not.
func (s *ModelRegistryStore) HasAnyModels() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.modelsByHarness) > 0
}

// CanonicalModels returns the sorted canonical model ids for a harness
// (for deterministic did-you-mean suggestions — canonical ids are the
// documented form, so suggestions never surface provider api ids).
// Callers must not mutate the slice.
func (s *ModelRegistryStore) CanonicalModels(harness string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sortedModelsByHarness[harness]
}

// applyDocument sanity-gates and installs a registry document: it must
// parse, and it must index at least one model. A malformed or empty
// upstream response never replaces a working registry.
func (s *ModelRegistryStore) applyDocument(data []byte) error {
	var parsed modelRegistryData
	if err := json.Unmarshal(data, &parsed); err != nil {
		return fmt.Errorf("parse model registry document: %w", err)
	}

	byHarness := make(map[string]map[string]bool)
	canonicalByHarness := make(map[string][]string)
	for _, m := range parsed.Models {
		// $comment section dividers carry no id/harness.
		if m.ID == "" || m.Harness == "" {
			continue
		}
		if byHarness[m.Harness] == nil {
			byHarness[m.Harness] = make(map[string]bool)
		}
		byHarness[m.Harness][m.ID] = true
		canonicalByHarness[m.Harness] = append(canonicalByHarness[m.Harness], m.ID)
		if m.ApiModelID != "" {
			byHarness[m.Harness][m.ApiModelID] = true
		}
	}
	if len(byHarness) == 0 {
		return fmt.Errorf("registry document contains no model entries")
	}
	for _, ids := range canonicalByHarness {
		sort.Strings(ids)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.document = data
	s.modelsByHarness = byHarness
	s.sortedModelsByHarness = canonicalByHarness
	return nil
}

// StartModelRegistryRefresh begins the background refresh of the
// process-wide store from the public cloud endpoint. Called once by the
// server after boot; nothing else ever initiates network activity from
// this package, so binaries and tests that merely import it stay
// network-silent.
func StartModelRegistryRefresh(ctx context.Context) {
	Store().startRefresh(ctx, os.Getenv(EnvModelRegistryUpstream),
		os.Getenv(EnvModelRegistryRefresh))
}

func (s *ModelRegistryStore) startRefresh(ctx context.Context, upstream, refreshSetting string) {
	if refreshSetting == "off" {
		log.Info().Msg("Model registry refresh disabled (" + EnvModelRegistryRefresh + "=off) — " +
			"serving the bundled registry")
		return
	}
	if upstream == "" {
		upstream = defaultModelRegistryUpstream
	}
	url := upstream + publicModelRegistryPath

	go func() {
		s.refreshOnce(ctx, url)
		ticker := time.NewTicker(modelRegistryRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.refreshOnce(ctx, url)
			}
		}
	}()
}

// refreshOnce fetches the upstream registry and applies it when sane. A
// failure of any kind keeps the current document: the first consecutive
// failure warns (self-hosted installs are often offline — that is a
// supported mode, not an error loop), later ones log at debug.
func (s *ModelRegistryStore) refreshOnce(ctx context.Context, url string) {
	data, err := fetchModelRegistry(ctx, url)
	if err == nil {
		err = s.applyDocument(data)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if s.failureLogged {
			log.Debug().Err(err).Str("url", url).Msg("Model registry refresh failed; keeping the current registry")
		} else {
			log.Warn().Err(err).Str("url", url).Msg("Model registry refresh failed; keeping the current registry " +
				"(offline self-hosting is fine — set " + EnvModelRegistryRefresh + "=off to silence this)")
			s.failureLogged = true
		}
		return
	}
	if s.failureLogged {
		s.failureLogged = false
	}
	log.Info().Int("bytes", len(data)).Str("url", url).Msg("Model registry refreshed from upstream")
}

func fetchModelRegistry(ctx context.Context, url string) ([]byte, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, modelRegistryFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(fetchCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxModelRegistryBytes))
	if err != nil {
		return nil, err
	}
	return data, nil
}
