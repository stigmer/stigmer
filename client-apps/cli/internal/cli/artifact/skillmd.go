package artifact

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

// SkillMetadata represents the YAML frontmatter in SKILL.md
type SkillMetadata struct {
	// Name is the canonical skill name (required, kebab-case)
	Name string `yaml:"name"`
	// Version is an optional version string
	Version string `yaml:"version"`
	// Description is an optional short description
	Description string `yaml:"description"`
}

// skillNamePattern validates kebab-case skill names
var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ParseSkillMetadata reads SKILL.md and extracts the YAML frontmatter metadata.
// Returns an error if SKILL.md doesn't exist, has no frontmatter, or name is missing.
func ParseSkillMetadata(skillDir string) (*SkillMetadata, error) {
	skillPath := filepath.Join(skillDir, SkillFileName)

	content, err := os.ReadFile(skillPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read %s", SkillFileName)
	}

	return parseSkillMdContent(string(content))
}

// parseSkillMdContent parses SKILL.md content and extracts YAML frontmatter.
// The frontmatter must be enclosed between --- markers at the start of the file.
func parseSkillMdContent(content string) (*SkillMetadata, error) {
	frontmatter, err := extractFrontmatter(content)
	if err != nil {
		return nil, err
	}

	var metadata SkillMetadata
	if err := yaml.Unmarshal([]byte(frontmatter), &metadata); err != nil {
		return nil, errors.Wrap(err, "failed to parse YAML frontmatter")
	}

	// Validate required fields
	if metadata.Name == "" {
		return nil, fmt.Errorf("SKILL.md is missing required 'name' field in YAML frontmatter\n\n" +
			"Expected format:\n" +
			"---\n" +
			"name: my-skill-name\n" +
			"---\n\n" +
			"The name must be kebab-case (lowercase letters, numbers, and hyphens)")
	}

	// Validate name format
	if !skillNamePattern.MatchString(metadata.Name) {
		return nil, fmt.Errorf("invalid skill name '%s' in SKILL.md\n\n"+
			"Skill names must be kebab-case:\n"+
			"- Lowercase letters (a-z)\n"+
			"- Numbers (0-9)\n"+
			"- Hyphens (-) to separate words\n\n"+
			"Examples: 'calculator', 'web-scraper', 'math-utils'", metadata.Name)
	}

	return &metadata, nil
}

// extractFrontmatter extracts YAML frontmatter from markdown content.
// Frontmatter must start with --- on the first line and end with --- on its own line.
func extractFrontmatter(content string) (string, error) {
	scanner := bufio.NewScanner(strings.NewReader(content))

	// First line must be ---
	if !scanner.Scan() {
		return "", fmt.Errorf("SKILL.md is empty")
	}
	firstLine := strings.TrimSpace(scanner.Text())
	if firstLine != "---" {
		return "", fmt.Errorf("SKILL.md must start with YAML frontmatter (---)\n\n" +
			"Expected format:\n" +
			"---\n" +
			"name: my-skill-name\n" +
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
		return "", errors.Wrap(err, "error reading SKILL.md")
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
