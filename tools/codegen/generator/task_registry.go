package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// TaskKindRegistryEntry is the JSON-serializable representation of a
// TaskKindDescriptor, combining proto-derived structural data with
// sidecar-provided presentation metadata.
type TaskKindRegistryEntry struct {
	Kind                    string                   `json:"kind"`
	DisplayName             string                   `json:"displayName"`
	Description             string                   `json:"description"`
	Category                string                   `json:"category"`
	Icon                    string                   `json:"icon"`
	ConfigProtoType         string                   `json:"configProtoType"`
	Fields                  []TaskFieldRegistryEntry `json:"fields"`
	FieldGroups             []TaskFieldGroupEntry    `json:"fieldGroups"`
	ConfigJsonSchema        map[string]interface{}   `json:"configJsonSchema"`
	OutputJsonSchema        map[string]interface{}   `json:"outputJsonSchema,omitempty"`
	YamlExamples            []string                 `json:"yamlExamples,omitempty"`
	DocumentationUrl        string                   `json:"documentationUrl"`
	IsAiNative              bool                     `json:"isAiNative"`
	RequiresExternalService bool                     `json:"requiresExternalService"`
}

// TaskFieldRegistryEntry describes a single field in the registry output.
type TaskFieldRegistryEntry struct {
	Name            string   `json:"name"`
	DisplayName     string   `json:"displayName"`
	Description     string   `json:"description"`
	Type            string   `json:"type"`
	Required        bool     `json:"required"`
	IsExpression    bool     `json:"isExpression,omitempty"`
	DefaultValue    string   `json:"defaultValue,omitempty"`
	EnumValues      []string `json:"enumValues,omitempty"`
	GroupId         string   `json:"groupId,omitempty"`
	FieldNumber     int      `json:"fieldNumber"`
	ElementType     string   `json:"elementType,omitempty"`
	ValidationHints []string `json:"validationHints,omitempty"`
}

// TaskFieldGroupEntry describes a field group in the registry output.
type TaskFieldGroupEntry struct {
	Id          string `json:"id"`
	DisplayName string `json:"displayName"`
	Description string `json:"description,omitempty"`
}

// SidecarMeta represents the YAML sidecar metadata file for a task kind.
type SidecarMeta struct {
	Kind                    string                 `yaml:"kind"`
	DisplayName             string                 `yaml:"display_name"`
	Description             string                 `yaml:"description"`
	Category                string                 `yaml:"category"`
	Icon                    string                 `yaml:"icon"`
	IsAiNative              bool                   `yaml:"is_ai_native"`
	RequiresExternalService bool                   `yaml:"requires_external_service"`
	DocumentationUrl        string                 `yaml:"documentation_url"`
	OutputSchema            map[string]interface{} `yaml:"output_schema"`
	FieldGroups             []SidecarFieldGroup    `yaml:"field_groups"`
	YamlExamples            []string               `yaml:"yaml_examples"`
}

// SidecarFieldGroup represents a field group definition in the sidecar YAML.
type SidecarFieldGroup struct {
	Id          string   `yaml:"id"`
	DisplayName string   `yaml:"display_name"`
	Description string   `yaml:"description"`
	Fields      []string `yaml:"fields"`
}

// TaskKindRegistry is the top-level registry output.
type TaskKindRegistry struct {
	Version     string                  `json:"version"`
	GeneratedAt string                  `json:"generatedAt"`
	Descriptors []TaskKindRegistryEntry `json:"descriptors"`
}

