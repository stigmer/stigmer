package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"strings"
)

type ServiceSchemaFile struct {
	Resource     string              `json:"resource"`
	Package      string              `json:"package"`
	GoImportPath string              `json:"goImportPath"`
	Services     []ServiceDefinition `json:"services"`
	ListVia      string              `json:"listVia,omitempty"`
}

type ServiceDefinition struct {
	Name    string         `json:"name"`
	Role    string         `json:"role"`
	Methods []MethodSchema `json:"methods"`
}

type MethodSchema struct {
	Name           string `json:"name"`
	InputType      string `json:"inputType"`
	InputFullType  string `json:"inputFullType"`
	OutputType     string `json:"outputType"`
	OutputFullType string `json:"outputFullType"`
	ServerStreaming bool   `json:"serverStreaming,omitempty"`
	ClientStreaming bool   `json:"clientStreaming,omitempty"`
	Description    string `json:"description,omitempty"`
}

var protoPackageToImport = map[string]string{
	"ai.stigmer.agentic.agent.v1":          "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1",
	"ai.stigmer.agentic.skill.v1":          "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1",
	"ai.stigmer.agentic.mcpserver.v1":      "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1",
	"ai.stigmer.agentic.session.v1":        "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1",
	"ai.stigmer.agentic.agentexecution.v1": "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1",
	"ai.stigmer.search.v1":                 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1",
	"ai.stigmer.commons.apiresource":       "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource",
}

type sdkResourceConfig struct {
	clientName   string
	protoResType string
	inputPrefix  string // SDK-facing prefix for input types (e.g. "Execution" instead of "AgentExecution")
	idType       string
	specSchema   string
}

var resourceConfig = map[string]sdkResourceConfig{
	"agent":     {clientName: "AgentClient", protoResType: "Agent", inputPrefix: "Agent", idType: "AgentId", specSchema: "agentic/agent/agent.json"},
	"skill":     {clientName: "SkillClient", protoResType: "Skill", inputPrefix: "Skill", idType: "SkillId", specSchema: "agentic/skill/skill.json"},
	"mcpserver": {clientName: "McpServerClient", protoResType: "McpServer", inputPrefix: "McpServer", idType: "", specSchema: "agentic/mcpserver/mcpserver.json"},
	"session":   {clientName: "SessionClient", protoResType: "Session", inputPrefix: "Session", idType: "SessionId", specSchema: ""},
	"execution": {clientName: "AgentExecutionClient", protoResType: "AgentExecution", inputPrefix: "AgentExecution", idType: "AgentExecutionId", specSchema: "agentic/agentexecution/agentexecution.json"},
}

// metaFieldNames are fields that always come from ApiResourceMetadata.
// Spec fields with these names are skipped to avoid struct field conflicts.
var metaFieldNames = map[string]bool{
	"Name": true, "Org": true, "Tags": true, "Visibility": true,
}

func runSDKClientGeneration(schemaDir, outputDir string) error {
	servicesDir := filepath.Join(schemaDir, "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		return fmt.Errorf("failed to read services directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	if err := generateGenErrors(outputDir); err != nil {
		return fmt.Errorf("failed to generate errors: %w", err)
	}
	fmt.Printf("   -> errors.go\n")

	if err := generateGenTypes(outputDir); err != nil {
		return fmt.Errorf("failed to generate types: %w", err)
	}
	fmt.Printf("   -> types.go\n")

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		resource := strings.TrimSuffix(entry.Name(), ".json")
		if resource == "search" {
			continue
		}
		cfg, ok := resourceConfig[resource]
		if !ok {
			continue
		}

		schemaPath := filepath.Join(servicesDir, entry.Name())
		data, err := os.ReadFile(schemaPath)
		if err != nil {
			return fmt.Errorf("failed to read %s: %w", schemaPath, err)
		}
		var schema ServiceSchemaFile
		if err := json.Unmarshal(data, &schema); err != nil {
			return fmt.Errorf("failed to parse %s: %w", schemaPath, err)
		}

		var specSchema *TaskConfigSchema
		var specTypes []*TypeSchema
		if cfg.specSchema != "" {
			specPath := filepath.Join(schemaDir, cfg.specSchema)
			specSchema, specTypes, err = loadSpecSchemaWithTypes(specPath, schemaDir, resource)
			if err != nil {
				fmt.Printf("   Warning: could not load spec schema for %s: %v\n", resource, err)
			}
		}

		code, err := generateResourceClient(&schema, cfg, specSchema, specTypes)
		if err != nil {
			return fmt.Errorf("failed to generate client for %s: %w", resource, err)
		}

		outputPath := filepath.Join(outputDir, resource+".go")
		if err := os.WriteFile(outputPath, code, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", outputPath, err)
		}
		fmt.Printf("   -> %s.go\n", resource)
	}
	return nil
}

