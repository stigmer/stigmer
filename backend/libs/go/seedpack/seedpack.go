package seedpack

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"strings"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// Manifest represents the seedpack metadata stored in manifest.json.
// It describes all skills and system agents included in the seedpack.
type Manifest struct {
	SchemaVersion string       `json:"schema_version"`
	Version       string       `json:"version"`
	CreatedAt     string       `json:"created_at"`
	Description   string       `json:"description"`
	Skills        []SkillEntry `json:"skills"`
	SystemAgents  []AgentEntry `json:"system_agents"`
}

// SkillEntry describes a skill included in the seedpack.
type SkillEntry struct {
	Name           string      `json:"name"`
	Path           string      `json:"path"`
	ArtifactPath   string      `json:"artifact_path,omitempty"`   // Pre-built ZIP artifact path
	ArtifactDigest string      `json:"artifact_digest,omitempty"` // SHA256 of the ZIP artifact
	ContentDigest  string      `json:"content_digest"`
	Source         SkillSource `json:"source"`
}

// SkillSource tracks the origin of a vendored skill.
type SkillSource struct {
	Type      string `json:"type"`
	URL       string `json:"url,omitempty"`
	CommitSHA string `json:"commit_sha,omitempty"`
}

// AgentEntry describes a system agent defined in the seedpack.
// Agents are stored as YAML files and loaded during bootstrap.
type AgentEntry struct {
	Name string `json:"name"`
	Path string `json:"path"` // Path to YAML file (e.g., "agents/skill-creator-agent.yaml")
}

// SkillMetadata represents the YAML frontmatter parsed from SKILL.md.
type SkillMetadata struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
	Version     string `yaml:"version,omitempty"`
	License     string `yaml:"license,omitempty"`
}

// Provenance represents the provenance.json schema for a vendored skill.
type Provenance struct {
	SchemaVersion string `json:"schema_version"`
	Source        struct {
		Type      string `json:"type"`
		URL       string `json:"url"`
		Ref       string `json:"ref"`
		CommitSHA string `json:"commit_sha"`
		Subdir    string `json:"subdir"`
	} `json:"source"`
	VendoredAt    string `json:"vendored_at"`
	VendoredBy    string `json:"vendored_by"`
	ContentDigest string `json:"content_digest"`
	Files         []struct {
		Path   string `json:"path"`
		Digest string `json:"digest"`
	} `json:"files"`
}

// skillNamePattern validates kebab-case skill names.
var skillNamePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// LoadManifest reads and parses the embedded manifest.json.
func LoadManifest() (*Manifest, error) {
	data, err := content.ReadFile("manifest.json")
	if err != nil {
		return nil, errors.Wrap(err, "failed to read embedded manifest.json")
	}

	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, errors.Wrap(err, "failed to parse manifest.json")
	}

	return &m, nil
}

// LoadSkillContent reads the full SKILL.md content for a skill.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
func LoadSkillContent(skillPath string) (string, error) {
	filePath := path.Join(skillPath, "SKILL.md")
	data, err := content.ReadFile(filePath)
	if err != nil {
		return "", errors.Wrapf(err, "failed to read %s", filePath)
	}
	return string(data), nil
}

// LoadSkillMetadata parses the YAML frontmatter from a skill's SKILL.md.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
func LoadSkillMetadata(skillPath string) (*SkillMetadata, error) {
	skillContent, err := LoadSkillContent(skillPath)
	if err != nil {
		return nil, err
	}

	return parseSkillMdContent(skillContent)
}

// LoadSkillProvenance reads the provenance.json for a skill.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
func LoadSkillProvenance(skillPath string) (*Provenance, error) {
	filePath := path.Join(skillPath, "provenance.json")
	data, err := content.ReadFile(filePath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read %s", filePath)
	}

	var p Provenance
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, errors.Wrap(err, "failed to parse provenance.json")
	}

	return &p, nil
}

// ListSkillFiles returns all files in a skill directory.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
// Returns relative paths within the skill directory.
func ListSkillFiles(skillPath string) ([]string, error) {
	var files []string

	err := fs.WalkDir(content, skillPath, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			// Return path relative to skillPath
			relPath := strings.TrimPrefix(p, skillPath+"/")
			files = append(files, relPath)
		}
		return nil
	})
	if err != nil {
		return nil, errors.Wrapf(err, "failed to list files in %s", skillPath)
	}

	return files, nil
}

// LoadSkillFile reads a specific file from a skill directory.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
// The filePath should be relative to the skill directory (e.g., "scripts/init_skill.py").
func LoadSkillFile(skillPath, filePath string) ([]byte, error) {
	fullPath := path.Join(skillPath, filePath)
	data, err := content.ReadFile(fullPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read %s", fullPath)
	}
	return data, nil
}

