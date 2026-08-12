// proto2schema converts Protocol Buffer definitions to JSON schemas for code generation.
//
// This tool parses .proto files and extracts:
// - Message definitions (task configs, shared types)
// - Service definitions (RPC methods for SDK client generation)
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
	"sort"
	"strings"

	"buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go/buf/validate"
	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
	"google.golang.org/protobuf/encoding/protowire"
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
	Name               string         `json:"name"`
	Kind               string         `json:"kind,omitempty"`
	Description        string         `json:"description"`
	ProtoType          string         `json:"protoType"`
	ProtoFile          string         `json:"protoFile"`
	DiscriminatorValue string         `json:"discriminatorValue,omitempty"`
	Fields             []*FieldSchema `json:"fields"`
}

type TypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

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

type TypeSpec struct {
	Kind        string    `json:"kind"`                  // string, int32, bool, map, array, message, struct
	KeyType     *TypeSpec `json:"keyType,omitempty"`     // for map
	ValueType   *TypeSpec `json:"valueType,omitempty"`   // for map
	ElementType *TypeSpec `json:"elementType,omitempty"` // for array
	MessageType string    `json:"messageType,omitempty"` // for message
	EnumType    string    `json:"enumType,omitempty"`    // fully-qualified proto enum type
	EnumValues  []string  `json:"enumValues,omitempty"`  // valid enum value names (excludes UNSPECIFIED sentinel)
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

// EnumSchema describes a proto enum type referenced by resource fields,
// extracted for SDK documentation.
type EnumSchema struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ProtoType   string            `json:"protoType"`
	Values      []EnumValueSchema `json:"values"`
}

// EnumValueSchema describes a single value within a proto enum.
type EnumValueSchema struct {
	Name        string `json:"name"`
	Number      int32  `json:"number"`
	Description string `json:"description"`
}

// ServiceSchemaFile represents all services for a single resource,
// written to tools/codegen/schemas/services/<resource>.json.
type ServiceSchemaFile struct {
	Resource            string              `json:"resource"`
	Package             string              `json:"package"`
	GoImportPath        string              `json:"goImportPath"`
	Services            []ServiceDefinition `json:"services"`
	ListVia             string              `json:"listVia,omitempty"`
	MethodTypes         []TypeSchema        `json:"methodTypes,omitempty"`
	EnumTypes           []EnumSchema        `json:"enumTypes,omitempty"`
	ResourceDescription string              `json:"resourceDescription,omitempty"`
	StatusType          *TypeSchema         `json:"statusType,omitempty"`
	StatusNestedTypes   []TypeSchema        `json:"statusNestedTypes,omitempty"`
}

// ServiceDefinition describes a single gRPC service (e.g., AgentQueryController).
type ServiceDefinition struct {
	Name      string         `json:"name"`
	Role      string         `json:"role"` // "query", "command", etc.
	ProtoFile string         `json:"protoFile,omitempty"`
	Methods   []MethodSchema `json:"methods"`
}

// MethodSchema describes a single RPC method.
type MethodSchema struct {
	Name            string `json:"name"`
	InputType       string `json:"inputType"`
	InputFullType   string `json:"inputFullType"`
	OutputType      string `json:"outputType"`
	OutputFullType  string `json:"outputFullType"`
	ServerStreaming bool   `json:"serverStreaming,omitempty"`
	ClientStreaming bool   `json:"clientStreaming,omitempty"`
	Description     string `json:"description,omitempty"`
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
		{name: "agentic", skip: nil, flatScan: false},
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

	// Generate SDK service schemas for all resources with gRPC services
	fmt.Printf("📦 Processing SDK service schemas\n")
	if err := generateSDKServiceSchemas(includeDir, baseOutputDir, useBufCache); err != nil {
		fmt.Printf("   ❌ Error: %v\n", err)
	} else {
		fmt.Printf("   ✅ Generated SDK service schemas\n\n")
	}

	fmt.Println("🎉 Comprehensive schema generation complete!")
	return nil
}

