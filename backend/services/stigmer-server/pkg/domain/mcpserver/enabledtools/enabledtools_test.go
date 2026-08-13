package enabledtools

import (
	"reflect"
	"testing"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
)

func caps() *mcpserverv1.DiscoveredCapabilities {
	return &mcpserverv1.DiscoveredCapabilities{
		Tools: []*mcpserverv1.DiscoveredTool{
			{Name: "search_code"},
			{Name: "create_pr"},
		},
		ResourceTemplates: []*mcpserverv1.DiscoveredResourceTemplate{
			{Name: "repo_readme"},
		},
	}
}

func TestClassify(t *testing.T) {
	t.Run("all valid", func(t *testing.T) {
		c := Classify(caps(), []string{"search_code", "create_pr"})
		if !c.Valid() {
			t.Errorf("expected valid classification, got %+v", c)
		}
	})

	t.Run("partitions unknown names and resource templates, preserving request order", func(t *testing.T) {
		c := Classify(caps(), []string{"zzz_last", "repo_readme", "search_code", "aaa_first"})
		if c.Valid() {
			t.Fatal("expected invalid classification")
		}
		if want := []string{"zzz_last", "aaa_first"}; !reflect.DeepEqual(c.Unknown, want) {
			t.Errorf("Unknown: want %v (request order), got %v", want, c.Unknown)
		}
		if want := []string{"repo_readme"}; !reflect.DeepEqual(c.ResourceTemplates, want) {
			t.Errorf("ResourceTemplates: want %v, got %v", want, c.ResourceTemplates)
		}
	})

	t.Run("matching is case-sensitive", func(t *testing.T) {
		// Tool names must match tools/list exactly (proto contract); a
		// case-mangled name is a typo, not a match.
		c := Classify(caps(), []string{"Search_Code"})
		if c.Valid() {
			t.Error("expected case-mangled name to classify as unknown")
		}
	})
}

func TestToolNames(t *testing.T) {
	if want, got := []string{"search_code", "create_pr"}, ToolNames(caps()); !reflect.DeepEqual(got, want) {
		t.Errorf("want %v (discovery order), got %v", want, got)
	}
}

func TestQuoteJoin(t *testing.T) {
	if want, got := "'a', 'b'", QuoteJoin([]string{"a", "b"}); got != want {
		t.Errorf("want %s, got %s", want, got)
	}
}
