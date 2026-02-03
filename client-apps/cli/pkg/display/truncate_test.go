package display

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTruncateDescription(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		maxLen   int
		expected string
	}{
		{
			name:     "short text unchanged",
			text:     "Hello world",
			maxLen:   50,
			expected: "Hello world",
		},
		{
			name:     "exact length unchanged",
			text:     "Hello",
			maxLen:   5,
			expected: "Hello",
		},
		{
			name:     "truncate with ellipsis",
			text:     "This is a long description that needs to be truncated",
			maxLen:   20,
			expected: "This is a long...",
		},
		{
			name:     "empty text",
			text:     "",
			maxLen:   50,
			expected: "",
		},
		{
			name:     "whitespace only",
			text:     "   \t\n   ",
			maxLen:   50,
			expected: "",
		},
		{
			name:     "multiline takes first line",
			text:     "First line\nSecond line\nThird line",
			maxLen:   50,
			expected: "First line",
		},
		{
			name:     "paragraph separator",
			text:     "First paragraph content here.\n\nSecond paragraph starts here.",
			maxLen:   100,
			expected: "First paragraph content here.",
		},
		{
			name:     "zero max length",
			text:     "Hello",
			maxLen:   0,
			expected: "",
		},
		{
			name:     "negative max length",
			text:     "Hello",
			maxLen:   -5,
			expected: "",
		},
		{
			name:     "unicode text",
			text:     "Hello 世界! This is a test.",
			maxLen:   15,
			expected: "Hello 世界!...",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TruncateDescription(tt.text, tt.maxLen)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestTruncateWithEllipsis(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		maxLen   int
		expected string
	}{
		{
			name:     "short text unchanged",
			text:     "Hello",
			maxLen:   10,
			expected: "Hello",
		},
		{
			name:     "truncate with ellipsis",
			text:     "Hello world",
			maxLen:   8,
			expected: "Hello...",
		},
		{
			name:     "very short max",
			text:     "Hello",
			maxLen:   3,
			expected: "...",
		},
		{
			name:     "zero max length",
			text:     "Hello",
			maxLen:   0,
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TruncateWithEllipsis(tt.text, tt.maxLen)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestNormalizeWhitespace(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected string
	}{
		{
			name:     "single spaces unchanged",
			text:     "Hello world",
			expected: "Hello world",
		},
		{
			name:     "multiple spaces collapsed",
			text:     "Hello    world",
			expected: "Hello world",
		},
		{
			name:     "newlines converted to space",
			text:     "Hello\nworld",
			expected: "Hello world",
		},
		{
			name:     "tabs converted to space",
			text:     "Hello\tworld",
			expected: "Hello world",
		},
		{
			name:     "leading/trailing removed",
			text:     "   Hello world   ",
			expected: "Hello world",
		},
		{
			name:     "mixed whitespace",
			text:     "  Hello  \n\t world  ",
			expected: "Hello world",
		},
		{
			name:     "empty string",
			text:     "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := NormalizeWhitespace(tt.text)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestFormatRelativeTime(t *testing.T) {
	tests := []struct {
		name     string
		seconds  int64
		expected string
	}{
		{
			name:     "just now",
			seconds:  30,
			expected: "just now",
		},
		{
			name:     "one minute",
			seconds:  60,
			expected: "1 minute ago",
		},
		{
			name:     "minutes",
			seconds:  300, // 5 minutes
			expected: "5 minutes ago",
		},
		{
			name:     "one hour",
			seconds:  3600,
			expected: "1 hour ago",
		},
		{
			name:     "hours",
			seconds:  7200, // 2 hours
			expected: "2 hours ago",
		},
		{
			name:     "one day",
			seconds:  86400,
			expected: "1 day ago",
		},
		{
			name:     "days",
			seconds:  172800, // 2 days
			expected: "2 days ago",
		},
		{
			name:     "one month",
			seconds:  2592000, // 30 days
			expected: "1 month ago",
		},
		{
			name:     "months",
			seconds:  5184000, // 60 days
			expected: "2 months ago",
		},
		{
			name:     "one year",
			seconds:  31536000, // 365 days
			expected: "1 year ago",
		},
		{
			name:     "years",
			seconds:  63072000, // 730 days
			expected: "2 years ago",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := FormatRelativeTime(tt.seconds)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestTruncateDescription_WordBoundary(t *testing.T) {
	// Test that word boundaries are respected
	text := "This is a test of word boundary truncation"

	result := TruncateDescription(text, 20)

	// Should end at a word boundary if possible
	assert.True(t, strings.HasSuffix(result, "..."))
	// Should not cut a word in the middle when there's a reasonable break point
	assert.NotContains(t, result, "bounda")
}

func TestExtractFirstParagraph(t *testing.T) {
	tests := []struct {
		name     string
		text     string
		expected string
	}{
		{
			name:     "single line",
			text:     "Single line text",
			expected: "Single line text",
		},
		{
			name:     "paragraph with double newline",
			text:     "First paragraph\n\nSecond paragraph",
			expected: "First paragraph",
		},
		{
			name:     "multiple lines same paragraph",
			text:     "Line one\nLine two",
			expected: "Line one",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractFirstParagraph(tt.text)
			assert.Equal(t, tt.expected, result)
		})
	}
}