// generateNamespaceSchemas generates schemas for a specific namespace
func generateNamespaceSchemas(protoDir, outputDir, includeDir string, useBufCache bool, messageSuffix string) error {
	// Wipe and recreate to remove stale schemas from previous runs.
	os.RemoveAll(outputDir)
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
		Name:               msg.GetName(),
		Kind:               kind,
		Description:        description,
		ProtoType:          protoType,
		ProtoFile:          filepath.Join("apis", protoFile),
		DiscriminatorValue: extractDiscriminatorValue(msg),
		Fields:             make([]*FieldSchema, 0),
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
	description := extractFieldComments(field)

	fieldSchema := &FieldSchema{
		Name:            toCamelCase(field.GetName(), true),
		JsonName:        field.GetJSONName(),
		ProtoField:      field.GetName(),
		Type:            extractTypeSpec(field),
		Description:     description,
		Required:        false,
		IsExpression:    extractIsExpression(field),
		ReferenceKind:   extractReferenceKind(field),
		DiscriminatedBy: extractDiscriminatedBy(field),
		Validation:      extractValidation(field),
	}

	if oo := field.GetOneOf(); oo != nil {
		fieldSchema.OneofGroup = oo.GetName()
	}

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
	case descriptorpb.FieldDescriptorProto_TYPE_UINT32:
		return TypeSpec{Kind: "uint32"}
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

		switch msgType.GetFullyQualifiedName() {
		case "google.protobuf.Struct":
			return TypeSpec{Kind: "struct"}
		case "google.protobuf.Value":
			return TypeSpec{Kind: "value"}
		case "google.protobuf.Timestamp":
			return TypeSpec{Kind: "timestamp"}
		}

		// Regular message type
		return TypeSpec{
			Kind:        "message",
			MessageType: msgType.GetName(),
		}
	case descriptorpb.FieldDescriptorProto_TYPE_ENUM:
		enumDesc := field.GetEnumType()
		fqn := fmt.Sprintf("%s.%s", enumDesc.GetFile().GetPackage(), enumDesc.GetName())
		var enumValues []string
		for _, v := range enumDesc.GetValues() {
			if v.GetNumber() == 0 {
				continue
			}
			enumValues = append(enumValues, v.GetName())
		}
		return TypeSpec{Kind: "string", EnumType: fqn, EnumValues: enumValues}
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

// referenceKindFieldNumber is the proto field number for the reference_kind
// extension defined in field_options.proto. We read it from unknown fields
// because the Go proto registry may not have the latest extension registered.
const referenceKindFieldNumber = 90204

// extractReferenceKind extracts the reference_kind field option value.
// Returns the ApiResourceKind enum integer (e.g., 43=skill, 44=mcp_server)
// or 0 if not set.
func extractReferenceKind(field *desc.FieldDescriptor) int32 {
	opts := field.GetFieldOptions()
	if opts == nil {
		return 0
	}

	raw := opts.ProtoReflect().GetUnknown()
	for len(raw) > 0 {
		num, typ, n := protowire.ConsumeTag(raw)
		if n < 0 {
			break
		}
		raw = raw[n:]

		switch typ {
		case protowire.VarintType:
			v, vn := protowire.ConsumeVarint(raw)
			if vn < 0 {
				return 0
			}
			if num == referenceKindFieldNumber {
				return int32(v)
			}
			raw = raw[vn:]
		case protowire.Fixed32Type:
			raw = raw[4:]
		case protowire.Fixed64Type:
			raw = raw[8:]
		case protowire.BytesType:
			_, bn := protowire.ConsumeBytes(raw)
			if bn < 0 {
				return 0
			}
			raw = raw[bn:]
		default:
			return 0
		}
	}
	return 0
}

const discriminatedByFieldNumber = 90205

// extractDiscriminatedBy extracts the discriminated_by field option value.
// Returns the sibling discriminator field name, or empty string if not set.
func extractDiscriminatedBy(field *desc.FieldDescriptor) string {
	opts := field.GetFieldOptions()
	if opts == nil {
		return ""
	}
	return extractStringFromUnknownFields(opts.ProtoReflect().GetUnknown(), discriminatedByFieldNumber)
}

const discriminatorValueFieldNumber = 90301

// extractDiscriminatorValue extracts the discriminator_value message option.
// Returns the enum string value this message corresponds to, or empty string if not set.
func extractDiscriminatorValue(msg *desc.MessageDescriptor) string {
	opts := msg.GetMessageOptions()
	if opts == nil {
		return ""
	}
	return extractStringFromUnknownFields(opts.ProtoReflect().GetUnknown(), discriminatorValueFieldNumber)
}

// extractStringFromUnknownFields reads a string extension value from proto unknown fields.
func extractStringFromUnknownFields(raw []byte, targetFieldNumber protowire.Number) string {
	for len(raw) > 0 {
		num, typ, n := protowire.ConsumeTag(raw)
		if n < 0 {
			break
		}
		raw = raw[n:]
		switch typ {
		case protowire.VarintType:
			_, vn := protowire.ConsumeVarint(raw)
			if vn < 0 {
				return ""
			}
			raw = raw[vn:]
		case protowire.Fixed32Type:
			raw = raw[4:]
		case protowire.Fixed64Type:
			raw = raw[8:]
		case protowire.BytesType:
			v, bn := protowire.ConsumeBytes(raw)
			if bn < 0 {
				return ""
			}
			if num == targetFieldNumber {
				return string(v)
			}
			raw = raw[bn:]
		default:
			return ""
		}
	}
	return ""
}

// stripInternalSection reduces a raw proto leading comment to its SDK-facing
// content: everything from the @internal marker line onward is discarded and
// the result is whitespace-trimmed.
//
// Convention: a comment line that is exactly "@internal" (ignoring
// surrounding whitespace) marks the start of proto-source-only content —
// implementation notes, authorization details, storage strategy. That text
// is for developers reading the proto files and must never reach a
// generated surface: SDK type docs, MCP tool schemas (read by LLMs), the
// task registry, or the docs site.
//
// This function is the single owner of that convention. It runs here, at
// the only point where proto comments enter the codegen toolchain, so every
// schema consumer — current and future — receives SDK-facing text only and
// no generator needs to know the marker exists (oss#327). The marker must
// be a full line: inline occurrences of "@internal" inside prose are left
// alone, matching how every proto in apis/ uses the convention.
func stripInternalSection(comment string) string {
	lines := strings.Split(comment, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) == "@internal" {
			lines = lines[:i]
			break
		}
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// extractComments extracts SDK-facing documentation from a message descriptor.
func extractComments(msg *desc.MessageDescriptor) string {
	sourceInfo := msg.GetSourceInfo()
	if sourceInfo == nil {
		return ""
	}
	return stripInternalSection(sourceInfo.GetLeadingComments())
}

// extractFieldComments extracts SDK-facing documentation from a field descriptor.
func extractFieldComments(field *desc.FieldDescriptor) string {
	sourceInfo := field.GetSourceInfo()
	if sourceInfo == nil {
		return ""
	}
	return stripInternalSection(sourceInfo.GetLeadingComments())
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

// CommonsSchemaFile holds shared types and enums from the commons package,
// written to tools/codegen/schemas/services/commons.json.
type CommonsSchemaFile struct {
	MessageTypes []TypeSchema `json:"messageTypes"`
	EnumTypes    []EnumSchema `json:"enumTypes"`
}

// sdkFacingCommonsTypes is the curated set of commons message types that
// should appear in SDK reference documentation. Internal types like
// AuthorizationConfig and ApiResourceKindMeta are excluded.
var sdkFacingCommonsTypes = map[string]bool{
	"ApiResourceMetadata":        true,
	"ApiResourceMetadataVersion": true,
	"ApiResourceAudit":           true,
	"ApiResourceAuditInfo":       true,
	"ApiResourceAuditActor":      true,
}

// sdkFacingCommonsEnums is the curated set of commons enum types that
// should appear in SDK reference documentation.
var sdkFacingCommonsEnums = map[string]bool{
	"ApiResourceVisibility": true,
	"ApiResourceKind":       true,
}

// extractCommonsSchema parses the commons proto files and extracts SDK-facing
// shared types and enums into a CommonsSchemaFile.
func extractCommonsSchema(includeDir string, useBufCache bool) (*CommonsSchemaFile, error) {
	commonsDirs := []string{
		filepath.Join(includeDir, "ai", "stigmer", "commons", "apiresource"),
		filepath.Join(includeDir, "ai", "stigmer", "commons", "apiresource", "apiresourcekind"),
	}

	var allProtoFiles []string
	for _, dir := range commonsDirs {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}
		files, err := findProtoFiles(dir)
		if err != nil {
			continue
		}
		allProtoFiles = append(allProtoFiles, files...)
	}

	if len(allProtoFiles) == 0 {
		return nil, fmt.Errorf("no commons proto files found")
	}

	importPaths := []string{includeDir}
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

	parser := &protoparse.Parser{
		ImportPaths:           importPaths,
		IncludeSourceCodeInfo: true,
	}

	var relativeFiles []string
	for _, pf := range allProtoFiles {
		relPath, err := filepath.Rel(includeDir, pf)
		if err != nil {
			continue
		}
		relativeFiles = append(relativeFiles, relPath)
	}

	fileDescriptors, err := parser.ParseFiles(relativeFiles...)
	if err != nil {
		return nil, fmt.Errorf("failed to parse commons protos: %w", err)
	}

	schema := &CommonsSchemaFile{}
	seenMsgs := make(map[string]bool)
	seenEnums := make(map[string]bool)

	for _, fd := range fileDescriptors {
		for _, msg := range fd.GetMessageTypes() {
			if sdkFacingCommonsTypes[msg.GetName()] && !seenMsgs[msg.GetName()] {
				seenMsgs[msg.GetName()] = true
				ts := parseSharedType(msg, fd)
				schema.MessageTypes = append(schema.MessageTypes, *ts)
				fmt.Printf("    Commons message: %s\n", msg.GetName())
			}
		}
		for _, enumDesc := range fd.GetEnumTypes() {
			if sdkFacingCommonsEnums[enumDesc.GetName()] && !seenEnums[enumDesc.GetName()] {
				seenEnums[enumDesc.GetName()] = true
				es := parseEnumSchema(enumDesc)
				schema.EnumTypes = append(schema.EnumTypes, es)
				fmt.Printf("    Commons enum: %s\n", enumDesc.GetName())
			}
		}
	}

	return schema, nil
}

// searchListResources are resources that use SearchService for listing.
// This is a server-side indexing concern: only resources indexed in the
// search system can use SearchService-backed listing.
var searchListResources = map[string]bool{
	"agent":     true,
	"skill":     true,
	"mcpserver": true,
	"workflow":  true,
	"datastore": true,
}

// extractServiceSchemas parses proto files for a resource and extracts service definitions.
func extractServiceSchemas(protoDir, includeDir string, useBufCache bool) (*ServiceSchemaFile, error) {
	protoFiles, err := findProtoFiles(protoDir)
	if err != nil {
		return nil, fmt.Errorf("failed to find proto files: %w", err)
	}
	if len(protoFiles) == 0 {
		return nil, nil
	}

	importPaths := []string{includeDir}
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

	parser := &protoparse.Parser{
		ImportPaths:           importPaths,
		IncludeSourceCodeInfo: true,
	}

	var relativeProtoFiles []string
	for _, pf := range protoFiles {
		relPath, err := filepath.Rel(includeDir, pf)
		if err != nil {
			return nil, fmt.Errorf("failed to get relative path for %s: %w", pf, err)
		}
		relativeProtoFiles = append(relativeProtoFiles, relPath)
	}

	fileDescriptors, err := parser.ParseFiles(relativeProtoFiles...)
	if err != nil {
		return nil, fmt.Errorf("failed to parse proto files: %w", err)
	}

	var schema ServiceSchemaFile
	var resourceType string

	// Collect every service before assigning roles: assignment must see
	// the whole package at once so that adding a proto file can never
	// rename an existing service's role (see assignServiceRoles).
	type serviceWithFile struct {
		svc *desc.ServiceDescriptor
		fd  *desc.FileDescriptor
	}
	var packageServices []serviceWithFile
	var roleInputs []serviceRoleInput
	for _, fd := range fileDescriptors {
		if schema.Package == "" {
			schema.Package = fd.GetPackage()
			schema.GoImportPath = deriveGoImportAlias(fd.GetPackage())
		}
		for _, svc := range fd.GetServices() {
			packageServices = append(packageServices, serviceWithFile{svc: svc, fd: fd})
			roleInputs = append(roleInputs, serviceRoleInput{
				ServiceName: svc.GetName(),
				ProtoFile:   fd.GetName(),
			})
		}
	}
	roles := assignServiceRoles(roleInputs)

	for _, entry := range packageServices {
		svc := entry.svc
		svcDef := ServiceDefinition{
			Name:      svc.GetName(),
			Role:      roles[svc.GetName()],
			ProtoFile: entry.fd.GetName(),
		}
		for _, method := range svc.GetMethods() {
			ms := MethodSchema{
				Name:            capitalize(method.GetName()),
				InputType:       method.GetInputType().GetName(),
				InputFullType:   method.GetInputType().GetFullyQualifiedName(),
				OutputType:      method.GetOutputType().GetName(),
				OutputFullType:  method.GetOutputType().GetFullyQualifiedName(),
				ServerStreaming: method.IsServerStreaming(),
				ClientStreaming: method.IsClientStreaming(),
				Description:     extractServiceMethodComments(method),
			}
			svcDef.Methods = append(svcDef.Methods, ms)
		}
		if len(svcDef.Methods) > 0 {
			schema.Services = append(schema.Services, svcDef)
			if svcDef.Role == "command" {
				resourceType = inferResourceType(svcDef.Methods)
			}
		}
	}

	schema.MethodTypes = collectMethodTypes(fileDescriptors, &schema, resourceType)

	if resourceType != "" {
		extractResourceAndStatusSchemas(fileDescriptors, &schema, resourceType)
	}

	// Collect enum types from all message fields (spec, status, method types).
	// This must run after MethodTypes and StatusNestedTypes are populated.
	specTypes := make(map[string]*TypeSchema)
	schema.EnumTypes = collectEnumTypes(fileDescriptors, &schema, specTypes)

	return &schema, nil
}

// collectMethodTypes extracts TypeSchema entries for input/output message types
// used by service methods that aren't already covered by the spec-based type
// generation or the doc generator's special-case handling (Empty, ID wrappers,
// the resource type itself, and delete inputs).
func collectMethodTypes(fileDescriptors []*desc.FileDescriptor, schema *ServiceSchemaFile, resourceType string) []TypeSchema {
	seen := make(map[string]bool)
	var result []TypeSchema

	// Build a map of FQN → message descriptor from all services' methods,
	// using the method descriptors which already resolve imported types.
	msgDescMap := make(map[string]*desc.MessageDescriptor)
	for _, fd := range fileDescriptors {
		for _, svc := range fd.GetServices() {
			for _, method := range svc.GetMethods() {
				in := method.GetInputType()
				out := method.GetOutputType()
				msgDescMap[in.GetFullyQualifiedName()] = in
				msgDescMap[out.GetFullyQualifiedName()] = out
			}
		}
	}

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			for _, fqn := range []string{m.InputFullType, m.OutputFullType} {
				shortName := fqn[strings.LastIndex(fqn, ".")+1:]

				if seen[shortName] {
					continue
				}

				if shouldSkipMethodType(shortName, fqn, resourceType) {
					continue
				}

				msgDesc, ok := msgDescMap[fqn]
				if !ok {
					continue
				}

				seen[shortName] = true
				ts := parseSharedType(msgDesc, msgDesc.GetFile())
				result = append(result, *ts)
			}
		}
	}

	return result
}