func loadSpecSchemaWithTypes(specPath, schemaDir, resource string) (*TaskConfigSchema, []*TypeSchema, error) {
	data, err := os.ReadFile(specPath)
	if err != nil {
		return nil, nil, err
	}
	var spec TaskConfigSchema
	if err := json.Unmarshal(data, &spec); err != nil {
		return nil, nil, err
	}

	typesDir := filepath.Join(filepath.Dir(specPath), "types")
	var types []*TypeSchema
	if entries, err := os.ReadDir(typesDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			td, err := os.ReadFile(filepath.Join(typesDir, e.Name()))
			if err != nil {
				continue
			}
			var ts TypeSchema
			if json.Unmarshal(td, &ts) == nil {
				types = append(types, &ts)
			}
		}
	}
	return &spec, types, nil
}

// =========================================================================
// Resource client generation
// =========================================================================

func generateResourceClient(schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema) ([]byte, error) {
	importPath, ok := protoPackageToImport[schema.Package]
	if !ok {
		return nil, fmt.Errorf("unknown proto package %q", schema.Package)
	}
	alias := schema.GoImportPath

	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package gen\n\n")

	// Collect import needs
	needsIO := false
	needsApiResource := false
	needsSearch := schema.ListVia == "SearchService"
	hasInputType := specSchema != nil
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if m.ServerStreaming {
				needsIO = true
			}
			if strings.Contains(m.InputFullType, "commons.apiresource") {
				needsApiResource = true
			}
		}
	}

	// Check if execution context types are needed (ExecutionValue is cross-package)
	needsExecutionContext := false
	if specSchema != nil {
		for _, f := range specSchema.Fields {
			if f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue" {
				needsExecutionContext = true
			}
		}
	}

	// Build type map for nested type lookups
	typeMap := make(map[string]*TypeSchema)
	for _, t := range specTypes {
		typeMap[t.Name] = t
	}

	buf.WriteString("import (\n")
	buf.WriteString("\t\"context\"\n")
	if needsIO {
		buf.WriteString("\t\"io\"\n")
	}
	buf.WriteString("\n")
	fmt.Fprintf(&buf, "\t%s %q\n", alias, importPath)
	if needsApiResource || hasInputType {
		buf.WriteString("\tapiresource \"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource\"\n")
	}
	if needsSearch {
		buf.WriteString("\tapiresourcekind \"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind\"\n")
		buf.WriteString("\trpc \"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc\"\n")
		buf.WriteString("\tsearchv1 \"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1\"\n")
	}
	if needsExecutionContext {
		buf.WriteString("\texecutioncontextv1 \"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1\"\n")
	}
	buf.WriteString("\t\"google.golang.org/grpc\"\n")
	buf.WriteString(")\n\n")

	// Client struct
	fmt.Fprintf(&buf, "// %s provides operations on %s resources.\n", cfg.clientName, schema.Resource)
	fmt.Fprintf(&buf, "type %s struct {\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&buf, "\t%s %s.%sClient\n", svc.Role, alias, svc.Name)
	}
	if needsSearch {
		buf.WriteString("\tsearch searchv1.SearchServiceClient\n")
	}
	buf.WriteString("}\n\n")

	// Constructor
	fmt.Fprintf(&buf, "func New%s(conn grpc.ClientConnInterface) *%s {\n", cfg.clientName, cfg.clientName)
	fmt.Fprintf(&buf, "\treturn &%s{\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&buf, "\t\t%s: %s.New%sClient(conn),\n", svc.Role, alias, svc.Name)
	}
	if needsSearch {
		buf.WriteString("\t\tsearch: searchv1.NewSearchServiceClient(conn),\n")
	}
	buf.WriteString("\t}\n}\n\n")

	// Methods
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			generateMethod(&buf, &m, &svc, schema, cfg, alias, hasInputType)
		}
	}

	// Search-backed List
	if needsSearch {
		generateSearchList(&buf, schema, cfg)
	}

	// Input types and toProto
	if specSchema != nil {
		generateInputTypesV2(&buf, schema, cfg, specSchema, typeMap, alias, needsExecutionContext)
	}

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return buf.Bytes(), fmt.Errorf("gofmt failed: %w\ngenerated:\n%s", err, buf.String())
	}
	return formatted, nil
}

