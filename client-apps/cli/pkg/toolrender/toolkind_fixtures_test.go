package toolrender

// Cross-language parity tests: the Go classifier and result normalizer run
// against the same fixtures as the TS implementation
// (test/fixtures/tool-view/), so the two surfaces cannot drift.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func fixturePath(t *testing.T, name string) string {
	t.Helper()
	// pkg/toolrender -> repo root is four levels up.
	return filepath.Join("..", "..", "..", "..", "test", "fixtures", "tool-view", name)
}

func TestClassificationFixtures(t *testing.T) {
	data, err := os.ReadFile(fixturePath(t, "classification.json"))
	if err != nil {
		t.Fatalf("read classification fixture: %v", err)
	}
	var fixture struct {
		Cases []struct {
			Name          string `json:"name"`
			McpServerSlug string `json:"mcpServerSlug"`
			ToolKind      string `json:"toolKind"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse classification fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no classification cases")
	}

	for _, c := range fixture.Cases {
		got := ClassifyToolByName(c.Name, c.McpServerSlug)
		if string(got) != c.ToolKind {
			t.Errorf("ClassifyToolByName(%q, %q) = %q, want %q", c.Name, c.McpServerSlug, got, c.ToolKind)
		}
	}
}

func TestResultViewFixtures(t *testing.T) {
	data, err := os.ReadFile(fixturePath(t, "result-views.json"))
	if err != nil {
		t.Fatalf("read result-views fixture: %v", err)
	}
	var fixture struct {
		Cases []struct {
			Name          string                 `json:"name"`
			ToolName      string                 `json:"toolName"`
			McpServerSlug string                 `json:"mcpServerSlug"`
			Args          map[string]interface{} `json:"args"`
			Result        string                 `json:"result"`
			Error         string                 `json:"error"`
			Status        string                 `json:"status"`
			Expected      struct {
				Type          string `json:"type"`
				Path          string `json:"path"`
				ExitCode      *int   `json:"exitCode"`
				Count         *int   `json:"count"`
				McpServerSlug string `json:"mcpServerSlug"`
				LinesAdded    *int   `json:"linesAdded"`
				LinesRemoved  *int   `json:"linesRemoved"`
			} `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("parse result-views fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("no result-view cases")
	}

	for _, c := range fixture.Cases {
		view := NormalizeToolResult(NormalizeInput{
			Name:          c.ToolName,
			Args:          c.Args,
			Result:        c.Result,
			Error:         c.Error,
			Failed:        c.Status == "TOOL_CALL_FAILED",
			McpServerSlug: c.McpServerSlug,
		})

		if string(view.Type) != c.Expected.Type {
			t.Errorf("%s: type = %q, want %q", c.Name, view.Type, c.Expected.Type)
			continue
		}

		if c.Expected.Path != "" && view.Path != c.Expected.Path {
			t.Errorf("%s: path = %q, want %q", c.Name, view.Path, c.Expected.Path)
		}
		if c.Expected.ExitCode != nil {
			if view.ExitCode == nil || *view.ExitCode != *c.Expected.ExitCode {
				t.Errorf("%s: exitCode = %v, want %d", c.Name, view.ExitCode, *c.Expected.ExitCode)
			}
		}
		if c.Expected.Count != nil && view.Count != *c.Expected.Count {
			t.Errorf("%s: count = %d, want %d", c.Name, view.Count, *c.Expected.Count)
		}
		if c.Expected.McpServerSlug != "" && view.McpServerSlug != c.Expected.McpServerSlug {
			t.Errorf("%s: mcpServerSlug = %q, want %q", c.Name, view.McpServerSlug, c.Expected.McpServerSlug)
		}
		if c.Expected.LinesAdded != nil {
			if view.LinesAdded == nil || *view.LinesAdded != *c.Expected.LinesAdded {
				t.Errorf("%s: linesAdded = %v, want %d", c.Name, view.LinesAdded, *c.Expected.LinesAdded)
			}
		}
		if c.Expected.LinesRemoved != nil {
			if view.LinesRemoved == nil || *view.LinesRemoved != *c.Expected.LinesRemoved {
				t.Errorf("%s: linesRemoved = %v, want %d", c.Name, view.LinesRemoved, *c.Expected.LinesRemoved)
			}
		}
	}
}