// runTaskRegistryGeneration generates the task-kind-registry.json by merging
// proto-derived schemas with sidecar metadata files.
func runTaskRegistryGeneration(schemaDir, outputDir, metaDir string) error {
	tasksSchemaDir := filepath.Join(schemaDir, "tasks")
	typesDir := filepath.Join(tasksSchemaDir, "types")

	fmt.Printf("Task Registry Generation\n")
	fmt.Printf("  Schema dir: %s\n", tasksSchemaDir)
	fmt.Printf("  Meta dir:   %s\n", metaDir)
	fmt.Printf("  Output dir: %s\n", outputDir)

	// Load all task schemas from proto2schema output
	taskSchemas, err := loadTaskSchemas(tasksSchemaDir)
	if err != nil {
		return fmt.Errorf("loading task schemas: %w", err)
	}
	fmt.Printf("  Loaded %d task schemas\n", len(taskSchemas))

	// Load shared types (for resolving nested message references)
	sharedTypes, err := loadSharedTypes(typesDir)
	if err != nil {
		// types dir may not exist for all setups — non-fatal
		fmt.Printf("  Warning: could not load shared types: %v\n", err)
		sharedTypes = make(map[string]*TypeSchema)
	}

	// Load sidecar metadata
	sidecars, err := loadSidecarMetadata(metaDir)
	if err != nil {
		return fmt.Errorf("loading sidecar metadata: %w", err)
	}
	fmt.Printf("  Loaded %d sidecar metadata files\n", len(sidecars))

	if err := validateSidecarExamples(taskSchemas, sidecars); err != nil {
		return err
	}

	// Merge schemas with sidecars into registry entries
	var entries []TaskKindRegistryEntry
	for _, schema := range taskSchemas {
		entry := buildRegistryEntry(schema, sidecars, sharedTypes)
		entries = append(entries, entry)
	}

	// Sort by discriminator value (which maps to enum order)
	sort.Slice(entries, func(i, j int) bool {
		return kindOrder(entries[i].Kind) < kindOrder(entries[j].Kind)
	})

	registry := TaskKindRegistry{
		Version:     "1.0.0",
		GeneratedAt: "generated-by-codegen",
		Descriptors: entries,
	}

	// Write the registry JSON
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("creating output dir: %w", err)
	}

	registryPath := filepath.Join(outputDir, "task-kind-registry.json")
	data, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling registry: %w", err)
	}
	if err := os.WriteFile(registryPath, data, 0644); err != nil {
		return fmt.Errorf("writing registry: %w", err)
	}
	fmt.Printf("  Written: %s (%d bytes)\n", registryPath, len(data))

	// Generate per-kind JSON Schemas
	schemasDir := filepath.Join(outputDir, "json-schemas")
	if err := os.MkdirAll(schemasDir, 0755); err != nil {
		return fmt.Errorf("creating schemas dir: %w", err)
	}
	for _, entry := range entries {
		schemaPath := filepath.Join(schemasDir, entry.Kind+".schema.json")
		schemaData, err := json.MarshalIndent(entry.ConfigJsonSchema, "", "  ")
		if err != nil {
			return fmt.Errorf("marshaling schema for %s: %w", entry.Kind, err)
		}
		if err := os.WriteFile(schemaPath, schemaData, 0644); err != nil {
			return fmt.Errorf("writing schema for %s: %w", entry.Kind, err)
		}
	}
	fmt.Printf("  Written: %d JSON Schema files in %s\n", len(entries), schemasDir)

	return nil
}

func loadTaskSchemas(dir string) ([]*TaskConfigSchema, error) {
	files, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var schemas []*TaskConfigSchema
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Name()))
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", f.Name(), err)
		}
		var schema TaskConfigSchema
		if err := json.Unmarshal(data, &schema); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", f.Name(), err)
		}
		schemas = append(schemas, &schema)
	}
	return schemas, nil
}

func loadSharedTypes(dir string) (map[string]*TypeSchema, error) {
	types := make(map[string]*TypeSchema)
	files, err := os.ReadDir(dir)
	if err != nil {
		return types, err
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Name()))
		if err != nil {
			continue
		}
		var ts TypeSchema
		if err := json.Unmarshal(data, &ts); err != nil {
			continue
		}
		types[ts.Name] = &ts
	}
	return types, nil
}