// =========================================================================
// Method generation
// =========================================================================

func generateMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, alias string, hasInputType bool) {
	receiver := strings.ToLower(cfg.clientName[:1])
	inputPkg, inputType := resolveType(m.InputFullType, m.InputType, schema.Package, alias)
	outputPkg, outputType := resolveType(m.OutputFullType, m.OutputType, schema.Package, alias)

	if m.ServerStreaming {
		generateStreamingMethod(buf, m, svc, receiver, cfg, inputPkg, inputType, outputPkg, outputType)
		return
	}

	isIDInput := isIDType(m.InputType)
	isDeleteInput := m.InputType == "ApiResourceDeleteInput"
	isResourceInput := m.InputType == cfg.protoResType

	switch {
	case isResourceInput && hasInputType:
		inputTypeName := cfg.inputPrefix + "Input"
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, inputTypeName, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, input.toProto())\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

	case isResourceInput && !hasInputType:
		// No spec schema — accept the proto directly
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s.%s) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, inputPkg, inputType, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, input)\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

	case isIDInput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, id string) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, &%s.%s{Value: id})\n",
			receiver, svc.Role, m.Name, inputPkg, m.InputType)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

	case isDeleteInput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *DeleteResourceInput) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, &apiresource.ApiResourceDeleteInput{\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\t\tResourceId:     input.ResourceID,\n")
		buf.WriteString("\t\tVersionMessage: input.VersionMessage,\n")
		buf.WriteString("\t\tForce:          input.Force,\n")
		buf.WriteString("\t})\n\treturn resp, wrapErr(err)\n}\n\n")

	default:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s.%s) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, inputPkg, inputType, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, input)\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")
	}
}

func generateStreamingMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, receiver string, cfg sdkResourceConfig, inputPkg, inputType, outputPkg, outputType string) {
	isIDInput := isIDType(m.InputType)
	streamTypeName := m.Name + "Stream"

	fmt.Fprintf(buf, "// %s wraps the server stream for %s.\n", streamTypeName, m.Name)
	fmt.Fprintf(buf, "type %s struct {\n", streamTypeName)
	fmt.Fprintf(buf, "\tstream %s.%s_%sClient\n", inputPkg, svc.Name, m.Name)
	buf.WriteString("}\n\n")

	fmt.Fprintf(buf, "func (s *%s) Recv() (*%s.%s, error) {\n", streamTypeName, outputPkg, outputType)
	buf.WriteString("\tmsg, err := s.stream.Recv()\n")
	buf.WriteString("\tif err != nil {\n\t\tif err == io.EOF {\n\t\t\treturn nil, io.EOF\n\t\t}\n\t\treturn nil, wrapErr(err)\n\t}\n\treturn msg, nil\n}\n\n")

	if isIDInput {
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, id string) (*%s, error) {\n",
			receiver, cfg.clientName, m.Name, streamTypeName)
		fmt.Fprintf(buf, "\tstream, err := %s.%s.%s(ctx, &%s.%s{Value: id})\n",
			receiver, svc.Role, m.Name, inputPkg, m.InputType)
	} else {
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s.%s) (*%s, error) {\n",
			receiver, cfg.clientName, m.Name, inputPkg, inputType, streamTypeName)
		fmt.Fprintf(buf, "\tstream, err := %s.%s.%s(ctx, input)\n",
			receiver, svc.Role, m.Name)
	}
	buf.WriteString("\tif err != nil {\n\t\treturn nil, wrapErr(err)\n\t}\n")
	fmt.Fprintf(buf, "\treturn &%s{stream: stream}, nil\n}\n\n", streamTypeName)
}

