package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// deriveTSImportBase converts a proto package to a @stigmer/protos import base.
// "ai.stigmer.agentic.agent.v1" → "@stigmer/protos/ai/stigmer/agentic/agent/v1"
func deriveTSImportBase(pkg string) string {
	return "@stigmer/protos/" + strings.ReplaceAll(pkg, ".", "/")
}

// tsProtoFieldName converts a proto field name (snake_case) to camelCase.
func tsProtoFieldName(protoField string) string {
	parts := strings.Split(protoField, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}

// tsClientFieldName converts a resource name to a client field name.
func tsClientFieldName(resource string) string {
	replacements := map[string]string{
		"agentexecution":    "agentExecution",
		"agentinstance":     "agentInstance",
		"executioncontext":  "executionContext",
		"mcpserver":         "mcpServer",
		"workflowexecution": "workflowExecution",
		"workflowinstance":  "workflowInstance",
		"identityaccount":   "identityAccount",
		"identityprovider":  "identityProvider",
		"iampolicy":         "iamPolicy",
		"apikey":            "apiKey",
	}
	if v, ok := replacements[resource]; ok {
		return v
	}
	return resource
}

// tsProtoFileToSuffix extracts the _pb suffix from a proto file path.
// "apis/.../spec.proto" → "spec_pb"
func tsProtoFileToSuffix(protoFile string) string {
	base := filepath.Base(protoFile)
	name := strings.TrimSuffix(base, ".proto")
	return name + "_pb"
}

// tsResolveEnumImport resolves the import path for an enum type.
// Enums in this codebase consistently live in enum_pb.ts files.
func tsResolveEnumImport(enumFullType string) (importFrom string, enumName string) {
	parts := strings.Split(enumFullType, ".")
	enumName = parts[len(parts)-1]
	enumPkg := strings.Join(parts[:len(parts)-1], ".")
	importBase := deriveTSImportBase(enumPkg)
	return importBase + "/enum_pb", enumName
}

// isCommonsType checks if a fully-qualified type belongs to the commons package.
func isCommonsType(fullType string) bool {
	return strings.HasPrefix(fullType, "ai.stigmer.commons.")
}

// tsCommonsImportFile returns the _pb file for a known commons type.
var commonsTypeFiles = map[string]string{
	"ApiResourceAuditActor": "status_pb",
	"ApiResourceAudit":      "status_pb",
	"ApiResourceMetadata":   "metadata_pb",
}

func tsResolveCommonsImport(typeName, fullType string) string {
	parts := strings.Split(fullType, ".")
	typePkg := strings.Join(parts[:len(parts)-1], ".")
	importBase := deriveTSImportBase(typePkg)
	if file, ok := commonsTypeFiles[typeName]; ok {
		return importBase + "/" + file
	}
	return importBase + "/io_pb"
}

// =========================================================================
// Entry point
// =========================================================================

func runSDKClientTSGeneration(schemaDir, outputDir string) error {
	servicesDir := filepath.Join(schemaDir, "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		return fmt.Errorf("failed to read services directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	if err := generateTSErrors(outputDir); err != nil {
		return fmt.Errorf("failed to generate errors.ts: %w", err)
	}
	fmt.Printf("   -> errors.ts\n")

	if err := generateTSTypes(outputDir); err != nil {
		return fmt.Errorf("failed to generate types.ts: %w", err)
	}
	fmt.Printf("   -> types.ts\n")

	var allResources []resourceGenInfo

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		resource := strings.TrimSuffix(entry.Name(), ".json")
		if resource == "search" {
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

		cfg := deriveResourceConfig(&schema, schemaDir)

		var specSchema *TaskConfigSchema
		var specTypes []*TypeSchema
		if cfg.specSchema != "" {
			specPath := filepath.Join(schemaDir, cfg.specSchema)
			specSchema, specTypes, err = loadSpecSchemaWithTypes(specPath, schemaDir, resource)
			if err != nil {
				fmt.Printf("   Warning: could not load spec schema for %s: %v\n", resource, err)
			}
		}

		code, genInfo, err := generateTSResourceClient(&schema, cfg, specSchema, specTypes)
		if err != nil {
			return fmt.Errorf("failed to generate TS client for %s: %w", resource, err)
		}

		outputPath := filepath.Join(outputDir, resource+".ts")
		if err := os.WriteFile(outputPath, code, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", outputPath, err)
		}
		fmt.Printf("   -> %s.ts\n", resource)

		allResources = append(allResources, genInfo)
	}

	sort.Slice(allResources, func(i, j int) bool {
		return allResources[i].resource < allResources[j].resource
	})

	if err := generateTSClientFile(outputDir, allResources); err != nil {
		return fmt.Errorf("failed to generate client.ts: %w", err)
	}
	fmt.Printf("   -> client.ts\n")

	return nil
}

// =========================================================================
// Import tracking
// =========================================================================

type tsImport struct {
	from       string
	values     []string
	typeValues []string
}

type tsImportSet struct {
	imports map[string]*tsImport
}

func newTSImportSet() *tsImportSet {
	return &tsImportSet{imports: make(map[string]*tsImport)}
}

func (s *tsImportSet) addValue(from, name string) {
	imp, ok := s.imports[from]
	if !ok {
		imp = &tsImport{from: from}
		s.imports[from] = imp
	}
	for _, v := range imp.values {
		if v == name {
			return
		}
	}
	imp.values = append(imp.values, name)
}

func (s *tsImportSet) addType(from, name string) {
	imp, ok := s.imports[from]
	if !ok {
		imp = &tsImport{from: from}
		s.imports[from] = imp
	}
	for _, v := range imp.values {
		if v == name {
			return
		}
	}
	for _, v := range imp.typeValues {
		if v == name {
			return
		}
	}
	imp.typeValues = append(imp.typeValues, name)
}

func (s *tsImportSet) emit(buf *bytes.Buffer) {
	var sources []string
	for k := range s.imports {
		sources = append(sources, k)
	}
	sort.Strings(sources)

	for _, from := range sources {
		imp := s.imports[from]
		var parts []string
		for _, v := range imp.values {
			parts = append(parts, v)
		}
		for _, v := range imp.typeValues {
			parts = append(parts, "type "+v)
		}
		if len(parts) == 0 {
			continue
		}
		fmt.Fprintf(buf, "import { %s } from %q;\n", strings.Join(parts, ", "), from)
	}
	buf.WriteString("\n")
}

// =========================================================================
// Per-resource client generation
// =========================================================================

func generateTSResourceClient(schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema) ([]byte, resourceGenInfo, error) {
	importBase := deriveTSImportBase(schema.Package)
	hasInputType := specSchema != nil
	needsSearch := schema.ListVia == "SearchService"

	genInfo := resourceGenInfo{
		resource:   schema.Resource,
		clientName: cfg.clientName,
	}

	imports := newTSImportSet()

	imports.addValue("@connectrpc/connect", "createClient")
	imports.addType("@connectrpc/connect", "Client")
	imports.addType("@connectrpc/connect", "Transport")
	imports.addValue("./errors", "wrapError")

	for _, svc := range schema.Services {
		file := svc.Role + "_pb"
		imports.addValue(importBase+"/"+file, svc.Name)
	}

	// Import the resource's own ID type schema, but only if it's a resource-specific
	// type (not a commons type like ApiResourceId which is handled separately).
	if cfg.idType != "" && cfg.idType != "ApiResourceId" {
		imports.addValue(importBase+"/io_pb", cfg.idType+"Schema")
	}

	imports.addValue(importBase+"/api_pb", cfg.protoResType+"Schema")
	imports.addType(importBase+"/api_pb", cfg.protoResType)

	// Build a map of spec-defined type names to their proto file suffixes.
	// This allows us to import types from the correct _pb file (e.g., spec_pb vs io_pb).
	specTypeNames := make(map[string]bool)
	specTypeFileMap := make(map[string]string) // typeName → _pb suffix (e.g., "spec_pb")
	for _, t := range specTypes {
		specTypeNames[t.Name] = true
		if t.ProtoFile != "" {
			specTypeFileMap[t.Name] = tsProtoFileToSuffix(t.ProtoFile)
		}
	}

	needsApiResourceId := false
	needsApiResourceRef := false
	needsApiResourceDeleteInput := false
	needsEmptySchema := false
	needsCreate := false

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if m.InputType == "ApiResourceId" {
				needsApiResourceId = true
			}
			if m.InputType == "ApiResourceReference" {
				needsApiResourceRef = true
			}
			if m.InputType == "ApiResourceDeleteInput" {
				needsApiResourceDeleteInput = true
			}
			if isEmptyType(m.InputFullType) {
				needsEmptySchema = true
				needsCreate = true
			}
			if m.ServerStreaming {
				genInfo.streamTypes = append(genInfo.streamTypes, cfg.protoResType+m.Name+"Stream")
			}
			if isIDType(m.InputType) {
				needsCreate = true
				// Import the ID schema for non-primary, resource-local ID types (e.g., IdpId)
				if m.InputType != cfg.idType &&
					m.InputType != "ApiResourceId" &&
					strings.HasPrefix(m.InputFullType, schema.Package+".") {
					imports.addValue(importBase+"/io_pb", m.InputType+"Schema")
				}
			}

			// Import non-standard types used as method inputs/outputs.
			tsImportMethodType(imports, m.InputType, m.InputFullType, schema, cfg, specTypeNames, specTypeFileMap, importBase)
			tsImportMethodType(imports, m.OutputType, m.OutputFullType, schema, cfg, specTypeNames, specTypeFileMap, importBase)
		}
	}

	if needsApiResourceId {
		needsCreate = true
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceIdSchema")
	}
	if needsApiResourceRef {
		needsCreate = true
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
	}
	if needsApiResourceDeleteInput {
		needsCreate = true
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceDeleteInputSchema")
		imports.addType("./types", "DeleteResourceInput")
	}
	if needsEmptySchema {
		imports.addValue("@bufbuild/protobuf/wkt", "EmptySchema")
	}

	if hasInputType {
		needsCreate = true
		imports.addValue(importBase+"/spec_pb", specSchema.Name+"Schema")
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataSchema")
	}

	if needsCreate {
		imports.addValue("@bufbuild/protobuf", "create")
	}

	if needsSearch {
		imports.addValue("@stigmer/protos/ai/stigmer/search/v1/query_pb", "SearchService")
		imports.addValue("@stigmer/protos/ai/stigmer/search/v1/io_pb", "SearchRequestSchema")
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind")
		imports.addValue("@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb", "PageInfoSchema")
		imports.addType("./types", "ListParams")
		imports.addType("./types", "ListResult")
	}

	typeMap := make(map[string]*TypeSchema)
	for _, t := range specTypes {
		typeMap[t.Name] = t
	}

	if specSchema != nil {
		needsEnvSpec := false
		needsResourceRef := false
		for _, f := range specSchema.Fields {
			scanFieldForSpecialImports(f, typeMap, &needsEnvSpec, &needsResourceRef)
		}
		if needsEnvSpec {
			imports.addType("./types", "EnvSpecInput")
		}
		if needsResourceRef {
			imports.addType("./types", "ResourceRef")
		}
	}

	var body bytes.Buffer

	fmt.Fprintf(&body, "/** Provides operations on %s resources. */\n", schema.Resource)
	fmt.Fprintf(&body, "export class %s {\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&body, "  private readonly %s: Client<typeof %s>;\n", svc.Role, svc.Name)
	}
	if needsSearch {
		body.WriteString("  private readonly search: Client<typeof SearchService>;\n")
	}
	body.WriteString("\n")

	fmt.Fprintf(&body, "  constructor(transport: Transport) {\n")
	for _, svc := range schema.Services {
		fmt.Fprintf(&body, "    this.%s = createClient(%s, transport);\n", svc.Role, svc.Name)
	}
	if needsSearch {
		body.WriteString("    this.search = createClient(SearchService, transport);\n")
	}
	body.WriteString("  }\n")

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			body.WriteString("\n")
			generateTSMethod(&body, &m, &svc, schema, cfg, hasInputType, imports)
		}
	}

	if needsSearch {
		body.WriteString("\n")
		generateTSSearchList(&body, schema, cfg)
	}

	body.WriteString("}\n")

	if specSchema != nil {
		body.WriteString("\n")
		inputTypes := generateTSInputTypes(&body, schema, cfg, specSchema, typeMap, imports)
		genInfo.inputTypes = inputTypes

		body.WriteString("\n")
		generateTSBuildProto(&body, schema, cfg, specSchema, typeMap, imports)
	}

	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	imports.emit(&buf)
	buf.Write(body.Bytes())

	return buf.Bytes(), genInfo, nil
}

