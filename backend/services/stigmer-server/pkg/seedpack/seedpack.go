package seedpack

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/pkg/errors"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

// Manifest describes all skills, system agents, and MCP servers discovered in
// the embedded seedpack. Built dynamically by walking the embedded filesystem
// rather than parsed from a static file.
type Manifest struct {
	ContentHash  string
	Skills       []SkillEntry
	SystemAgents []AgentEntry
	McpServers   []McpServerEntry
}

// SkillEntry describes a skill discovered in the seedpack.
// ContentDigest is computed by hashing all files in the skill directory.
type SkillEntry struct {
	Name          string
	Path          string
	ContentDigest string
}

// AgentEntry describes a system agent discovered in the seedpack.
type AgentEntry struct {
	Name string
	Path string
}

// McpServerEntry describes an MCP server discovered in the seedpack.
type McpServerEntry struct {
	Name string
	Path string
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

// DiscoverManifest builds a Manifest by walking the embedded filesystem.
//
// Resources are discovered by convention:
//   - skills/{name}/SKILL.md    -> SkillEntry (name from directory name)
//   - agents/{name}.yaml        -> AgentEntry (name from metadata.name in YAML)
//   - mcp-servers/{name}.yaml   -> McpServerEntry (name from metadata.name in YAML)
//
// A content hash is computed over all discovered resource files for change detection.
// Any file change (add, modify, remove) produces a different hash.
func DiscoverManifest() (*Manifest, error) {
	skills, err := discoverSkills()
	if err != nil {
		return nil, errors.Wrap(err, "discover skills")
	}

	agents, err := discoverAgents()
	if err != nil {
		return nil, errors.Wrap(err, "discover agents")
	}

	mcpServers, err := discoverMcpServers()
	if err != nil {
		return nil, errors.Wrap(err, "discover MCP servers")
	}

	contentHash, err := computeSeedpackHash()
	if err != nil {
		return nil, errors.Wrap(err, "compute seedpack hash")
	}

	return &Manifest{
		ContentHash:  contentHash,
		Skills:       skills,
		SystemAgents: agents,
		McpServers:   mcpServers,
	}, nil
}

// discoverSkills walks skills/ for subdirectories containing SKILL.md.
func discoverSkills() ([]SkillEntry, error) {
	entries, err := content.ReadDir("skills")
	if err != nil {
		return nil, errors.Wrap(err, "read skills directory")
	}

	var skills []SkillEntry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		skillPath := path.Join("skills", entry.Name())

		if _, err := content.ReadFile(path.Join(skillPath, "SKILL.md")); err != nil {
			continue
		}

		digest, err := computeSkillDigest(skillPath)
		if err != nil {
			return nil, errors.Wrapf(err, "compute digest for skill %s", entry.Name())
		}

		skills = append(skills, SkillEntry{
			Name:          entry.Name(),
			Path:          skillPath,
			ContentDigest: digest,
		})
	}

	sort.Slice(skills, func(i, j int) bool {
		return skills[i].Name < skills[j].Name
	})

	return skills, nil
}

// discoverAgents walks agents/ for YAML files and extracts metadata.name.
func discoverAgents() ([]AgentEntry, error) {
	entries, err := content.ReadDir("agents")
	if err != nil {
		return nil, errors.Wrap(err, "read agents directory")
	}

	var agents []AgentEntry
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}

		agentPath := path.Join("agents", entry.Name())
		data, err := content.ReadFile(agentPath)
		if err != nil {
			return nil, errors.Wrapf(err, "read %s", agentPath)
		}

		name, err := extractYAMLMetadataName(data)
		if err != nil {
			return nil, errors.Wrapf(err, "extract name from %s", agentPath)
		}

		agents = append(agents, AgentEntry{
			Name: name,
			Path: agentPath,
		})
	}

	sort.Slice(agents, func(i, j int) bool {
		return agents[i].Name < agents[j].Name
	})

	return agents, nil
}

// discoverMcpServers walks mcp-servers/ for YAML files and extracts metadata.name.
func discoverMcpServers() ([]McpServerEntry, error) {
	entries, err := content.ReadDir("mcp-servers")
	if err != nil {
		return nil, errors.Wrap(err, "read mcp-servers directory")
	}

	var mcpServers []McpServerEntry
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".yaml") {
			continue
		}

		mcpPath := path.Join("mcp-servers", entry.Name())
		data, err := content.ReadFile(mcpPath)
		if err != nil {
			return nil, errors.Wrapf(err, "read %s", mcpPath)
		}

		name, err := extractYAMLMetadataName(data)
		if err != nil {
			return nil, errors.Wrapf(err, "extract name from %s", mcpPath)
		}

		mcpServers = append(mcpServers, McpServerEntry{
			Name: name,
			Path: mcpPath,
		})
	}

	sort.Slice(mcpServers, func(i, j int) bool {
		return mcpServers[i].Name < mcpServers[j].Name
	})

	return mcpServers, nil
}

// =============================================================================
// Content Hashing
// =============================================================================

