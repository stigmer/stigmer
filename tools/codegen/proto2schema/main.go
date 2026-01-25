// proto2schema converts Protocol Buffer definitions to JSON schemas for code generation.
//
// This tool parses .proto files and extracts:
// - Message definitions (task configs, shared types)
// - Field names, types, and metadata
// - Comments and documentation
// - buf.validate validation rules
//
// Output is JSON schema files used by the code generator.
//
// Usage:
//   go run tools/codegen/proto2schema/main.go \
//     --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
//     --output-dir tools/codegen/schemas/tasks

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/descriptorpb"
)

// Schema types matching our design

type PackageSchema struct {
	Name        string              `json:"name"`
	Version     string              `json:"version"`
	Description string              `json:"description"`
	GoPackage   string              `json:"goPackage"`
	TaskConfigs []*TaskConfigSchema `json:"taskConfigs,omitempty"`
	SharedTypes []*TypeSchema       `json:"sharedTypes,omitempty"`
}

type TaskConfigSchema struct {
	Name        string         `json:"name"`
	Kind        string         `json:"kind,omitempty"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

type TypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

type FieldSchema struct {
	Name         string      `json:"name"`
	JsonName     string      `json:"jsonName"`
	ProtoField   string      `json:"protoField"`
	Type         TypeSpec    `json:"type"`
	Description  string      `json:"description"`
	Required     bool        `json:"required"`
	IsExpression bool        `json:"isExpression,omitempty"`
	Validation   *Validation `json:"validation,omitempty"`
}

type TypeSpec struct {
	Kind        string    `json:"kind"`                  // string, int32, bool, map, array, message, struct
	KeyType     *TypeSpec `json:"keyType,omitempty"`     // for map
	ValueType   *TypeSpec `json:"valueType,omitempty"`   // for map
	ElementType *TypeSpec `json:"elementType,omitempty"` // for array
	MessageType string    `json:"messageType,omitempty"` // for message
}

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

func main() {
	protoDir := flag.String("proto-dir", "", "Directory containing .proto files")
	outputDir := flag.String("output-dir", "", "Output directory for JSON schemas")
	includeDir := flag.String("include-dir", "apis", "Directory containing proto imports")
	useBufCache := flag.Bool("use-buf-cache", true, "Use buf's module cache for dependencies")
	messageSuffix := flag.String("message-suffix", "TaskConfig", "Suffix of messages to extract (TaskConfig, Spec, etc)")
	comprehensive := flag.Bool("comprehensive", false, "Generate schemas for ALL proto namespaces under agentic/")
	flag.Parse()

	if !*comprehensive && (*protoDir == "" || *outputDir == "") {
		fmt.Println("Usage: proto2schema --proto-dir <dir> --output-dir <dir> [--include-dir <dir>] [--use-buf-cache] [--message-suffix <suffix>]")
		fmt.Println("   OR: proto2schema --comprehensive [--include-dir <dir>] [--output-dir <dir>]")
		os.Exit(1)
	}

	if *comprehensive {
		// Comprehensive mode: scan all agentic namespaces
		fmt.Println("🚀 Comprehensive schema generation mode")
		if err := runComprehensiveGeneration(*includeDir, *outputDir, *useBufCache); err != nil {
			fmt.Printf("Error in comprehensive generation: %v\n", err)
			os.Exit(1)
		}
		return
	}

	fmt.Printf("Converting proto files from %s to JSON schemas in %s\n", *protoDir, *outputDir)

	// Create output directory
	if err := os.MkdirAll(*outputDir, 0755); err != nil {
		fmt.Printf("Error creating output directory: %v\n", err)
		os.Exit(1)
	}

	// Find all .proto files
	protoFiles, err := findProtoFiles(*protoDir)
	if err != nil {
		fmt.Printf("Error finding proto files: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Found %d proto files\n", len(protoFiles))

	// Build import paths
	importPaths := []string{*includeDir}

	// Add buf module cache if enabled (for dependencies like buf/validate)
	if *useBufCache {
		// Buf v3 cache structure: ~/.cache/buf/v3/modules/<digest>/<org>/<repo>/<commit>/files/
		// We need to find the protovalidate module
		homeDir, err := os.UserHomeDir()
		if err == nil {
			bufCachePath := filepath.Join(homeDir, ".cache", "buf", "v3", "modules", "b5", "buf.build", "bufbuild", "protovalidate")
			// Find the latest commit directory
			if entries, err := os.ReadDir(bufCachePath); err == nil && len(entries) > 0 {
				// Use the first (most recent) commit hash directory
				for _, entry := range entries {
					if entry.IsDir() {
						filesPath := filepath.Join(bufCachePath, entry.Name(), "files")
						if _, err := os.Stat(filesPath); err == nil {
							importPaths = append([]string{filesPath}, importPaths...)
							fmt.Printf("Using buf cache: %s\n", filesPath)
							break
						}
					}
				}
			}
		}
	}

	// Parse proto files
	parser := &protoparse.Parser{
		ImportPaths:           importPaths,
		IncludeSourceCodeInfo: true,
	}

	// Convert paths to relative paths from include dir
	var relativeProtoFiles []string
	for _, protoFile := range protoFiles {
		relPath, err := filepath.Rel(*includeDir, protoFile)
		if err != nil {
			fmt.Printf("Error getting relative path for %s: %v\n", protoFile, err)
			os.Exit(1)
		}
		relativeProtoFiles = append(relativeProtoFiles, relPath)
	}

	fileDescriptors, err := parser.ParseFiles(relativeProtoFiles...)
	if err != nil {
		fmt.Printf("Error parsing proto files: %v\n", err)
		os.Exit(1)
	}

	// Track all message types we've seen
	taskConfigs := make(map[string]*TaskConfigSchema)
	sharedTypes := make(map[string]*TypeSchema)

	// First pass: Extract all messages with the specified suffix
	for _, fd := range fileDescriptors {
		fmt.Printf("\nProcessing %s...\n", fd.GetName())

		// Find messages with the specified suffix in this file
		for _, msg := range fd.GetMessageTypes() {
			if strings.HasSuffix(msg.GetName(), *messageSuffix) {
				fmt.Printf("  Found message: %s\n", msg.GetName())

				schema, err := parseTaskConfig(msg, fd)
				if err != nil {
					fmt.Printf("  Error parsing message: %v\n", err)
					continue
				}

				taskConfigs[msg.GetName()] = schema

				// Also collect any nested message types referenced by this message
				collectNestedTypes(msg, fd, sharedTypes)
			}
		}
	}

	// Write message schemas
	fmt.Printf("\nWriting message schemas...\n")
	for name, schema := range taskConfigs {
		baseName := strings.ToLower(strings.TrimSuffix(name, *messageSuffix))
		schemaFile := filepath.Join(*outputDir, baseName+".json")

		if err := writeSchemaFile(schema, schemaFile); err != nil {
			fmt.Printf("  Error writing %s: %v\n", baseName, err)
			continue
		}

		fmt.Printf("  → %s\n", schemaFile)
	}

	// Write shared type schemas to a types subdirectory
	if len(sharedTypes) > 0 {
		typesDir := filepath.Join(filepath.Dir(*outputDir), "types")
		if err := os.MkdirAll(typesDir, 0755); err != nil {
			fmt.Printf("Error creating types directory: %v\n", err)
		} else {
			fmt.Printf("\nWriting shared type schemas...\n")
			for name, typeSchema := range sharedTypes {
				baseName := strings.ToLower(name)
				schemaFile := filepath.Join(typesDir, baseName+".json")

				if err := writeSchemaFile(typeSchema, schemaFile); err != nil {
					fmt.Printf("  Error writing %s: %v\n", baseName, err)
					continue
				}

				fmt.Printf("  → %s\n", schemaFile)
			}
		}
	}

	fmt.Println("\n✅ Schema generation complete!")
}

// runComprehensiveGeneration scans all proto namespaces and generates schemas.
// This includes agentic, iam, and tenancy namespaces.
func runComprehensiveGeneration(includeDir, baseOutputDir string, useBufCache bool) error {
	// Default output directory
	if baseOutputDir == "" {
		baseOutputDir = "tools/codegen/schemas"
	}

	stigmerDir := filepath.Join(includeDir, "ai", "stigmer")

	// Define all top-level namespaces to scan
	// Each namespace has its own directory structure under apis/ai/stigmer/
	topLevelNamespaces := []struct {
		name     string   // Directory name (e.g., "agentic", "iam", "tenancy")
		skip     []string // Subdirectories to skip
		flatScan bool     // If true, scan subdirectories (iam/apikey), if false, scan direct children (agentic/agent)
	}{
		{name: "agentic", skip: []string{"session"}, flatScan: false},
		{name: "iam", skip: nil, flatScan: true},
		{name: "tenancy", skip: nil, flatScan: true},
	}

	fmt.Printf("📁 Scanning namespaces in %s\n\n", stigmerDir)

	for _, ns := range topLevelNamespaces {
		namespaceDir := filepath.Join(stigmerDir, ns.name)
		if _, err := os.Stat(namespaceDir); os.IsNotExist(err) {
			fmt.Printf("⏭️  Skipping %s (directory not found)\n", ns.name)
			continue
		}

		fmt.Printf("📦 Processing top-level namespace: %s\n", ns.name)

		// Read subdirectories
		subDirs, err := os.ReadDir(namespaceDir)
		if err != nil {
			fmt.Printf("   ❌ Error reading directory: %v\n", err)
			continue
		}

		for _, subDir := range subDirs {
			if !subDir.IsDir() {
				continue
			}

			subDirName := subDir.Name()

			// Check if this subdirectory should be skipped
			shouldSkip := false
			for _, skipName := range ns.skip {
				if subDirName == skipName {
					shouldSkip = true
					break
				}
			}
			if shouldSkip {
				fmt.Printf("   ⏭️  Skipping %s/%s (internal only)\n", ns.name, subDirName)
				continue
			}

			fmt.Printf("   📄 Processing %s/%s\n", ns.name, subDirName)

			// Path to proto files - structure is <namespace>/<subdomain>/v1/
			protoDir := filepath.Join(namespaceDir, subDirName, "v1")
			if _, err := os.Stat(protoDir); os.IsNotExist(err) {
				fmt.Printf("      ⚠️  No v1 directory found, skipping\n")
				continue
			}

			// Output directory preserves the namespace hierarchy
			outputDir := filepath.Join(baseOutputDir, ns.name, subDirName)

			// Generate schemas for Spec messages
			if err := generateNamespaceSchemas(protoDir, outputDir, includeDir, useBufCache, "Spec"); err != nil {
				fmt.Printf("      ❌ Error: %v\n", err)
				continue
			}

			fmt.Printf("      ✅ Generated schemas\n")
		}

		fmt.Println()
	}

	// Process workflow tasks (special case - nested under agentic/workflow/v1/tasks/)
	fmt.Printf("📦 Processing workflow tasks\n")
	agenticDir := filepath.Join(stigmerDir, "agentic")
	workflowTasksDir := filepath.Join(agenticDir, "workflow", "v1", "tasks")
	tasksOutputDir := filepath.Join(baseOutputDir, "tasks")
	if err := generateNamespaceSchemas(workflowTasksDir, tasksOutputDir, includeDir, useBufCache, "TaskConfig"); err != nil {
		fmt.Printf("   ❌ Error: %v\n", err)
	} else {
		fmt.Printf("   ✅ Generated workflow task schemas\n\n")
	}

	fmt.Println("🎉 Comprehensive schema generation complete!")
	return nil
}

// generateNamespaceSchemas generates schemas for a specific namespace
func generateNamespaceSchemas(protoDir, outputDir, includeDir string, useBufCache bool, messageSuffix string) error {
	// Create output directory
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	// Find all .proto files
	protoFiles, err := findProtoFiles(protoDir)
	if err != nil {
		return fmt.Errorf("failed to find proto files: %w", err)
	}

	if len(protoFiles) == 0 {
		return nil // No proto files, skip
	}

	// Build import paths
	importPaths := []string{includeDir}

	// Add buf module cache if enabled
	if useBufCache {
		homeDir, err := os.UserHomeDir()
		if err == nil {
			bufCachePath := filepath.Join(homeDir, ".cache", "buf", "v3", "modules", "b5", "buf.build", "bufbuild", "protovalidate")
			if entries, err := os.ReadDir(bufCachePath); err == nil && len(entries) > 0 {
				for _, entry := range entries {
					if entry.IsDir() {
						filesPath := filepath.Join(bufCachePath, entry.Name(), "files")
						if _, err := os.Stat(filesPath); err == nil {
							importPaths = append([]string{filesPath}, importPaths...)
							break
						}
					}
				}
			}
		}
	}

	// Parse proto files
	parser := &protoparse.Parser{
		ImportPaths:           importPaths,
		IncludeSourceCodeInfo: true,
	}

	// Convert paths to relative paths from include dir
	var relativeProtoFiles []string
	for _, protoFile := range protoFiles {
		relPath, err := filepath.Rel(includeDir, protoFile)
		if err != nil {
			return fmt.Errorf("failed to get relative path for %s: %w", protoFile, err)
		}
		relativeProtoFiles = append(relativeProtoFiles, relPath)
	}

	fileDescriptors, err := parser.ParseFiles(relativeProtoFiles...)
	if err != nil {
		return fmt.Errorf("failed to parse proto files: %w", err)
	}

	// Track all message types
	taskConfigs := make(map[string]*TaskConfigSchema)
	sharedTypes := make(map[string]*TypeSchema)

	// Extract all messages with the specified suffix
	for _, fd := range fileDescriptors {
		for _, msg := range fd.GetMessageTypes() {
			if strings.HasSuffix(msg.GetName(), messageSuffix) {
				schema, err := parseTaskConfig(msg, fd)
				if err != nil {
					continue
				}
				taskConfigs[msg.GetName()] = schema
				collectNestedTypes(msg, fd, sharedTypes)
			}
		}
	}

	// Write message schemas
	for name, schema := range taskConfigs {
		baseName := strings.ToLower(strings.TrimSuffix(name, messageSuffix))
		schemaFile := filepath.Join(outputDir, baseName+".json")

		if err := writeSchemaFile(schema, schemaFile); err != nil {
			continue
		}
		fmt.Printf("   → %s\n", filepath.Base(schemaFile))
	}

	// Write shared type schemas to a types subdirectory
	if len(sharedTypes) > 0 {
		typesDir := filepath.Join(outputDir, "types")
		if err := os.MkdirAll(typesDir, 0755); err == nil {
			for name, typeSchema := range sharedTypes {
				baseName := strings.ToLower(name)
				schemaFile := filepath.Join(typesDir, baseName+".json")
				if err := writeSchemaFile(typeSchema, schemaFile); err != nil {
					continue
				}
				fmt.Printf("   → types/%s\n", filepath.Base(schemaFile))
			}
		}
	}

	return nil
}

func findProtoFiles(dir string) ([]string, error) {
	var protoFiles []string

	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() && strings.HasSuffix(path, ".proto") {
			protoFiles = append(protoFiles, path)
		}

		return nil
	})

	return protoFiles, err
}

// collectNestedTypes recursively collects all nested message types referenced by a message
func collectNestedTypes(msg *desc.MessageDescriptor, fd *desc.FileDescriptor, sharedTypes map[string]*TypeSchema) {
	for _, field := range msg.GetFields() {
		// Handle map fields specially - check the value type
		if field.IsMap() {
			mapEntry := field.GetMessageType()
			if mapEntry != nil {
				// Map entry has two fields: key (index 0) and value (index 1)
				valueField := mapEntry.GetFields()[1]
				if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
					msgType := valueField.GetMessageType()
					if msgType != nil && !strings.HasPrefix(msgType.GetFullyQualifiedName(), "google.protobuf") {
						typeName := msgType.GetName()
						if _, exists := sharedTypes[typeName]; !exists {
							msgFd := msgType.GetFile()
							sharedTypes[typeName] = parseSharedType(msgType, msgFd)
							fmt.Printf("    Found shared type (map value): %s\n", typeName)
							collectNestedTypes(msgType, msgFd, sharedTypes)
						}
					}
				}
			}
		} else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
			msgType := field.GetMessageType()
			// Skip google.protobuf types and map entry types
			if msgType != nil &&
				!strings.HasPrefix(msgType.GetFullyQualifiedName(), "google.protobuf") &&
				!msgType.IsMapEntry() {
				typeName := msgType.GetName()
				if _, exists := sharedTypes[typeName]; !exists {
					// Get the file descriptor for this message type
					msgFd := msgType.GetFile()
					sharedTypes[typeName] = parseSharedType(msgType, msgFd)
					fmt.Printf("    Found shared type: %s\n", typeName)

					// Recursively collect types referenced by this type
					collectNestedTypes(msgType, msgFd, sharedTypes)
				}
			}
		}
	}
}

// parseSharedType parses a shared message type into a schema
func parseSharedType(msg *desc.MessageDescriptor, fd *desc.FileDescriptor) *TypeSchema {
	// Extract description from message comments
	description := extractComments(msg)

	// Build proto type name
	protoType := fmt.Sprintf("%s.%s", fd.GetPackage(), msg.GetName())

	// Build proto file path relative to apis/
	protoFile := fd.GetName()

	schema := &TypeSchema{
		Name:        msg.GetName(),
		Description: description,
		ProtoType:   protoType,
		ProtoFile:   filepath.Join("apis", protoFile),
		Fields:      make([]*FieldSchema, 0),
	}

	// Parse fields
	for _, field := range msg.GetFields() {
		fieldSchema, err := extractFieldSchema(field)
		if err != nil {
			// Skip fields that can't be parsed
			continue
		}
		schema.Fields = append(schema.Fields, fieldSchema)
	}

	return schema
}

// parseTaskConfig parses a TaskConfig message into a schema
func parseTaskConfig(msg *desc.MessageDescriptor, fd *desc.FileDescriptor) (*TaskConfigSchema, error) {
	// Extract task kind from message name (e.g., SetTaskConfig → SET)
	kind := extractTaskKind(msg.GetName())

	// Extract description from message comments
	description := extractComments(msg)

	// Build proto type name
	protoType := fmt.Sprintf("%s.%s", fd.GetPackage(), msg.GetName())

	// Build proto file path relative to apis/
	protoFile := fd.GetName()

	schema := &TaskConfigSchema{
		Name:        msg.GetName(),
		Kind:        kind,
		Description: description,
		ProtoType:   protoType,
		ProtoFile:   filepath.Join("apis", protoFile),
		Fields:      make([]*FieldSchema, 0),
	}

	// Parse fields
	for _, field := range msg.GetFields() {
		fieldSchema, err := extractFieldSchema(field)
		if err != nil {
			return nil, fmt.Errorf("failed to parse field %s: %w", field.GetName(), err)
		}
		schema.Fields = append(schema.Fields, fieldSchema)
	}

	return schema, nil
}

// extractFieldSchema extracts field schema from a proto field descriptor
func extractFieldSchema(field *desc.FieldDescriptor) (*FieldSchema, error) {
	// Extract field description from comments
	description := extractFieldComments(field)

	// Build field schema
	fieldSchema := &FieldSchema{
		Name:         strings.Title(strings.ReplaceAll(field.GetName(), "_", " ")),
		JsonName:     field.GetJSONName(),
		ProtoField:   field.GetName(),
		Type:         extractTypeSpec(field),
		Description:  description,
		Required:     false,
		IsExpression: extractIsExpression(field),
		Validation:   extractValidation(field),
	}

	// Capitalize field name properly
	fieldSchema.Name = toCamelCase(field.GetName(), true)

	// Check if field is required from buf.validate
	if fieldSchema.Validation != nil && fieldSchema.Validation.Required {
		fieldSchema.Required = true
	}

	return fieldSchema, nil
}

// extractTypeSpec extracts type specification from a proto field descriptor
func extractTypeSpec(field *desc.FieldDescriptor) TypeSpec {
	// Handle map fields FIRST (before checking IsRepeated, since maps are also repeated)
	if field.IsMap() {
		keyField := field.GetMapKeyType()
		valueField := field.GetMapValueType()

		keyType := extractScalarTypeSpec(keyField)
		valueType := extractScalarTypeSpec(valueField)

		return TypeSpec{
			Kind:      "map",
			KeyType:   &keyType,
			ValueType: &valueType,
		}
	}

	// Handle repeated fields (arrays)
	if field.IsRepeated() {
		elementType := extractScalarTypeSpec(field)
		return TypeSpec{
			Kind:        "array",
			ElementType: &elementType,
		}
	}

	// Handle scalar or message fields
	return extractScalarTypeSpec(field)
}

// extractScalarTypeSpec extracts type spec for scalar or message types
func extractScalarTypeSpec(field *desc.FieldDescriptor) TypeSpec {
	switch field.GetType() {
	case descriptorpb.FieldDescriptorProto_TYPE_STRING:
		return TypeSpec{Kind: "string"}
	case descriptorpb.FieldDescriptorProto_TYPE_INT32:
		return TypeSpec{Kind: "int32"}
	case descriptorpb.FieldDescriptorProto_TYPE_INT64:
		return TypeSpec{Kind: "int64"}
	case descriptorpb.FieldDescriptorProto_TYPE_BOOL:
		return TypeSpec{Kind: "bool"}
	case descriptorpb.FieldDescriptorProto_TYPE_FLOAT:
		return TypeSpec{Kind: "float"}
	case descriptorpb.FieldDescriptorProto_TYPE_DOUBLE:
		return TypeSpec{Kind: "double"}
	case descriptorpb.FieldDescriptorProto_TYPE_BYTES:
		return TypeSpec{Kind: "bytes"}
	case descriptorpb.FieldDescriptorProto_TYPE_MESSAGE:
		msgType := field.GetMessageType()

		// Special handling for google.protobuf.Struct
		if msgType.GetFullyQualifiedName() == "google.protobuf.Struct" {
			return TypeSpec{Kind: "struct"}
		}

		// Regular message type
		return TypeSpec{
			Kind:        "message",
			MessageType: msgType.GetName(),
		}
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		// For now, treat enums as strings
		return TypeSpec{Kind: "string"}
	default:
		return TypeSpec{Kind: "string"} // fallback
	}
}

// extractValidation extracts buf.validate validation rules from field options using protoreflect APIs.
// This properly parses the buf.validate.field extension instead of relying on brittle string matching.
func extractValidation(field *desc.FieldDescriptor) *Validation {
	opts := field.GetFieldOptions()
	if opts == nil {
		return nil
	}

	// Use proto.GetExtension to properly extract buf.validate.field rules
	ext := proto.GetExtension(opts, validate.E_Field)
	if ext == nil {
		return nil
	}

	fieldRules, ok := ext.(*validate.FieldRules)
	if !ok || fieldRules == nil {
		return nil
	}

	validation := &Validation{}
	hasValidation := false

	// Required constraint
	if fieldRules.GetRequired() {
		validation.Required = true
		hasValidation = true
	}

	// String constraints
	if strRules := fieldRules.GetString(); strRules != nil {
		if strRules.HasMinLen() {
			validation.MinLength = int(strRules.GetMinLen())
			hasValidation = true
		}
		if strRules.HasMaxLen() {
			validation.MaxLength = int(strRules.GetMaxLen())
			hasValidation = true
		}
		if strRules.HasPattern() {
			validation.Pattern = strRules.GetPattern()
			hasValidation = true
		}
		// String enum constraints (string.in)
		if len(strRules.GetIn()) > 0 {
			validation.Enum = strRules.GetIn()
			hasValidation = true
		}
	}

	// Int32 constraints
	if int32Rules := fieldRules.GetInt32(); int32Rules != nil {
		if gte := int32Rules.GetGte(); gte != 0 {
			validation.Min = int(gte)
			hasValidation = true
		}
		if lte := int32Rules.GetLte(); lte != 0 {
			validation.Max = int(lte)
			hasValidation = true
		}
		if gt := int32Rules.GetGt(); gt != 0 {
			validation.Min = int(gt) + 1
			hasValidation = true
		}
		if lt := int32Rules.GetLt(); lt != 0 {
			validation.Max = int(lt) - 1
			hasValidation = true
		}
	}

	// Int64 constraints
	if int64Rules := fieldRules.GetInt64(); int64Rules != nil {
		if gte := int64Rules.GetGte(); gte != 0 {
			validation.Min = int(gte)
			hasValidation = true
		}
		if lte := int64Rules.GetLte(); lte != 0 {
			validation.Max = int(lte)
			hasValidation = true
		}
		if gt := int64Rules.GetGt(); gt != 0 {
			validation.Min = int(gt) + 1
			hasValidation = true
		}
		if lt := int64Rules.GetLt(); lt != 0 {
			validation.Max = int(lt) - 1
			hasValidation = true
		}
	}

	// Float constraints
	if floatRules := fieldRules.GetFloat(); floatRules != nil {
		if gte := floatRules.GetGte(); gte != 0 {
			validation.Min = int(gte)
			hasValidation = true
		}
		if lte := floatRules.GetLte(); lte != 0 {
			validation.Max = int(lte)
			hasValidation = true
		}
	}

	// Double constraints
	if doubleRules := fieldRules.GetDouble(); doubleRules != nil {
		if gte := doubleRules.GetGte(); gte != 0 {
			validation.Min = int(gte)
			hasValidation = true
		}
		if lte := doubleRules.GetLte(); lte != 0 {
			validation.Max = int(lte)
			hasValidation = true
		}
	}

	// Repeated (array) constraints
	if repeatedRules := fieldRules.GetRepeated(); repeatedRules != nil {
		if minItems := repeatedRules.GetMinItems(); minItems != 0 {
			validation.MinItems = int(minItems)
			hasValidation = true
		}
		if maxItems := repeatedRules.GetMaxItems(); maxItems != 0 {
			validation.MaxItems = int(maxItems)
			hasValidation = true
		}
	}

	// Map constraints
	if mapRules := fieldRules.GetMap(); mapRules != nil {
		if minPairs := mapRules.GetMinPairs(); minPairs != 0 {
			validation.MinItems = int(minPairs)
			hasValidation = true
		}
		if maxPairs := mapRules.GetMaxPairs(); maxPairs != 0 {
			validation.MaxItems = int(maxPairs)
			hasValidation = true
		}
	}

	// Bytes constraints (similar to string)
	if bytesRules := fieldRules.GetBytes(); bytesRules != nil {
		if bytesRules.HasMinLen() {
			validation.MinLength = int(bytesRules.GetMinLen())
			hasValidation = true
		}
		if bytesRules.HasMaxLen() {
			validation.MaxLength = int(bytesRules.GetMaxLen())
			hasValidation = true
		}
		if bytesRules.HasPattern() {
			validation.Pattern = bytesRules.GetPattern()
			hasValidation = true
		}
	}

	if !hasValidation {
		return nil
	}

	return validation
}

// extractIsExpression extracts the is_expression field option
func extractIsExpression(field *desc.FieldDescriptor) bool {
	opts := field.GetFieldOptions()
	if opts == nil {
		return false
	}

	// Get the full proto text representation
	protoText := field.AsProto().String()
	optsStr := opts.String()
	fullText := protoText + " " + optsStr

	// Check for is_expression option
	// Patterns: "is_expression = true", "is_expression:true", "90203"
	if strings.Contains(fullText, "is_expression") &&
		(strings.Contains(fullText, "= true") ||
			strings.Contains(fullText, ":true") ||
			strings.Contains(fullText, ": true")) {
		return true
	}

	// Also check by field number (90203)
	// In protobuf binary format, boolean true is represented as 1
	if strings.Contains(fullText, "90203") &&
		(strings.Contains(fullText, ":1") ||
			strings.Contains(fullText, " 1") ||
			strings.Contains(fullText, "=1")) {
		return true
	}

	return false
}

// extractComments extracts documentation from a message descriptor
func extractComments(msg *desc.MessageDescriptor) string {
	sourceInfo := msg.GetSourceInfo()
	if sourceInfo == nil {
		return ""
	}

	comments := sourceInfo.GetLeadingComments()
	if comments != "" {
		// Clean up comments (remove leading/trailing whitespace)
		comments = strings.TrimSpace(comments)
	}

	return comments
}

// extractFieldComments extracts documentation from a field descriptor
func extractFieldComments(field *desc.FieldDescriptor) string {
	sourceInfo := field.GetSourceInfo()
	if sourceInfo == nil {
		return ""
	}

	comments := sourceInfo.GetLeadingComments()
	if comments != "" {
		// Clean up comments (remove leading/trailing whitespace)
		comments = strings.TrimSpace(comments)
	}

	return comments
}

// extractTaskKind extracts task kind from message name
// Example: SetTaskConfig → SET, HttpCallTaskConfig → HTTP_CALL
func extractTaskKind(messageName string) string {
	// Remove "TaskConfig" suffix
	name := strings.TrimSuffix(messageName, "TaskConfig")

	// Convert camelCase to UPPER_SNAKE_CASE
	var result []rune
	for i, r := range name {
		if i > 0 && r >= 'A' && r <= 'Z' {
			result = append(result, '_')
		}
		result = append(result, r)
	}

	return strings.ToUpper(string(result))
}

// toCamelCase converts snake_case to CamelCase
func toCamelCase(s string, capitalizeFirst bool) string {
	parts := strings.Split(s, "_")
	for i, part := range parts {
		if i == 0 && !capitalizeFirst {
			continue
		}
		if len(part) > 0 {
			parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
	}
	return strings.Join(parts, "")
}

// writeSchemaFile writes a schema to a JSON file
func writeSchemaFile(schema interface{}, outputPath string) error {
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(outputPath, data, 0644)
}
