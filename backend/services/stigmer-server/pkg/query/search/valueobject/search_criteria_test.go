package valueobject

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

func TestNewSearchCriteria_ValidInput(t *testing.T) {
	kinds := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_skill,
	}

	criteria, err := NewSearchCriteria(kinds, "kubernetes", "acme", false, false, 2, 50)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(criteria.Kinds()) != 2 {
		t.Errorf("expected 2 kinds, got %d", len(criteria.Kinds()))
	}
	if criteria.Query() != "kubernetes" {
		t.Errorf("expected query 'kubernetes', got '%s'", criteria.Query())
	}
	if criteria.OrgFilter() != "acme" {
		t.Errorf("expected org 'acme', got '%s'", criteria.OrgFilter())
	}
	if criteria.ExcludePublic() {
		t.Error("expected excludePublic to be false")
	}
	if criteria.PageNumber() != 2 {
		t.Errorf("expected page 2, got %d", criteria.PageNumber())
	}
	if criteria.PageSize() != 50 {
		t.Errorf("expected page size 50, got %d", criteria.PageSize())
	}
}

func TestNewSearchCriteria_QueryTrimming(t *testing.T) {
	criteria, err := NewSearchCriteria(nil, "  kubernetes  ", "", false, false, 1, 20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if criteria.Query() != "kubernetes" {
		t.Errorf("expected trimmed query 'kubernetes', got '%s'", criteria.Query())
	}
}

func TestNewSearchCriteria_QueryTooLong(t *testing.T) {
	longQuery := strings.Repeat("a", MaxQueryLength+1)

	_, err := NewSearchCriteria(nil, longQuery, "", false, false, 1, 20)
	if err == nil {
		t.Error("expected error for query exceeding max length")
	}
}

func TestNewSearchCriteria_QueryAtMaxLength(t *testing.T) {
	maxQuery := strings.Repeat("a", MaxQueryLength)

	criteria, err := NewSearchCriteria(nil, maxQuery, "", false, false, 1, 20)
	if err != nil {
		t.Fatalf("unexpected error for query at max length: %v", err)
	}

	if len(criteria.Query()) != MaxQueryLength {
		t.Errorf("expected query length %d, got %d", MaxQueryLength, len(criteria.Query()))
	}
}

func TestNewSearchCriteria_FiltersNonSearchableKinds(t *testing.T) {
	kinds := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
		apiresourcekind.ApiResourceKind_session,         // Not searchable
		apiresourcekind.ApiResourceKind_agent_execution, // Not searchable
		apiresourcekind.ApiResourceKind_skill,
	}

	criteria, err := NewSearchCriteria(kinds, "", "", false, false, 1, 20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should only contain agent and skill
	if len(criteria.Kinds()) != 2 {
		t.Errorf("expected 2 kinds after filtering, got %d", len(criteria.Kinds()))
	}

	kindsMap := make(map[apiresourcekind.ApiResourceKind]bool)
	for _, k := range criteria.Kinds() {
		kindsMap[k] = true
	}

	if !kindsMap[apiresourcekind.ApiResourceKind_agent] {
		t.Error("expected agent kind to be present")
	}
	if !kindsMap[apiresourcekind.ApiResourceKind_skill] {
		t.Error("expected skill kind to be present")
	}
}

func TestNewSearchCriteria_PageNumberClamping(t *testing.T) {
	tests := []struct {
		name     string
		input    int32
		expected int32
	}{
		{"zero becomes 1", 0, 1},
		{"negative becomes 1", -5, 1},
		{"positive stays same", 3, 3},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			criteria, err := NewSearchCriteria(nil, "", "", false, false, tc.input, 20)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if criteria.PageNumber() != tc.expected {
				t.Errorf("expected page %d, got %d", tc.expected, criteria.PageNumber())
			}
		})
	}
}

func TestNewSearchCriteria_PageSizeClamping(t *testing.T) {
	tests := []struct {
		name     string
		input    int32
		expected int32
	}{
		{"zero becomes default", 0, DefaultPageSize},
		{"negative becomes default", -5, DefaultPageSize},
		{"above max becomes max", 200, MaxPageSize},
		{"within range stays same", 50, 50},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			criteria, err := NewSearchCriteria(nil, "", "", false, false, 1, tc.input)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if criteria.PageSize() != tc.expected {
				t.Errorf("expected page size %d, got %d", tc.expected, criteria.PageSize())
			}
		})
	}
}

