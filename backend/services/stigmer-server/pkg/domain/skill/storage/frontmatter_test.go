package storage

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// frontmatterWithName builds a minimal valid SKILL.md with the given name.
func frontmatterWithName(name string) string {
	return fmt.Sprintf("---\nname: %s\ndescription: a test skill\n---\n# Skill\n\nBody.", name)
}

// TestParseFrontmatter_NameValidation covers the kebab-case-with-optional-dot-namespaces
// rule. Dots are allowed as namespace separators (issue #144) but every segment must
// remain alphanumeric, so leading/trailing/consecutive separators are rejected.
func TestParseFrontmatter_NameValidation(t *testing.T) {
	valid := []string{
		"calculator",
		"web-scraper",
		"math-utils",
		"pdf2text",
		"platform.planton-architecture",
		"org.acme.custom-runbook",
	}
	for _, name := range valid {
		t.Run("valid/"+name, func(t *testing.T) {
			fm, err := ParseFrontmatter(frontmatterWithName(name))
			require.NoError(t, err)
			assert.Equal(t, name, fm.Name)
		})
	}

	invalid := []string{
		"MySkill",                // uppercase
		"web_scraper",            // underscore
		"-my-skill",              // leading hyphen
		"my-skill-",              // trailing hyphen
		"my--skill",              // consecutive hyphens
		".platform",              // leading dot
		"platform.",              // trailing dot
		"platform..architecture", // consecutive dots
		"platform.-architecture", // mixed consecutive separators
		"my skill",               // space
	}
	for _, name := range invalid {
		t.Run("invalid/"+name, func(t *testing.T) {
			_, err := ParseFrontmatter(frontmatterWithName(name))
			require.Error(t, err)
		})
	}
}
