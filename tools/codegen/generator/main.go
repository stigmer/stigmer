// generator converts JSON schemas to Go code for the Stigmer SDK.
//
// This tool reads JSON schema files and generates:
// - Config structs for workflow tasks
// - Builder functions for creating tasks
// - ToProto/FromProto conversion methods
//
// Usage:
//   go run tools/codegen/generator/main.go \
//     --schema-dir tools/codegen/schemas \
//     --output-dir sdk/go/workflow/gen \
//     --package gen

package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"go/format"
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
// Generator
// ============================================================================

// expandStructConfig describes a struct field that should be expanded into
// typed discriminated-union fields based on external config schemas.
// Format: structField:discriminatorField:configSchemaDir
type expandStructConfig struct {
	structField        string              // proto field name of the google.protobuf.Struct to expand (e.g., "task_config")
	discriminatorField string              // proto field name of the kind/discriminator enum (e.g., "kind")
	configSchemaDir    string              // directory containing config schemas (e.g., "../tools/codegen/schemas/tasks")
	configs            []*TaskConfigSchema // loaded config schemas
	configTypes        []*TypeSchema       // loaded nested types from configs
	kindToEnum         map[string]string   // maps config Kind (e.g., "HTTP_CALL") → enum value (e.g., "http_call")
}

// Generator generates Go code from JSON schemas
type Generator struct {
	schemaDir   string
	outputDir   string
	packageName string
	fileSuffix  string

	// Loaded schemas
	taskConfigs   []*TaskConfigSchema
	sharedTypes   []*TypeSchema
	resourceSpecs []*TaskConfigSchema // SDK resource specs (Agent, Skill, etc.) - reuses TaskConfigSchema

	expandStruct *expandStructConfig // optional: expand a Struct field into typed config fields
}

// NewGenerator creates a new code generator
func NewGenerator(schemaDir, outputDir, packageName, fileSuffix string) (*Generator, error) {
	g := &Generator{
		schemaDir:   schemaDir,
		outputDir:   outputDir,
		packageName: packageName,
		fileSuffix:  fileSuffix,
	}

	// Load schemas
	if err := g.loadSchemas(); err != nil {
		return nil, fmt.Errorf("failed to load schemas: %w", err)
	}

	return g, nil
}

