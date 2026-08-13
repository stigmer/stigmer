// generator emits client-facing artifacts from the committed JSON schemas
// (tools/codegen/schemas, extracted from the protos by proto2schema).
//
// One binary, dispatched by --target:
//   - sdk-client / sdk-client-ts / sdk-client-python / sdk-client-java —
//     typed resource clients for the Go/TypeScript/Python/Java SDKs
//   - mcp-ts — apply-input modules for the TypeScript MCP server
//   - sdk-docs / task-docs — MDX reference documentation
//   - task-registry — task-kind-registry.json + JSON Schemas for the server
//   - docs-yaml-check — pass/fail validation of docs YAML blocks
//
// Usage:
//   go run ./tools/codegen/generator \
//     --schema-dir tools/codegen/schemas \
//     --output-dir <dir> \
//     --target <target>

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ============================================================================
// Schema Types
// ============================================================================

// TaskConfigSchema represents a workflow task configuration
type TaskConfigSchema struct {
	Name               string         `json:"name"`
	Kind               string         `json:"kind,omitempty"`
	Description        string         `json:"description"`
	ProtoType          string         `json:"protoType"`
	ProtoFile          string         `json:"protoFile"`
	DiscriminatorValue string         `json:"discriminatorValue,omitempty"`
	Fields             []*FieldSchema `json:"fields"`
}

// TypeSchema represents a shared type (e.g., HttpEndpoint)
type TypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
	Domain      string         // Extracted from proto namespace (e.g., "commons", "agentic")
}

// FieldSchema represents a field in a config or type
type FieldSchema struct {
	Name            string      `json:"name"`
	JsonName        string      `json:"jsonName"`
	ProtoField      string      `json:"protoField"`
	Type            TypeSpec    `json:"type"`
	Description     string      `json:"description"`
	Required        bool        `json:"required"`
	IsExpression    bool        `json:"isExpression,omitempty"`
	ReferenceKind   int32       `json:"referenceKind,omitempty"`
	DiscriminatedBy string      `json:"discriminatedBy,omitempty"`
	OneofGroup      string      `json:"oneofGroup,omitempty"`
	Validation      *Validation `json:"validation,omitempty"`
}

// TypeSpec describes the type of a field
type TypeSpec struct {
	Kind        string    `json:"kind"`                  // string, int32, uint32, int64, bool, float, double, bytes, map, array, message, struct, timestamp
	KeyType     *TypeSpec `json:"keyType,omitempty"`     // for map
	ValueType   *TypeSpec `json:"valueType,omitempty"`   // for map
	ElementType *TypeSpec `json:"elementType,omitempty"` // for array
	MessageType string    `json:"messageType,omitempty"` // for message
	EnumType    string    `json:"enumType,omitempty"`    // fully-qualified proto enum type
	EnumValues  []string  `json:"enumValues,omitempty"`  // valid enum value names (excludes UNSPECIFIED sentinel)
}

// Validation describes validation rules for a field
type Validation struct {
	Required  bool     `json:"required,omitempty"`
	MinLength int      `json:"minLength,omitempty"`
	MaxLength int      `json:"maxLength,omitempty"`
	Pattern   string   `json:"pattern,omitempty"`
	Min       int      `json:"min,omitempty"`
	Max       int      `json:"max,omitempty"`
	MinItems  int      `json:"minItems,omitempty"`
	MaxItems  int      `json:"maxItems,omitempty"`
	Enum      []string `json:"enum,omitempty"`
}

// ============================================================================
// Schema Loading
// ============================================================================

// expandStructConfig describes a struct field that should be expanded into
// typed discriminated-union fields based on external config schemas.
type expandStructConfig struct {
	structField        string              // proto field name of the google.protobuf.Struct to expand (e.g., "task_config")
	discriminatorField string              // proto field name of the kind/discriminator enum (e.g., "kind")
	configSchemaDir    string              // directory containing config schemas (e.g., "../tools/codegen/schemas/tasks")
	configs            []*TaskConfigSchema // loaded config schemas
	configTypes        []*TypeSchema       // loaded nested types from configs
	kindToEnum         map[string]string   // maps config Kind (e.g., "HTTP_CALL") → enum value (e.g., "http_call")
}