func generateSearchList(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig) {
	receiver := strings.ToLower(cfg.clientName[:1])
	kindConst := "apiresourcekind.ApiResourceKind_" + protoKindName(schema.Resource)

	fmt.Fprintf(buf, "func (%s *%s) List(ctx context.Context, params *ListParams) (*ListResult, error) {\n", receiver, cfg.clientName)
	buf.WriteString("\treq := &searchv1.SearchRequest{\n")
	fmt.Fprintf(buf, "\t\tKinds: []apiresourcekind.ApiResourceKind{%s},\n", kindConst)
	buf.WriteString("\t\tQuery: params.Query,\n")
	buf.WriteString("\t\tOrg:   params.Org,\n")
	buf.WriteString("\t\tExcludePublic: params.ExcludePublic,\n")
	buf.WriteString("\t}\n")
	buf.WriteString("\tif params.Page != nil {\n")
	buf.WriteString("\t\treq.Page = &rpc.PageInfo{Num: params.Page.Num, Size: params.Page.Size}\n")
	buf.WriteString("\t}\n")
	fmt.Fprintf(buf, "\tresp, err := %s.search.Search(ctx, req)\n", receiver)
	buf.WriteString("\tif err != nil {\n\t\treturn nil, wrapErr(err)\n\t}\n")
	buf.WriteString("\treturn &ListResult{\n")
	buf.WriteString("\t\tEntries:    resp.GetEntries(),\n")
	buf.WriteString("\t\tTotalCount: resp.GetTotalCount(),\n")
	buf.WriteString("\t\tTotalPages: resp.GetTotalPages(),\n")
	buf.WriteString("\t}, nil\n}\n\n")
}

func protoKindName(resource string) string {
	switch resource {
	case "mcpserver":
		return "mcp_server"
	case "execution":
		return "agent_execution"
	default:
		return resource
	}
}

// =========================================================================
// Input type generation from spec schemas
// =========================================================================

func generateInputTypesV2(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, alias string, needsExecCtx bool) {
	inputName := cfg.inputPrefix + "Input"
	emitted := make(map[string]bool) // track emitted nested types

	// Filter spec fields that conflict with metadata fields
	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	// --- Input struct ---
	fmt.Fprintf(buf, "// %s holds the fields for creating/updating a %s.\n", inputName, cfg.protoResType)
	fmt.Fprintf(buf, "type %s struct {\n", inputName)
	buf.WriteString("\tName string\n")
	buf.WriteString("\tOrg  string\n")
	for _, f := range specFields {
		goType := goTypeForField(f, typeMap)
		fmt.Fprintf(buf, "\t%s %s\n", f.Name, goType)
	}
	buf.WriteString("}\n\n")

	// --- Nested input types ---
	for _, f := range specFields {
		emitNestedTypes(buf, f, typeMap, emitted)
	}

	// --- toProto method ---
	fmt.Fprintf(buf, "func (i *%s) toProto() *%s.%s {\n", inputName, alias, cfg.protoResType)
	fmt.Fprintf(buf, "\tresource := &%s.%s{\n", alias, cfg.protoResType)
	fmt.Fprintf(buf, "\t\tApiVersion: %q,\n", "agentic.stigmer.ai/v1")
	fmt.Fprintf(buf, "\t\tKind:       %q,\n", cfg.protoResType)
	buf.WriteString("\t\tMetadata: &apiresource.ApiResourceMetadata{\n")
	buf.WriteString("\t\t\tName: i.Name,\n")
	buf.WriteString("\t\t\tOrg:  i.Org,\n")
	buf.WriteString("\t\t},\n")
	fmt.Fprintf(buf, "\t\tSpec: &%s.%s{},\n", alias, spec.Name)
	buf.WriteString("\t}\n")

	for _, f := range specFields {
		emitToProtoField(buf, f, alias, typeMap, spec.Name)
	}

	buf.WriteString("\treturn resource\n}\n\n")

	// --- toProto on nested types ---
	for _, f := range specFields {
		emitNestedToProto(buf, f, alias, typeMap, emitted, spec.Name)
	}
}

func goTypeForField(f *FieldSchema, typeMap map[string]*TypeSchema) string {
	return goTypeForTypeSpec(&f.Type, typeMap)
}