// Generate generates all Go code
func (g *Generator) Generate() error {
	// Create output directory
	if err := os.MkdirAll(g.outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Generate helpers file first
	fmt.Printf("\nGenerating helpers...\n")
	if err := g.generateHelpers(); err != nil {
		return fmt.Errorf("failed to generate helpers: %w", err)
	}

	// Generate shared types
	if len(g.sharedTypes) > 0 {
		fmt.Printf("\nGenerating shared types...\n")
		if err := g.generateSharedTypes(); err != nil {
			return fmt.Errorf("failed to generate shared types: %w", err)
		}
	}

	// Generate task files (one file per task)
	fmt.Printf("\nGenerating task configs...\n")
	for _, taskConfig := range g.taskConfigs {
		if err := g.generateTaskFile(taskConfig); err != nil {
			return fmt.Errorf("failed to generate task %s: %w", taskConfig.Name, err)
		}
	}

	// Generate SDK resource args structs (Agent, Skill, etc.)
	if len(g.resourceSpecs) > 0 {
		fmt.Printf("\nGenerating SDK resource args structs...\n")

		for _, resourceSpec := range g.resourceSpecs {
			if err := g.generateResourceArgsFile(resourceSpec); err != nil {
				return fmt.Errorf("failed to generate resource args for %s: %w", resourceSpec.Name, err)
			}
		}
	}

	return nil
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

// extractSubdomainFromProtoFile extracts subdomain from proto file path
// Examples:
//
//	"apis/ai/stigmer/agentic/agent/v1/spec.proto" -> "agent"
//	"apis/ai/stigmer/agentic/skill/v1/spec.proto" -> "skill"
//	"apis/ai/stigmer/iam/apikey/v1/spec.proto" -> "apikey"
//	"apis/ai/stigmer/tenancy/organization/v1/spec.proto" -> "organization"
//	"apis/ai/stigmer/commons/apiresource/io.proto" -> ""
func extractSubdomainFromProtoFile(protoFile string) string {
	// Pattern: apis/ai/stigmer/<domain>/<subdomain>/v<version>/...
	parts := strings.Split(protoFile, "/")
	if len(parts) >= 6 && parts[0] == "apis" && parts[1] == "ai" && parts[2] == "stigmer" {
		domain := parts[3] // "agentic", "iam", "tenancy", "commons"

		// Skip commons - no subdomain concept, types go to gen/types/
		if domain == "commons" {
			return ""
		}

		// For all other domains (agentic, iam, tenancy), parts[4] is the resource subdomain
		// e.g., agentic/agent, iam/apikey, tenancy/organization
		return parts[4]
	}
	return ""
}

// getOutputDir returns the appropriate output directory for a given schema
func (g *Generator) getOutputDir(schema *TaskConfigSchema) string {
	// Extract subdomain from proto file path (data-driven)
	subdomain := extractSubdomainFromProtoFile(schema.ProtoFile)

	if subdomain != "" {
		// Generate to sdk/go/gen/<subdomain>/ (e.g., sdk/go/gen/agent/, sdk/go/gen/skill/)
		return filepath.Join("sdk", "go", "gen", subdomain)
	}

	// Default: use configured output directory (gen/workflow for tasks)
	return g.outputDir
}

// getPackageName returns the appropriate package name for a given schema
func (g *Generator) getPackageName(schema *TaskConfigSchema) string {
	// Determine package name from output directory
	outputDir := g.getOutputDir(schema)

	// Extract last path component as package name
	parts := strings.Split(outputDir, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}

	return g.packageName
}

// loadSchemas loads all JSON schemas from the schema directory
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

	// Load SDK resource specs and types from namespace directories
	// Schema directory structure:
	//   schemas/
	//     tasks/              <- workflow task configs (handled above)
	//     types/              <- workflow task types (handled above)
	//     agentic/            <- namespace directory
	//       agent/            <- resource directory
	//         agent.json      <- resource spec
	//         types/          <- resource-specific types
	//           subagent.json
	//       skill/
	//         skill.json
	//       workflow/
	//         workflow.json
	//     iam/                <- another namespace
	//       apikey/
	//         apikey.json
	if schemaEntries, err := os.ReadDir(g.schemaDir); err == nil {
		for _, schemaEntry := range schemaEntries {
			// Skip non-directories and special directories
			if !schemaEntry.IsDir() {
				continue
			}

			topLevelName := schemaEntry.Name()

			// Skip known non-resource directories (workflow tasks handled separately)
			if topLevelName == "tasks" || topLevelName == "types" {
				continue
			}

			topLevelDir := filepath.Join(g.schemaDir, topLevelName)

			// Check if this is a namespace directory (contains subdirectories with JSON files)
			// or a resource directory (contains JSON files directly)
			subEntries, err := os.ReadDir(topLevelDir)
			if err != nil {
				continue
			}

			// Determine if this is a namespace or resource directory
			isNamespaceDir := false
			for _, subEntry := range subEntries {
				if subEntry.IsDir() && subEntry.Name() != "types" {
					// Has subdirectories other than types/ - this is a namespace
					isNamespaceDir = true
					break
				}
			}

			if isNamespaceDir {
				// This is a namespace directory (e.g., agentic/, iam/)
				// Iterate over resource directories within the namespace
				for _, resourceEntry := range subEntries {
					if !resourceEntry.IsDir() {
						continue
					}

					resourceName := resourceEntry.Name()
					resourceDir := filepath.Join(topLevelDir, resourceName)

					// Load from this resource directory
					g.loadResourceDir(resourceDir, topLevelName+"/"+resourceName, loadedTypes)
				}
			} else {
				// This is a resource directory directly (backward compatibility)
				g.loadResourceDir(topLevelDir, topLevelName, loadedTypes)
			}
		}
	}

	if len(g.taskConfigs) == 0 && len(g.sharedTypes) == 0 && len(g.resourceSpecs) == 0 {
		return fmt.Errorf("no schemas found in %s", g.schemaDir)
	}

	return nil
}

// loadResourceDir loads specs and types from a resource directory.
// resourceDir is the absolute path, displayPath is for logging (e.g., "agentic/agent").
func (g *Generator) loadResourceDir(resourceDir, displayPath string, loadedTypes map[string]bool) {
	entries, err := os.ReadDir(resourceDir)
	if err != nil {
		return
	}

	for _, entry := range entries {
		// Check if this is a types/ subdirectory
		if entry.IsDir() && entry.Name() == "types" {
			// Load types from <resource>/types/ directory
			typesDir := filepath.Join(resourceDir, "types")
			typeEntries, err := os.ReadDir(typesDir)
			if err != nil {
				continue
			}

			for _, typeEntry := range typeEntries {
				if typeEntry.IsDir() || !strings.HasSuffix(typeEntry.Name(), ".json") {
					continue
				}

				path := filepath.Join(typesDir, typeEntry.Name())
				schema, err := loadTypeSchema(path)
				if err != nil {
					fmt.Printf("  Warning: failed to load type %s: %v\n", typeEntry.Name(), err)
					continue
				}

				// Skip duplicates
				if loadedTypes[schema.Name] {
					continue
				}
				loadedTypes[schema.Name] = true

				// Extract domain from proto namespace (data-driven, no hard-coding)
				schema.Domain = extractDomainFromProtoType(schema.ProtoType)
				fmt.Printf("  Loaded type: %s (domain: %s, from %s/types/)\n", schema.Name, schema.Domain, displayPath)

				g.sharedTypes = append(g.sharedTypes, schema)
			}
			continue
		}

		// Skip other subdirectories and non-JSON files
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(resourceDir, entry.Name())
		schema, err := loadTaskConfigSchema(path)
		if err != nil {
			fmt.Printf("  Warning: failed to load spec %s: %v\n", entry.Name(), err)
			continue
		}

		g.resourceSpecs = append(g.resourceSpecs, schema)
		fmt.Printf("  Loaded spec: %s (from %s/)\n", schema.Name, displayPath)
	}
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

// parseExpandStruct parses the --expand-struct flag value and loads config
// schemas and their types from the specified directory.
func (g *Generator) parseExpandStruct(value string) error {
	parts := strings.SplitN(value, ":", 3)
	if len(parts) != 3 {
		return fmt.Errorf("expected format struct_field:discriminator_field:config_schema_dir, got %q", value)
	}

	esc := &expandStructConfig{
		structField:        parts[0],
		discriminatorField: parts[1],
		configSchemaDir:    parts[2],
	}

	entries, err := os.ReadDir(esc.configSchemaDir)
	if err != nil {
		return fmt.Errorf("read config schema dir %s: %w", esc.configSchemaDir, err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		schema, err := loadTaskConfigSchema(filepath.Join(esc.configSchemaDir, entry.Name()))
		if err != nil {
			return fmt.Errorf("load config schema %s: %w", entry.Name(), err)
		}
		esc.configs = append(esc.configs, schema)
		fmt.Printf("  Loaded expand-struct config: %s (kind=%s)\n", schema.Name, schema.Kind)
	}

	typesDir := filepath.Join(esc.configSchemaDir, "types")
	if entries, err := os.ReadDir(typesDir); err == nil {
		loadedTypes := make(map[string]bool)
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			ts, err := loadTypeSchema(filepath.Join(typesDir, entry.Name()))
			if err != nil {
				return fmt.Errorf("load config type %s: %w", entry.Name(), err)
			}
			if loadedTypes[ts.Name] {
				continue
			}
			loadedTypes[ts.Name] = true
			esc.configTypes = append(esc.configTypes, ts)
		}
	}

	esc.kindToEnum = buildKindToEnumMap(esc.configs, esc.configTypes, esc.discriminatorField)

	g.expandStruct = esc
	return nil
}

// buildKindToEnumMap builds a mapping from config schema Kind (e.g., "HTTP_CALL")
// to the actual proto enum value name (e.g., "http_call") using word-set matching.
func buildKindToEnumMap(configs []*TaskConfigSchema, types []*TypeSchema, discriminatorField string) map[string]string {
	var enumValues []string
	for _, ts := range types {
		for _, f := range ts.Fields {
			if f.ProtoField == discriminatorField && len(f.Type.EnumValues) > 0 {
				enumValues = f.Type.EnumValues
				break
			}
		}
		if len(enumValues) > 0 {
			break
		}
	}

	result := make(map[string]string, len(configs))
	for _, cfg := range configs {
		if ev := matchEnumValue(cfg.Kind, enumValues); ev != "" {
			result[cfg.Kind] = ev
			fmt.Printf("    Mapped config %s → enum %s\n", cfg.Kind, ev)
		}
	}
	return result
}

// matchEnumValue finds the enum value matching a config Kind by word-set comparison.
// Config Kind words must be a subset of (or equal to) the enum value's words.
func matchEnumValue(configKind string, enumValues []string) string {
	configWords := strings.Split(configKind, "_")

	var bestMatch string
	bestDiff := -1

	for _, ev := range enumValues {
		evUpper := strings.ToUpper(ev)
		evWords := strings.Split(evUpper, "_")

		if isWordSubset(configWords, evWords) {
			diff := len(evWords) - len(configWords)
			if bestDiff < 0 || diff < bestDiff {
				bestMatch = ev
				bestDiff = diff
			}
		}
	}
	return bestMatch
}

func isWordSubset(subset, superset []string) bool {
	set := make(map[string]bool, len(superset))
	for _, w := range superset {
		set[w] = true
	}
	for _, w := range subset {
		if !set[w] {
			return false
		}
	}
	return true
}

// generateHelpers generates a helpers.go file with utility functions
func (g *Generator) generateHelpers() error {
	var buf bytes.Buffer

	// File header
	fmt.Fprintf(&buf, "// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Import reflect and fmt
	fmt.Fprintf(&buf, "import (\n")
	fmt.Fprintf(&buf, "\t\"fmt\"\n")
	fmt.Fprintf(&buf, "\t\"reflect\"\n")
	fmt.Fprintf(&buf, ")\n\n")

	// isEmpty function
	fmt.Fprintf(&buf, "// isEmpty checks if a value is empty/zero.\n")
	fmt.Fprintf(&buf, "// Used by ToProto methods to skip optional fields.\n")
	fmt.Fprintf(&buf, "func isEmpty(v interface{}) bool {\n")
	fmt.Fprintf(&buf, "\tif v == nil {\n")
	fmt.Fprintf(&buf, "\t\treturn true\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\tval := reflect.ValueOf(v)\n")
	fmt.Fprintf(&buf, "\treturn val.IsZero()\n")
	fmt.Fprintf(&buf, "}\n\n")

	// coerceToString function for expression support
	fmt.Fprintf(&buf, "// coerceToString converts various types to strings for expression support.\n")
	fmt.Fprintf(&buf, "// Used by option functions to accept both string literals and expressions.\n")
	fmt.Fprintf(&buf, "func coerceToString(value interface{}) string {\n")
	fmt.Fprintf(&buf, "\tif s, ok := value.(string); ok {\n")
	fmt.Fprintf(&buf, "\t\treturn s\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\t// NOTE: *Task handling omitted to avoid circular dependency between gen/workflow and workflow packages.\n")
	fmt.Fprintf(&buf, "\t// Task-to-expression conversion is handled in the hand-written workflow package helpers.\n")
	fmt.Fprintf(&buf, "\t// Handle StringRef - use Value() for resolved literals, Expression() for computed\n")
	fmt.Fprintf(&buf, "\tif sr, ok := value.(interface{ Value() string; Expression() string }); ok {\n")
	fmt.Fprintf(&buf, "\t\t// Try Value() first (for resolved StringRef from Concat, etc.)\n")
	fmt.Fprintf(&buf, "\t\tif v := sr.Value(); v != \"\" {\n")
	fmt.Fprintf(&buf, "\t\t\treturn v\n")
	fmt.Fprintf(&buf, "\t\t}\n")
	fmt.Fprintf(&buf, "\t\t// Fall back to Expression() for computed/context refs\n")
	fmt.Fprintf(&buf, "\t\treturn sr.Expression()\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\t// Handle TaskFieldRef and other expression types\n")
	fmt.Fprintf(&buf, "\tif expr, ok := value.(interface{ Expression() string }); ok {\n")
	fmt.Fprintf(&buf, "\t\treturn expr.Expression()\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\treturn fmt.Sprintf(\"%%v\", value)\n")
	fmt.Fprintf(&buf, "}\n")

	// Format and write
	fmt.Printf("  Generating helpers.go...\n")
	return g.writeFormattedFile("helpers.go", buf.Bytes())
}

// generateSharedTypes generates a types.go file with all shared types
func (g *Generator) generateSharedTypes() error {
	// Group types by domain
	typesByDomain := make(map[string][]*TypeSchema)
	for _, typeSchema := range g.sharedTypes {
		domain := typeSchema.Domain
		if domain == "" {
			domain = "commons" // default
		}
		typesByDomain[domain] = append(typesByDomain[domain], typeSchema)
	}

	// Generate a separate file for each domain
	for domain, types := range typesByDomain {
		if err := g.generateTypesForDomain(domain, types); err != nil {
			return fmt.Errorf("failed to generate %s types: %w", domain, err)
		}
	}

	return nil
}

// generateTypesForDomain generates types for a specific domain
func (g *Generator) generateTypesForDomain(domain string, types []*TypeSchema) error {
	ctx := newGenContext("types") // Always use "types" package

	var buf bytes.Buffer

	// Generate package declaration
	fmt.Fprintf(&buf, "package types\n\n")

	// Generate each type in this domain
	for _, typeSchema := range types {
		if err := ctx.genTypeStruct(&buf, typeSchema); err != nil {
			return err
		}

		// Generate FromProto method for shared types
		if err := ctx.genTypeFromProtoMethod(&buf, typeSchema); err != nil {
			return err
		}
	}

	// Add imports at the beginning
	var finalBuf bytes.Buffer
	filename := fmt.Sprintf("%s_types.go", domain)
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n\n", filename))
	finalBuf.WriteString(fmt.Sprintf("package types\n\n"))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package types\n\n"):])

	// Write to sdk/go/gen/types/ directory
	typesOutputDir := "sdk/go/gen/types"
	if err := os.MkdirAll(typesOutputDir, 0755); err != nil {
		return fmt.Errorf("failed to create types directory: %w", err)
	}

	outputPath := filepath.Join(typesOutputDir, filename)

	// Format code
	formatted, err := format.Source(finalBuf.Bytes())
	if err != nil {
		return fmt.Errorf("failed to format %s: %w", filename, err)
	}

	// Write file
	if err := os.WriteFile(outputPath, formatted, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", filename, err)
	}

	fmt.Printf("  Generated %s (%d types)\n", filename, len(types))
	return nil
}

// generateTaskFile generates a single file for a task config
func (g *Generator) generateTaskFile(taskConfig *TaskConfigSchema) error {
	// Collect shared type names
	sharedTypeNames := make([]string, 0, len(g.sharedTypes))
	for _, t := range g.sharedTypes {
		sharedTypeNames = append(sharedTypeNames, t.Name)
	}

	ctx := newGenContextWithSharedTypes(g.packageName, sharedTypeNames)

	var buf bytes.Buffer

	// Generate package and imports
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate config struct
	if err := ctx.genConfigStruct(&buf, taskConfig); err != nil {
		return err
	}

	// Generate ToProto method
	if err := ctx.genToProtoMethod(&buf, taskConfig); err != nil {
		return err
	}

	// Generate FromProto method
	if err := ctx.genFromProtoMethod(&buf, taskConfig); err != nil {
		return err
	}

	// TODO: Generate Args structs for workflow tasks (after SDK resources are stable)

	// Add imports at the beginning (after package declaration)
	var finalBuf bytes.Buffer
	baseName := strings.ToLower(strings.ReplaceAll(taskConfig.Name, "Spec", "spec"))
	baseName = strings.ToLower(strings.ReplaceAll(baseName, "Config", "config"))
	filename := fmt.Sprintf("%s%s.go", toSnakeCase(baseName), g.fileSuffix)
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n\n", filename))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", g.packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+g.packageName+"\n\n"):])

	// Format and write
	fmt.Printf("  Generating %s...\n", filename)
	return g.writeFormattedFile(filename, finalBuf.Bytes())
}