// Generator loads the JSON schemas of one schema directory for a target's
// emitters. mcp-ts constructs one per resource directory (e.g.
// schemas/agentic/agent) and hands the loaded collections to buildMcpGen.
type Generator struct {
	schemaDir   string
	outputDir   string
	packageName string

	// Loaded schemas. A resource spec JSON at the directory root (e.g.
	// agent.json) loads into taskConfigs; buildMcpGen promotes it into
	// resourceSpecs by shape.
	taskConfigs   []*TaskConfigSchema
	sharedTypes   []*TypeSchema
	resourceSpecs []*TaskConfigSchema // SDK resource specs (Agent, Skill, etc.) - reuses TaskConfigSchema

	expandStruct *expandStructConfig // optional: expand a Struct field into typed config fields
}

// NewGenerator creates a new schema-loading Generator
func NewGenerator(schemaDir, outputDir, packageName string) (*Generator, error) {
	g := &Generator{
		schemaDir:   schemaDir,
		outputDir:   outputDir,
		packageName: packageName,
	}

	// Load schemas
	if err := g.loadSchemas(); err != nil {
		return nil, fmt.Errorf("failed to load schemas: %w", err)
	}

	return g, nil
}

// extractDomainFromProtoType extracts domain from proto type namespace
// Examples:
//
//	"ai.stigmer.commons.apiresource.ApiResourceReference" -> "commons"
//	"ai.stigmer.agentic.agent.v1.McpServerDefinition" -> "agentic"
//	"ai.stigmer.agentic.skill.v1.SkillSpec" -> "agentic"
func extractDomainFromProtoType(protoType string) string {
	// Split proto namespace: ai.stigmer.<domain>.<rest>
	parts := strings.Split(protoType, ".")
	if len(parts) >= 3 && parts[0] == "ai" && parts[1] == "stigmer" {
		return parts[2] // "commons", "agentic", etc.
	}
	return "unknown"
}

// loadSchemas loads all JSON schemas from the schema directory:
// task/resource config JSONs from tasks/ (or the directory root when there is
// no tasks/ subdirectory), and shared types from types/ and tasks/types/.
func (g *Generator) loadSchemas() error {
	// Try loading from tasks/ subdirectory first
	tasksDir := filepath.Join(g.schemaDir, "tasks")
	if _, err := os.Stat(tasksDir); err == nil {
		entries, err := os.ReadDir(tasksDir)
		if err != nil {
			return fmt.Errorf("failed to read tasks directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(tasksDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load task config %s: %w", entry.Name(), err)
			}

			g.taskConfigs = append(g.taskConfigs, schema)
			fmt.Printf("  Loaded config: %s\n", schema.Name)
		}
	} else {
		// If no tasks/ subdirectory, load from root schema directory
		entries, err := os.ReadDir(g.schemaDir)
		if err != nil {
			return fmt.Errorf("failed to read schema directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(g.schemaDir, entry.Name())
			schema, err := loadTaskConfigSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load config %s: %w", entry.Name(), err)
			}

			g.taskConfigs = append(g.taskConfigs, schema)
			fmt.Printf("  Loaded config: %s\n", schema.Name)
		}
	}

	// Track loaded types to avoid duplicates
	loadedTypes := make(map[string]bool)

	// Load shared types from types/ directory (if exists)
	typesDir := filepath.Join(g.schemaDir, "types")
	if _, err := os.Stat(typesDir); err == nil {
		entries, err := os.ReadDir(typesDir)
		if err != nil {
			return fmt.Errorf("failed to read types directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(typesDir, entry.Name())
			schema, err := loadTypeSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load type %s: %w", entry.Name(), err)
			}

			// Skip duplicates
			if loadedTypes[schema.Name] {
				continue
			}
			loadedTypes[schema.Name] = true

			// Extract domain from proto namespace (data-driven, no hard-coding)
			schema.Domain = extractDomainFromProtoType(schema.ProtoType)
			fmt.Printf("  Loaded type: %s (domain: %s)\n", schema.Name, schema.Domain)

			g.sharedTypes = append(g.sharedTypes, schema)
		}
	}

	// Load workflow task types from tasks/types/ directory
	// These are types used by workflow task configs (e.g., AgentExecutionConfig, ForkBranch, etc.)
	tasksTypesDir := filepath.Join(g.schemaDir, "tasks", "types")
	if _, err := os.Stat(tasksTypesDir); err == nil {
		entries, err := os.ReadDir(tasksTypesDir)
		if err != nil {
			return fmt.Errorf("failed to read tasks/types directory: %w", err)
		}

		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}

			path := filepath.Join(tasksTypesDir, entry.Name())
			schema, err := loadTypeSchema(path)
			if err != nil {
				return fmt.Errorf("failed to load task type %s: %w", entry.Name(), err)
			}

			// Skip duplicates
			if loadedTypes[schema.Name] {
				continue
			}
			loadedTypes[schema.Name] = true

			// Extract domain from proto namespace - workflow task types go to "workflow" domain
			schema.Domain = extractDomainFromProtoType(schema.ProtoType)
			fmt.Printf("  Loaded task type: %s (domain: %s, from tasks/types/)\n", schema.Name, schema.Domain)

			g.sharedTypes = append(g.sharedTypes, schema)
		}
	}

	if len(g.taskConfigs) == 0 && len(g.sharedTypes) == 0 {
		return fmt.Errorf("no schemas found in %s", g.schemaDir)
	}

	return nil
}