// shouldSkipMethodType returns true for types that the SDK doc generator
// already handles with built-in rendering (ID params, empty types, resource
// wrappers, and delete inputs).
func shouldSkipMethodType(shortName, fqn, resourceType string) bool {
	if fqn == "google.protobuf.Empty" {
		return true
	}
	if shortName == resourceType {
		return true
	}
	if strings.HasSuffix(shortName, "Id") || strings.HasSuffix(shortName, "ID") {
		return true
	}
	if shortName == "ApiResourceDeleteInput" {
		return true
	}
	return false
}

// collectEnumTypes gathers EnumSchema entries for all enum types referenced
// by spec, status, and method type fields. Each enum is keyed by its
// fully-qualified proto name to handle name collisions across packages
// (e.g., ExecutionPhase in agentexecution vs workflowexecution).
func collectEnumTypes(fileDescriptors []*desc.FileDescriptor, schema *ServiceSchemaFile, specTypes map[string]*TypeSchema) []EnumSchema {
	seen := make(map[string]bool) // keyed by FQN
	var result []EnumSchema

	collectFromField := func(field *desc.FieldDescriptor) {
		ts := extractTypeSpec(field)
		collectEnumFromTypeSpec(&ts, field, seen, &result)
	}

	collectFromMessage := func(msg *desc.MessageDescriptor) {
		for _, f := range msg.GetFields() {
			collectFromField(f)
		}
	}

	// Walk spec types
	for _, st := range specTypes {
		for _, f := range st.Fields {
			if f.Type.EnumType != "" {
				collectEnumFromFieldSchema(f, fileDescriptors, seen, &result)
			}
		}
	}

	// Walk method types
	for _, mt := range schema.MethodTypes {
		for _, f := range mt.Fields {
			if f.Type.EnumType != "" {
				collectEnumFromFieldSchema(f, fileDescriptors, seen, &result)
			}
		}
	}

	// Walk status type fields
	if schema.StatusType != nil {
		for _, f := range schema.StatusType.Fields {
			if f.Type.EnumType != "" {
				collectEnumFromFieldSchema(f, fileDescriptors, seen, &result)
			}
		}
	}

	// Walk status nested types
	for _, nt := range schema.StatusNestedTypes {
		for _, f := range nt.Fields {
			if f.Type.EnumType != "" {
				collectEnumFromFieldSchema(f, fileDescriptors, seen, &result)
			}
		}
	}

	// Walk resource message fields recursively (for types like ApiResourceMetadata
	// that may reference enums not captured in the schemas above).
	visited := make(map[string]bool)
	var walkMessage func(msg *desc.MessageDescriptor)
	walkMessage = func(msg *desc.MessageDescriptor) {
		fqn := msg.GetFullyQualifiedName()
		if visited[fqn] || strings.HasPrefix(fqn, "google.protobuf") {
			return
		}
		visited[fqn] = true
		collectFromMessage(msg)
		for _, f := range msg.GetFields() {
			if f.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
				mt := f.GetMessageType()
				if mt != nil && !mt.IsMapEntry() {
					walkMessage(mt)
				}
			}
		}
	}

	for _, fd := range fileDescriptors {
		for _, svc := range fd.GetServices() {
			for _, method := range svc.GetMethods() {
				walkMessage(method.GetInputType())
				walkMessage(method.GetOutputType())
			}
		}
	}

	return result
}