// generateResourceArgsFile generates Args struct for an SDK resource spec (Pulumi pattern)
func (g *Generator) generateResourceArgsFile(resourceSpec *TaskConfigSchema) error {
	// Determine package name dynamically from proto file path
	packageName := g.getPackageName(resourceSpec)

	// Create context that uses proto stubs types for resource Args
	ctx := newGenContextForResourceArgs(packageName, g.sharedTypes)

	var buf bytes.Buffer

	// Generate package declaration
	fmt.Fprintf(&buf, "package %s\n\n", packageName)

	// Generate Args struct (Pulumi pattern)
	if err := ctx.genArgsStruct(&buf, resourceSpec); err != nil {
		return err
	}

	// Add imports at the beginning (after package declaration)
	var finalBuf bytes.Buffer
	baseName := strings.ToLower(strings.ReplaceAll(resourceSpec.Name, "Spec", "spec"))
	filename := fmt.Sprintf("%s_args.go", toSnakeCase(baseName))
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n\n", filename))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+packageName+"\n\n"):])

	// Format and write
	outputDir := g.getOutputDir(resourceSpec)
	fmt.Printf("  Generating %s/%s...\n", outputDir, filename)
	return g.writeFormattedFileToDir(outputDir, filename, finalBuf.Bytes())
}

// writeFormattedFile formats Go code and writes it to a file
func (g *Generator) writeFormattedFile(filename string, code []byte) error {
	return g.writeFormattedFileToDir(g.outputDir, filename, code)
}

// writeFormattedFileToDir formats Go code and writes it to a file in a specific directory
func (g *Generator) writeFormattedFileToDir(outputDir, filename string, code []byte) error {
	// Format with gofmt
	formatted, err := format.Source(code)
	if err != nil {
		// Print the code for debugging
		fmt.Printf("\n=== UNFORMATTED CODE (contains errors) ===\n%s\n", string(code))
		return fmt.Errorf("failed to format %s: %w", filename, err)
	}

	// Create output directory if it doesn't exist
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", outputDir, err)
	}

	// Write to file
	outputPath := filepath.Join(outputDir, filename)
	if err := os.WriteFile(outputPath, formatted, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", filename, err)
	}

	return nil
}