func goTypeForTypeSpec(ts *TypeSpec, typeMap map[string]*TypeSchema) string {
	switch ts.Kind {
	case "string":
		return "string"
	case "int32":
		return "int32"
	case "uint32":
		return "uint32"
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
	case "timestamp":
		return "string"
	case "struct":
		return "map[string]any"
	case "array":
		if ts.ElementType != nil {
			return "[]" + goTypeForTypeSpec(ts.ElementType, typeMap)
		}
		return "[]string"
	case "map":
		keyType := "string"
		valType := "string"
		if ts.KeyType != nil {
			keyType = goTypeForTypeSpec(ts.KeyType, typeMap)
		}
		if ts.ValueType != nil {
			valType = goTypeForTypeSpec(ts.ValueType, typeMap)
		}
		return fmt.Sprintf("map[%s]%s", keyType, valType)
	case "message":
		switch ts.MessageType {
		case "EnvironmentSpec":
			return "*EnvSpecInput"
		case "EnvironmentValue", "ExecutionValue":
			return "EnvVarInput"
		case "ApiResourceReference":
			return "ResourceRef"
		default:
			return "*" + ts.MessageType + "Input"
		}
	default:
		return "string"
	}
}

func emitNestedTypes(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool) {
	var msgName string
	switch {
	case f.Type.Kind == "message":
		msgName = f.Type.MessageType
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		msgName = f.Type.ElementType.MessageType
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		msgName = f.Type.ValueType.MessageType
	default:
		return
	}

	if isSpecialType(msgName) {
		return
	}
	if emitted[msgName] {
		return
	}
	ts, ok := typeMap[msgName]
	if !ok {
		return
	}
	emitted[msgName] = true

	inputName := msgName + "Input"
	fmt.Fprintf(buf, "// %s is the SDK input type for %s.\n", inputName, msgName)
	fmt.Fprintf(buf, "type %s struct {\n", inputName)
	for _, field := range ts.Fields {
		goType := goTypeForField(field, typeMap)
		fmt.Fprintf(buf, "\t%s %s\n", field.Name, goType)
	}
	buf.WriteString("}\n\n")

	// Recurse
	for _, field := range ts.Fields {
		emitNestedTypes(buf, field, typeMap, emitted)
	}
}

func emitToProtoField(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema, specName string) {
	protoField := goProtoFieldName(f.ProtoField)

	switch {
	case f.Type.Kind == "string" || f.Type.Kind == "bool" || f.Type.Kind == "int32" || f.Type.Kind == "int64" ||
		f.Type.Kind == "uint32" || f.Type.Kind == "float" || f.Type.Kind == "double" || f.Type.Kind == "bytes":
		fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s = i.%s.toProto()\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "message" && f.OneofGroup != "":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		emitOneofToProto(buf, f, alias, specName, typeMap)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "message":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s = i.%s.toProto()\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if elemMsg == "ApiResourceReference" {
			// Convert ResourceRef -> apiresource.ApiResourceReference
			fmt.Fprintf(buf, "\tfor _, r := range i.%s {\n", f.Name)
			fmt.Fprintf(buf, "\t\tresource.Spec.%s = append(resource.Spec.%s, r.toProto())\n", protoField, protoField)
			buf.WriteString("\t}\n")
		} else {
			fmt.Fprintf(buf, "\tfor _, item := range i.%s {\n", f.Name)
			fmt.Fprintf(buf, "\t\tresource.Spec.%s = append(resource.Spec.%s, item.toProto())\n", protoField, protoField)
			buf.WriteString("\t}\n")
		}

	case f.Type.Kind == "map":
		if f.Type.ValueType != nil && f.Type.ValueType.Kind == "message" {
			elemMsg := f.Type.ValueType.MessageType
			switch elemMsg {
			case "ExecutionValue":
				fmt.Fprintf(buf, "\tif len(i.%s) > 0 {\n", f.Name)
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = make(map[string]*executioncontextv1.ExecutionValue, len(i.%s))\n", protoField, f.Name)
				fmt.Fprintf(buf, "\t\tfor k, v := range i.%s {\n", f.Name)
				fmt.Fprintf(buf, "\t\t\tresource.Spec.%s[k] = &executioncontextv1.ExecutionValue{Value: v.Value, IsSecret: v.IsSecret}\n", protoField)
				buf.WriteString("\t\t}\n\t}\n")
			default:
				fmt.Fprintf(buf, "\tif len(i.%s) > 0 {\n", f.Name)
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = make(map[string]*%s.%s, len(i.%s))\n", protoField, alias, elemMsg, f.Name)
				fmt.Fprintf(buf, "\t\tfor k, v := range i.%s {\n", f.Name)
				fmt.Fprintf(buf, "\t\t\tresource.Spec.%s[k] = v.toProto()\n", protoField)
				buf.WriteString("\t\t}\n\t}\n")
			}
		} else {
			fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)
		}

	default:
		fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)
	}
}