// collectEnumFromTypeSpec extracts an EnumSchema from a field descriptor when
// the TypeSpec indicates an enum type.
func collectEnumFromTypeSpec(ts *TypeSpec, field *desc.FieldDescriptor, seen map[string]bool, result *[]EnumSchema) {
	var enumDesc *desc.EnumDescriptor

	switch {
	case ts.EnumType != "":
		enumDesc = field.GetEnumType()
	case ts.Kind == "array" && ts.ElementType != nil && ts.ElementType.EnumType != "":
		enumDesc = field.GetEnumType()
	default:
		return
	}

	if enumDesc == nil {
		return
	}

	fqn := fmt.Sprintf("%s.%s", enumDesc.GetFile().GetPackage(), enumDesc.GetName())
	if seen[fqn] {
		return
	}
	seen[fqn] = true

	*result = append(*result, parseEnumSchema(enumDesc))
}

// collectEnumFromFieldSchema resolves an enum from FieldSchema.Type.EnumType
// by finding the enum descriptor in the parsed file descriptors.
func collectEnumFromFieldSchema(f *FieldSchema, fileDescriptors []*desc.FileDescriptor, seen map[string]bool, result *[]EnumSchema) {
	enumFQN := resolveEnumFQN(&f.Type)
	if enumFQN == "" || seen[enumFQN] {
		return
	}

	enumName := enumFQN[strings.LastIndex(enumFQN, ".")+1:]
	enumPkg := enumFQN[:strings.LastIndex(enumFQN, ".")]

	for _, fd := range fileDescriptors {
		enumDesc := findEnumInDependencies(fd, enumPkg, enumName)
		if enumDesc != nil {
			seen[enumFQN] = true
			*result = append(*result, parseEnumSchema(enumDesc))
			return
		}
	}
}

