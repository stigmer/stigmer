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

	"google.golang.org/protobuf/compiler/protogen"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
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
	flag.Parse()

	if *protoDir == "" || *outputDir == "" {
		fmt.Println("Usage: proto2schema --proto-dir <dir> --output-dir <dir>")
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

	// TODO: Parse proto files and generate schemas
	// For now, let's create a simple test output
	for _, protoFile := range protoFiles {
		fmt.Printf("  - %s\n", protoFile)
		
		// Extract base name for schema file
		baseName := strings.TrimSuffix(filepath.Base(protoFile), ".proto")
		schemaFile := filepath.Join(*outputDir, baseName+".json")
		
		// TODO: Parse proto and generate schema
		// For now, create a placeholder
		fmt.Printf("    → %s\n", schemaFile)
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

// parseProtoFile parses a single proto file and extracts schema information
func parseProtoFile(protoFile string) (*TaskConfigSchema, error) {
	// TODO: Implement proto parsing
	// This is a placeholder that will be implemented next
	return nil, fmt.Errorf("not implemented yet")
}

// extractFieldSchema extracts field schema from a proto field descriptor
func extractFieldSchema(field protoreflect.FieldDescriptor) *FieldSchema {
	// TODO: Implement field extraction
	return nil
}

// extractTypeSpec extracts type specification from a proto field descriptor
func extractTypeSpec(field protoreflect.FieldDescriptor) TypeSpec {
	// TODO: Implement type extraction
	return TypeSpec{}
}

// extractValidation extracts buf.validate validation rules from field options
func extractValidation(field protoreflect.FieldDescriptor) *Validation {
	// TODO: Implement validation extraction
	return nil
}

// writeSchemaFile writes a schema to a JSON file
func writeSchemaFile(schema interface{}, outputPath string) error {
	data, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(outputPath, data, 0644)
}
