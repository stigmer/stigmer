package extractor

import (
	"testing"

	"google.golang.org/protobuf/proto"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// mockExtractor is a test implementation of SearchableExtractor.
type mockExtractor struct {
	kind apiresourcekind.ApiResourceKind
}

func (m *mockExtractor) Kind() apiresourcekind.ApiResourceKind {
	return m.kind
}

func (m *mockExtractor) NewEmptyProto() proto.Message {
	return nil
}

func (m *mockExtractor) GetSearchSummary(resource proto.Message) string {
	return "mock summary"
}

func (m *mockExtractor) ToSearchResult(resource proto.Message, score float32) *searchv1.SearchResult {
	return &searchv1.SearchResult{Name: "mock", Score: score}
}

func (m *mockExtractor) GetSearchIndexEntry(resource proto.Message) *store.SearchIndexEntry {
	return &store.SearchIndexEntry{Name: "mock"}
}

// newTestRegistry creates a fresh registry for testing.
func newTestRegistry() *SearchableResourceRegistry {
	return &SearchableResourceRegistry{
		extractors: make(map[apiresourcekind.ApiResourceKind]SearchableExtractor),
	}
}

func TestSearchableResourceRegistry_Register(t *testing.T) {
	registry := newTestRegistry()

	extractor := &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}

	// Register should work
	registry.extractors[extractor.Kind()] = extractor

	if registry.Size() != 1 {
		t.Errorf("expected size 1, got %d", registry.Size())
	}
}

func TestSearchableResourceRegistry_GetExtractor(t *testing.T) {
	registry := newTestRegistry()

	agentExtractor := &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}
	registry.extractors[agentExtractor.Kind()] = agentExtractor

	t.Run("existing kind returns extractor", func(t *testing.T) {
		ext, err := registry.GetExtractor(apiresourcekind.ApiResourceKind_agent)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if ext != agentExtractor {
			t.Error("expected to get the registered extractor")
		}
	})

	t.Run("non-existing kind returns error", func(t *testing.T) {
		_, err := registry.GetExtractor(apiresourcekind.ApiResourceKind_skill)
		if err == nil {
			t.Error("expected error for non-registered kind")
		}
	})
}

func TestSearchableResourceRegistry_GetExtractorOrNil(t *testing.T) {
	registry := newTestRegistry()

	agentExtractor := &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}
	registry.extractors[agentExtractor.Kind()] = agentExtractor

	t.Run("existing kind returns extractor", func(t *testing.T) {
		ext := registry.GetExtractorOrNil(apiresourcekind.ApiResourceKind_agent)
		if ext != agentExtractor {
			t.Error("expected to get the registered extractor")
		}
	})

	t.Run("non-existing kind returns nil", func(t *testing.T) {
		ext := registry.GetExtractorOrNil(apiresourcekind.ApiResourceKind_skill)
		if ext != nil {
			t.Error("expected nil for non-registered kind")
		}
	})
}

func TestSearchableResourceRegistry_SupportedKinds(t *testing.T) {
	registry := newTestRegistry()

	// Register multiple extractors
	registry.extractors[apiresourcekind.ApiResourceKind_agent] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}
	registry.extractors[apiresourcekind.ApiResourceKind_skill] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_skill}

	kinds := registry.SupportedKinds()

	if len(kinds) != 2 {
		t.Errorf("expected 2 kinds, got %d", len(kinds))
	}

	// Should be sorted
	kindMap := make(map[apiresourcekind.ApiResourceKind]bool)
	for _, k := range kinds {
		kindMap[k] = true
	}

	if !kindMap[apiresourcekind.ApiResourceKind_agent] {
		t.Error("expected agent kind")
	}
	if !kindMap[apiresourcekind.ApiResourceKind_skill] {
		t.Error("expected skill kind")
	}
}

func TestSearchableResourceRegistry_IsSupported(t *testing.T) {
	registry := newTestRegistry()

	registry.extractors[apiresourcekind.ApiResourceKind_agent] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}

	if !registry.IsSupported(apiresourcekind.ApiResourceKind_agent) {
		t.Error("expected agent to be supported")
	}

	if registry.IsSupported(apiresourcekind.ApiResourceKind_skill) {
		t.Error("expected skill to not be supported")
	}
}

func TestSearchableResourceRegistry_Size(t *testing.T) {
	registry := newTestRegistry()

	if registry.Size() != 0 {
		t.Errorf("expected size 0, got %d", registry.Size())
	}

	registry.extractors[apiresourcekind.ApiResourceKind_agent] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}

	if registry.Size() != 1 {
		t.Errorf("expected size 1, got %d", registry.Size())
	}

	registry.extractors[apiresourcekind.ApiResourceKind_skill] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_skill}

	if registry.Size() != 2 {
		t.Errorf("expected size 2, got %d", registry.Size())
	}
}

func TestSearchableResourceRegistry_ValidateExpectedKinds_AllPresent(t *testing.T) {
	registry := newTestRegistry()

	// Register all expected kinds (matching not_search_indexed: false in proto)
	for _, kind := range []apiresourcekind.ApiResourceKind{
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
	} {
		registry.extractors[kind] = &mockExtractor{kind: kind}
	}

	// Should not panic
	registry.ValidateExpectedKinds()
}

func TestSearchableResourceRegistry_ValidateExpectedKinds_Missing(t *testing.T) {
	registry := newTestRegistry()

	// Register only some kinds
	registry.extractors[apiresourcekind.ApiResourceKind_agent] = &mockExtractor{kind: apiresourcekind.ApiResourceKind_agent}

	// Should not panic, just log warning
	registry.ValidateExpectedKinds()

	// Verify only agent is supported
	if registry.Size() != 1 {
		t.Errorf("expected size 1, got %d", registry.Size())
	}
}

func TestBuildSearchableText(t *testing.T) {
	tests := []struct {
		name     string
		entry    *store.SearchIndexEntry
		expected string
	}{
		{
			name: "all fields",
			entry: &store.SearchIndexEntry{
				Name:        "Test Agent",
				Description: "A test description",
				Tags:        "tag1 tag2 tag3",
			},
			expected: "Test Agent A test description tag1 tag2 tag3",
		},
		{
			name: "name only",
			entry: &store.SearchIndexEntry{
				Name:        "Test Agent",
				Description: "",
				Tags:        "",
			},
			expected: "Test Agent",
		},
		{
			name: "name and description",
			entry: &store.SearchIndexEntry{
				Name:        "Test Agent",
				Description: "Description here",
				Tags:        "",
			},
			expected: "Test Agent Description here",
		},
		{
			name: "name and tags",
			entry: &store.SearchIndexEntry{
				Name:        "Test Agent",
				Description: "",
				Tags:        "kubernetes docker",
			},
			expected: "Test Agent kubernetes docker",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := BuildSearchableText(tc.entry)
			if result != tc.expected {
				t.Errorf("expected '%s', got '%s'", tc.expected, result)
			}
		})
	}
}

func TestJoinTags(t *testing.T) {
	tests := []struct {
		name     string
		tags     []string
		expected string
	}{
		{"empty", []string{}, ""},
		{"single tag", []string{"kubernetes"}, "kubernetes"},
		{"multiple tags", []string{"kubernetes", "docker", "devops"}, "kubernetes docker devops"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result := JoinTags(tc.tags)
			if result != tc.expected {
				t.Errorf("expected '%s', got '%s'", tc.expected, result)
			}
		})
	}
}