// resolveEnumFQN extracts the fully-qualified enum type name from a TypeSpec,
// handling direct, array, and map-value enum references.
func resolveEnumFQN(ts *TypeSpec) string {
	if ts.EnumType != "" {
		return ts.EnumType
	}
	if ts.Kind == "array" && ts.ElementType != nil && ts.ElementType.EnumType != "" {
		return ts.ElementType.EnumType
	}
	if ts.Kind == "map" && ts.ValueType != nil && ts.ValueType.EnumType != "" {
		return ts.ValueType.EnumType
	}
	return ""
}

// findEnumInDependencies searches a file descriptor and all its transitive
// dependencies for an enum with the given package and name.
func findEnumInDependencies(fd *desc.FileDescriptor, pkg, name string) *desc.EnumDescriptor {
	if fd.GetPackage() == pkg {
		for _, e := range fd.GetEnumTypes() {
			if e.GetName() == name {
				return e
			}
		}
	}
	for _, dep := range fd.GetDependencies() {
		if result := findEnumInDependencies(dep, pkg, name); result != nil {
			return result
		}
	}
	return nil
}

// parseEnumSchema builds an EnumSchema from a proto enum descriptor.
func parseEnumSchema(enumDesc *desc.EnumDescriptor) EnumSchema {
	fqn := fmt.Sprintf("%s.%s", enumDesc.GetFile().GetPackage(), enumDesc.GetName())

	var values []EnumValueSchema
	for _, v := range enumDesc.GetValues() {
		if v.GetNumber() == 0 {
			continue
		}
		desc := ""
		if si := v.GetSourceInfo(); si != nil {
			desc = stripInternalSection(si.GetLeadingComments())
		}
		values = append(values, EnumValueSchema{
			Name:        v.GetName(),
			Number:      v.GetNumber(),
			Description: desc,
		})
	}

	enumComment := ""
	if si := enumDesc.GetSourceInfo(); si != nil {
		enumComment = stripInternalSection(si.GetLeadingComments())
	}

	return EnumSchema{
		Name:        enumDesc.GetName(),
		Description: enumComment,
		ProtoType:   fqn,
		Values:      values,
	}
}