// ============================================================================
// Generation Context
// ============================================================================

// protoStubInfo holds information for mapping message types to proto stubs
type protoStubInfo struct {
	importPath   string // Full Go import path
	packageAlias string // Go package alias to use in generated code
	typeName     string // Type name in the proto stubs package
}

// genContext holds state during code generation
type genContext struct {
	packageName    string
	imports        map[string]struct{}
	generated      map[string]struct{}
	sharedTypes    map[string]struct{}    // Set of shared type names (from types package)
	protoStubTypes map[string]*TypeSchema // Map of message type name to its schema (for proto stubs lookup)
	useProtoStubs  bool                   // Whether to use proto stubs types instead of gen/types
}

// newGenContext creates a new generation context
func newGenContext(packageName string) *genContext {
	return &genContext{
		packageName:    packageName,
		imports:        make(map[string]struct{}),
		generated:      make(map[string]struct{}),
		sharedTypes:    make(map[string]struct{}),
		protoStubTypes: make(map[string]*TypeSchema),
		useProtoStubs:  false,
	}
}

// newGenContextWithSharedTypes creates a context aware of shared types
func newGenContextWithSharedTypes(packageName string, sharedTypeNames []string) *genContext {
	ctx := newGenContext(packageName)
	for _, typeName := range sharedTypeNames {
		ctx.sharedTypes[typeName] = struct{}{}
	}
	return ctx
}

// newGenContextForResourceArgs creates a context for generating resource Args structs
// that uses proto stubs types directly instead of gen/types package
func newGenContextForResourceArgs(packageName string, sharedTypes []*TypeSchema) *genContext {
	ctx := newGenContext(packageName)
	ctx.useProtoStubs = true
	for _, typeSchema := range sharedTypes {
		ctx.sharedTypes[typeSchema.Name] = struct{}{}
		ctx.protoStubTypes[typeSchema.Name] = typeSchema
	}
	return ctx
}

const sdkProtoPrefix = "github.com/stigmer/stigmer/sdk/go/v3/proto"

// protoTypeToGoImportPath converts a proto type namespace to a Go import path
// using the given module prefix.
// Example with sdkProtoPrefix:
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

// addImport adds an import to the context
func (c *genContext) addImport(pkg string) {
	c.imports[pkg] = struct{}{}
}

// addImportWithAlias adds an import with a specific alias to the context
// The alias is stored by prefixing "alias:" to the import path
func (c *genContext) addImportWithAlias(pkg, alias string) {
	c.imports[alias+":"+pkg] = struct{}{}
}

// genImports generates the import block
func (c *genContext) genImports(w *bytes.Buffer) {
	if len(c.imports) == 0 {
		return
	}

	// Separate aliased and non-aliased imports
	type importEntry struct {
		alias string
		path  string
	}
	var entries []importEntry

	for imp := range c.imports {
		if strings.Contains(imp, ":") {
			// Aliased import: "alias:path"
			parts := strings.SplitN(imp, ":", 2)
			entries = append(entries, importEntry{alias: parts[0], path: parts[1]})
		} else {
			// Regular import
			entries = append(entries, importEntry{alias: "", path: imp})
		}
	}

	// Sort imports for deterministic output (by path)
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].path < entries[j].path
	})

	// Write import block
	fmt.Fprintf(w, "import (\n")
	for _, entry := range entries {
		if entry.alias != "" {
			fmt.Fprintf(w, "\t%s \"%s\"\n", entry.alias, entry.path)
		} else {
			fmt.Fprintf(w, "\t\"%s\"\n", entry.path)
		}
	}
	fmt.Fprintf(w, ")\n\n")
}

// wellKnownProtoType returns the Go type for well-known protobuf types
// Returns empty string if not a well-known type
func (c *genContext) wellKnownProtoType(messageType string) string {
	switch messageType {
	case "Timestamp":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		return "*timestamppb.Timestamp"
	case "Duration":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/durationpb", "durationpb")
		return "*durationpb.Duration"
	case "Any":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/anypb", "anypb")
		return "*anypb.Any"
	case "Empty":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/emptypb", "emptypb")
		return "*emptypb.Empty"
	case "FieldMask":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/fieldmaskpb", "fieldmaskpb")
		return "*fieldmaskpb.FieldMask"
	case "Value", "ListValue", "NullValue":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/structpb", "structpb")
		return "*structpb." + messageType
	case "BoolValue", "Int32Value", "Int64Value", "UInt32Value", "UInt64Value",
		"FloatValue", "DoubleValue", "StringValue", "BytesValue":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/wrapperspb", "wrapperspb")
		return "*wrapperspb." + messageType
	default:
		return ""
	}
}

// isWellKnownProtoType checks if a message type is a well-known protobuf type
func (c *genContext) isWellKnownProtoType(messageType string) bool {
	switch messageType {
	case "Timestamp", "Duration", "Any", "Empty", "FieldMask",
		"Value", "ListValue", "NullValue",
		"BoolValue", "Int32Value", "Int64Value", "UInt32Value", "UInt64Value",
		"FloatValue", "DoubleValue", "StringValue", "BytesValue":
		return true
	default:
		return false
	}
}