func TestSearchCriteria_IsDiscoverMode(t *testing.T) {
	t.Run("empty kinds is discover mode", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "query", "", false, false, 1, 20)
		if !criteria.IsDiscoverMode() {
			t.Error("expected discover mode with empty kinds")
		}
	})

	t.Run("with kinds is not discover mode", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(
			[]apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_agent},
			"query", "", false, false, 1, 20,
		)
		if criteria.IsDiscoverMode() {
			t.Error("expected not discover mode with kinds specified")
		}
	})
}

func TestSearchCriteria_HasQuery(t *testing.T) {
	t.Run("empty query", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "", "", false, false, 1, 20)
		if criteria.HasQuery() {
			t.Error("expected HasQuery to be false for empty query")
		}
	})

	t.Run("whitespace-only query", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "   ", "", false, false, 1, 20)
		if criteria.HasQuery() {
			t.Error("expected HasQuery to be false for whitespace-only query")
		}
	})

	t.Run("non-empty query", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "kubernetes", "", false, false, 1, 20)
		if !criteria.HasQuery() {
			t.Error("expected HasQuery to be true for non-empty query")
		}
	})
}

func TestSearchCriteria_HasOrgFilter(t *testing.T) {
	t.Run("empty org filter", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "", "", false, false, 1, 20)
		if criteria.HasOrgFilter() {
			t.Error("expected HasOrgFilter to be false for empty org")
		}
	})

	t.Run("non-empty org filter", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "", "acme", false, false, 1, 20)
		if !criteria.HasOrgFilter() {
			t.Error("expected HasOrgFilter to be true for non-empty org")
		}
	})
}

func TestSearchCriteria_EffectiveKinds(t *testing.T) {
	t.Run("discover mode returns all searchable kinds", func(t *testing.T) {
		criteria, _ := NewSearchCriteria(nil, "query", "", false, false, 1, 20)
		effective := criteria.EffectiveKinds()

		if len(effective) != len(SearchableKinds) {
			t.Errorf("expected %d kinds, got %d", len(SearchableKinds), len(effective))
		}

		for _, k := range effective {
			if !SearchableKinds[k] {
				t.Errorf("unexpected non-searchable kind: %v", k)
			}
		}
	})

	t.Run("specific kinds returns requested kinds", func(t *testing.T) {
		kinds := []apiresourcekind.ApiResourceKind{
			apiresourcekind.ApiResourceKind_agent,
		}
		criteria, _ := NewSearchCriteria(kinds, "", "", false, false, 1, 20)
		effective := criteria.EffectiveKinds()

		if len(effective) != 1 {
			t.Errorf("expected 1 kind, got %d", len(effective))
		}
		if effective[0] != apiresourcekind.ApiResourceKind_agent {
			t.Errorf("expected agent kind, got %v", effective[0])
		}
	})
}

func TestSearchCriteria_Offset(t *testing.T) {
	tests := []struct {
		name       string
		pageNumber int32
		pageSize   int32
		expected   int32
	}{
		{"first page", 1, 20, 0},
		{"second page", 2, 20, 20},
		{"third page with 50 size", 3, 50, 100},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			criteria, _ := NewSearchCriteria(nil, "", "", false, false, tc.pageNumber, tc.pageSize)
			if criteria.Offset() != tc.expected {
				t.Errorf("expected offset %d, got %d", tc.expected, criteria.Offset())
			}
		})
	}
}

func TestSearchCriteria_Immutability(t *testing.T) {
	kinds := []apiresourcekind.ApiResourceKind{
		apiresourcekind.ApiResourceKind_agent,
	}

	criteria, _ := NewSearchCriteria(kinds, "query", "org", false, false, 1, 20)

	// Modify the original slice
	kinds[0] = apiresourcekind.ApiResourceKind_skill

	// The criteria should still have agent
	if criteria.Kinds()[0] != apiresourcekind.ApiResourceKind_agent {
		t.Error("criteria was mutated by modifying input slice")
	}

	// Modify the returned slice
	returned := criteria.Kinds()
	returned[0] = apiresourcekind.ApiResourceKind_workflow

	// The criteria should still have agent
	if criteria.Kinds()[0] != apiresourcekind.ApiResourceKind_agent {
		t.Error("criteria was mutated by modifying returned slice")
	}
}