// extractResourceAndStatusSchemas populates the resource description and
// status type schema on the service schema. The resource description comes
// from the proto comment on the resource message (e.g., Agent). The status
// type is extracted from the resource message's "status" field, but only
// when it contains fields beyond the shared audit field.
func extractResourceAndStatusSchemas(fileDescriptors []*desc.FileDescriptor, schema *ServiceSchemaFile, resourceType string) {
	var resourceMsg *desc.MessageDescriptor
	for _, fd := range fileDescriptors {
		for _, msg := range fd.GetMessageTypes() {
			if msg.GetName() == resourceType {
				resourceMsg = msg
				break
			}
		}
		if resourceMsg != nil {
			break
		}
	}
	if resourceMsg == nil {
		return
	}

	schema.ResourceDescription = extractComments(resourceMsg)

	statusField := resourceMsg.FindFieldByName("status")
	if statusField == nil || statusField.GetMessageType() == nil {
		return
	}

	statusMsg := statusField.GetMessageType()
	hasNonAuditField := false
	for _, f := range statusMsg.GetFields() {
		if f.GetName() != "audit" {
			hasNonAuditField = true
			break
		}
	}
	if !hasNonAuditField {
		return
	}

	schema.StatusType = parseSharedType(statusMsg, statusMsg.GetFile())

	// Collect nested types referenced by status fields (e.g., ApiResourceAudit).
	statusNested := make(map[string]*TypeSchema)
	collectNestedTypes(statusMsg, statusMsg.GetFile(), statusNested)
	for _, ts := range statusNested {
		schema.StatusNestedTypes = append(schema.StatusNestedTypes, *ts)
	}
	sort.Slice(schema.StatusNestedTypes, func(i, j int) bool {
		return schema.StatusNestedTypes[i].Name < schema.StatusNestedTypes[j].Name
	})
}

