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
	"time"
)

// ============================================================================
// Schema Types
// ============================================================================

// TaskConfigSchema represents a workflow task configuration
type TaskConfigSchema struct {
	Name        string         `json:"name"`
	Kind        string         `json:"kind,omitempty"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

// TypeSchema represents a shared type (e.g., HttpEndpoint)
type TypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

// FieldSchema represents a field in a config or type
type FieldSchema struct {
	Name        string      `json:"name"`
	JsonName    string      `json:"jsonName"`
	ProtoField  string      `json:"protoField"`
	Type        TypeSpec    `json:"type"`
	Description string      `json:"description"`
	Required    bool        `json:"required"`
	Validation  *Validation `json:"validation,omitempty"`
}

// TypeSpec describes the type of a field
type TypeSpec struct {
	Kind        string    `json:"kind"` // string, int32, int64, bool, float, double, bytes, map, array, message, struct
	KeyType     *TypeSpec `json:"keyType,omitempty"`     // for map
	ValueType   *TypeSpec `json:"valueType,omitempty"`   // for map
	ElementType *TypeSpec `json:"elementType,omitempty"` // for array
	MessageType string    `json:"messageType,omitempty"` // for message
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

// Generator generates Go code from JSON schemas
type Generator struct {
	schemaDir   string
	outputDir   string
	packageName string

	// Loaded schemas
	taskConfigs []*TaskConfigSchema
	sharedTypes []*TypeSchema
}

// NewGenerator creates a new code generator
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

	return nil
}

// loadSchemas loads all JSON schemas from the schema directory
func (g *Generator) loadSchemas() error {
	// Load task configs
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
			fmt.Printf("  Loaded task: %s\n", schema.Name)
		}
	}

	// Load shared types
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

			g.sharedTypes = append(g.sharedTypes, schema)
			fmt.Printf("  Loaded type: %s\n", schema.Name)
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

// generateHelpers generates a helpers.go file with utility functions
func (g *Generator) generateHelpers() error {
	var buf bytes.Buffer

	// File header
	fmt.Fprintf(&buf, "// Code generated by stigmer-codegen. DO NOT EDIT.\n")
	fmt.Fprintf(&buf, "// Generated: %s\n\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Import reflect for isEmpty
	fmt.Fprintf(&buf, "import \"reflect\"\n\n")

	// isEmpty function
	fmt.Fprintf(&buf, "// isEmpty checks if a value is empty/zero.\n")
	fmt.Fprintf(&buf, "// Used by ToProto methods to skip optional fields.\n")
	fmt.Fprintf(&buf, "func isEmpty(v interface{}) bool {\n")
	fmt.Fprintf(&buf, "\tif v == nil {\n")
	fmt.Fprintf(&buf, "\t\treturn true\n")
	fmt.Fprintf(&buf, "\t}\n")
	fmt.Fprintf(&buf, "\tval := reflect.ValueOf(v)\n")
	fmt.Fprintf(&buf, "\treturn val.IsZero()\n")
	fmt.Fprintf(&buf, "}\n")

	// Format and write
	fmt.Printf("  Generating helpers.go...\n")
	return g.writeFormattedFile("helpers.go", buf.Bytes())
}

// generateSharedTypes generates a types.go file with all shared types
func (g *Generator) generateSharedTypes() error {
	ctx := newGenContext(g.packageName)

	var buf bytes.Buffer

	// Generate package declaration
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate each shared type
	for _, typeSchema := range g.sharedTypes {
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
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: types.go\n"))
	finalBuf.WriteString(fmt.Sprintf("// Generated: %s\n\n", time.Now().Format(time.RFC3339)))
	finalBuf.WriteString(fmt.Sprintf("package %s\n\n", g.packageName))

	// Add imports if any were used
	if len(ctx.imports) > 0 {
		ctx.genImports(&finalBuf)
	}

	// Add generated code
	finalBuf.Write(buf.Bytes()[len("package "+g.packageName+"\n\n"):])

	// Format and write
	fmt.Printf("  Generating types.go...\n")
	return g.writeFormattedFile("types.go", finalBuf.Bytes())
}

// generateTaskFile generates a single file for a task config
func (g *Generator) generateTaskFile(taskConfig *TaskConfigSchema) error {
	ctx := newGenContext(g.packageName)

	var buf bytes.Buffer

	// Generate package and imports
	fmt.Fprintf(&buf, "package %s\n\n", g.packageName)

	// Generate config struct
	if err := ctx.genConfigStruct(&buf, taskConfig); err != nil {
		return err
	}

	// Generate builder function
	if err := ctx.genBuilderFunc(&buf, taskConfig); err != nil {
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

	// Add imports at the beginning (after package declaration)
	var finalBuf bytes.Buffer
	filename := fmt.Sprintf("%s_task.go", strings.ToLower(strings.ReplaceAll(taskConfig.Kind, "_", "")))
	finalBuf.WriteString(fmt.Sprintf("// Code generated by stigmer-codegen. DO NOT EDIT.\n"))
	finalBuf.WriteString(fmt.Sprintf("// Source: %s\n", filename))
	finalBuf.WriteString(fmt.Sprintf("// Generated: %s\n\n", time.Now().Format(time.RFC3339)))
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

// writeFormattedFile formats Go code and writes it to a file
func (g *Generator) writeFormattedFile(filename string, code []byte) error {
	// Format with gofmt
	formatted, err := format.Source(code)
	if err != nil {
		// Print the code for debugging
		fmt.Printf("\n=== UNFORMATTED CODE (contains errors) ===\n%s\n", string(code))
		return fmt.Errorf("failed to format %s: %w", filename, err)
	}

	// Write to file
	outputPath := filepath.Join(g.outputDir, filename)
	if err := os.WriteFile(outputPath, formatted, 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", filename, err)
	}

	return nil
}

// ============================================================================
// Generation Context
// ============================================================================

// genContext holds state during code generation
type genContext struct {
	packageName string
	imports     map[string]struct{}
	generated   map[string]struct{}
}

// newGenContext creates a new generation context
func newGenContext(packageName string) *genContext {
	return &genContext{
		packageName: packageName,
		imports:     make(map[string]struct{}),
		generated:   make(map[string]struct{}),
	}
}

// addImport adds an import to the context
func (c *genContext) addImport(pkg string) {
	c.imports[pkg] = struct{}{}
}

// genImports generates the import block
func (c *genContext) genImports(w *bytes.Buffer) {
	if len(c.imports) == 0 {
		return
	}

	// Sort imports for deterministic output
	imports := make([]string, 0, len(c.imports))
	for imp := range c.imports {
		imports = append(imports, imp)
	}
	sort.Strings(imports)

	// Write import block
	fmt.Fprintf(w, "import (\n")
	for _, imp := range imports {
		fmt.Fprintf(w, "\t\"%s\"\n", imp)
	}
	fmt.Fprintf(w, ")\n\n")
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
		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")

	// Generate isTaskConfig() method to implement TaskConfig interface
	fmt.Fprintf(w, "// isTaskConfig marks %s as a TaskConfig implementation.\n", config.Name)
	fmt.Fprintf(w, "func (c *%s) isTaskConfig() {}\n\n", config.Name)

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
		jsonTag := fmt.Sprintf("`json:\"%s,omitempty\"`", field.JsonName)
		fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
	}

	fmt.Fprintf(w, "}\n\n")
	return nil
}

