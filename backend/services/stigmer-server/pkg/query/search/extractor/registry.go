package extractor

import (
	"fmt"
	"sort"
	"sync"

	"github.com/rs/zerolog/log"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// SearchableResourceRegistry maps ApiResourceKind to its SearchableExtractor.
//
// This component enables the search query handler to work with any searchable
// resource type without type-switching. Extractors are registered via the
// Register function, typically called from init() functions.
//
// # Registration Pattern
//
// Each extractor implementation should register itself in an init() function:
//
//	func init() {
//	    extractor.Register(&AgentExtractor{})
//	}
//
// # Open-Closed Principle
//
// Adding support for a new searchable resource type requires only:
//  1. Implementing SearchableExtractor
//  2. Calling Register() from an init() function
//
// No changes to this registry or the search handler are needed.
//
// # Thread Safety
//
// The registry is protected by a read-write mutex for thread-safe access.
// Registration is typically done at init time before any concurrent access.
type SearchableResourceRegistry struct {
	mu         sync.RWMutex
	extractors map[apiresourcekind.ApiResourceKind]SearchableExtractor
}

// globalRegistry is the singleton registry instance.
var globalRegistry = &SearchableResourceRegistry{
	extractors: make(map[apiresourcekind.ApiResourceKind]SearchableExtractor),
}

// Register adds an extractor to the global registry.
// This should be called from init() functions to register extractors at startup.
//
// Panics if an extractor is already registered for the same kind, indicating
// a configuration error that should be caught during development.
func Register(extractor SearchableExtractor) {
	globalRegistry.mu.Lock()
	defer globalRegistry.mu.Unlock()

	kind := extractor.Kind()
	if existing, ok := globalRegistry.extractors[kind]; ok {
		panic(fmt.Sprintf(
			"duplicate SearchableExtractor for kind %s: found both %T and %T",
			kind, existing, extractor,
		))
	}

	globalRegistry.extractors[kind] = extractor
}

// GetRegistry returns the global SearchableResourceRegistry.
// Use this to look up extractors for specific resource kinds.
func GetRegistry() *SearchableResourceRegistry {
	return globalRegistry
}

// GetExtractor returns the extractor for the given resource kind.
// Returns an error if no extractor is registered for the kind.
func (r *SearchableResourceRegistry) GetExtractor(kind apiresourcekind.ApiResourceKind) (SearchableExtractor, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	extractor, ok := r.extractors[kind]
	if !ok {
		return nil, fmt.Errorf(
			"no SearchableExtractor registered for kind %s. Supported kinds: %v",
			kind, r.supportedKindsLocked(),
		)
	}
	return extractor, nil
}

// GetExtractorOrNil returns the extractor for the given resource kind,
// or nil if not registered.
//
// Use this method when you want to handle missing extractors gracefully
// instead of receiving an error.
func (r *SearchableResourceRegistry) GetExtractorOrNil(kind apiresourcekind.ApiResourceKind) SearchableExtractor {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.extractors[kind]
}

// SupportedKinds returns the set of resource kinds that have registered extractors.
func (r *SearchableResourceRegistry) SupportedKinds() []apiresourcekind.ApiResourceKind {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return r.supportedKindsLocked()
}

// supportedKindsLocked returns supported kinds without acquiring the lock.
// Caller must hold at least a read lock.
func (r *SearchableResourceRegistry) supportedKindsLocked() []apiresourcekind.ApiResourceKind {
	kinds := make([]apiresourcekind.ApiResourceKind, 0, len(r.extractors))
	for k := range r.extractors {
		kinds = append(kinds, k)
	}
	// Sort for consistent ordering
	sort.Slice(kinds, func(i, j int) bool {
		return kinds[i].String() < kinds[j].String()
	})
	return kinds
}

// IsSupported returns true if an extractor is registered for the given kind.
func (r *SearchableResourceRegistry) IsSupported(kind apiresourcekind.ApiResourceKind) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	_, ok := r.extractors[kind]
	return ok
}

// Size returns the number of registered extractors.
func (r *SearchableResourceRegistry) Size() int {
	r.mu.RLock()
	defer r.mu.RUnlock()

	return len(r.extractors)
}

// ValidateExpectedKinds checks that extractors are registered for all expected
// searchable kinds. Logs warnings for any missing kinds.
//
// This should be called after all init() functions have run, typically at
// server startup.
func (r *SearchableResourceRegistry) ValidateExpectedKinds() {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// All resource kinds with not_search_indexed: false in the proto enum.
	expectedKinds := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_organization,
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_agent_execution,
		apiresourcekind.ApiResourceKind_session,
		apiresourcekind.ApiResourceKind_skill,
		apiresourcekind.ApiResourceKind_mcp_server,
		apiresourcekind.ApiResourceKind_agent_instance,
		apiresourcekind.ApiResourceKind_workflow,
		apiresourcekind.ApiResourceKind_workflow_instance,
		apiresourcekind.ApiResourceKind_workflow_execution,
		apiresourcekind.ApiResourceKind_environment,
		apiresourcekind.ApiResourceKind_execution_context,
		apiresourcekind.ApiResourceKind_project,
	}

	var missing []string
	for _, kind := range expectedKinds {
		if _, ok := r.extractors[kind]; !ok {
			missing = append(missing, kind.String())
		}
	}

	if len(missing) > 0 {
		log.Warn().
			Strs("missing_kinds", missing).
			Msg("SearchableResourceRegistry is missing extractors. These kinds will not be searchable.")
	} else {
		log.Info().
			Int("count", len(r.extractors)).
			Strs("kinds", func() []string {
				kinds := make([]string, 0, len(r.extractors))
				for k := range r.extractors {
					kinds = append(kinds, k.String())
				}
				sort.Strings(kinds)
				return kinds
			}()).
			Msg("SearchableResourceRegistry initialized successfully")
	}
}

// resetForTesting clears the registry for use in tests.
// This is not exported and should only be used via the test helper.
func (r *SearchableResourceRegistry) resetForTesting() {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.extractors = make(map[apiresourcekind.ApiResourceKind]SearchableExtractor)
}