// generateSDKServiceSchemas auto-discovers all resources with gRPC services
// across all namespaces (agentic, iam, tenancy) and generates service schemas.
func generateSDKServiceSchemas(includeDir, baseOutputDir string, useBufCache bool) error {
	servicesDir := filepath.Join(baseOutputDir, "services")
	// Wipe and recreate to remove stale schemas from previous runs.
	os.RemoveAll(servicesDir)
	if err := os.MkdirAll(servicesDir, 0755); err != nil {
		return fmt.Errorf("failed to create services directory: %w", err)
	}

	stigmerDir := filepath.Join(includeDir, "ai", "stigmer")

	namespaces := []string{"agentic", "iam", "tenancy"}
	for _, ns := range namespaces {
		nsDir := filepath.Join(stigmerDir, ns)
		if _, err := os.Stat(nsDir); os.IsNotExist(err) {
			continue
		}

		subDirs, err := os.ReadDir(nsDir)
		if err != nil {
			fmt.Printf("   ⚠️  Error reading %s: %v\n", ns, err)
			continue
		}

		for _, subDir := range subDirs {
			if !subDir.IsDir() {
				continue
			}
			resourceDir := subDir.Name()
			protoDir := filepath.Join(nsDir, resourceDir, "v1")
			if _, err := os.Stat(protoDir); os.IsNotExist(err) {
				continue
			}

			schema, err := extractServiceSchemas(protoDir, includeDir, useBufCache)
			if err != nil {
				fmt.Printf("   ❌ Error extracting services for %s/%s: %v\n", ns, resourceDir, err)
				continue
			}
			if schema == nil || len(schema.Services) == 0 {
				continue
			}

			schema.Resource = resourceDir
			if searchListResources[resourceDir] {
				schema.ListVia = "SearchService"
			}

			outputPath := filepath.Join(servicesDir, resourceDir+".json")
			if err := writeSchemaFile(schema, outputPath); err != nil {
				fmt.Printf("   ❌ Error writing %s: %v\n", resourceDir, err)
				continue
			}
			fmt.Printf("   → services/%s.json (%d services, %d methods)\n",
				resourceDir, len(schema.Services), countMethods(schema))
		}
	}

	// Also extract the SearchService (in search/v1/)
	searchDir := filepath.Join(stigmerDir, "search", "v1")
	if _, err := os.Stat(searchDir); err == nil {
		schema, err := extractServiceSchemas(searchDir, includeDir, useBufCache)
		if err == nil && schema != nil && len(schema.Services) > 0 {
			schema.Resource = "search"
			outputPath := filepath.Join(servicesDir, "search.json")
			if err := writeSchemaFile(schema, outputPath); err == nil {
				fmt.Printf("   → services/search.json (%d methods)\n", countMethods(schema))
			}
		}
	}

	// Extract commons shared types and enums
	fmt.Printf("   📄 Processing commons types\n")
	commonsSchema, err := extractCommonsSchema(includeDir, useBufCache)
	if err != nil {
		fmt.Printf("   ⚠️  Error extracting commons: %v\n", err)
	} else if commonsSchema != nil {
		outputPath := filepath.Join(servicesDir, "commons.json")
		if err := writeSchemaFile(commonsSchema, outputPath); err != nil {
			fmt.Printf("   ❌ Error writing commons.json: %v\n", err)
		} else {
			fmt.Printf("   → services/commons.json (%d types, %d enums)\n",
				len(commonsSchema.MessageTypes), len(commonsSchema.EnumTypes))
		}
	}

	return nil
}

