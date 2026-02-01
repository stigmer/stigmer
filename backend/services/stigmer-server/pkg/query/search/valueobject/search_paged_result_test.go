package valueobject

import (
	"testing"

	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
)

func TestNewSearchPagedResult_ValidInput(t *testing.T) {
	results := []*searchv1.SearchResult{
		{Id: "1", Name: "Agent One"},
		{Id: "2", Name: "Agent Two"},
	}
	countsByKind := map[string]int32{
		"agent": 5,
		"skill": 3,
	}

	result, err := NewSearchPagedResult(results, countsByKind, 8, 20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(result.Results()) != 2 {
		t.Errorf("expected 2 results, got %d", len(result.Results()))
	}
	if result.TotalCount() != 8 {
		t.Errorf("expected total count 8, got %d", result.TotalCount())
	}
	if result.TotalPages() != 1 {
		t.Errorf("expected 1 page, got %d", result.TotalPages())
	}
}

func TestNewSearchPagedResult_TotalPagesCalculation(t *testing.T) {
	tests := []struct {
		name        string
		totalCount  int32
		pageSize    int32
		expectPages int32
	}{
		{"exact division", 40, 20, 2},
		{"with remainder", 45, 20, 3},
		{"single page", 15, 20, 1},
		{"zero results", 0, 20, 0},
		{"large count", 1000, 50, 20},
		{"one item per page", 5, 1, 5},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			result, err := NewSearchPagedResult(nil, nil, tc.totalCount, tc.pageSize)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if result.TotalPages() != tc.expectPages {
				t.Errorf("expected %d pages, got %d", tc.expectPages, result.TotalPages())
			}
		})
	}
}

func TestNewSearchPagedResult_NegativeTotalCount(t *testing.T) {
	_, err := NewSearchPagedResult(nil, nil, -1, 20)
	if err == nil {
		t.Error("expected error for negative totalCount")
	}
}

func TestNewSearchPagedResult_NegativePageSize(t *testing.T) {
	_, err := NewSearchPagedResult(nil, nil, 10, -1)
	if err == nil {
		t.Error("expected error for negative pageSize")
	}
}

func TestNewSearchPagedResult_ZeroPageSize(t *testing.T) {
	result, err := NewSearchPagedResult(nil, nil, 10, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.TotalPages() != 0 {
		t.Errorf("expected 0 pages with 0 page size, got %d", result.TotalPages())
	}
}

func TestSearchPagedResult_IsEmpty(t *testing.T) {
	t.Run("empty results", func(t *testing.T) {
		result, _ := NewSearchPagedResult(nil, nil, 0, 20)
		if !result.IsEmpty() {
			t.Error("expected IsEmpty to be true")
		}
	})

	t.Run("non-empty results", func(t *testing.T) {
		results := []*searchv1.SearchResult{{Id: "1"}}
		result, _ := NewSearchPagedResult(results, nil, 1, 20)
		if result.IsEmpty() {
			t.Error("expected IsEmpty to be false")
		}
	})
}

func TestSearchPagedResult_PageSize(t *testing.T) {
	results := []*searchv1.SearchResult{
		{Id: "1"},
		{Id: "2"},
		{Id: "3"},
	}
	result, _ := NewSearchPagedResult(results, nil, 100, 20)
	if result.PageSize() != 3 {
		t.Errorf("expected PageSize 3, got %d", result.PageSize())
	}
}

func TestEmptyResult(t *testing.T) {
	result := EmptyResult()

	if !result.IsEmpty() {
		t.Error("expected empty result")
	}
	if result.TotalCount() != 0 {
		t.Errorf("expected total count 0, got %d", result.TotalCount())
	}
	if result.TotalPages() != 0 {
		t.Errorf("expected 0 pages, got %d", result.TotalPages())
	}
	if len(result.CountsByKind()) != 0 {
		t.Errorf("expected empty counts, got %d", len(result.CountsByKind()))
	}
}

func TestSearchPagedResult_Immutability_Results(t *testing.T) {
	results := []*searchv1.SearchResult{
		{Id: "1", Name: "Original"},
	}

	result, _ := NewSearchPagedResult(results, nil, 1, 20)

	// Modify the original slice
	results[0] = &searchv1.SearchResult{Id: "2", Name: "Modified"}

	// The result should still have the original
	if result.Results()[0].Id != "1" {
		t.Error("result was mutated by modifying input slice")
	}

	// Modify the returned slice
	returned := result.Results()
	returned[0] = &searchv1.SearchResult{Id: "3", Name: "Also Modified"}

	// The result should still have the original
	if result.Results()[0].Id != "1" {
		t.Error("result was mutated by modifying returned slice")
	}
}

func TestSearchPagedResult_Immutability_CountsByKind(t *testing.T) {
	counts := map[string]int32{
		"agent": 5,
	}

	result, _ := NewSearchPagedResult(nil, counts, 5, 20)

	// Modify the original map
	counts["agent"] = 100
	counts["skill"] = 50

	// The result should still have the original values
	if result.CountsByKind()["agent"] != 5 {
		t.Error("result was mutated by modifying input map")
	}
	if _, exists := result.CountsByKind()["skill"]; exists {
		t.Error("result was mutated by adding to input map")
	}

	// Modify the returned map
	returned := result.CountsByKind()
	returned["agent"] = 999

	// The result should still have the original value
	if result.CountsByKind()["agent"] != 5 {
		t.Error("result was mutated by modifying returned map")
	}
}

func TestSearchPagedResult_NilInputs(t *testing.T) {
	result, err := NewSearchPagedResult(nil, nil, 0, 20)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should handle nil inputs gracefully
	if result.Results() == nil {
		t.Error("Results() should return empty slice, not nil")
	}
	if result.CountsByKind() == nil {
		t.Error("CountsByKind() should return empty map, not nil")
	}
}