func loadSidecarMetadata(dir string) (map[string]*SidecarMeta, error) {
	sidecars := make(map[string]*SidecarMeta)
	files, err := os.ReadDir(dir)
	if err != nil {
		return sidecars, err
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".yaml") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, f.Name()))
		if err != nil {
			return nil, fmt.Errorf("reading %s: %w", f.Name(), err)
		}
		var meta SidecarMeta
		if err := yaml.Unmarshal(data, &meta); err != nil {
			return nil, fmt.Errorf("parsing %s: %w", f.Name(), err)
		}
		sidecars[meta.Kind] = &meta
	}
	return sidecars, nil
}

func buildRegistryEntry(schema *TaskConfigSchema, sidecars map[string]*SidecarMeta, sharedTypes map[string]*TypeSchema) TaskKindRegistryEntry {
	kind := schema.DiscriminatorValue
	if kind == "" {
		kind = strings.ToLower(schema.Kind)
	}

	entry := TaskKindRegistryEntry{
		Kind:            kind,
		ConfigProtoType: schema.ProtoType,
	}

	// Build field group lookup from sidecar
	fieldToGroup := make(map[string]string)
	meta, hasMeta := sidecars[kind]
	if hasMeta {
		entry.DisplayName = meta.DisplayName
		entry.Description = meta.Description
		entry.Category = meta.Category
		entry.Icon = meta.Icon
		entry.IsAiNative = meta.IsAiNative
		entry.RequiresExternalService = meta.RequiresExternalService
		entry.DocumentationUrl = meta.DocumentationUrl
		entry.OutputJsonSchema = meta.OutputSchema
		entry.YamlExamples = meta.YamlExamples

		for _, fg := range meta.FieldGroups {
			entry.FieldGroups = append(entry.FieldGroups, TaskFieldGroupEntry{
				Id:          fg.Id,
				DisplayName: fg.DisplayName,
				Description: fg.Description,
			})
			for _, fieldName := range fg.Fields {
				fieldToGroup[fieldName] = fg.Id
			}
		}
	} else {
		// Derive display name from kind when no sidecar exists
		entry.DisplayName = toDisplayName(kind)
		entry.Description = cleanDescription(schema.Description)
		entry.Category = "unspecified"
	}

	// Build field descriptors
	for i, field := range schema.Fields {
		fe := TaskFieldRegistryEntry{
			Name:         field.ProtoField,
			DisplayName:  toDisplayName(field.ProtoField),
			Description:  cleanDescription(field.Description),
			Type:         mapFieldType(field.Type),
			Required:     field.Required,
			IsExpression: field.IsExpression,
			FieldNumber:  i + 1,
			GroupId:      fieldToGroup[field.ProtoField],
		}

		if field.Type.EnumValues != nil {
			fe.EnumValues = field.Type.EnumValues
		}
		if field.Type.ElementType != nil {
			fe.ElementType = field.Type.ElementType.Kind
			if field.Type.ElementType.MessageType != "" {
				fe.ElementType = field.Type.ElementType.MessageType
			}
		}
		if field.Type.MessageType != "" && fe.ElementType == "" {
			fe.ElementType = field.Type.MessageType
		}

		// Build validation hints
		if field.Validation != nil {
			fe.ValidationHints = buildValidationHints(field.Validation)
		}

		entry.Fields = append(entry.Fields, fe)
	}

	// Generate JSON Schema from fields
	entry.ConfigJsonSchema = generateJsonSchema(schema, sharedTypes)

	return entry
}

func generateJsonSchema(schema *TaskConfigSchema, sharedTypes map[string]*TypeSchema) map[string]interface{} {
	jsonSchema := map[string]interface{}{
		"$schema":              "https://json-schema.org/draft/2020-12/schema",
		"title":                schema.Name,
		"type":                 "object",
		"additionalProperties": false,
	}

	properties := make(map[string]interface{})
	var required []string

	for _, field := range schema.Fields {
		prop := fieldToJsonSchemaProperty(field, sharedTypes, map[string]bool{})
		properties[field.ProtoField] = prop
		if field.Required {
			required = append(required, field.ProtoField)
		}
	}

	jsonSchema["properties"] = properties
	if len(required) > 0 {
		jsonSchema["required"] = required
	}

	return jsonSchema
}