// genWellKnownTypeFromProto generates FromProto conversion code for well-known proto types
func (c *genContext) genWellKnownTypeFromProto(w *bytes.Buffer, field *FieldSchema) {
	switch field.Type.MessageType {
	case "Timestamp":
		// Timestamps in structpb are typically RFC 3339 strings
		// Parse them directly into timestamppb.Timestamp
		c.addImportWithAlias("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		c.addImport("time")
		fmt.Fprintf(w, "\t\t// Parse timestamp from RFC 3339 string or struct with seconds/nanos\n")
		fmt.Fprintf(w, "\t\tif strVal := val.GetStringValue(); strVal != \"\" {\n")
		fmt.Fprintf(w, "\t\t\tt, err := time.Parse(time.RFC3339Nano, strVal)\n")
		fmt.Fprintf(w, "\t\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\t\treturn err\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tc.%s = timestamppb.New(t)\n", field.Name)
		fmt.Fprintf(w, "\t\t} else if structVal := val.GetStructValue(); structVal != nil {\n")
		fmt.Fprintf(w, "\t\t\tfields := structVal.GetFields()\n")
		fmt.Fprintf(w, "\t\t\tseconds := int64(0)\n")
		fmt.Fprintf(w, "\t\t\tnanos := int32(0)\n")
		fmt.Fprintf(w, "\t\t\tif s, ok := fields[\"seconds\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tseconds = int64(s.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tif n, ok := fields[\"nanos\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tnanos = int32(n.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tc.%s = &timestamppb.Timestamp{Seconds: seconds, Nanos: nanos}\n", field.Name)
		fmt.Fprintf(w, "\t\t}\n")
	case "Duration":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/durationpb", "durationpb")
		fmt.Fprintf(w, "\t\t// Parse duration from struct with seconds/nanos\n")
		fmt.Fprintf(w, "\t\tif structVal := val.GetStructValue(); structVal != nil {\n")
		fmt.Fprintf(w, "\t\t\tfields := structVal.GetFields()\n")
		fmt.Fprintf(w, "\t\t\tseconds := int64(0)\n")
		fmt.Fprintf(w, "\t\t\tnanos := int32(0)\n")
		fmt.Fprintf(w, "\t\t\tif s, ok := fields[\"seconds\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tseconds = int64(s.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tif n, ok := fields[\"nanos\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tnanos = int32(n.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tc.%s = &durationpb.Duration{Seconds: seconds, Nanos: nanos}\n", field.Name)
		fmt.Fprintf(w, "\t\t}\n")
	default:
		// For other well-known types, skip the FromProto (they're complex and rarely used in this context)
		fmt.Fprintf(w, "\t\t// TODO: Handle well-known type %s\n", field.Type.MessageType)
		fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
	}
}

// genConfigStruct generates a Go struct for a task config
func (c *genContext) genConfigStruct(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Generate documentation comment
	if config.Description != "" {
		c.writeComment(w, config.Description)
	}

	// Struct declaration
	fmt.Fprintf(w, "type %s struct {\n", config.Name)

	// Fields
	for _, field := range config.Fields {
		// Field comment
		if field.Description != "" {
			c.writeFieldComment(w, field.Description)
		}

		// Field declaration
		goType := c.goType(field.Type)

		// Use interface{} for expression fields (smart type conversion)
		if field.IsExpression && field.Type.Kind == "string" {
			goType = "interface{}"
		}

		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")

	// Generate IsTaskConfig() method only for TaskConfig types (exported for cross-package use)
	if strings.HasSuffix(config.Name, "TaskConfig") {
		fmt.Fprintf(w, "// IsTaskConfig marks %s as a TaskConfig implementation.\n", config.Name)
		fmt.Fprintf(w, "func (c *%s) IsTaskConfig() {}\n\n", config.Name)
	}

	return nil
}

// genTypeStruct generates a Go struct for a shared type
func (c *genContext) genTypeStruct(w *bytes.Buffer, typeSchema *TypeSchema) error {
	// Generate documentation comment
	if typeSchema.Description != "" {
		c.writeComment(w, typeSchema.Description)
	}

	// Struct declaration
	fmt.Fprintf(w, "type %s struct {\n", typeSchema.Name)

	// Fields
	for _, field := range typeSchema.Fields {
		// Field comment
		if field.Description != "" {
			c.writeFieldComment(w, field.Description)
		}

		// Field declaration
		goType := c.goType(field.Type)

		// Use interface{} for expression fields (smart type conversion)
		if field.IsExpression && field.Type.Kind == "string" {
			goType = "interface{}"
		}

		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")
	return nil
}

// genArgsStruct generates an Args struct for SDK resources (Pulumi pattern)
// Example: AgentSpec -> AgentArgs
func (c *genContext) genArgsStruct(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Determine the Args struct name
	// "AgentSpec" -> "AgentArgs"
	argsName := strings.TrimSuffix(config.Name, "Spec") + "Args"

	// Generate documentation comment
	resourceName := strings.TrimSuffix(config.Name, "Spec")
	fmt.Fprintf(w, "// %s contains the configuration arguments for creating a %s.\n", argsName, resourceName)
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// This struct follows the Pulumi Args pattern for resource configuration.\n")
	if config.Description != "" {
		fmt.Fprintf(w, "//\n")
		c.writeComment(w, config.Description)
	}

	// Struct declaration
	fmt.Fprintf(w, "type %s struct {\n", argsName)

	// Fields - use plain Go types (simple types from same gen/ package)
	for _, field := range config.Fields {
		// Field comment
		if field.Description != "" {
			c.writeFieldComment(w, field.Description)
		}

		// Field declaration - use goType which keeps message types unqualified
		goType := c.goType(field.Type)

		// Use plain struct tags (no omitempty for required fields)
		var jsonTag string
		if field.Required {
			jsonTag = fmt.Sprintf("`json:\"%s\"`", field.JsonName)
		} else {
			jsonTag = fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		}

		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")
	return nil
}

// genBuilderFunc generates a builder function for a task config.
//
// DEPRECATED: This method is no longer used. Builder functions are now
// part of the manual ergonomic API layer (workflow.go and *_options.go),
// not generated code, because they reference manual SDK types like *Task.
//
// This method is kept for reference but should not be called.
func (c *genContext) genBuilderFunc(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Function documentation
	kindTitle := strings.Title(strings.ToLower(strings.ReplaceAll(config.Kind, "_", " ")))
	fmt.Fprintf(w, "// %sTask creates a %s workflow task.\n", titleCase(config.Kind), kindTitle)
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Parameters:\n")
	fmt.Fprintf(w, "//   - name: Task name (must be unique within workflow)\n")
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		desc := sanitizeDescription(field.Description)
		fmt.Fprintf(w, "//   - %s: %s\n", paramName, desc)
	}
	fmt.Fprintf(w, "func %sTask(name string", titleCase(config.Kind))

	// Parameters
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		paramType := c.goType(field.Type)
		fmt.Fprintf(w, ", %s %s", paramName, paramType)
	}

	fmt.Fprintf(w, ") *Task {\n")

	// Function body
	fmt.Fprintf(w, "\treturn &Task{\n")
	fmt.Fprintf(w, "\t\tName: name,\n")
	fmt.Fprintf(w, "\t\tKind: TaskKind%s,\n", titleCase(config.Kind))
	fmt.Fprintf(w, "\t\tConfig: &%s{\n", config.Name)

	// Assign parameters to struct fields
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		fmt.Fprintf(w, "\t\t\t%s: %s,\n", field.Name, paramName)
	}

	fmt.Fprintf(w, "\t\t},\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genToProtoMethod generates ToProto() method for proto conversion
func (c *genContext) genToProtoMethod(w *bytes.Buffer, config *TaskConfigSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// ToProto converts %s to google.protobuf.Struct for proto marshaling.\n", config.Name)
	fmt.Fprintf(w, "func (c *%s) ToProto() (*structpb.Struct, error) {\n", config.Name)
	fmt.Fprintf(w, "\tdata := make(map[string]interface{})\n\n")

	// Marshal each field
	for _, field := range config.Fields {
		// Determine if we need smart conversion for expression fields
		needsConversion := field.IsExpression && field.Type.Kind == "string"

		// Special handling for array of message types (e.g., []*types.WorkflowTask)
		if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message" {
			c.addImport("encoding/json")
			if field.Required {
				fmt.Fprintf(w, "\t// Convert %s array to proto-compatible format using JSON marshaling\n", field.Name)
				fmt.Fprintf(w, "\tif c.%s != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\tjsonBytes, err := json.Marshal(c.%s)\n", field.Name)
				fmt.Fprintf(w, "\t\tif err != nil {\n")
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tvar %sArray []interface{}\n", field.Name)
				fmt.Fprintf(w, "\t\tif err := json.Unmarshal(jsonBytes, &%sArray); err != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tdata[\"%s\"] = %sArray\n", field.JsonName, field.Name)
				fmt.Fprintf(w, "\t}\n")
			} else {
				fmt.Fprintf(w, "\tif !isEmpty(c.%s) {\n", field.Name)
				fmt.Fprintf(w, "\t\t// Convert %s array to proto-compatible format using JSON marshaling\n", field.Name)
				fmt.Fprintf(w, "\t\tjsonBytes, err := json.Marshal(c.%s)\n", field.Name)
				fmt.Fprintf(w, "\t\tif err != nil {\n")
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tvar %sArray []interface{}\n", field.Name)
				fmt.Fprintf(w, "\t\tif err := json.Unmarshal(jsonBytes, &%sArray); err != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tdata[\"%s\"] = %sArray\n", field.JsonName, field.Name)
				fmt.Fprintf(w, "\t}\n")
			}
			continue
		}

		// Special handling for message types (e.g., *types.HttpEndpoint)
		if field.Type.Kind == "message" {
			c.addImport("encoding/json")
			if field.Required {
				fmt.Fprintf(w, "\t// Convert %s to proto-compatible format using JSON marshaling\n", field.Name)
				fmt.Fprintf(w, "\tif c.%s != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\tjsonBytes, err := json.Marshal(c.%s)\n", field.Name)
				fmt.Fprintf(w, "\t\tif err != nil {\n")
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tvar %sMap map[string]interface{}\n", field.Name)
				fmt.Fprintf(w, "\t\tif err := json.Unmarshal(jsonBytes, &%sMap); err != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\t// Apply smart conversion to expression fields within the message\n")
				c.generateMessageFieldConversion(w, field, field.Name+"Map")
				fmt.Fprintf(w, "\t\tdata[\"%s\"] = %sMap\n", field.JsonName, field.Name)
				fmt.Fprintf(w, "\t}\n")
			} else {
				fmt.Fprintf(w, "\tif !isEmpty(c.%s) && c.%s != nil {\n", field.Name, field.Name)
				fmt.Fprintf(w, "\t\t// Convert %s to proto-compatible format using JSON marshaling\n", field.Name)
				fmt.Fprintf(w, "\t\tjsonBytes, err := json.Marshal(c.%s)\n", field.Name)
				fmt.Fprintf(w, "\t\tif err != nil {\n")
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\tvar %sMap map[string]interface{}\n", field.Name)
				fmt.Fprintf(w, "\t\tif err := json.Unmarshal(jsonBytes, &%sMap); err != nil {\n", field.Name)
				fmt.Fprintf(w, "\t\t\treturn nil, err\n")
				fmt.Fprintf(w, "\t\t}\n")
				fmt.Fprintf(w, "\t\t// Apply smart conversion to expression fields within the message\n")
				c.generateMessageFieldConversion(w, field, field.Name+"Map")
				fmt.Fprintf(w, "\t\tdata[\"%s\"] = %sMap\n", field.JsonName, field.Name)
				fmt.Fprintf(w, "\t}\n")
			}
			continue
		}

		valueExpr := "c." + field.Name
		if needsConversion {
			valueExpr = "coerceToString(c." + field.Name + ")"
		}

		if field.Required {
			fmt.Fprintf(w, "\tdata[\"%s\"] = %s\n", field.JsonName, valueExpr)
		} else {
			// Optional field - only include if not zero value
			fmt.Fprintf(w, "\tif !isEmpty(c.%s) {\n", field.Name)
			if needsConversion {
				fmt.Fprintf(w, "\t\t// Smart conversion: accepts string or TaskFieldRef\n")
			}
			fmt.Fprintf(w, "\t\tdata[\"%s\"] = %s\n", field.JsonName, valueExpr)
			fmt.Fprintf(w, "\t}\n")
		}
	}

	fmt.Fprintf(w, "\n\treturn structpb.NewStruct(data)\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// generateMessageFieldConversion generates code to apply smart conversion to expression fields within a message
func (c *genContext) generateMessageFieldConversion(w *bytes.Buffer, field *FieldSchema, mapVarName string) {
	// Check if this is HttpEndpoint which has Uri as an expression field
	if field.Type.MessageType == "HttpEndpoint" {
		fmt.Fprintf(w, "\t\tif uri, ok := %s[\"uri\"]; ok {\n", mapVarName)
		fmt.Fprintf(w, "\t\t\t%s[\"uri\"] = coerceToString(uri)\n", mapVarName)
		fmt.Fprintf(w, "\t\t}\n")
	}
	// Add more message types here as needed
}

// genTypeFromProtoMethod generates FromProto() method for a shared type
func (c *genContext) genTypeFromProtoMethod(w *bytes.Buffer, typeSchema *TypeSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// FromProto converts google.protobuf.Struct to %s.\n", typeSchema.Name)
	fmt.Fprintf(w, "func (c *%s) FromProto(s *structpb.Struct) error {\n", typeSchema.Name)
	fmt.Fprintf(w, "\tfields := s.GetFields()\n\n")

	// Unmarshal each field
	for _, field := range typeSchema.Fields {
		c.genFromProtoField(w, field)
	}

	fmt.Fprintf(w, "\treturn nil\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genFromProtoMethod generates FromProto() method for proto conversion
func (c *genContext) genFromProtoMethod(w *bytes.Buffer, config *TaskConfigSchema) error {
	c.addImport("google.golang.org/protobuf/types/known/structpb")

	fmt.Fprintf(w, "// FromProto converts google.protobuf.Struct to %s.\n", config.Name)
	fmt.Fprintf(w, "func (c *%s) FromProto(s *structpb.Struct) error {\n", config.Name)
	fmt.Fprintf(w, "\tfields := s.GetFields()\n\n")

	// Unmarshal each field
	for _, field := range config.Fields {
		c.genFromProtoField(w, field)
	}

	fmt.Fprintf(w, "\treturn nil\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
}

// genFromProtoField generates FromProto conversion code for a single field
func (c *genContext) genFromProtoField(w *bytes.Buffer, field *FieldSchema) {
	fmt.Fprintf(w, "\tif val, ok := fields[\"%s\"]; ok {\n", field.JsonName)

	switch field.Type.Kind {
	case "string":
		fmt.Fprintf(w, "\t\tc.%s = val.GetStringValue()\n", field.Name)

	case "int32":
		fmt.Fprintf(w, "\t\tc.%s = int32(val.GetNumberValue())\n", field.Name)

	case "uint32":
		fmt.Fprintf(w, "\t\tc.%s = uint32(val.GetNumberValue())\n", field.Name)

	case "int64":
		fmt.Fprintf(w, "\t\tc.%s = int64(val.GetNumberValue())\n", field.Name)

	case "bool":
		fmt.Fprintf(w, "\t\tc.%s = val.GetBoolValue()\n", field.Name)

	case "float":
		fmt.Fprintf(w, "\t\tc.%s = float32(val.GetNumberValue())\n", field.Name)

	case "double":
		fmt.Fprintf(w, "\t\tc.%s = val.GetNumberValue()\n", field.Name)

	case "map":
		if field.Type.KeyType == nil || field.Type.ValueType == nil {
			fmt.Fprintf(w, "\t\t// TODO: Map with unknown key/value type\n")
			fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
		} else if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "string" {
			// Simple string-to-string map
			fmt.Fprintf(w, "\t\tc.%s = make(map[string]string)\n", field.Name)
			fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
			fmt.Fprintf(w, "\t\t\tc.%s[k] = v.GetStringValue()\n", field.Name)
			fmt.Fprintf(w, "\t\t}\n")
		} else if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "message" {
			// Complex map: map[string]*MessageType
			typeName := field.Type.ValueType.MessageType
			if _, isShared := c.sharedTypes[typeName]; isShared && c.packageName != "types" {
				typeName = "types." + typeName
				c.addImport("github.com/stigmer/stigmer/sdk/go/v3/gen/types")
			}
			fmt.Fprintf(w, "\t\tc.%s = make(map[string]*%s)\n", field.Name, typeName)
			fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
			fmt.Fprintf(w, "\t\t\titem := &%s{}\n", typeName)
			fmt.Fprintf(w, "\t\t\tif err := item.FromProto(v.GetStructValue()); err != nil {\n")
			fmt.Fprintf(w, "\t\t\t\treturn err\n")
			fmt.Fprintf(w, "\t\t\t}\n")
			fmt.Fprintf(w, "\t\t\tc.%s[k] = item\n", field.Name)
			fmt.Fprintf(w, "\t\t}\n")
		} else {
			fmt.Fprintf(w, "\t\t// TODO: Map with key=%s value=%s\n", field.Type.KeyType.Kind, field.Type.ValueType.Kind)
			fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
		}

	case "struct":
		fmt.Fprintf(w, "\t\tc.%s = val.GetStructValue().AsMap()\n", field.Name)

	case "value":
		fmt.Fprintf(w, "\t\tc.%s = val.AsInterface()\n", field.Name)

	case "message":
		// Handle well-known proto types specially
		if c.isWellKnownProtoType(field.Type.MessageType) {
			c.genWellKnownTypeFromProto(w, field)
		} else {
			// Check if this is a shared type that needs types. prefix
			typeName := field.Type.MessageType
			if _, isShared := c.sharedTypes[typeName]; isShared && c.packageName != "types" {
				typeName = "types." + typeName
				c.addImport("github.com/stigmer/stigmer/sdk/go/v3/gen/types")
			}
			fmt.Fprintf(w, "\t\tc.%s = &%s{}\n", field.Name, typeName)
			fmt.Fprintf(w, "\t\tif err := c.%s.FromProto(val.GetStructValue()); err != nil {\n", field.Name)
			fmt.Fprintf(w, "\t\t\treturn err\n")
			fmt.Fprintf(w, "\t\t}\n")
		}

	case "array":
		elementType := field.Type.ElementType
		if elementType == nil {
			fmt.Fprintf(w, "\t\t// TODO: Array with unknown element type\n")
			fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
		} else {
			switch elementType.Kind {
			case "string":
				fmt.Fprintf(w, "\t\tc.%s = make([]string, 0)\n", field.Name)
				fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
				fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, v.GetStringValue())\n", field.Name, field.Name)
				fmt.Fprintf(w, "\t\t}\n")
			case "int32":
				fmt.Fprintf(w, "\t\tc.%s = make([]int32, 0)\n", field.Name)
				fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
				fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, int32(v.GetNumberValue()))\n", field.Name, field.Name)
				fmt.Fprintf(w, "\t\t}\n")
			case "int64":
				fmt.Fprintf(w, "\t\tc.%s = make([]int64, 0)\n", field.Name)
				fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
				fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, int64(v.GetNumberValue()))\n", field.Name, field.Name)
				fmt.Fprintf(w, "\t\t}\n")
			case "message":
				typeName := elementType.MessageType
				if _, isShared := c.sharedTypes[typeName]; isShared && c.packageName != "types" {
					typeName = "types." + typeName
					c.addImport("github.com/stigmer/stigmer/sdk/go/v3/gen/types")
				}
				fmt.Fprintf(w, "\t\tc.%s = make([]*%s, 0)\n", field.Name, typeName)
				fmt.Fprintf(w, "\t\tfor _, v := range val.GetListValue().GetValues() {\n")
				fmt.Fprintf(w, "\t\t\titem := &%s{}\n", typeName)
				fmt.Fprintf(w, "\t\t\tif err := item.FromProto(v.GetStructValue()); err != nil {\n")
				fmt.Fprintf(w, "\t\t\t\treturn err\n")
				fmt.Fprintf(w, "\t\t\t}\n")
				fmt.Fprintf(w, "\t\t\tc.%s = append(c.%s, item)\n", field.Name, field.Name)
				fmt.Fprintf(w, "\t\t}\n")
			default:
				fmt.Fprintf(w, "\t\t// TODO: Array of %s type\n", elementType.Kind)
				fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
			}
		}

	case "timestamp":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		c.addImport("time")
		fmt.Fprintf(w, "\t\tif strVal := val.GetStringValue(); strVal != \"\" {\n")
		fmt.Fprintf(w, "\t\t\tt, err := time.Parse(time.RFC3339Nano, strVal)\n")
		fmt.Fprintf(w, "\t\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\t\treturn err\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tc.%s = timestamppb.New(t)\n", field.Name)
		fmt.Fprintf(w, "\t\t} else if structVal := val.GetStructValue(); structVal != nil {\n")
		fmt.Fprintf(w, "\t\t\tfields := structVal.GetFields()\n")
		fmt.Fprintf(w, "\t\t\tseconds := int64(0)\n")
		fmt.Fprintf(w, "\t\t\tnanos := int32(0)\n")
		fmt.Fprintf(w, "\t\t\tif s, ok := fields[\"seconds\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tseconds = int64(s.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tif n, ok := fields[\"nanos\"]; ok {\n")
		fmt.Fprintf(w, "\t\t\t\tnanos = int32(n.GetNumberValue())\n")
		fmt.Fprintf(w, "\t\t\t}\n")
		fmt.Fprintf(w, "\t\t\tc.%s = &timestamppb.Timestamp{Seconds: seconds, Nanos: nanos}\n", field.Name)
		fmt.Fprintf(w, "\t\t}\n")

	default:
		// For unknown types, suppress unused variable warning
		fmt.Fprintf(w, "\t\t// TODO: Implement FromProto for %s field %s\n", field.Type.Kind, field.Name)
		fmt.Fprintf(w, "\t\t_ = val // suppress unused variable warning\n")
	}

	fmt.Fprintf(w, "\t}\n\n")
}

// ============================================================================
// Args Struct Generation (Pulumi Pattern)
// ============================================================================

// NOTE: Functional options generation has been removed in favor of Args structs.
// See genArgsStruct() above for the Pulumi-style pattern.

// NOTE: All functional options generation methods removed.
// Args structs are now generated by genArgsStruct() above.

// singularize converts plural field names to singular form for option functions.
// Examples: "Headers" -> "Header", "Skills" -> "Skill", "Environments" -> "Environment"
func (c *genContext) singularize(plural string) string {
	// Handle common irregular plurals
	irregulars := map[string]string{
		"Children": "Child",
		"People":   "Person",
		"Men":      "Man",
		"Women":    "Woman",
	}

	if singular, ok := irregulars[plural]; ok {
		return singular
	}

	// Simple rule: remove trailing 's' for most cases
	if strings.HasSuffix(plural, "ies") {
		// "Entries" -> "Entry"
		return plural[:len(plural)-3] + "y"
	}
	if strings.HasSuffix(plural, "ses") {
		// "Addresses" -> "Address"
		return plural[:len(plural)-2]
	}
	if strings.HasSuffix(plural, "s") && !strings.HasSuffix(plural, "ss") {
		// "Headers" -> "Header", but not "Address" -> "Addres"
		return plural[:len(plural)-1]
	}

	// If no rule matches, return as-is (might already be singular)
	return plural
}

// pluralize ensures consistent plural form for bulk option functions.
// Examples: "Header" -> "Headers", "Skill" -> "Skills"
func (c *genContext) pluralize(singular string) string {
	// Handle common irregular plurals
	irregulars := map[string]string{
		"Child":  "Children",
		"Person": "People",
		"Man":    "Men",
		"Woman":  "Women",
	}

	if plural, ok := irregulars[singular]; ok {
		return plural
	}

	// Simple rule: add 's' for most cases
	if strings.HasSuffix(singular, "y") && len(singular) > 1 {
		// "Entry" -> "Entries" (if preceded by consonant)
		prevChar := singular[len(singular)-2]
		if prevChar != 'a' && prevChar != 'e' && prevChar != 'i' && prevChar != 'o' && prevChar != 'u' {
			return singular[:len(singular)-1] + "ies"
		}
	}
	if strings.HasSuffix(singular, "s") || strings.HasSuffix(singular, "x") ||
		strings.HasSuffix(singular, "z") || strings.HasSuffix(singular, "ch") ||
		strings.HasSuffix(singular, "sh") {
		// "Address" -> "Addresses"
		return singular + "es"
	}

	// Default: add 's'
	return singular + "s"
}

// needsCoercion determines if a value type needs coerceToString() conversion.
// Returns true for string types (which support expressions), false for structured types.
func (c *genContext) needsCoercion(typeSpec *TypeSpec) bool {
	if typeSpec == nil {
		return false
	}

	switch typeSpec.Kind {
	case "string":
		return true
	case "map":
		// For maps, check if value type is string
		if typeSpec.ValueType != nil && typeSpec.ValueType.Kind == "string" {
			return true
		}
		return false
	default:
		return false
	}
}

// ============================================================================
// Type Conversion
// ============================================================================

// goType converts a TypeSpec to a Go type string
func (c *genContext) goType(typeSpec TypeSpec) string {
	switch typeSpec.Kind {
	case "string":
		return "string"
	case "int32":
		return "int32"
	case "int64":
		return "int64"
	case "uint32":
		return "uint32"
	case "bool":
		return "bool"
	case "float":
		return "float32"
	case "double":
		return "float64"
	case "bytes":
		return "[]byte"

	case "map":
		keyType := c.goType(*typeSpec.KeyType)
		valueType := c.goType(*typeSpec.ValueType)
		return fmt.Sprintf("map[%s]%s", keyType, valueType)

	case "array":
		elementType := c.goType(*typeSpec.ElementType)
		return fmt.Sprintf("[]%s", elementType)

	case "message":
		// Handle well-known proto types first
		if wellKnownType := c.wellKnownProtoType(typeSpec.MessageType); wellKnownType != "" {
			return wellKnownType
		}

		// Check if this is a shared type
		if _, isShared := c.sharedTypes[typeSpec.MessageType]; isShared {
			// If useProtoStubs is enabled, use proto stubs types directly
			if c.useProtoStubs {
				if typeSchema, ok := c.protoStubTypes[typeSpec.MessageType]; ok && typeSchema.ProtoType != "" {
					importPath := protoTypeToGoImportPath(typeSchema.ProtoType, sdkProtoPrefix)
					pkgAlias := protoTypeToPackageAlias(typeSchema.ProtoType)
					if importPath != "" && pkgAlias != "" {
						c.addImportWithAlias(importPath, pkgAlias)
						return "*" + pkgAlias + "." + typeSpec.MessageType
					}
				}
			}

			// Fall back to gen/types package
			if c.packageName != "types" {
				c.addImport("github.com/stigmer/stigmer/sdk/go/v3/gen/types")
			}
			// Reference shared type from types package
			if c.packageName == "types" {
				return "*" + typeSpec.MessageType
			}
			return "*types." + typeSpec.MessageType
		}
		// Pointer for proto compatibility
		return "*" + typeSpec.MessageType

	case "struct":
		// google.protobuf.Struct → map[string]interface{}
		return "map[string]interface{}"

	case "value":
		// google.protobuf.Value → any JSON-representable scalar or composite
		return "interface{}"

	case "timestamp":
		c.addImportWithAlias("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		return "*timestamppb.Timestamp"

	default:
		panic(fmt.Sprintf("unknown type kind: %s", typeSpec.Kind))
	}
}

// paramName converts a field name to a parameter name (lowercase first letter)
func (c *genContext) paramName(fieldName string) string {
	if fieldName == "" {
		return ""
	}
	return strings.ToLower(fieldName[:1]) + fieldName[1:]
}

// writeComment writes a multi-line comment
func (c *genContext) writeComment(w *bytes.Buffer, comment string) {
	lines := strings.Split(comment, "\n")
	for _, line := range lines {
		if line == "" {
			fmt.Fprintf(w, "//\n")
		} else {
			fmt.Fprintf(w, "// %s\n", line)
		}
	}
}

// writeFieldComment writes a single-line field comment
func (c *genContext) writeFieldComment(w *bytes.Buffer, comment string) {
	// Remove newlines for field comments
	comment = strings.ReplaceAll(comment, "\n", " ")
	fmt.Fprintf(w, "\t// %s\n", comment)
}

// titleCase converts a string to TitleCase (e.g., "HTTP_CALL" -> "HttpCall")
func titleCase(s string) string {
	parts := strings.Split(s, "_")
	for i, part := range parts {
		if len(part) > 0 {
			parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
	}
	return strings.Join(parts, "")
}

// toSnakeCase converts CamelCase to snake_case
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

func toSnakeCase(s string) string {
	var result []rune
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result = append(result, '_')
		}
		result = append(result, r)
	}
	return strings.ToLower(string(result))
}

// ============================================================================
// Comprehensive Mode
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
	outputDir := flag.String("output-dir", "sdk/go/workflow/gen", "Output directory for generated Go code")
	packageName := flag.String("package", "gen", "Go package name for generated code")
	fileSuffix := flag.String("file-suffix", "", "Suffix for generated files (e.g., '_task', '_spec', or empty)")
	target := flag.String("target", "sdk", "Generation target: sdk, mcp-ts, sdk-client, or task-registry")
	metaDir := flag.String("meta-dir", "", "Directory containing sidecar YAML metadata (used by task-registry target)")
	expandStruct := flag.String("expand-struct", "", "Expand a Struct field into typed config fields: struct_field:discriminator_field:config_schema_dir")
	comprehensive := flag.Bool("comprehensive", false, "Auto-discover all domain/resource schemas and generate for each")
	apisDir := flag.String("apis-dir", "", "Root directory of proto API definitions (used by sdk-docs for overview.md loading)")
	flag.Parse()

	if *comprehensive {
		if *schemaDir == "" || *outputDir == "" {
			fmt.Println("Usage: generator --comprehensive --schema-dir <dir> --output-dir <dir> --target mcp-ts")
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
			if err := runTaskDocsGeneration(*schemaDir, *outputDir, *metaDir); err != nil {
				fmt.Printf("Error in task docs generation: %v\n", err)
				os.Exit(1)
			}
		default:
			fmt.Printf("Comprehensive mode is supported for --target=mcp-ts, --target=sdk-client, --target=sdk-client-ts, --target=sdk-client-python, --target=sdk-client-java, --target=sdk-docs, --target=task-registry, or --target=task-docs (got %s)\n", *target)
			os.Exit(1)
		}
		fmt.Println("\n✅ Comprehensive code generation complete!")
		return
	}

	if *schemaDir == "" || *outputDir == "" {
		fmt.Println("Usage: generator --schema-dir <dir> --output-dir <dir> --package <name> [--target sdk]")
		os.Exit(1)
	}

	fmt.Printf("Generating Go code from schemas in %s\n", *schemaDir)
	fmt.Printf("Output directory: %s\n", *outputDir)
	fmt.Printf("Package name: %s\n", *packageName)
	fmt.Printf("Target: %s\n", *target)

	gen, err := NewGenerator(*schemaDir, *outputDir, *packageName, *fileSuffix)
	if err != nil {
		fmt.Printf("Error creating generator: %v\n", err)
		os.Exit(1)
	}

	if *expandStruct != "" {
		if err := gen.parseExpandStruct(*expandStruct); err != nil {
			fmt.Printf("Error parsing --expand-struct: %v\n", err)
			os.Exit(1)
		}
	}

	if err := gen.Generate(); err != nil {
		fmt.Printf("Error generating code: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\n✅ Code generation complete!")
}