// loadTaskConfigSchema loads a task config schema from a JSON file
func loadTaskConfigSchema(path string) (*TaskConfigSchema, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var schema TaskConfigSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, err
	}

	return &schema, nil
}

// loadTypeSchema loads a type schema from a JSON file
func loadTypeSchema(path string) (*TypeSchema, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var schema TypeSchema
	if err := json.Unmarshal(data, &schema); err != nil {
		return nil, err
	}

	return &schema, nil
}

// ============================================================================
// Shared proto-namespace helpers
// ============================================================================

// protoTypeToGoImportPath converts a proto type namespace to a Go import path
// using the given module prefix.
// Example with prefix "github.com/stigmer/stigmer/sdk/go/v3/proto":
//
//	"ai.stigmer.agentic.agent.v1.McpServerUsage" -> "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agent/v1"
func protoTypeToGoImportPath(protoType, prefix string) string {
	parts := strings.Split(protoType, ".")
	if len(parts) < 4 {
		return ""
	}

	pathParts := parts[:len(parts)-1]

	return prefix + "/" + strings.Join(pathParts, "/")
}

// protoTypeToPackageAlias returns a Go package alias for a proto type
// Example: "ai.stigmer.agentic.agent.v1.McpServerUsage" -> "agentv1"
// Example: "ai.stigmer.commons.apiresource.ApiResourceReference" -> "apiresource"
func protoTypeToPackageAlias(protoType string) string {
	parts := strings.Split(protoType, ".")
	if len(parts) < 4 {
		return ""
	}

	// Versioned packages: ... <subdomain> vN <TypeName>
	// e.g. ai.stigmer.iam.v1.IamRole (5 parts) or ai.stigmer.agentic.agent.v1.Type (6 parts)
	if len(parts) >= 5 && strings.HasPrefix(parts[len(parts)-2], "v") {
		subdomain := parts[len(parts)-3]
		version := parts[len(parts)-2]
		return subdomain + version
	}

	// For non-versioned packages (e.g., ai.stigmer.commons.apiresource.TypeName)
	return parts[len(parts)-2]
}

// sanitizeDescription sanitizes a description string for use in Go comments
// by replacing newlines with spaces and collapsing multiple spaces
func sanitizeDescription(desc string) string {
	// Replace newlines and carriage returns with spaces
	desc = strings.ReplaceAll(desc, "\n", " ")
	desc = strings.ReplaceAll(desc, "\r", " ")

	// Collapse multiple spaces into one
	for strings.Contains(desc, "  ") {
		desc = strings.ReplaceAll(desc, "  ", " ")
	}

	// Trim leading and trailing whitespace
	return strings.TrimSpace(desc)
}

// ============================================================================
// Schema Discovery
// ============================================================================

// satelliteDir holds schemas from a non-domain directory (e.g., tasks/).
type satelliteDir struct {
	path    string
	schemas []*TaskConfigSchema
	types   []*TypeSchema
}