// genBuilderFunc generates a builder function for a task config
func (c *genContext) genBuilderFunc(w *bytes.Buffer, config *TaskConfigSchema) error {
	// Function documentation
	kindTitle := strings.Title(strings.ToLower(strings.ReplaceAll(config.Kind, "_", " ")))
	fmt.Fprintf(w, "// %sTask creates a %s workflow task.\n", titleCase(config.Kind), kindTitle)
	fmt.Fprintf(w, "//\n")
	fmt.Fprintf(w, "// Parameters:\n")
	fmt.Fprintf(w, "//   - name: Task name (must be unique within workflow)\n")
	for _, field := range config.Fields {
		paramName := c.paramName(field.Name)
		desc := strings.ReplaceAll(field.Description, "\n", " ")
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
		if field.Required {
			fmt.Fprintf(w, "\tdata[\"%s\"] = c.%s\n", field.JsonName, field.Name)
		} else {
			// Optional field - only include if not zero value
			fmt.Fprintf(w, "\tif !isEmpty(c.%s) {\n", field.Name)
			fmt.Fprintf(w, "\t\tdata[\"%s\"] = c.%s\n", field.JsonName, field.Name)
			fmt.Fprintf(w, "\t}\n")
		}
	}

	fmt.Fprintf(w, "\n\treturn structpb.NewStruct(data)\n")
	fmt.Fprintf(w, "}\n\n")

	return nil
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

	case "int64":
		fmt.Fprintf(w, "\t\tc.%s = int64(val.GetNumberValue())\n", field.Name)

	case "bool":
		fmt.Fprintf(w, "\t\tc.%s = val.GetBoolValue()\n", field.Name)

	case "map":
		if field.Type.KeyType.Kind == "string" && field.Type.ValueType.Kind == "string" {
			fmt.Fprintf(w, "\t\tc.%s = make(map[string]string)\n", field.Name)
			fmt.Fprintf(w, "\t\tfor k, v := range val.GetStructValue().GetFields() {\n")
			fmt.Fprintf(w, "\t\t\tc.%s[k] = v.GetStringValue()\n", field.Name)
			fmt.Fprintf(w, "\t\t}\n")
		}

	case "struct":
		fmt.Fprintf(w, "\t\tc.%s = val.GetStructValue().AsMap()\n", field.Name)

	case "message":
		fmt.Fprintf(w, "\t\tc.%s = &%s{}\n", field.Name, field.Type.MessageType)
		fmt.Fprintf(w, "\t\tif err := c.%s.FromProto(val.GetStructValue()); err != nil {\n", field.Name)
		fmt.Fprintf(w, "\t\t\treturn err\n")
		fmt.Fprintf(w, "\t\t}\n")
	}

	fmt.Fprintf(w, "\t}\n\n")
}

