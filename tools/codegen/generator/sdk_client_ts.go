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

// tsApisDir is the root directory containing proto API definitions.
// Used by tsResolveEnumImport to determine whether a package has a
// dedicated enum.proto file. Defaults to "apis" (repo root CWD).
var tsApisDir = "apis"

// tsResolveEnumImport resolves the import path for an enum type.
// It checks whether the enum's package has a dedicated enum.proto;
// if not, the enum is assumed to live in spec.proto.
func tsResolveEnumImport(enumFullType string) (importFrom string, enumName string) {
	parts := strings.Split(enumFullType, ".")
	enumName = parts[len(parts)-1]
	enumPkg := strings.Join(parts[:len(parts)-1], ".")
	importBase := deriveTSImportBase(enumPkg)

	suffix := "spec_pb"
	pkgPath := strings.ReplaceAll(enumPkg, ".", "/")
	if _, err := os.Stat(filepath.Join(tsApisDir, pkgPath, "enum.proto")); err == nil {
		suffix = "enum_pb"
	}
	return importBase + "/" + suffix, enumName
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

	if err := generateTSProtoUtils(outputDir); err != nil {
		return fmt.Errorf("failed to generate proto-utils.ts: %w", err)
	}
	fmt.Printf("   -> proto-utils.ts\n")

	if err := generateTSTypes(outputDir); err != nil {
		return fmt.Errorf("failed to generate types.ts: %w", err)
	}
	fmt.Printf("   -> types.ts\n")

	if err := generateTSBidiStream(outputDir); err != nil {
		return fmt.Errorf("failed to generate bidi-stream.ts: %w", err)
	}
	fmt.Printf("   -> bidi-stream.ts\n")

	var allResources []resourceGenInfo

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		resource := strings.TrimSuffix(entry.Name(), ".json")
		if resource == "search" || resource == "commons" {
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

	if err := generateTSKindMeta(outputDir); err != nil {
		return fmt.Errorf("failed to generate kind-meta files: %w", err)
	}

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

	// Build a map of method-level type names to their proto file suffixes.
	// Types like MintUserTokenRequest live in token.proto, not io.proto;
	// without this map, they fall through to the io_pb default.
	methodTypeFileMap := make(map[string]string)
	for _, mt := range schema.MethodTypes {
		if mt.ProtoFile != "" {
			methodTypeFileMap[mt.Name] = tsProtoFileToSuffix(mt.ProtoFile)
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
				if m.ClientStreaming {
					imports.addValue("./bidi-stream", "BidiStream")
				}
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
			tsImportMethodType(imports, m.InputType, m.InputFullType, schema, cfg, specTypeNames, specTypeFileMap, methodTypeFileMap, importBase)
			tsImportMethodType(imports, m.OutputType, m.OutputFullType, schema, cfg, specTypeNames, specTypeFileMap, methodTypeFileMap, importBase)
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
		imports.addValue("./proto-utils", "stripUndefined")
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
func tsImportMethodType(imports *tsImportSet, typeName, fullType string, schema *ServiceSchemaFile, cfg sdkResourceConfig, specTypeNames map[string]bool, specTypeFileMap map[string]string, methodTypeFileMap map[string]string, importBase string) {
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

	// Same-package: resolve from methodTypes when the type's proto file is known
	if file, ok := methodTypeFileMap[typeName]; ok {
		imports.addValue(importBase+"/"+file, typeName+"Schema")
		imports.addType(importBase+"/"+file, typeName)
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
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind")
		kindConst := cfg.resourceKind
		fmt.Fprintf(buf, "  async %s(ref: ResourceRef): Promise<%s> {\n", tsMethodName(m.Name), outputType)
		fmt.Fprintf(buf, "    try {\n")
		fmt.Fprintf(buf, "      %sawait this.%s.%s(create(ApiResourceReferenceSchema, { ...ref, kind: ApiResourceKind.%s }));\n", returnKeyword, svc.Role, tsMethodName(m.Name), kindConst)
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
	if outputType != cfg.protoResType && !m.ClientStreaming {
		importBase := deriveTSImportBase(schema.Package)
		imports.addType(importBase+"/api_pb", outputType)
	}

	if m.ClientStreaming {
		// Bidi streaming: return a BidiStream with send/close/async iteration.
		importBase := deriveTSImportBase(schema.Package)
		imports.addType(importBase+"/io_pb", m.InputType)
		imports.addType(importBase+"/io_pb", m.OutputType)
		fmt.Fprintf(buf, "  %s(signal?: AbortSignal): BidiStream<%s, %s> {\n", tsMethodName(m.Name), m.InputType, outputType)
		fmt.Fprintf(buf, "    return new BidiStream((reqs) => this.%s.%s(reqs, { signal }));\n", svc.Role, tsMethodName(m.Name))
		buf.WriteString("  }\n")
	} else if isIDInput {
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
	kindConst := cfg.resourceKind
	fmt.Fprintf(buf, "  async list(params: ListParams): Promise<ListResult> {\n")
	fmt.Fprintf(buf, "    try {\n")
	fmt.Fprintf(buf, "      const resp = await this.search.search(create(SearchRequestSchema, {\n")
	fmt.Fprintf(buf, "        kinds: [ApiResourceKind.%s],\n", kindConst)
	fmt.Fprintf(buf, "        query: params.query,\n")
	fmt.Fprintf(buf, "        org: params.org,\n")
	fmt.Fprintf(buf, "        excludePublic: params.excludePublic ?? false,\n")
	fmt.Fprintf(buf, "        crossOrgPublic: params.crossOrgPublic ?? false,\n")
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
	buf.WriteString("  slug?: string;\n")
	buf.WriteString("  org: string;\n")
	buf.WriteString("  labels?: Record<string, string>;\n")
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
// Generates buildXxxProto functions that properly construct protobuf-es
// message instances using create(Schema). Nested message fields, repeated
// messages, oneofs, and maps with message values are all handled.
//
// Mirrors the Go SDK's emitToProtoField / emitNestedToProto pattern,
// adapted for protobuf-es semantics (create + Object.assign + oneof
// { case, value } syntax).
// =========================================================================

func tsFieldNeedsConversion(f *FieldSchema) bool {
	switch {
	case f.Type.Kind == "message":
		return true
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		return true
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		return true
	default:
		return false
	}
}

// isSyntheticOneof returns true for proto3 optional synthetic oneofs (prefixed with _).
// protobuf-es v2 exposes these as regular fields, not oneofs.
func isSyntheticOneof(group string) bool {
	return strings.HasPrefix(group, "_")
}

func tsTypeHasOneof(ts *TypeSchema) bool {
	for _, f := range ts.Fields {
		if f.OneofGroup != "" && !isSyntheticOneof(f.OneofGroup) {
			return true
		}
	}
	return false
}

func tsTypeHasNestedMessages(ts *TypeSchema) bool {
	for _, f := range ts.Fields {
		if tsFieldNeedsConversion(f) {
			return true
		}
	}
	return false
}

// tsAddSchemaImport adds the XxxSchema import for a TypeSchema.
// When the type belongs to a different proto package (cross-package reference),
// the import base is derived from the type's own ProtoType rather than the
// current resource's package.
func tsAddSchemaImport(ts *TypeSchema, imports *tsImportSet, importBase string) {
	schemaName := ts.Name + "Schema"
	if ts.ProtoFile != "" {
		effectiveBase := importBase
		if ts.ProtoType != "" {
			parts := strings.Split(ts.ProtoType, ".")
			if len(parts) > 1 {
				typePkg := strings.Join(parts[:len(parts)-1], ".")
				effectiveBase = deriveTSImportBase(typePkg)
			}
		}
		suffix := tsProtoFileToSuffix(ts.ProtoFile)
		imports.addValue(effectiveBase+"/"+suffix, schemaName)
	} else {
		imports.addValue(importBase+"/spec_pb", schemaName)
	}
}

func generateTSBuildProto(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) {
	importBase := deriveTSImportBase(schema.Package)
	inputName := cfg.inputPrefix + "Input"

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	// Emit nested builder functions first (so they're available to the main builder).
	emitted := make(map[string]bool)
	for _, f := range specFields {
		emitTSNestedBuilders(buf, f, typeMap, emitted, imports, importBase)
	}

	// Separate spec fields into regular fields and oneof groups.
	specOneofGroups := make(map[string][]*FieldSchema)
	var specOneofOrder []string
	var regularSpecFields []*FieldSchema
	for _, f := range specFields {
		if f.OneofGroup != "" && !isSyntheticOneof(f.OneofGroup) {
			if _, seen := specOneofGroups[f.OneofGroup]; !seen {
				specOneofOrder = append(specOneofOrder, f.OneofGroup)
			}
			specOneofGroups[f.OneofGroup] = append(specOneofGroups[f.OneofGroup], f)
		} else {
			regularSpecFields = append(regularSpecFields, f)
		}
	}

	hasSpecOneofs := len(specOneofGroups) > 0

	// Identify regular fields that need pre-computation (proto conversion).
	var preComputed []*FieldSchema
	for _, f := range regularSpecFields {
		if tsFieldNeedsConversion(f) {
			preComputed = append(preComputed, f)
		}
	}

	fmt.Fprintf(buf, "function build%sProto(input: %s): %s {\n", cfg.protoResType, inputName, cfg.protoResType)

	for _, f := range preComputed {
		emitTSPreComputeField(buf, f, typeMap, imports)
	}

	if hasSpecOneofs {
		// When spec has oneofs, build spec separately so we can assign oneofs imperatively.
		fmt.Fprintf(buf, "  const spec = Object.assign(create(%sSchema), stripUndefined({\n", spec.Name)
		for _, f := range regularSpecFields {
			fieldName := tsProtoFieldName(f.ProtoField)
			if tsFieldNeedsConversion(f) {
				fmt.Fprintf(buf, "    %s,\n", fieldName)
			} else {
				fmt.Fprintf(buf, "    %s: input.%s,\n", fieldName, fieldName)
			}
		}
		fmt.Fprintf(buf, "  }));\n")

		// Emit oneof assignments on the spec.
		for _, oneofName := range specOneofOrder {
			fields := specOneofGroups[oneofName]
			oneofTSName := tsProtoFieldName(oneofName)
			for i, field := range fields {
				fieldName := tsProtoFieldName(field.ProtoField)
				prefix := "if"
				if i > 0 {
					prefix = "} else if"
				}
				fmt.Fprintf(buf, "  %s (input.%s) {\n", prefix, fieldName)

				childType := field.Type.MessageType
				if childType != "" && !isSpecialType(childType) {
					if _, childOk := typeMap[childType]; childOk {
						fmt.Fprintf(buf, "    spec.%s = { case: %q, value: build%sProto(input.%s) };\n",
							oneofTSName, fieldName, childType, fieldName)
					} else {
						fmt.Fprintf(buf, "    spec.%s = { case: %q, value: input.%s };\n",
							oneofTSName, fieldName, fieldName)
					}
				} else if childType == "ApiResourceReference" {
					imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
					fmt.Fprintf(buf, "    spec.%s = { case: %q, value: create(ApiResourceReferenceSchema, input.%s) };\n",
						oneofTSName, fieldName, fieldName)
				} else {
					fmt.Fprintf(buf, "    spec.%s = { case: %q, value: input.%s };\n",
						oneofTSName, fieldName, fieldName)
				}
			}
			buf.WriteString("  }\n")
		}

		fmt.Fprintf(buf, "  return Object.assign(create(%sSchema), {\n", cfg.protoResType)
		fmt.Fprintf(buf, "    apiVersion: %q,\n", cfg.apiVersion)
		fmt.Fprintf(buf, "    kind: %q,\n", cfg.protoResType)
		fmt.Fprintf(buf, "    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n")
		fmt.Fprintf(buf, "      name: input.name,\n")
		fmt.Fprintf(buf, "      org: input.org,\n")
		buf.WriteString("      ...(input.slug && { slug: input.slug }),\n")
		buf.WriteString("      ...(input.labels && { labels: input.labels }),\n")
		fmt.Fprintf(buf, "    }),\n")
		fmt.Fprintf(buf, "    spec,\n")
		fmt.Fprintf(buf, "  }) as %s;\n", cfg.protoResType)
	} else {
		fmt.Fprintf(buf, "  return Object.assign(create(%sSchema), {\n", cfg.protoResType)
		fmt.Fprintf(buf, "    apiVersion: %q,\n", cfg.apiVersion)
		fmt.Fprintf(buf, "    kind: %q,\n", cfg.protoResType)
		fmt.Fprintf(buf, "    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n")
		fmt.Fprintf(buf, "      name: input.name,\n")
		fmt.Fprintf(buf, "      org: input.org,\n")
		buf.WriteString("      ...(input.slug && { slug: input.slug }),\n")
		buf.WriteString("      ...(input.labels && { labels: input.labels }),\n")
		fmt.Fprintf(buf, "    }),\n")
		fmt.Fprintf(buf, "    spec: Object.assign(create(%sSchema), stripUndefined({\n", spec.Name)

		for _, f := range regularSpecFields {
			fieldName := tsProtoFieldName(f.ProtoField)
			if tsFieldNeedsConversion(f) {
				fmt.Fprintf(buf, "      %s,\n", fieldName)
			} else {
				fmt.Fprintf(buf, "      %s: input.%s,\n", fieldName, fieldName)
			}
		}

		fmt.Fprintf(buf, "    })),\n")
		fmt.Fprintf(buf, "  }) as %s;\n", cfg.protoResType)
	}
	buf.WriteString("}\n")
}

// emitTSPreComputeField emits a variable declaration that converts an input
// field to proper proto message instance(s) before the main return statement.
func emitTSPreComputeField(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) {
	fieldName := tsProtoFieldName(f.ProtoField)

	switch {
	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentSpecSchema")
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema")
		fmt.Fprintf(buf, "  let %s;\n", fieldName)
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    const es = create(EnvironmentSpecSchema);\n")
		fmt.Fprintf(buf, "    for (const [k, v] of Object.entries(input.%s.variables)) {\n", fieldName)
		fmt.Fprintf(buf, "      es.data[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n")
		fmt.Fprintf(buf, "    }\n")
		fmt.Fprintf(buf, "    %s = es;\n", fieldName)
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
		if f.ReferenceKind != 0 {
			fmt.Fprintf(buf, "  const %s = (input.%s?.slug || input.%s?.org) ? create(ApiResourceReferenceSchema, { ...input.%s, kind: %d }) : undefined;\n", fieldName, fieldName, fieldName, fieldName, f.ReferenceKind)
		} else {
			fmt.Fprintf(buf, "  const %s = (input.%s?.slug || input.%s?.org) ? create(ApiResourceReferenceSchema, input.%s) : undefined;\n", fieldName, fieldName, fieldName, fieldName)
		}

	case f.Type.Kind == "message":
		builderName := "build" + f.Type.MessageType + "Proto"
		fmt.Fprintf(buf, "  const %s = input.%s ? %s(input.%s) : undefined;\n", fieldName, fieldName, builderName, fieldName)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
		if f.ReferenceKind != 0 {
			fmt.Fprintf(buf, "  const %s = input.%s?.map(r => create(ApiResourceReferenceSchema, { ...r, kind: %d }));\n", fieldName, fieldName, f.ReferenceKind)
		} else {
			fmt.Fprintf(buf, "  const %s = input.%s?.map(r => create(ApiResourceReferenceSchema, r));\n", fieldName, fieldName)
		}

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		builderName := "build" + f.Type.ElementType.MessageType + "Proto"
		fmt.Fprintf(buf, "  const %s = input.%s?.map(%s);\n", fieldName, fieldName, builderName)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema")
		fmt.Fprintf(buf, "  let %s;\n", fieldName)
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    %s = Object.fromEntries(Object.entries(input.%s).map(([k, v]) =>\n", fieldName, fieldName)
		fmt.Fprintf(buf, "      [k, create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description })]));\n")
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb", "ExecutionValueSchema")
		fmt.Fprintf(buf, "  let %s;\n", fieldName)
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    %s = Object.fromEntries(Object.entries(input.%s).map(([k, v]) =>\n", fieldName, fieldName)
		fmt.Fprintf(buf, "      [k, create(ExecutionValueSchema, { value: v.value, isSecret: v.isSecret })]));\n")
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		builderName := "build" + f.Type.ValueType.MessageType + "Proto"
		fmt.Fprintf(buf, "  let %s;\n", fieldName)
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    %s = Object.fromEntries(Object.entries(input.%s).map(([k, v]) => [k, %s(v)]));\n",
			fieldName, fieldName, builderName)
		fmt.Fprintf(buf, "  }\n")
	}
}

// emitTSNestedBuilders recursively generates buildXxxProto helper functions
// for each non-special nested message type referenced by a field.
func emitTSNestedBuilders(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, imports *tsImportSet, importBase string) {
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

	// Recurse into sub-types first so their builders are emitted before this one.
	for _, field := range ts.Fields {
		emitTSNestedBuilders(buf, field, typeMap, emitted, imports, importBase)
	}

	tsAddSchemaImport(ts, imports, importBase)

	hasOneof := tsTypeHasOneof(ts)
	hasNested := tsTypeHasNestedMessages(ts)
	inputName := msgName + "Input"
	builderName := "build" + msgName + "Proto"

	if !hasOneof && !hasNested {
		// All-scalar type: use Object.assign + stripUndefined pattern.
		fmt.Fprintf(buf, "function %s(input: %s) {\n", builderName, inputName)
		fmt.Fprintf(buf, "  return Object.assign(create(%sSchema), stripUndefined({\n", msgName)
		for _, field := range ts.Fields {
			fn := tsProtoFieldName(field.ProtoField)
			fmt.Fprintf(buf, "    %s: input.%s,\n", fn, fn)
		}
		fmt.Fprintf(buf, "  }));\n")
		fmt.Fprintf(buf, "}\n\n")
		return
	}

	// Complex type: needs imperative construction (oneofs and/or nested messages).
	fmt.Fprintf(buf, "function %s(input: %s) {\n", builderName, inputName)
	fmt.Fprintf(buf, "  const msg = create(%sSchema);\n", msgName)

	// Group fields by oneof (skip synthetic oneofs from proto3 optional).
	oneofGroups := make(map[string][]*FieldSchema)
	var oneofOrder []string
	var regularFields []*FieldSchema
	for _, field := range ts.Fields {
		if field.OneofGroup != "" && !isSyntheticOneof(field.OneofGroup) {
			if _, seen := oneofGroups[field.OneofGroup]; !seen {
				oneofOrder = append(oneofOrder, field.OneofGroup)
			}
			oneofGroups[field.OneofGroup] = append(oneofGroups[field.OneofGroup], field)
		} else {
			regularFields = append(regularFields, field)
		}
	}

	// Emit regular (non-oneof) fields.
	for _, field := range regularFields {
		emitTSNestedFieldAssign(buf, field, typeMap, imports, importBase)
	}

	// Emit oneof groups.
	for _, oneofName := range oneofOrder {
		fields := oneofGroups[oneofName]
		for i, field := range fields {
			fieldName := tsProtoFieldName(field.ProtoField)
			prefix := "if"
			if i > 0 {
				prefix = "} else if"
			}
			fmt.Fprintf(buf, "  %s (input.%s) {\n", prefix, fieldName)

			childType := field.Type.MessageType
			if _, childOk := typeMap[childType]; childOk && !isSpecialType(childType) {
				fmt.Fprintf(buf, "    msg.%s = { case: %q, value: build%sProto(input.%s) };\n",
					oneofName, fieldName, childType, fieldName)
			} else if isSpecialType(childType) && childType == "ApiResourceReference" {
				imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
				fmt.Fprintf(buf, "    msg.%s = { case: %q, value: create(ApiResourceReferenceSchema, input.%s) };\n",
					oneofName, fieldName, fieldName)
			} else {
				fmt.Fprintf(buf, "    msg.%s = { case: %q, value: input.%s };\n",
					oneofName, fieldName, fieldName)
			}
		}
		buf.WriteString("  }\n")
	}

	buf.WriteString("  return msg;\n")
	fmt.Fprintf(buf, "}\n\n")
}

// emitTSNestedFieldAssign emits a field assignment inside a nested builder function.
func emitTSNestedFieldAssign(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, imports *tsImportSet, importBase string) {
	fieldName := tsProtoFieldName(f.ProtoField)

	switch {
	case f.Type.Kind == "string" || f.Type.Kind == "bool" || f.Type.Kind == "int32" ||
		f.Type.Kind == "int64" || f.Type.Kind == "uint32" || f.Type.Kind == "float" ||
		f.Type.Kind == "double" || f.Type.Kind == "bytes" || f.Type.Kind == "timestamp" ||
		f.Type.Kind == "struct":
		fmt.Fprintf(buf, "  if (input.%s !== undefined) msg.%s = input.%s;\n", fieldName, fieldName, fieldName)

	case f.Type.Kind == "array" && (f.Type.ElementType == nil || f.Type.ElementType.Kind != "message"):
		fmt.Fprintf(buf, "  if (input.%s) msg.%s = input.%s;\n", fieldName, fieldName, fieldName)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
		if f.ReferenceKind != 0 {
			fmt.Fprintf(buf, "  if (input.%s) msg.%s = input.%s.map(r => create(ApiResourceReferenceSchema, { ...r, kind: %d }));\n",
				fieldName, fieldName, fieldName, f.ReferenceKind)
		} else {
			fmt.Fprintf(buf, "  if (input.%s) msg.%s = input.%s.map(r => create(ApiResourceReferenceSchema, r));\n",
				fieldName, fieldName, fieldName)
		}

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if !isSpecialType(elemMsg) {
			fmt.Fprintf(buf, "  if (input.%s) msg.%s = input.%s.map(build%sProto);\n",
				fieldName, fieldName, fieldName, elemMsg)
		}

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentSpecSchema")
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema")
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    const es = create(EnvironmentSpecSchema);\n")
		fmt.Fprintf(buf, "    for (const [k, v] of Object.entries(input.%s.variables)) {\n", fieldName)
		fmt.Fprintf(buf, "      es.data[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n")
		fmt.Fprintf(buf, "    }\n")
		fmt.Fprintf(buf, "    msg.%s = es;\n", fieldName)
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
		if f.ReferenceKind != 0 {
			fmt.Fprintf(buf, "  if (input.%s?.slug || input.%s?.org) msg.%s = create(ApiResourceReferenceSchema, { ...input.%s, kind: %d });\n",
				fieldName, fieldName, fieldName, fieldName, f.ReferenceKind)
		} else {
			fmt.Fprintf(buf, "  if (input.%s?.slug || input.%s?.org) msg.%s = create(ApiResourceReferenceSchema, input.%s);\n",
				fieldName, fieldName, fieldName, fieldName)
		}

	case f.Type.Kind == "message":
		msgType := f.Type.MessageType
		if !isSpecialType(msgType) {
			fmt.Fprintf(buf, "  if (input.%s) msg.%s = build%sProto(input.%s);\n",
				fieldName, fieldName, msgType, fieldName)
		}

	case f.Type.Kind == "map" && (f.Type.ValueType == nil || f.Type.ValueType.Kind == "string"):
		fmt.Fprintf(buf, "  if (input.%s) Object.assign(msg.%s, input.%s);\n", fieldName, fieldName, fieldName)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb", "EnvironmentValueSchema")
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    for (const [k, v] of Object.entries(input.%s)) {\n", fieldName)
		fmt.Fprintf(buf, "      msg.%s[k] = create(EnvironmentValueSchema, { value: v.value, isSecret: v.isSecret, description: v.description });\n", fieldName)
		fmt.Fprintf(buf, "    }\n")
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue":
		imports.addValue("@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb", "ExecutionValueSchema")
		fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
		fmt.Fprintf(buf, "    for (const [k, v] of Object.entries(input.%s)) {\n", fieldName)
		fmt.Fprintf(buf, "      msg.%s[k] = create(ExecutionValueSchema, { value: v.value, isSecret: v.isSecret });\n", fieldName)
		fmt.Fprintf(buf, "    }\n")
		fmt.Fprintf(buf, "  }\n")

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		elemMsg := f.Type.ValueType.MessageType
		if !isSpecialType(elemMsg) {
			fmt.Fprintf(buf, "  if (input.%s) {\n", fieldName)
			fmt.Fprintf(buf, "    for (const [k, v] of Object.entries(input.%s)) {\n", fieldName)
			fmt.Fprintf(buf, "      msg.%s[k] = build%sProto(v);\n", fieldName, elemMsg)
			fmt.Fprintf(buf, "    }\n")
			fmt.Fprintf(buf, "  }\n")
		}
	}
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

	// Re-export: classes as values, input types as types.
	// Deduplicate type exports across resources to avoid "exported multiple times" errors
	// when the same nested type (e.g., McpServerUsageInput) appears in multiple resources.
	buf.WriteString("\n// Re-export all resource client types and input types.\n")
	exportedTypes := make(map[string]bool)
	for _, r := range resources {
		// Client class export (value)
		fmt.Fprintf(&buf, "export { %s } from \"./%s\";\n", r.clientName, r.resource)
		// Input types export (type-only, required by isolatedModules)
		if len(r.inputTypes) > 0 {
			var typeExports []string
			for _, t := range r.inputTypes {
				if exportedTypes[t] {
					continue
				}
				exportedTypes[t] = true
				typeExports = append(typeExports, "type "+t)
			}
			if len(typeExports) > 0 {
				fmt.Fprintf(&buf, "export { %s } from \"./%s\";\n", strings.Join(typeExports, ", "), r.resource)
			}
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
// Generated proto-utils.ts
// =========================================================================

func generateTSProtoUtils(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`// Code generated by stigmer-codegen. DO NOT EDIT.

/**
 * Remove keys whose values are ` + "`undefined`" + ` so that ` + "`Object.assign`" + `
 * does not overwrite protobuf default values (empty maps, empty arrays).
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result as Partial<T>;
}
`)
	return os.WriteFile(filepath.Join(outputDir, "proto-utils.ts"), buf.Bytes(), 0644)
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
  readonly crossOrgPublic?: boolean;
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
// Generated bidi-stream.ts
// =========================================================================

func generateTSBidiStream(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`// Code generated by stigmer-codegen. DO NOT EDIT.

/**
 * BidiStream provides send/receive/close for a bidirectional streaming RPC.
 *
 * Use ` + "`stream.send(msg)`" + ` to send messages to the server and
 * ` + "`for await (const msg of stream)`" + ` to receive messages.
 * Call ` + "`stream.close()`" + ` when no more messages will be sent.
 */
export class BidiStream<Send, Receive> {
  private _queue: Send[] = [];
  private _resolve: ((result: IteratorResult<Send>) => void) | null = null;
  private _done = false;
  private _responses: AsyncIterable<Receive>;

  /** @internal */
  constructor(open: (reqs: AsyncIterable<Send>) => AsyncIterable<Receive>) {
    const self = this;
    const requests: AsyncIterable<Send> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<Send>> {
            if (self._queue.length > 0) {
              return Promise.resolve({ value: self._queue.shift()!, done: false });
            }
            if (self._done) {
              return Promise.resolve({ value: undefined as unknown as Send, done: true });
            }
            return new Promise((resolve) => { self._resolve = resolve; });
          },
        };
      },
    };
    this._responses = open(requests);
  }

  /** Send a message to the server. */
  send(msg: Send): void {
    if (this._done) throw new Error("stream closed");
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve({ value: msg, done: false });
    } else {
      this._queue.push(msg);
    }
  }

  /** Signal that no more messages will be sent. */
  close(): void {
    this._done = true;
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve({ value: undefined as unknown as Send, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Receive> {
    yield* this._responses;
  }
}
`)
	return os.WriteFile(filepath.Join(outputDir, "bidi-stream.ts"), buf.Bytes(), 0644)
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