// tsImportMethodType handles importing a single method input or output type.
// It determines the correct source module based on type origin.
func tsImportMethodType(imports *tsImportSet, typeName, fullType string, schema *ServiceSchemaFile, cfg sdkResourceConfig, specTypeNames map[string]bool, specTypeFileMap map[string]string, importBase string) {
	// Skip types handled by dedicated logic
	if typeName == "" || typeName == cfg.protoResType || typeName == "ApiResourceId" ||
		typeName == "ApiResourceReference" || typeName == "ApiResourceDeleteInput" ||
		isIDType(typeName) || isEmptyType(fullType) {
		return
	}

	typePkg := ""
	if idx := strings.LastIndex(fullType, "."); idx > 0 {
		typePkg = fullType[:idx]
	}

	// Cross-package type: import from the type's own package
	if typePkg != schema.Package {
		if isCommonsType(fullType) {
			from := tsResolveCommonsImport(typeName, fullType)
			imports.addType(from, typeName)
		} else if typePkg != "" {
			crossBase := deriveTSImportBase(typePkg)
			imports.addType(crossBase+"/io_pb", typeName)
		}
		return
	}

	// Same-package type: check if it's a spec-defined type
	if specTypeNames[typeName] {
		if file, ok := specTypeFileMap[typeName]; ok {
			imports.addValue(importBase+"/"+file, typeName+"Schema")
			imports.addType(importBase+"/"+file, typeName)
		} else {
			imports.addValue(importBase+"/spec_pb", typeName+"Schema")
			imports.addType(importBase+"/spec_pb", typeName)
		}
		return
	}

	// Same-package type: the spec type itself — schema is already imported,
	// but we still need the TYPE for method signatures.
	if typeName == cfg.inputPrefix+"Spec" {
		imports.addType(importBase+"/spec_pb", typeName)
		return
	}

	// Same-package: default to io_pb
	imports.addValue(importBase+"/io_pb", typeName+"Schema")
	imports.addType(importBase+"/io_pb", typeName)
}