func countMethods(s *ServiceSchemaFile) int {
	n := 0
	for _, svc := range s.Services {
		n += len(svc.Methods)
	}
	return n
}

// deriveGoImportAlias turns a proto package like "ai.stigmer.agentic.agent.v1"
// into the Go import alias convention "agentv1".
func deriveGoImportAlias(pkg string) string {
	parts := strings.Split(pkg, ".")
	if len(parts) < 2 {
		return strings.ReplaceAll(pkg, ".", "")
	}
	// Take the second-to-last (resource) and last (version) parts.
	resource := parts[len(parts)-2]
	version := parts[len(parts)-1]
	return resource + version
}

// inferResourceType determines the primary resource type from command service
// methods. Prefers the output type of update or delete (which always return
// the resource directly) over create (which may return a wrapper like
// PlatformClientCreateResponse).
func inferResourceType(methods []MethodSchema) string {
	for _, m := range methods {
		if strings.EqualFold(m.Name, "Update") {
			return m.OutputType
		}
	}
	for _, m := range methods {
		if strings.EqualFold(m.Name, "Delete") {
			return m.OutputType
		}
	}
	return methods[0].OutputType
}

// serviceRoleInput identifies one service for role assignment: its name
// and the proto file (descriptor path) it is defined in.
type serviceRoleInput struct {
	ServiceName string
	ProtoFile   string
}

// assignServiceRoles maps every service in a package to its SDK client
// role, keyed by service name.
//
// Roles become field names on the generated SDK clients in every
// language, so they must be stable: adding a service to a package must
// never rename an existing service's role. A first-come-first-served
// assignment over lexically walked proto files does not have that
// property (a new `message_query.proto` would steal "query" from the
// service in `query.proto`), so assignment considers the whole package:
//
//   - a service whose inferred role no other service claims keeps it;
//   - when several services claim the same role, the bare role goes to
//     the service defined in the file named exactly "<role>.proto" (the
//     house convention for a resource's primary controllers), and every
//     other claimant gets its unique name-derived role;
//   - if no claimant is defined in "<role>.proto", every claimant gets
//     its unique role.
func assignServiceRoles(services []serviceRoleInput) map[string]string {
	claimants := make(map[string][]serviceRoleInput)
	for _, svc := range services {
		role := inferServiceRole(svc.ServiceName)
		claimants[role] = append(claimants[role], svc)
	}

	roles := make(map[string]string, len(services))
	for role, group := range claimants {
		if len(group) == 1 {
			roles[group[0].ServiceName] = role
			continue
		}
		bareAssigned := false
		for _, svc := range group {
			if !bareAssigned && filepath.Base(svc.ProtoFile) == role+".proto" {
				roles[svc.ServiceName] = role
				bareAssigned = true
				continue
			}
			roles[svc.ServiceName] = inferUniqueServiceRole(svc.ServiceName)
		}
	}
	return roles
}

func inferServiceRole(name string) string {
	lower := strings.ToLower(name)
	if strings.Contains(lower, "command") {
		return "command"
	}
	if strings.Contains(lower, "query") {
		return "query"
	}
	if strings.Contains(lower, "token") {
		return "token"
	}
	return "query"
}

// inferUniqueServiceRole derives a unique role when the default role
// collides with an existing service. It converts a service name like
// "TaskKindRegistryQueryController" into a camelCase role like
// "taskKindRegistryQuery" by stripping the "Controller" suffix and
// lowercasing the first letter.
func inferUniqueServiceRole(name string) string {
	role := strings.TrimSuffix(name, "Controller")
	if len(role) == 0 {
		return strings.ToLower(name)
	}
	return strings.ToLower(role[:1]) + role[1:]
}

func capitalize(s string) string {
	if len(s) == 0 {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func extractServiceMethodComments(method *desc.MethodDescriptor) string {
	sourceInfo := method.GetSourceInfo()
	if sourceInfo == nil {
		return ""
	}
	return stripInternalSection(sourceInfo.GetLeadingComments())
}
