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

	"github.com/jhump/protoreflect/desc"
	"github.com/jhump/protoreflect/desc/protoparse"
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
	Name        string         `json:"name"`
	JsonName    string         `json:"jsonName"`
	ProtoField  string         `json:"protoField"`
	Type        TypeSpec       `json:"type"`
	Description string         `json:"description"`
	Required    bool           `json:"required"`
	Validation  *Validation    `json:"validation,omitempty"`
}

type TypeSpec struct {
	Kind        string    `json:"kind"` // string, int32, bool, map, array, message, struct
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
	stubDir := flag.String("stub-dir", "/tmp/proto-stubs", "Directory containing proto stubs (like buf/validate)")
	messageSuffix := flag.String("message-suffix", "TaskConfig", "Suffix of messages to extract (TaskConfig, Spec, etc)")
	flag.Parse()

	if *protoDir == "" || *outputDir == "" {
		fmt.Println("Usage: proto2schema --proto-dir <dir> --output-dir <dir> [--include-dir <dir>] [--stub-dir <dir>] [--message-suffix <suffix>]")
		os.Exit(1)
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

	// Build import paths (stub-dir first for external deps, then include-dir for local)
	importPaths := []string{*stubDir, *includeDir}
	
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
		Name:        strings.Title(strings.ReplaceAll(field.GetName(), "_", " ")),
		JsonName:    field.GetJSONName(),
		ProtoField:  field.GetName(),
		Type:        extractTypeSpec(field),
		Description: description,
		Required:    false,
		Validation:  extractValidation(field),
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

// extractValidation extracts buf.validate validation rules from field options
func extractValidation(field *desc.FieldDescriptor) *Validation {
	opts := field.GetFieldOptions()
	if opts == nil {
		return nil
	}
	
	validation := &Validation{}
	hasValidation := false
	
	// Get the full proto text representation of the field
	// This includes all options and extensions
	protoText := field.AsProto().String()
	optsStr := opts.String()
	
	// Combine both to have maximum coverage
	fullText := protoText + " " + optsStr
	
	// Check for buf.validate.field extension
	// Multiple patterns to catch different representations
	if strings.Contains(fullText, "[buf.validate.field]") ||
		strings.Contains(fullText, "buf.validate.field") ||
		strings.Contains(fullText, "1071") {
		hasValidation = true
		
		// Check for required constraint
		// Various patterns: "required = true", "required:true", "required: true"
		if strings.Contains(fullText, "required") &&
			(strings.Contains(fullText, "= true") || 
			 strings.Contains(fullText, ":true") ||
			 strings.Contains(fullText, ": true")) {
			validation.Required = true
		}
		
		// Check for string validation (min_len, max_len)
		if strings.Contains(fullText, "min_len") {
			validation.MinLength = extractIntFromOptions(fullText, "min_len")
		}
		if strings.Contains(fullText, "max_len") {
			validation.MaxLength = extractIntFromOptions(fullText, "max_len")
		}
		
		// Check for numeric validation (gte, lte)
		if strings.Contains(fullText, "gte") {
			validation.Min = extractIntFromOptions(fullText, "gte")
		}
		if strings.Contains(fullText, "lte") {
			validation.Max = extractIntFromOptions(fullText, "lte")
		}
		
		// Check for array validation (min_items, max_items)
		if strings.Contains(fullText, "min_items") {
			validation.MinItems = extractIntFromOptions(fullText, "min_items")
		}
		if strings.Contains(fullText, "max_items") {
			validation.MaxItems = extractIntFromOptions(fullText, "max_items")
		}
	}
	
	if !hasValidation {
		return nil
	}
	
	return validation
}

// extractIntFromOptions extracts an integer value from options string
// Example: "min_len:1" or "min_len = 1" returns 1
func extractIntFromOptions(optsStr, key string) int {
	idx := strings.Index(optsStr, key)
	if idx == -1 {
		return 0
	}
	
	// Start after the key
	start := idx + len(key)
	
	// Skip whitespace, ":", "=", and more whitespace
	for start < len(optsStr) && (optsStr[start] == ' ' || optsStr[start] == ':' || optsStr[start] == '=') {
		start++
	}
	
	end := start
	
	// Find the end of the number
	for end < len(optsStr) && optsStr[end] >= '0' && optsStr[end] <= '9' {
		end++
	}
	
	if end > start {
		numStr := optsStr[start:end]
		var num int
		fmt.Sscanf(numStr, "%d", &num)
		return num
	}
	
	return 0
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
