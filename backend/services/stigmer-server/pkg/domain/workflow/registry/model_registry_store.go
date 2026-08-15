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

	// Pricing-variant capability index (stigmer/stigmer#357): variant key
	// ("fast") → harness → model references that price it. Presence of a
	// priced variant IS the selectability capability — a tier with no price
	// would trip billing's undercharge guard, so selection and billability
	// are coupled by construction. The harness dimension exists for the
	// workflow validators (which know the task's harness); the execution
	// create step stays deliberately harness-free (it never resolves the
	// session) and unions across harnesses.
	modelsByVariant map[string]map[string]map[string]bool
	// variant key → sorted canonical ids across all harnesses (create-step
	// refusal messages).
	sortedModelsByVariant map[string][]string
	// variant key → harness → sorted canonical ids (workflow-validation
	// refusal messages).
	sortedModelsByVariantHarness map[string]map[string][]string

	// Log-noise control: the first refresh failure warns, subsequent
	// consecutive failures log at debug until a refresh succeeds again.
	failureLogged bool
}

// FastVariantKey is the registry pricing-variant key backing
// SERVICE_TIER_FAST (stigmer/stigmer#357) — the one vocabulary shared by
// every consumer (execution create validation, workflow validation), defined
// beside the index it queries so the selectable key and the priced key can
// never drift.
const FastVariantKey = "fast"

// The subset of a registry entry the store indexes. Both canonical ids
// and provider api ids are accepted as valid references because the
// runner resolves canonical ids via the registry and passes
// unknown-but-registered api ids to the provider verbatim
// (stigmer/stigmer#240). PricingVariants values are deliberately not
// modeled — only the key set matters for capability.
type modelRegistryEntry struct {
	ID              string                     `json:"id"`
	ApiModelID      string                     `json:"apiModelId"`
	Harness         string                     `json:"harness"`
	PricingVariants map[string]json.RawMessage `json:"pricingVariants"`
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

// IsValidModelOnAnyHarness reports whether a model reference (canonical id
// or provider api id) is executable on AT LEAST ONE harness. The
// existence check for surfaces with no serving harness in this edition
// (agent channels): a pin no section knows is certainly a typo, while a
// pin valid anywhere may be right where the spec actually serves.
func (s *ModelRegistryStore) IsValidModelOnAnyHarness(model string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, models := range s.modelsByHarness {
		if models[model] {
			return true
		}
	}
	return false
}

// CanonicalModelsAcrossHarnesses returns the sorted, deduplicated
// canonical model ids across every harness section — the did-you-mean
// candidate pool for the any-harness existence check. Computed per call
// (refusal-path only); callers may keep the slice.
func (s *ModelRegistryStore) CanonicalModelsAcrossHarnesses() []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	seen := make(map[string]bool)
	var merged []string
	for _, models := range s.sortedModelsByHarness {
		for _, name := range models {
			if !seen[name] {
				seen[name] = true
				merged = append(merged, name)
			}
		}
	}
	sort.Strings(merged)
	return merged
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

// HasPricingVariant reports whether a model reference (canonical id or
// provider api id) prices the given variant key (e.g. "fast") under ANY
// harness — the registry-backed capability check for
// ExecutionConfig.service_tier at execution create (stigmer/stigmer#357),
// which is deliberately harness-free (it never resolves the session).
func (s *ModelRegistryStore) HasPricingVariant(model, variant string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, refs := range s.modelsByVariant[variant] {
		if refs[model] {
			return true
		}
	}
	return false
}

// HasPricingVariantForHarness reports whether a model reference prices the
// given variant key under the given harness. The workflow validators use
// this form — the task config names its harness, so a fast variant priced
// only under another harness must not validate (it would execute as a
// silent no-op).
func (s *ModelRegistryStore) HasPricingVariantForHarness(harness, model, variant string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.modelsByVariant[variant][harness][model]
}

// CanonicalModelsWithVariant returns the sorted canonical model ids that
// price the given variant key under any harness, for actionable refusal
// messages ("fast is available on: ..."). Callers must not mutate the
// slice.
func (s *ModelRegistryStore) CanonicalModelsWithVariant(variant string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sortedModelsByVariant[variant]
}

// CanonicalModelsWithVariantForHarness returns the sorted canonical model
// ids that price the given variant key under the given harness. Callers
// must not mutate the slice.
func (s *ModelRegistryStore) CanonicalModelsWithVariantForHarness(harness, variant string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.sortedModelsByVariantHarness[variant][harness]
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
	byVariant := make(map[string]map[string]map[string]bool)
	// Set-backed: the same canonical id may price a variant under more than
	// one harness, and the union list must not repeat it.
	canonicalByVariantSet := make(map[string]map[string]bool)
	canonicalByVariantHarness := make(map[string]map[string][]string)
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
		for variant := range m.PricingVariants {
			if byVariant[variant] == nil {
				byVariant[variant] = make(map[string]map[string]bool)
			}
			if byVariant[variant][m.Harness] == nil {
				byVariant[variant][m.Harness] = make(map[string]bool)
			}
			byVariant[variant][m.Harness][m.ID] = true
			if m.ApiModelID != "" {
				byVariant[variant][m.Harness][m.ApiModelID] = true
			}
			if canonicalByVariantSet[variant] == nil {
				canonicalByVariantSet[variant] = make(map[string]bool)
			}
			canonicalByVariantSet[variant][m.ID] = true
			if canonicalByVariantHarness[variant] == nil {
				canonicalByVariantHarness[variant] = make(map[string][]string)
			}
			canonicalByVariantHarness[variant][m.Harness] =
				append(canonicalByVariantHarness[variant][m.Harness], m.ID)
		}
	}
	if len(byHarness) == 0 {
		return fmt.Errorf("registry document contains no model entries")
	}
	for _, ids := range canonicalByHarness {
		sort.Strings(ids)
	}
	canonicalByVariant := make(map[string][]string, len(canonicalByVariantSet))
	for variant, idSet := range canonicalByVariantSet {
		ids := make([]string, 0, len(idSet))
		for id := range idSet {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		canonicalByVariant[variant] = ids
	}
	for _, byH := range canonicalByVariantHarness {
		for _, ids := range byH {
			sort.Strings(ids)
		}
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.document = data
	s.modelsByHarness = byHarness
	s.sortedModelsByHarness = canonicalByHarness
	s.modelsByVariant = byVariant
	s.sortedModelsByVariant = canonicalByVariant
	s.sortedModelsByVariantHarness = canonicalByVariantHarness
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