func emitOneofToProto(buf *bytes.Buffer, f *FieldSchema, alias, specName string, typeMap map[string]*TypeSchema) {
	protoField := goProtoFieldName(f.ProtoField)
	oneofWrapper := specName + "_" + protoField
	msgType := f.Type.MessageType

	ts, ok := typeMap[msgType]
	if !ok {
		return
	}

	fmt.Fprintf(buf, "\t\tresource.Spec.ServerType = &%s.%s{\n", alias, oneofWrapper)
	fmt.Fprintf(buf, "\t\t\t%s: &%s.%s{\n", protoField, alias, msgType)
	for _, field := range ts.Fields {
		pf := goProtoFieldName(field.ProtoField)
		fmt.Fprintf(buf, "\t\t\t\t%s: i.%s.%s,\n", pf, f.Name, field.Name)
	}
	buf.WriteString("\t\t\t},\n\t\t}\n")
}

func emitNestedToProto(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema, emitted map[string]bool, specName string) {
	var msgName string
	switch {
	case f.Type.Kind == "message":
		msgName = f.Type.MessageType
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		msgName = f.Type.ElementType.MessageType
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		msgName = f.Type.ValueType.MessageType
	default:
		return
	}

	if isSpecialType(msgName) {
		return
	}
	if f.OneofGroup != "" {
		return // oneof types are inlined
	}

	toProtoKey := msgName + "_toProto"
	if emitted[toProtoKey] {
		return
	}

	ts, ok := typeMap[msgName]
	if !ok {
		return
	}
	emitted[toProtoKey] = true

	inputName := msgName + "Input"
	fmt.Fprintf(buf, "func (i *%s) toProto() *%s.%s {\n", inputName, alias, msgName)
	fmt.Fprintf(buf, "\treturn &%s.%s{\n", alias, msgName)
	for _, field := range ts.Fields {
		pf := goProtoFieldName(field.ProtoField)
		if field.Type.Kind == "message" {
			if field.Type.MessageType == "ApiResourceReference" {
				fmt.Fprintf(buf, "\t\t%s: i.%s.toProto(),\n", pf, field.Name)
			} else {
				// Skip complex nested message fields that need their own conversion
				continue
			}
		} else if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message" {
			continue // handled separately
		} else {
			fmt.Fprintf(buf, "\t\t%s: i.%s,\n", pf, field.Name)
		}
	}
	buf.WriteString("\t}\n}\n\n")

	// Recurse for nested types
	for _, field := range ts.Fields {
		emitNestedToProto(buf, field, alias, typeMap, emitted, specName)
	}
}

// =========================================================================
// Shared generated files (errors.go, types.go)
// =========================================================================

