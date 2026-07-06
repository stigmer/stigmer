package storage

import (
	"bufio"
	"fmt"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

// SkillFrontmatter represents the YAML frontmatter extracted from SKILL.md.
// This struct contains the metadata fields that are parsed from the frontmatter
// section at the beginning of a SKILL.md file.
type SkillFrontmatter struct {
	// Name is the canonical skill identifier (required).
	// Kebab-case, optionally scoped with dot-separated namespaces: lowercase
	// letters, numbers, hyphens (words), and dots (namespace segments).
	// Examples: "calculator", "web-scraper", "math-utils", "platform.planton-architecture"
	Name string `yaml:"name"`

	// Description is a human-readable summary of what the skill does (optional but recommended).
	// Should be 1-2 sentences, ideally under 100 tokens for prompt efficiency.
	// Example: "Extracts text and tables from PDF files using OCR when needed"
	Description string `yaml:"description"`

	// Version is an optional version string for the skill.
	// This is informational and not used for versioning (hash-based versioning is used instead).
	Version string `yaml:"version"`
}

// skillNamePattern validates kebab-case skill names, optionally scoped with
// dot-separated namespaces.
// Valid names: lowercase letters (a-z), numbers (0-9), hyphens (-) to separate
// words, and dots (.) to separate namespace segments (e.g. "platform.planton-architecture").
// Every segment between separators must be alphanumeric, so a name cannot start
// or end with a separator, nor contain consecutive separators. The derived slug
// renders dots as hyphens (see steps.GenerateSlug).
var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+([.-][a-z0-9]+)*$`)

// ParseFrontmatter extracts and parses YAML frontmatter from SKILL.md content.
// The frontmatter must be enclosed between --- markers at the start of the file.
//
// Required fields:
//   - name: Must be kebab-case (lowercase letters, numbers, hyphens), optionally
//     scoped with dot-separated namespaces (e.g. "platform.my-skill")
//
// Optional fields:
//   - description: Human-readable summary (recommended for marketplace display)
//   - version: Informational version string
//
// Returns an error if:
//   - Content is empty
//   - Frontmatter delimiters are missing or malformed
//   - YAML parsing fails
//   - Required 'name' field is missing
//   - Name format is invalid (not kebab-case)
func ParseFrontmatter(content string) (*SkillFrontmatter, error) {
	// Extract raw frontmatter YAML
	frontmatterYAML, err := extractFrontmatterYAML(content)
	if err != nil {
		return nil, err
	}

	// Parse YAML into struct
	var frontmatter SkillFrontmatter
	if err := yaml.Unmarshal([]byte(frontmatterYAML), &frontmatter); err != nil {
		return nil, fmt.Errorf("failed to parse YAML frontmatter: %w", err)
	}

	// Validate required fields
	if err := validateFrontmatter(&frontmatter); err != nil {
		return nil, err
	}

	return &frontmatter, nil
}

// extractFrontmatterYAML extracts the raw YAML content from between --- delimiters.
// The frontmatter must start on the first line with --- and end with --- on its own line.
func extractFrontmatterYAML(content string) (string, error) {
	if content == "" {
		return "", fmt.Errorf("SKILL.md is empty")
	}

	scanner := bufio.NewScanner(strings.NewReader(content))

	// First line must be the opening ---
	if !scanner.Scan() {
		return "", fmt.Errorf("SKILL.md is empty")
	}
	firstLine := strings.TrimSpace(scanner.Text())
	if firstLine != "---" {
		return "", fmt.Errorf("SKILL.md must start with YAML frontmatter (---)\n\n" +
			"Expected format:\n" +
			"---\n" +
			"name: my-skill-name\n" +
			"description: A brief description of what this skill does\n" +
			"---\n" +
			"# Skill Title\n" +
			"...")
	}

	// Collect lines until closing ---
	var frontmatterLines []string
	foundClosing := false
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			foundClosing = true
			break
		}
		frontmatterLines = append(frontmatterLines, line)
	}

	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("error reading SKILL.md content: %w", err)
	}

	if !foundClosing {
		return "", fmt.Errorf("SKILL.md frontmatter is not closed (missing closing ---)")
	}

	if len(frontmatterLines) == 0 {
		return "", fmt.Errorf("SKILL.md has empty frontmatter\n\n" +
			"The frontmatter must contain at least a 'name' field:\n" +
			"---\n" +
			"name: my-skill-name\n" +
			"---")
	}

	return strings.Join(frontmatterLines, "\n"), nil
}

// validateFrontmatter validates the required fields and format constraints.
func validateFrontmatter(fm *SkillFrontmatter) error {
	// Validate required 'name' field
	if fm.Name == "" {
		return fmt.Errorf("SKILL.md is missing required 'name' field in YAML frontmatter\n\n" +
			"Expected format:\n" +
			"---\n" +
			"name: my-skill-name\n" +
			"---\n\n" +
			"The name must be kebab-case (lowercase letters, numbers, and hyphens), " +
			"optionally scoped with dots (e.g. 'platform.my-skill')")
	}

	// Validate name format (kebab-case, optionally dot-scoped)
	if !skillNamePattern.MatchString(fm.Name) {
		return fmt.Errorf("invalid skill name '%s' in SKILL.md\n\n"+
			"Skill names must be kebab-case, optionally scoped with dot-separated namespaces:\n"+
			"- Lowercase letters (a-z)\n"+
			"- Numbers (0-9)\n"+
			"- Hyphens (-) to separate words\n"+
			"- Dots (.) to separate namespace segments\n\n"+
			"Every segment must be alphanumeric: no leading, trailing, or consecutive separators.\n\n"+
			"Examples: 'calculator', 'web-scraper', 'math-utils', 'platform.planton-architecture'", fm.Name)
	}

	return nil
}