// goType converts a TypeSpec to a Go type string
func (c *genContext) goType(typeSpec TypeSpec) string {
	switch typeSpec.Kind {
	case "string":
		return "string"
	case "int32":
		return "int32"
	case "int64":
		return "int64"
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
		// Pointer for proto compatibility
		return "*" + typeSpec.MessageType

	case "struct":
		// google.protobuf.Struct → map[string]interface{}
		return "map[string]interface{}"

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

// ============================================================================
// Main
// ============================================================================

func main() {
	schemaDir := flag.String("schema-dir", "tools/codegen/schemas", "Directory containing JSON schemas")
	outputDir := flag.String("output-dir", "sdk/go/workflow/gen", "Output directory for generated Go code")
	packageName := flag.String("package", "gen", "Go package name for generated code")
	flag.Parse()

	if *schemaDir == "" || *outputDir == "" {
		fmt.Println("Usage: generator --schema-dir <dir> --output-dir <dir> --package <name>")
		os.Exit(1)
	}

	fmt.Printf("Generating Go code from schemas in %s\n", *schemaDir)
	fmt.Printf("Output directory: %s\n", *outputDir)
	fmt.Printf("Package name: %s\n", *packageName)

	// Create generator
	gen, err := NewGenerator(*schemaDir, *outputDir, *packageName)
	if err != nil {
		fmt.Printf("Error creating generator: %v\n", err)
		os.Exit(1)
	}

	// Generate code
	if err := gen.Generate(); err != nil {
		fmt.Printf("Error generating code: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("\n✅ Code generation complete!")
}