// discoverDomains walks the schema root and returns domain/resource pairs.
// A domain directory contains subdirectories with {name}.json resource schemas.
// Non-domain directories (satellites) are returned separately.
func discoverDomains(schemaDir string) (domains []struct {
	name      string
	resources []string
}, satellites []string, err error) {
	entries, err := os.ReadDir(schemaDir)
	if err != nil {
		return nil, nil, fmt.Errorf("read schema dir: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirPath := filepath.Join(schemaDir, entry.Name())
		subs, err := os.ReadDir(dirPath)
		if err != nil {
			continue
		}

		var resources []string
		isDomain := false
		for _, sub := range subs {
			if !sub.IsDir() {
				continue
			}
			expected := filepath.Join(dirPath, sub.Name(), sub.Name()+".json")
			if _, err := os.Stat(expected); err == nil {
				resources = append(resources, sub.Name())
				isDomain = true
			}
		}

		if isDomain {
			sort.Strings(resources)
			domains = append(domains, struct {
				name      string
				resources []string
			}{name: entry.Name(), resources: resources})
		} else {
			satellites = append(satellites, dirPath)
		}
	}

	sort.Slice(domains, func(i, j int) bool { return domains[i].name < domains[j].name })
	return domains, satellites, nil
}

// indexSatellites loads schemas from satellite directories.
func indexSatellites(dirs []string) ([]*satelliteDir, error) {
	var result []*satelliteDir
	for _, dir := range dirs {
		sat := &satelliteDir{path: dir}
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil, fmt.Errorf("read satellite dir %s: %w", dir, err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			schema, err := loadTaskConfigSchema(filepath.Join(dir, entry.Name()))
			if err != nil {
				continue
			}
			sat.schemas = append(sat.schemas, schema)
		}

		typesDir := filepath.Join(dir, "types")
		if entries, err := os.ReadDir(typesDir); err == nil {
			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
					continue
				}
				ts, err := loadTypeSchema(filepath.Join(typesDir, entry.Name()))
				if err != nil {
					continue
				}
				sat.types = append(sat.types, ts)
			}
		}

		result = append(result, sat)
	}
	return result, nil
}

// detectExpandStructFromSchema inspects a generator's loaded schemas for
// the discriminated_by pattern and auto-configures expand-struct from
// matching satellite schemas.
func detectExpandStructFromSchema(gen *Generator, satellites []*satelliteDir) {
	for _, typ := range gen.sharedTypes {
		var structField, discriminatorField *FieldSchema
		for _, f := range typ.Fields {
			if f.DiscriminatedBy != "" {
				structField = f
			}
			if f.Type.Kind == "string" && len(f.Type.EnumValues) > 0 {
				discriminatorField = f
			}
		}
		if structField == nil || discriminatorField == nil {
			continue
		}

		if structField.DiscriminatedBy != discriminatorField.ProtoField {
			continue
		}

		enumSet := make(map[string]bool, len(discriminatorField.Type.EnumValues))
		for _, v := range discriminatorField.Type.EnumValues {
			enumSet[v] = true
		}

		for _, sat := range satellites {
			matchCount := 0
			for _, s := range sat.schemas {
				if s.DiscriminatorValue != "" && enumSet[s.DiscriminatorValue] {
					matchCount++
				}
			}
			if matchCount == 0 {
				continue
			}

			esc := &expandStructConfig{
				structField:        structField.ProtoField,
				discriminatorField: discriminatorField.ProtoField,
				configSchemaDir:    sat.path,
				configs:            sat.schemas,
				configTypes:        sat.types,
				kindToEnum:         make(map[string]string),
			}
			for _, s := range sat.schemas {
				if s.DiscriminatorValue != "" {
					esc.kindToEnum[s.Kind] = s.DiscriminatorValue
				}
			}
			gen.expandStruct = esc
			fmt.Printf("  Auto-detected expand-struct: %s discriminated by %s (%d variants from %s)\n",
				structField.ProtoField, discriminatorField.ProtoField,
				matchCount, filepath.Base(sat.path))
			return
		}
	}
}

// ============================================================================
// Main
// ============================================================================