func fieldToJsonSchemaProperty(field *FieldSchema, sharedTypes map[string]*TypeSchema, seen map[string]bool) map[string]interface{} {
	prop := make(map[string]interface{})

	desc := cleanDescription(field.Description)
	if desc != "" {
		prop["description"] = desc
	}

	switch field.Type.Kind {
	case "string":
		if field.Type.EnumType != "" && len(field.Type.EnumValues) > 0 {
			prop["type"] = "string"
			prop["enum"] = field.Type.EnumValues
		} else {
			prop["type"] = "string"
		}
		if field.Validation != nil {
			if field.Validation.MinLength > 0 {
				prop["minLength"] = field.Validation.MinLength
			}
			if field.Validation.MaxLength > 0 {
				prop["maxLength"] = field.Validation.MaxLength
			}
			if field.Validation.Pattern != "" {
				prop["pattern"] = field.Validation.Pattern
			}
		}
	case "int32", "int64", "uint32":
		prop["type"] = "integer"
		if field.Validation != nil {
			if field.Validation.Min != 0 {
				prop["minimum"] = field.Validation.Min
			}
			if field.Validation.Max != 0 {
				prop["maximum"] = field.Validation.Max
			}
		}
	case "float", "double":
		prop["type"] = "number"
		if field.Validation != nil {
			if field.Validation.Min != 0 {
				prop["minimum"] = field.Validation.Min
			}
			if field.Validation.Max != 0 {
				prop["maximum"] = field.Validation.Max
			}
		}
	case "bool":
		prop["type"] = "boolean"
	case "struct":
		prop["type"] = "object"
	case "value":
		// google.protobuf.Value — any JSON value (scalar, array, or
		// object). No "type" constraint: an empty schema accepts any JSON,
		// which is correct here (the field may be a string, array, or
		// object), unlike a fixed "object" that would reject valid scalars.
	case "map":
		prop["type"] = "object"
		if field.Type.ValueType != nil && field.Type.ValueType.Kind == "string" {
			prop["additionalProperties"] = map[string]interface{}{"type": "string"}
		} else {
			prop["additionalProperties"] = true
		}
	case "array":
		prop["type"] = "array"
		if field.Type.ElementType != nil {
			prop["items"] = typeSpecToJsonSchema(field.Type.ElementType, sharedTypes, seen)
		}
		if field.Validation != nil && field.Validation.MinItems > 0 {
			prop["minItems"] = field.Validation.MinItems
		}
	case "message":
		// Expand the nested message into a full typed sub-schema so authors
		// get validation and autocomplete inside it (e.g. agent_call's
		// run_config and output), instead of a bare object that accepts
		// anything (stigmer/stigmer#358).
		expandMessageSchema(prop, field.Type.MessageType, sharedTypes, seen)
	case "timestamp":
		prop["type"] = "string"
		prop["format"] = "date-time"
	case "bytes":
		prop["type"] = "string"
		prop["contentEncoding"] = "base64"
	default:
		prop["type"] = "string"
	}

	return prop
}

func typeSpecToJsonSchema(ts *TypeSpec, sharedTypes map[string]*TypeSchema, seen map[string]bool) map[string]interface{} {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" && len(ts.EnumValues) > 0 {
			return map[string]interface{}{"type": "string", "enum": ts.EnumValues}
		}
		return map[string]interface{}{"type": "string"}
	case "int32", "int64", "uint32":
		return map[string]interface{}{"type": "integer"}
	case "float", "double":
		return map[string]interface{}{"type": "number"}
	case "bool":
		return map[string]interface{}{"type": "boolean"}
	case "struct":
		return map[string]interface{}{"type": "object"}
	case "value":
		// google.protobuf.Value — any JSON value; empty schema accepts all.
		return map[string]interface{}{}
	case "message":
		prop := map[string]interface{}{}
		expandMessageSchema(prop, ts.MessageType, sharedTypes, seen)
		return prop
	default:
		return map[string]interface{}{"type": "string"}
	}
}