// GetSkillByName looks up a skill by name in the manifest.
// Returns nil if the skill is not found.
func GetSkillByName(name string) (*SkillEntry, error) {
	manifest, err := LoadManifest()
	if err != nil {
		return nil, err
	}

	for i := range manifest.Skills {
		if manifest.Skills[i].Name == name {
			return &manifest.Skills[i], nil
		}
	}

	return nil, nil
}

// GetAgentByName looks up a system agent by name in the manifest.
// Returns nil if the agent is not found.
func GetAgentByName(name string) (*AgentEntry, error) {
	manifest, err := LoadManifest()
	if err != nil {
		return nil, err
	}

	for i := range manifest.SystemAgents {
		if manifest.SystemAgents[i].Name == name {
			return &manifest.SystemAgents[i], nil
		}
	}

	return nil, nil
}

// =============================================================================
// Bootstrap Artifact Functions
// =============================================================================
// These functions support the server bootstrap process by loading pre-built
// artifacts (ZIP files, agent YAML) that were created during vendoring.

// LoadSkillArtifact loads a pre-built ZIP artifact for a skill.
// The artifactPath should be relative to the seedpack root (e.g., "artifacts/skill-creator.zip").
// Returns the raw ZIP bytes ready to be sent to the Push API.
func LoadSkillArtifact(artifactPath string) ([]byte, error) {
	data, err := content.ReadFile(artifactPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read skill artifact %s", artifactPath)
	}
	return data, nil
}

// LoadAgentYAML loads and parses an agent YAML file into a proto message.
// The agentPath should be relative to the seedpack root (e.g., "agents/skill-creator-agent.yaml").
// Returns the Agent proto ready to be sent to the Apply API.
func LoadAgentYAML(agentPath string) (*agentv1.Agent, error) {
	data, err := content.ReadFile(agentPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read agent YAML %s", agentPath)
	}

	return parseAgentYAML(data, agentPath)
}

// parseAgentYAML parses YAML content into an Agent proto message.
// This follows the same pattern as the CLI agent loader for consistency.
func parseAgentYAML(data []byte, sourcePath string) (*agentv1.Agent, error) {
	// Parse YAML to intermediate map
	var intermediate map[string]interface{}
	if err := yaml.Unmarshal(data, &intermediate); err != nil {
		return nil, errors.Wrapf(err, "failed to parse YAML from %s", sourcePath)
	}

	// Convert YAML map to JSON (protojson requires JSON input)
	jsonBytes, err := yamlMapToJSON(intermediate)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to convert YAML to JSON from %s", sourcePath)
	}

	// Use protojson to unmarshal into the proto message
	agent := &agentv1.Agent{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false, // Strict parsing - reject unknown fields
	}

	if err := unmarshaler.Unmarshal(jsonBytes, agent); err != nil {
		return nil, errors.Wrapf(err, "failed to parse Agent proto from %s", sourcePath)
	}

	return agent, nil
}

// yamlMapToJSON converts a YAML-parsed map to JSON bytes.
// This handles the map[interface{}]interface{} that YAML produces.
func yamlMapToJSON(m map[string]interface{}) ([]byte, error) {
	converted := convertYAMLValue(m)
	return json.Marshal(converted)
}

// convertYAMLValue recursively converts YAML values to JSON-compatible values.
// YAML sometimes produces map[interface{}]interface{} which JSON can't handle.
func convertYAMLValue(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{})
		for k, v := range val {
			result[k] = convertYAMLValue(v)
		}
		return result
	case map[interface{}]interface{}:
		// YAML sometimes produces map[interface{}]interface{}
		result := make(map[string]interface{})
		for k, v := range val {
			keyStr := fmt.Sprintf("%v", k)
			result[keyStr] = convertYAMLValue(v)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(val))
		for i, v := range val {
			result[i] = convertYAMLValue(v)
		}
		return result
	default:
		return val
	}
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
		return nil, fmt.Errorf("SKILL.md is missing required 'name' field in YAML frontmatter")
	}

	// Validate name format
	if !skillNamePattern.MatchString(metadata.Name) {
		return nil, fmt.Errorf("invalid skill name '%s' - must be kebab-case", metadata.Name)
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
		return "", fmt.Errorf("SKILL.md must start with YAML frontmatter (---)")
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
		return "", fmt.Errorf("SKILL.md has empty frontmatter")
	}

	return strings.Join(frontmatterLines, "\n"), nil
}