func main() {
	schemaDir := flag.String("schema-dir", "tools/codegen/schemas", "Directory containing JSON schemas")
	outputDir := flag.String("output-dir", "", "Output directory for generated code")
	target := flag.String("target", "", "Generation target: sdk-client, sdk-client-ts, sdk-client-python, sdk-client-java, mcp-ts, sdk-docs, task-registry, task-docs, or docs-yaml-check")
	metaDir := flag.String("meta-dir", "", "Directory containing sidecar YAML metadata (used by the task-registry and task-docs targets)")
	apisDir := flag.String("apis-dir", "", "Root directory of proto API definitions (used by sdk-docs for overview.md loading and by task-docs for the index enrichment template)")
	docsDir := flag.String("docs-dir", "", "Root directory of the documentation tree (used by the docs-yaml-check target)")
	rules := flag.String("rules", "off", "Protovalidate rule evaluation for docs-yaml-check: off, report (print findings, never fail), or enforce (findings fail the gate)")
	flag.Parse()

	// docs-yaml-check is a pass/fail validator over the docs tree: it reads
	// no schemas and emits no files, so it has its own flag contract and
	// returns before the generation-complete banner below.
	if *target == "docs-yaml-check" {
		if *docsDir == "" {
			fmt.Println("--docs-dir is required for --target=docs-yaml-check")
			os.Exit(1)
		}
		ruleMode, err := parseDocsYamlRuleMode(*rules)
		if err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
		if err := runDocsYamlCheck(*docsDir, ruleMode); err != nil {
			fmt.Printf("Error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	if *schemaDir == "" || *outputDir == "" {
		fmt.Println("Usage: generator --schema-dir <dir> --output-dir <dir> --target <target>")
		os.Exit(1)
	}

	switch *target {
	case "sdk-client":
		if err := runSDKClientGeneration(*schemaDir, *outputDir); err != nil {
			fmt.Printf("Error in SDK client generation: %v\n", err)
			os.Exit(1)
		}
	case "mcp-ts":
		if err := runMCPTSGeneration(*schemaDir, *outputDir); err != nil {
			fmt.Printf("Error in TypeScript MCP generation: %v\n", err)
			os.Exit(1)
		}
	case "sdk-client-ts":
		if err := runSDKClientTSGeneration(*schemaDir, *outputDir); err != nil {
			fmt.Printf("Error in TypeScript SDK client generation: %v\n", err)
			os.Exit(1)
		}
	case "sdk-client-python":
		if err := runSDKClientPythonGeneration(*schemaDir, *outputDir); err != nil {
			fmt.Printf("Error in Python SDK client generation: %v\n", err)
			os.Exit(1)
		}
	case "sdk-client-java":
		if err := runSDKClientJavaGeneration(*schemaDir, *outputDir); err != nil {
			fmt.Printf("Error in Java SDK client generation: %v\n", err)
			os.Exit(1)
		}
	case "sdk-docs":
		if err := runSDKDocsGeneration(*schemaDir, *outputDir, *apisDir); err != nil {
			fmt.Printf("Error in SDK docs generation: %v\n", err)
			os.Exit(1)
		}
	case "task-registry":
		if *metaDir == "" {
			fmt.Println("--meta-dir is required for --target=task-registry")
			os.Exit(1)
		}
		if err := runTaskRegistryGeneration(*schemaDir, *outputDir, *metaDir); err != nil {
			fmt.Printf("Error in task registry generation: %v\n", err)
			os.Exit(1)
		}
	case "task-docs":
		if *metaDir == "" {
			fmt.Println("--meta-dir is required for --target=task-docs")
			os.Exit(1)
		}
		if *apisDir == "" {
			fmt.Println("--apis-dir is required for --target=task-docs (index enrichment template)")
			os.Exit(1)
		}
		if err := runTaskDocsGeneration(*schemaDir, *outputDir, *metaDir, *apisDir); err != nil {
			fmt.Printf("Error in task docs generation: %v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Printf("Unknown --target %q: expected sdk-client, sdk-client-ts, sdk-client-python, sdk-client-java, mcp-ts, sdk-docs, task-registry, task-docs, or docs-yaml-check\n", *target)
		os.Exit(1)
	}

	fmt.Println("\n✅ Code generation complete!")
}