// computeSkillDigest hashes all files in a skill directory to produce a
// deterministic content digest. Files are walked in lexical order (guaranteed
// by fs.WalkDir) and each file's relative path and content contribute to the hash.
func computeSkillDigest(skillPath string) (string, error) {
	h := sha256.New()

	err := fs.WalkDir(content, skillPath, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, readErr := content.ReadFile(p)
		if readErr != nil {
			return readErr
		}
		relPath := strings.TrimPrefix(p, skillPath+"/")
		h.Write([]byte(relPath))
		h.Write([]byte{0})
		h.Write(data)
		return nil
	})
	if err != nil {
		return "", errors.Wrapf(err, "walk skill directory %s", skillPath)
	}

	return "sha256:" + hex.EncodeToString(h.Sum(nil)), nil
}

// computeSeedpackHash computes a single deterministic hash over all embedded
// resource files. Walks skills/, agents/, and mcp-servers/ in lexical order.
// Used as the seedpack "version" for overall change detection during bootstrap.
func computeSeedpackHash() (string, error) {
	h := sha256.New()

	for _, dir := range []string{"skills", "agents", "mcp-servers"} {
		err := fs.WalkDir(content, dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			data, readErr := content.ReadFile(p)
			if readErr != nil {
				return readErr
			}
			h.Write([]byte(p))
			h.Write([]byte{0})
			h.Write(data)
			return nil
		})
		if err != nil {
			return "", errors.Wrapf(err, "walk %s", dir)
		}
	}

	return "sha256:" + hex.EncodeToString(h.Sum(nil))[:16], nil
}

// extractYAMLMetadataName does a lightweight YAML parse to extract just the
// metadata.name field, without requiring the full proto schema.
func extractYAMLMetadataName(data []byte) (string, error) {
	var doc struct {
		Metadata struct {
			Name string `yaml:"name"`
		} `yaml:"metadata"`
	}
	if err := yaml.Unmarshal(data, &doc); err != nil {
		return "", errors.Wrap(err, "parse YAML")
	}
	if doc.Metadata.Name == "" {
		return "", fmt.Errorf("missing metadata.name")
	}
	return doc.Metadata.Name, nil
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

// GetSkillByName looks up a skill by name in the discovered manifest.
// Returns nil if the skill is not found.
func GetSkillByName(name string) (*SkillEntry, error) {
	manifest, err := DiscoverManifest()
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

// GetAgentByName looks up a system agent by name in the discovered manifest.
// Returns nil if the agent is not found.
func GetAgentByName(name string) (*AgentEntry, error) {
	manifest, err := DiscoverManifest()
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

// GetMcpServerByName looks up an MCP server by name in the discovered manifest.
// Returns nil if the MCP server is not found.
func GetMcpServerByName(name string) (*McpServerEntry, error) {
	manifest, err := DiscoverManifest()
	if err != nil {
		return nil, err
	}

	for i := range manifest.McpServers {
		if manifest.McpServers[i].Name == name {
			return &manifest.McpServers[i], nil
		}
	}

	return nil, nil
}

// =============================================================================
// Bootstrap Functions
// =============================================================================

// CreateSkillZIP creates a ZIP archive from the embedded skill directory at runtime.
// The skillPath should be relative to the seedpack root (e.g., "skills/skill-creator").
// Returns the raw ZIP bytes ready to be sent to the Push API.
func CreateSkillZIP(skillPath string) ([]byte, error) {
	files, err := ListSkillFiles(skillPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to list files for %s", skillPath)
	}

	if len(files) == 0 {
		return nil, fmt.Errorf("no files found in skill directory %s", skillPath)
	}

	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	for _, filePath := range files {
		data, err := LoadSkillFile(skillPath, filePath)
		if err != nil {
			w.Close()
			return nil, errors.Wrapf(err, "failed to read %s/%s", skillPath, filePath)
		}

		f, err := w.Create(filePath)
		if err != nil {
			w.Close()
			return nil, errors.Wrapf(err, "failed to create zip entry for %s", filePath)
		}

		if _, err := f.Write(data); err != nil {
			w.Close()
			return nil, errors.Wrapf(err, "failed to write zip entry for %s", filePath)
		}
	}

	if err := w.Close(); err != nil {
		return nil, errors.Wrap(err, "failed to finalize zip archive")
	}

	return buf.Bytes(), nil
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

// LoadMcpServerYAML loads and parses an MCP server YAML file into a proto message.
// The mcpServerPath should be relative to the seedpack root (e.g., "mcp-servers/stigmer-mcp-server.yaml").
// Returns the McpServer proto ready to be sent to the Apply API.
func LoadMcpServerYAML(mcpServerPath string) (*mcpserverv1.McpServer, error) {
	data, err := content.ReadFile(mcpServerPath)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to read MCP server YAML %s", mcpServerPath)
	}

	return parseMcpServerYAML(data, mcpServerPath)
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

// parseMcpServerYAML parses YAML content into an McpServer proto message.
func parseMcpServerYAML(data []byte, sourcePath string) (*mcpserverv1.McpServer, error) {
	var intermediate map[string]interface{}
	if err := yaml.Unmarshal(data, &intermediate); err != nil {
		return nil, errors.Wrapf(err, "failed to parse YAML from %s", sourcePath)
	}

	jsonBytes, err := yamlMapToJSON(intermediate)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to convert YAML to JSON from %s", sourcePath)
	}

	mcpServer := &mcpserverv1.McpServer{}
	unmarshaler := protojson.UnmarshalOptions{
		DiscardUnknown: false,
	}

	if err := unmarshaler.Unmarshal(jsonBytes, mcpServer); err != nil {
		return nil, errors.Wrapf(err, "failed to parse McpServer proto from %s", sourcePath)
	}

	return mcpServer, nil
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