func generateGenErrors(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package gen\n\n")
	buf.WriteString(`import (
	"errors"
	"fmt"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// ErrorCode represents a category of SDK error.
type ErrorCode int

const (
	CodeUnknown           ErrorCode = iota
	CodeNotFound
	CodePermissionDenied
	CodeUnauthenticated
	CodeInvalidArgument
	CodeAlreadyExists
	CodeResourceExhausted
	CodeFailedPrecondition
	CodeInternal
	CodeUnavailable
)

// Error is the structured error type returned by all SDK operations.
type Error struct {
	Code     ErrorCode
	Message  string
	GRPCCode codes.Code
}

func (e *Error) Error() string {
	return fmt.Sprintf("stigmer: %s (code=%d)", e.Message, e.GRPCCode)
}

func IsNotFound(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodeNotFound
}

func IsUnauthenticated(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodeUnauthenticated
}

func IsPermissionDenied(err error) bool {
	var sErr *Error
	return errors.As(err, &sErr) && sErr.Code == CodePermissionDenied
}

// WrapErr is the exported version of wrapErr for use by the parent package.
func WrapErr(err error) error { return wrapErr(err) }

func wrapErr(err error) error {
	if err == nil {
		return nil
	}
	st, ok := status.FromError(err)
	if !ok {
		return err
	}
	return &Error{
		Code:     grpcCodeToSDK(st.Code()),
		Message:  st.Message(),
		GRPCCode: st.Code(),
	}
}

func grpcCodeToSDK(c codes.Code) ErrorCode {
	switch c {
	case codes.NotFound:
		return CodeNotFound
	case codes.PermissionDenied:
		return CodePermissionDenied
	case codes.Unauthenticated:
		return CodeUnauthenticated
	case codes.InvalidArgument:
		return CodeInvalidArgument
	case codes.AlreadyExists:
		return CodeAlreadyExists
	case codes.ResourceExhausted:
		return CodeResourceExhausted
	case codes.FailedPrecondition:
		return CodeFailedPrecondition
	case codes.Internal:
		return CodeInternal
	case codes.Unavailable:
		return CodeUnavailable
	default:
		return CodeUnknown
	}
}
`)

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outputDir, "errors.go"), formatted, 0644)
}

func generateGenTypes(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package gen\n\n")
	buf.WriteString(`import (
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// DeleteResourceInput provides arguments for deleting a resource.
type DeleteResourceInput struct {
	ResourceID     string
	VersionMessage string
	Force          bool
}

// ResourceRef identifies an API resource by org, slug, and optional version.
type ResourceRef struct {
	Org     string
	Slug    string
	Version string
	Kind    apiresourcekind.ApiResourceKind
}

func (r ResourceRef) toProto() *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:     r.Org,
		Slug:    r.Slug,
		Version: r.Version,
		Kind:    r.Kind,
	}
}

// Page specifies offset-based pagination.
type Page struct {
	Num  int32
	Size int32
}

// ListParams configures a SearchService-backed list query.
type ListParams struct {
	Org           string
	Query         string
	ExcludePublic bool
	Page          *Page
}

// ListResult holds the response from a SearchService-backed list.
type ListResult struct {
	Entries    []*searchv1.SearchResult
	TotalCount int32
	TotalPages int32
}

// EnvSpecInput describes environment variables and secrets for a resource.
type EnvSpecInput struct {
	Variables map[string]EnvVarInput
}

// EnvVarInput describes a single environment variable.
type EnvVarInput struct {
	Value       string
	IsSecret    bool
	Description string
}

func (e *EnvSpecInput) toProto() *environmentv1.EnvironmentSpec {
	spec := &environmentv1.EnvironmentSpec{
		Data: make(map[string]*environmentv1.EnvironmentValue, len(e.Variables)),
	}
	for name, v := range e.Variables {
		spec.Data[name] = &environmentv1.EnvironmentValue{
			Value:       v.Value,
			IsSecret:    v.IsSecret,
			Description: v.Description,
		}
	}
	return spec
}
`)

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outputDir, "types.go"), formatted, 0644)
}

// =========================================================================
// Helpers
// =========================================================================

func isSpecialType(name string) bool {
	switch name {
	case "EnvironmentSpec", "EnvironmentValue", "ExecutionValue", "ApiResourceReference":
		return true
	}
	return false
}

func resolveType(fullType, shortType, schemaPkg, alias string) (string, string) {
	if strings.HasPrefix(fullType, schemaPkg+".") {
		return alias, shortType
	}
	if strings.Contains(fullType, "commons.apiresource") {
		return "apiresource", shortType
	}
	return alias, shortType
}

func isIDType(typeName string) bool {
	return strings.HasSuffix(typeName, "Id") || strings.HasSuffix(typeName, "ID")
}

func goProtoFieldName(protoField string) string {
	parts := strings.Split(protoField, "_")
	for i, p := range parts {
		if len(p) > 0 {
			parts[i] = strings.ToUpper(p[:1]) + p[1:]
		}
		switch strings.ToLower(p) {
		case "url":
			parts[i] = "Url"
		case "id":
			parts[i] = "Id"
		case "md":
			parts[i] = "Md"
		case "usd":
			parts[i] = "Usd"
		}
	}
	return strings.Join(parts, "")
}
