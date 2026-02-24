package mdrender

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

// plainText strips ANSI escape codes from rendered output so tests can assert
// on the visible text content without being coupled to styling details.
func plainText(s string) string {
	return ansi.Strip(s)
}

func TestRender_EmptyContent(t *testing.T) {
	result := Render("", 80)
	if result != "" {
		t.Errorf("expected empty string for empty input, got %q", result)
	}
}

func TestRender_PlainText(t *testing.T) {
	result := Render("Hello world", 80)
	if !strings.Contains(plainText(result), "Hello world") {
		t.Errorf("plain text should be preserved, got %q", plainText(result))
	}
}

func TestRender_HeaderProducesANSI(t *testing.T) {
	result := Render("# My Header", 80)
	plain := plainText(result)
	if !strings.Contains(plain, "My Header") {
		t.Errorf("header text should be present, got %q", plain)
	}
	if result == "# My Header" {
		t.Error("header should be rendered with ANSI styling, got raw markdown")
	}
}

func TestRender_BoldProducesANSI(t *testing.T) {
	result := Render("Some **bold** text", 80)
	plain := plainText(result)
	if !strings.Contains(plain, "bold") {
		t.Errorf("bold text should be present, got %q", plain)
	}
	if strings.Contains(plain, "**") {
		t.Error("raw markdown bold markers should not be present in rendered output")
	}
}

func TestRender_CodeBlockPreserved(t *testing.T) {
	input := "```go\nfmt.Println(\"hello\")\n```"
	result := Render(input, 80)
	plain := plainText(result)
	if !strings.Contains(plain, "Println") {
		t.Errorf("code block content should be preserved, got %q", plain)
	}
	if strings.Contains(plain, "```") {
		t.Error("raw code fences should not appear in rendered output")
	}
}

func TestRender_UnorderedListRendered(t *testing.T) {
	input := "- Item one\n- Item two\n- Item three"
	result := Render(input, 80)
	plain := plainText(result)
	if !strings.Contains(plain, "Item one") || !strings.Contains(plain, "Item two") {
		t.Errorf("list items should be preserved, got %q", plain)
	}
}

func TestRender_OrderedListRendered(t *testing.T) {
	input := "1. First\n2. Second\n3. Third"
	result := Render(input, 80)
	plain := plainText(result)
	if !strings.Contains(plain, "First") || !strings.Contains(plain, "Second") {
		t.Errorf("ordered list items should be preserved, got %q", plain)
	}
}

func TestRender_NoTrailingNewlines(t *testing.T) {
	result := Render("Hello world", 80)
	if strings.HasSuffix(result, "\n") {
		t.Errorf("rendered output should not have trailing newlines, got %q", result)
	}
}

func TestRender_ZeroWidthDisablesWrapping(t *testing.T) {
	longLine := strings.Repeat("word ", 100)
	result := Render(longLine, 0)
	if !strings.Contains(plainText(result), "word") {
		t.Errorf("content should be preserved with zero width, got %q", plainText(result))
	}
}

func TestHasMarkdown_PlainText(t *testing.T) {
	if HasMarkdown("Just a plain sentence.") {
		t.Error("plain text should not be detected as markdown")
	}
}

func TestHasMarkdown_Empty(t *testing.T) {
	if HasMarkdown("") {
		t.Error("empty string should not be detected as markdown")
	}
}

func TestHasMarkdown_Headers(t *testing.T) {
	tests := []string{"# Header", "## Sub", "### Sub-sub"}
	for _, input := range tests {
		if !HasMarkdown(input) {
			t.Errorf("expected %q to be detected as markdown", input)
		}
	}
}

func TestHasMarkdown_Lists(t *testing.T) {
	tests := []string{"- item", "* item", "1. item"}
	for _, input := range tests {
		if !HasMarkdown(input) {
			t.Errorf("expected %q to be detected as markdown", input)
		}
	}
}

func TestHasMarkdown_Bold(t *testing.T) {
	if !HasMarkdown("Some **bold** text") {
		t.Error("bold markers should be detected as markdown")
	}
}

func TestHasMarkdown_CodeFence(t *testing.T) {
	if !HasMarkdown("```go\ncode\n```") {
		t.Error("code fences should be detected as markdown")
	}
}

func TestHasMarkdown_Blockquote(t *testing.T) {
	if !HasMarkdown("> quoted text") {
		t.Error("blockquotes should be detected as markdown")
	}
}

func TestHasMarkdown_HorizontalRule(t *testing.T) {
	if !HasMarkdown("---") {
		t.Error("horizontal rules should be detected as markdown")
	}
}