func scanFieldForSpecialImports(f *FieldSchema, typeMap map[string]*TypeSchema, needsEnvSpec, needsResourceRef *bool) {
	switch {
	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		*needsEnvSpec = true
	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		*needsResourceRef = true
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		*needsResourceRef = true
	case f.Type.Kind == "message":
		if ts, ok := typeMap[f.Type.MessageType]; ok {
			for _, sf := range ts.Fields {
				scanFieldForSpecialImports(sf, typeMap, needsEnvSpec, needsResourceRef)
			}
		}
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		if ts, ok := typeMap[f.Type.ElementType.MessageType]; ok {
			for _, sf := range ts.Fields {
				scanFieldForSpecialImports(sf, typeMap, needsEnvSpec, needsResourceRef)
			}
		}
	}
}

// =========================================================================
// Method generation
// =========================================================================

func generateTSMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, hasInputType bool, imports *tsImportSet) {
	if m.ServerStreaming {
		generateTSStreamingMethod(buf, m, svc, schema, cfg, imports)
		return
	}

	emptyInput := isEmptyType(m.InputFullType)
	emptyOutput := isEmptyType(m.OutputFullType)
	isIDInput := isIDType(m.InputType)
	isDeleteInput := m.InputType == "ApiResourceDeleteInput"
	isResourceInput := m.InputType == cfg.protoResType
	isApiResourceIdInput := m.InputType == "ApiResourceId"
	isApiResourceRefInput := m.InputType == "ApiResourceReference"

	outputType := cfg.protoResType
	if emptyOutput {
		outputType = "void"
	} else if m.OutputType != cfg.protoResType {
		outputType = m.OutputType
	}

	returnKeyword := "return "
	if emptyOutput {
		returnKeyword = ""
	}

	switch {
	case emptyInput:
		fmt.Fprintf(buf, "  async %s(): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(EmptySchema, {}));\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isResourceInput && hasInputType:
		inputTypeName := cfg.inputPrefix + "Input"
		fmt.Fprintf(buf, "  async %s(input: %s): Promise<%s> {\n", tsMethodName(m.Name), inputTypeName, outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(build%sProto(input));\n", returnKeyword, svc.Role, tsMethodName(m.Name), cfg.protoResType)
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isResourceInput && !hasInputType:
		fmt.Fprintf(buf, "  async %s(input: %s): Promise<%s> {\n", tsMethodName(m.Name), cfg.protoResType, outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(input);\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isIDInput:
		fmt.Fprintf(buf, "  async %s(id: string): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(%sSchema, { value: id }));\n", returnKeyword, svc.Role, tsMethodName(m.Name), m.InputType)
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isApiResourceIdInput:
		fmt.Fprintf(buf, "  async %s(id: string): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(ApiResourceIdSchema, { value: id }));\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isApiResourceRefInput:
		imports.addType("./types", "ResourceRef")
		fmt.Fprintf(buf, "  async %s(ref: ResourceRef): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(ApiResourceReferenceSchema, ref));\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	case isDeleteInput:
		fmt.Fprintf(buf, "  async %s(input: DeleteResourceInput): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(ApiResourceDeleteInputSchema, {\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "        resourceId: input.resourceId,\n")
		fmt.Fprintf(buf, "        versionMessage: input.versionMessage,\n")
		fmt.Fprintf(buf, "        force: input.force,\n")
		fmt.Fprintf(buf, "      }));\n")
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")

	default:
		inputType := m.InputType
		fmt.Fprintf(buf, "  async %s(input: %s): Promise<%s> {\n", tsMethodName(m.Name), inputType, outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(input);\n", returnKeyword, svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")
	}
}

func generateTSStreamingMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, imports *tsImportSet) {
	isIDInput := isIDType(m.InputType)
	outputType := m.OutputType
	if outputType != cfg.protoResType {
		importBase := deriveTSImportBase(schema.Package)
		imports.addType(importBase+"/api_pb", outputType)
	}

	if isIDInput {
		fmt.Fprintf(buf, "  async *%s(id: string, signal?: AbortSignal): AsyncGenerator<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      for await (const msg of this.%s.%s(create(%sSchema, { value: id }), { signal })) {\n", svc.Role, tsMethodName(m.Name), m.InputType)
		fmt.Fprintf(buf, "        yield msg;\n")
		fmt.Fprintf(buf, "      }\n")
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")
	} else {
		importBase := deriveTSImportBase(schema.Package)
		imports.addType(importBase+"/io_pb", m.InputType)
		fmt.Fprintf(buf, "  async *%s(input: %s, signal?: AbortSignal): AsyncGenerator<%s> {\n", tsMethodName(m.Name), m.InputType, outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      for await (const msg of this.%s.%s(input, { signal })) {\n", svc.Role, tsMethodName(m.Name))
		fmt.Fprintf(buf, "        yield msg;\n")
		fmt.Fprintf(buf, "      }\n")
		fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
		buf.WriteString("  }\n")
	}
}

func generateTSSearchList(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig) {
	kindConst := pascalToSnake(cfg.protoResType)
	fmt.Fprintf(buf, "  async list(params: ListParams): Promise<ListResult> {\n")
	fmt.Fprintf(buf, "    try {\n")
	fmt.Fprintf(buf, "      const resp = await this.search.search(create(SearchRequestSchema, {\n")
	fmt.Fprintf(buf, "        kinds: [ApiResourceKind.%s],\n", kindConst)
	fmt.Fprintf(buf, "        query: params.query,\n")
	fmt.Fprintf(buf, "        org: params.org,\n")
	fmt.Fprintf(buf, "        excludePublic: params.excludePublic ?? false,\n")
	fmt.Fprintf(buf, "        page: params.page ? create(PageInfoSchema, params.page) : undefined,\n")
	fmt.Fprintf(buf, "      }));\n")
	fmt.Fprintf(buf, "      return {\n")
	fmt.Fprintf(buf, "        entries: resp.entries,\n")
	fmt.Fprintf(buf, "        totalCount: resp.totalCount,\n")
	fmt.Fprintf(buf, "        totalPages: resp.totalPages,\n")
	fmt.Fprintf(buf, "      };\n")
	fmt.Fprintf(buf, "    } catch (e) { throw wrapError(e); }\n")
	buf.WriteString("  }\n")
}

// =========================================================================
// Input type generation
// =========================================================================

func generateTSInputTypes(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) []string {
	inputName := cfg.inputPrefix + "Input"
	emitted := make(map[string]bool)
	var allTypes []string

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	fmt.Fprintf(buf, "/** Input for creating/updating a %s. */\n", cfg.protoResType)
	fmt.Fprintf(buf, "export interface %s {\n", inputName)
	buf.WriteString("  name: string;\n")
	buf.WriteString("  org: string;\n")
	for _, f := range specFields {
		tsType := tsTypeForField(f, typeMap, imports, schema.Package)
		optional := "?"
		if f.Required {
			optional = ""
		}
		fmt.Fprintf(buf, "  %s%s: %s;\n", tsProtoFieldName(f.ProtoField), optional, tsType)
	}
	buf.WriteString("}\n")
	allTypes = append(allTypes, inputName)

	for _, f := range specFields {
		emitTSNestedTypes(buf, f, typeMap, emitted, &allTypes, imports, schema.Package)
	}

	return allTypes
}

func emitTSNestedTypes(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, allTypes *[]string, imports *tsImportSet, pkg string) {
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

	if isSpecialType(msgName) || emitted[msgName] {
		return
	}
	ts, ok := typeMap[msgName]
	if !ok {
		return
	}
	emitted[msgName] = true

	inputName := msgName + "Input"
	fmt.Fprintf(buf, "\n/** SDK input type for %s. */\n", msgName)
	fmt.Fprintf(buf, "export interface %s {\n", inputName)
	for _, field := range ts.Fields {
		tsType := tsTypeForField(field, typeMap, imports, pkg)
		optional := "?"
		if field.Required {
			optional = ""
		}
		fmt.Fprintf(buf, "  %s%s: %s;\n", tsProtoFieldName(field.ProtoField), optional, tsType)
	}
	buf.WriteString("}\n")
	*allTypes = append(*allTypes, inputName)

	for _, field := range ts.Fields {
		emitTSNestedTypes(buf, field, typeMap, emitted, allTypes, imports, pkg)
	}
}

func tsTypeForField(f *FieldSchema, _ map[string]*TypeSchema, imports *tsImportSet, pkg string) string {
	return tsTypeForTypeSpec(&f.Type, imports, pkg)
}

func tsTypeForTypeSpec(ts *TypeSpec, imports *tsImportSet, _ string) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			importFrom, enumName := tsResolveEnumImport(ts.EnumType)
			imports.addValue(importFrom, enumName)
			return enumName
		}
		return "string"
	case "int32", "uint32", "float", "double":
		return "number"
	case "int64":
		return "bigint"
	case "bool":
		return "boolean"
	case "bytes":
		return "Uint8Array"
	case "timestamp":
		return "Date | string"
	case "struct":
		imports.addType("@bufbuild/protobuf", "JsonObject")
		return "JsonObject"
	case "array":
		if ts.ElementType != nil {
			elemType := tsTypeForTypeSpec(ts.ElementType, imports, "")
			return elemType + "[]"
		}
		return "string[]"
	case "map":
		keyType := "string"
		valType := "string"
		if ts.KeyType != nil {
			keyType = tsTypeForTypeSpec(ts.KeyType, imports, "")
		}
		if ts.ValueType != nil {
			valType = tsTypeForTypeSpec(ts.ValueType, imports, "")
		}
		return fmt.Sprintf("Record<%s, %s>", keyType, valType)
	case "message":
		switch ts.MessageType {
		case "EnvironmentSpec":
			imports.addType("./types", "EnvSpecInput")
			return "EnvSpecInput"
		case "EnvironmentValue", "ExecutionValue":
			imports.addType("./types", "EnvVarInput")
			return "EnvVarInput"
		case "ApiResourceReference":
			imports.addType("./types", "ResourceRef")
			return "ResourceRef"
		default:
			return ts.MessageType + "Input"
		}
	default:
		return "string"
	}
}

// =========================================================================
// Proto builder generation
//
// Uses Object.assign(create(Schema), { ...data }) to avoid MessageInit
// type checking issues. protobuf-es v2 create() produces a valid message
// instance, and Object.assign copies SDK input values onto it at runtime.
// TypeScript sees the result as an intersection type which is safely
// assignable to the original message type.
// =========================================================================

func generateTSBuildProto(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) {
	inputName := cfg.inputPrefix + "Input"

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	fmt.Fprintf(buf, "function build%sProto(input: %s): %s {\n", cfg.protoResType, inputName, cfg.protoResType)
	fmt.Fprintf(buf, "  return Object.assign(create(%sSchema), {\n", cfg.protoResType)
	fmt.Fprintf(buf, "    apiVersion: %q,\n", cfg.apiVersion)
	fmt.Fprintf(buf, "    kind: %q,\n", cfg.protoResType)
	fmt.Fprintf(buf, "    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n")
	fmt.Fprintf(buf, "      name: input.name,\n")
	fmt.Fprintf(buf, "      org: input.org,\n")
	fmt.Fprintf(buf, "    }),\n")
	fmt.Fprintf(buf, "    spec: Object.assign(create(%sSchema), {\n", spec.Name)

	for _, f := range specFields {
		fieldName := tsProtoFieldName(f.ProtoField)
		fmt.Fprintf(buf, "      %s: input.%s,\n", fieldName, fieldName)
	}

	fmt.Fprintf(buf, "    }),\n")
	fmt.Fprintf(buf, "  }) as %s;\n", cfg.protoResType)
	buf.WriteString("}\n")
}

// =========================================================================
// Generated client.ts
// =========================================================================

func generateTSClientFile(outputDir string, resources []resourceGenInfo) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("import type { Transport } from \"@connectrpc/connect\";\n")

	for _, r := range resources {
		fmt.Fprintf(&buf, "import { %s } from \"./%s\";\n", r.clientName, r.resource)
	}
	buf.WriteString("\n")

	buf.WriteString("/** Aggregate client with all resource-specific sub-clients. */\n")
	buf.WriteString("export class GeneratedClient {\n")
	for _, r := range resources {
		fieldName := tsClientFieldName(r.resource)
		fmt.Fprintf(&buf, "  readonly %s: %s;\n", fieldName, r.clientName)
	}
	buf.WriteString("\n")

	buf.WriteString("  constructor(transport: Transport) {\n")
	for _, r := range resources {
		fieldName := tsClientFieldName(r.resource)
		fmt.Fprintf(&buf, "    this.%s = new %s(transport);\n", fieldName, r.clientName)
	}
	buf.WriteString("  }\n")
	buf.WriteString("}\n")

	// Re-export: classes as values, input types as types
	buf.WriteString("\n// Re-export all resource client types and input types.\n")
	for _, r := range resources {
		// Client class export (value)
		fmt.Fprintf(&buf, "export { %s } from \"./%s\";\n", r.clientName, r.resource)
		// Input types export (type-only, required by isolatedModules)
		if len(r.inputTypes) > 0 {
			var typeExports []string
			for _, t := range r.inputTypes {
				typeExports = append(typeExports, "type "+t)
			}
			fmt.Fprintf(&buf, "export { %s } from \"./%s\";\n", strings.Join(typeExports, ", "), r.resource)
		}
	}
	buf.WriteString("export { type ListParams, type ListResult, type DeleteResourceInput, type ResourceRef, type EnvSpecInput, type EnvVarInput, type Page } from \"./types\";\n")
	buf.WriteString("export { StigmerError, type ErrorCode, isNotFound, isUnauthenticated, isPermissionDenied, isRetryable } from \"./errors\";\n")

	return os.WriteFile(filepath.Join(outputDir, "client.ts"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated errors.ts
// =========================================================================

func generateTSErrors(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`// Code generated by stigmer-codegen. DO NOT EDIT.

import { ConnectError, Code } from "@connectrpc/connect";

/** Error codes mapped from gRPC/Connect status codes. */
export type ErrorCode =
  | "unknown"
  | "not-found"
  | "permission-denied"
  | "unauthenticated"
  | "invalid-argument"
  | "already-exists"
  | "resource-exhausted"
  | "failed-precondition"
  | "internal"
  | "unavailable"
  | "cancelled";

const CODE_MAP: Record<number, ErrorCode> = {
  [Code.NotFound]: "not-found",
  [Code.PermissionDenied]: "permission-denied",
  [Code.Unauthenticated]: "unauthenticated",
  [Code.InvalidArgument]: "invalid-argument",
  [Code.AlreadyExists]: "already-exists",
  [Code.ResourceExhausted]: "resource-exhausted",
  [Code.FailedPrecondition]: "failed-precondition",
  [Code.Internal]: "internal",
  [Code.Unavailable]: "unavailable",
  [Code.Canceled]: "cancelled",
};

/** Structured error type returned by all SDK operations. */
export class StigmerError extends Error {
  readonly code: ErrorCode;
  readonly connectCode: number;

  constructor(code: ErrorCode, message: string, connectCode: number) {
    super(message);
    this.name = "StigmerError";
    this.code = code;
    this.connectCode = connectCode;
  }
}

/** @internal Convert any thrown value to a StigmerError. */
export function wrapError(err: unknown): StigmerError {
  if (err instanceof ConnectError) {
    const code = CODE_MAP[err.code] ?? "unknown";
    return new StigmerError(code, err.rawMessage || err.message, err.code);
  }
  if (err instanceof StigmerError) {
    return err;
  }
  if (err instanceof Error) {
    return new StigmerError("unknown", err.message, Code.Unknown);
  }
  return new StigmerError("unknown", String(err), Code.Unknown);
}

export function isNotFound(err: unknown): boolean {
  return err instanceof StigmerError && err.code === "not-found";
}

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof StigmerError && err.code === "unauthenticated";
}

export function isPermissionDenied(err: unknown): boolean {
  return err instanceof StigmerError && err.code === "permission-denied";
}

export function isRetryable(err: unknown): boolean {
  return err instanceof StigmerError && (err.code === "internal" || err.code === "unavailable");
}
`)
	return os.WriteFile(filepath.Join(outputDir, "errors.ts"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated types.ts
// =========================================================================

func generateTSTypes(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`// Code generated by stigmer-codegen. DO NOT EDIT.

import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

/** Arguments for deleting a resource. */
export interface DeleteResourceInput {
  readonly resourceId: string;
  readonly versionMessage?: string;
  readonly force?: boolean;
}

/** Identifies an API resource by org, slug, and optional version. */
export interface ResourceRef {
  readonly org: string;
  readonly slug: string;
  readonly version?: string;
  readonly kind?: number;
}

/** Offset-based pagination parameters. */
export interface Page {
  readonly num: number;
  readonly size: number;
}

/** Parameters for SearchService-backed list queries. */
export interface ListParams {
  readonly org: string;
  readonly query?: string;
  readonly excludePublic?: boolean;
  readonly page?: Page;
}

/** Response from a SearchService-backed list query. */
export interface ListResult {
  readonly entries: SearchResult[];
  readonly totalCount: number;
  readonly totalPages: number;
}

/** Environment variable configuration. */
export interface EnvSpecInput {
  readonly variables: Record<string, EnvVarInput>;
}

/** A single environment variable. */
export interface EnvVarInput {
  readonly value: string;
  readonly isSecret?: boolean;
  readonly description?: string;
}
`)
	return os.WriteFile(filepath.Join(outputDir, "types.ts"), buf.Bytes(), 0644)
}

// =========================================================================
// Helpers
// =========================================================================

func tsMethodName(name string) string {
	if len(name) == 0 {
		return name
	}
	return strings.ToLower(name[:1]) + name[1:]
}