// expandMessageSchema fills prop with the typed object schema of a shared
// message type. Falls back to a bare "object" when the type schema is not
// available (proto2schema did not extract it) or when the type recurses —
// the fallback is exactly the pre-expansion behavior, so unknown types
// never make the schema stricter than the data.
func expandMessageSchema(prop map[string]interface{}, messageType string, sharedTypes map[string]*TypeSchema, seen map[string]bool) {
	prop["type"] = "object"

	typeSchema := sharedTypes[messageType]
	if typeSchema == nil || seen[messageType] {
		return
	}
	seen[messageType] = true
	defer delete(seen, messageType)

	properties := make(map[string]interface{})
	var required []string
	for _, field := range typeSchema.Fields {
		properties[field.ProtoField] = fieldToJsonSchemaProperty(field, sharedTypes, seen)
		if field.Required {
			required = append(required, field.ProtoField)
		}
	}

	prop["additionalProperties"] = false
	prop["properties"] = properties
	if len(required) > 0 {
		prop["required"] = required
	}
}

func mapFieldType(ts TypeSpec) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			return "enum"
		}
		return "string"
	case "int32", "int64", "uint32":
		return "int32"
	case "float", "double":
		return "float"
	case "bool":
		return "bool"
	case "struct":
		return "struct"
	case "value":
		return "value"
	case "map":
		return "map"
	case "array":
		return "repeated"
	case "message":
		return "message"
	case "timestamp":
		return "string"
	default:
		return "string"
	}
}

func buildValidationHints(v *Validation) []string {
	var hints []string
	if v.Required {
		hints = append(hints, "required")
	}
	if v.MinLength > 0 {
		hints = append(hints, fmt.Sprintf("min_length: %d", v.MinLength))
	}
	if v.MaxLength > 0 {
		hints = append(hints, fmt.Sprintf("max_length: %d", v.MaxLength))
	}
	if v.Pattern != "" {
		hints = append(hints, fmt.Sprintf("pattern: %s", v.Pattern))
	}
	if v.Min != 0 {
		hints = append(hints, fmt.Sprintf("min: %d", v.Min))
	}
	if v.Max != 0 {
		hints = append(hints, fmt.Sprintf("max: %d", v.Max))
	}
	if v.MinItems > 0 {
		hints = append(hints, fmt.Sprintf("min_items: %d", v.MinItems))
	}
	return hints
}

func toDisplayName(snakeCase string) string {
	parts := strings.Split(snakeCase, "_")
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
	}
	return strings.Join(parts, " ")
}

// cleanDescription flattens a proto description into a single registry line:
// @since annotation lines are dropped and whitespace is collapsed.
// @internal sections never reach this generator: proto2schema strips them at
// extraction, the single owner of that convention (oss#327). The previous
// per-line @internal filter here dropped only the marker line and shipped
// the internal content into the registry — the exact divergence that fix
// removed.
func cleanDescription(desc string) string {
	lines := strings.Split(desc, "\n")
	var cleaned []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "@since") {
			continue
		}
		cleaned = append(cleaned, trimmed)
	}
	result := strings.Join(cleaned, " ")
	// Collapse multiple spaces
	for strings.Contains(result, "  ") {
		result = strings.ReplaceAll(result, "  ", " ")
	}
	return strings.TrimSpace(result)
}

// kindOrder maps task kind names to their enum values for stable sorting.
func kindOrder(kind string) int {
	order := map[string]int{
		"set_vars":      1,
		"http_call":     2,
		"grpc_call":     3,
		"activity_call": 4,
		"switch_case":   5,
		"for_each":      6,
		"fork":          7,
		"try_catch":     8,
		"listen":        9,
		"wait":          10,
		"raise_error":   11,
		"run_workflow":  12,
		"agent_call":    13,
		"llm_call":      14,
		"transform":     15,
		"human_input":   16,
		"validate":      17,
		"emit_event":    18,
		"notification":  19,
		"eval":          20,
	}
	if v, ok := order[kind]; ok {
		return v
	}
	return 99
}
