package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// =========================================================================
// Python naming helpers
// =========================================================================

// pyMethodName converts PascalCase to snake_case for Python SDK method names.
// "Apply" → "apply", "GetByReference" → "get_by_reference"
func pyMethodName(name string) string {
	var result []rune
	runes := []rune(name)
	for i, r := range runes {
		if i > 0 && unicode.IsUpper(r) {
			prev := runes[i-1]
			if unicode.IsLower(prev) || unicode.IsDigit(prev) {
				result = append(result, '_')
			} else if unicode.IsUpper(prev) && i+1 < len(runes) && unicode.IsLower(runes[i+1]) {
				result = append(result, '_')
			}
		}
		result = append(result, unicode.ToLower(r))
	}
	return string(result)
}

// pyStubMethodName converts PascalCase to lowerCamelCase for Python gRPC stub calls.
// Stigmer protos define methods in lowerCamelCase ("apply", "getByReference").
func pyStubMethodName(name string) string {
	if len(name) == 0 {
		return name
	}
	return strings.ToLower(name[:1]) + name[1:]
}

// pyProtoFileToModule extracts the _pb2 module name from a proto file path.
// "apis/.../token.proto" → "token_pb2"
func pyProtoFileToModule(protoFile string) string {
	base := filepath.Base(protoFile)
	name := strings.TrimSuffix(base, ".proto")
	return name + "_pb2"
}

// pyMethodTypePb2Prefix returns the _pb2 module prefix for a method type.
// Types whose proto file is known via methodTypePb2Map get their correct module;
// everything else falls back to "io_pb2".
func pyMethodTypePb2Prefix(typeName string, methodTypePb2Map map[string]string) string {
	if mod, ok := methodTypePb2Map[typeName]; ok {
		return mod
	}
	return "io_pb2"
}

// pyTrackMethodTypeImport ensures the correct _pb2 import is tracked for a method
// input or output type. Types with a known proto file get their specific _pb2 module
// (e.g., token_pb2); everything else falls back to io_pb2.
func pyTrackMethodTypeImport(typeName, fullType string, cfg sdkResourceConfig, schema *ServiceSchemaFile, methodTypePb2Map map[string]string, imports *pyImports) {
	if typeName == cfg.protoResType || isEmptyType(fullType) || isIDType(typeName) ||
		typeName == "ApiResourceId" || typeName == "ApiResourceReference" || typeName == "ApiResourceDeleteInput" {
		return
	}
	if !strings.HasPrefix(fullType, schema.Package+".") {
		return
	}
	mod := pyMethodTypePb2Prefix(typeName, methodTypePb2Map)
	if mod == "io_pb2" {
		imports.needsIoPb2 = true
	} else {
		imports.extraPb2Modules[mod] = true
	}
}

// pyClientFieldName maps a resource slug to its snake_case plural Python property name.
func pyClientFieldName(resource string) string {
	m := map[string]string{
		"agent":             "agents",
		"agentexecution":    "agent_executions",
		"agentinstance":     "agent_instances",
		"apikey":            "api_keys",
		"environment":       "environments",
		"executioncontext":  "execution_contexts",
		"iampolicy":         "iam_policies",
		"identityaccount":   "identity_accounts",
		"identityprovider":  "identity_providers",
		"mcpserver":         "mcp_servers",
		"organization":      "organizations",
		"project":           "projects",
		"session":           "sessions",
		"skill":             "skills",
		"workflow":          "workflows",
		"workflowexecution": "workflow_executions",
		"workflowinstance":  "workflow_instances",
	}
	if v, ok := m[resource]; ok {
		return v
	}
	return resource + "s"
}

// pyTypeForTypeSpec converts a TypeSpec to a Python type annotation string.
func pyTypeForTypeSpec(ts *TypeSpec) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			return "int"
		}
		return "str"
	case "int32", "uint32", "int64":
		return "int"
	case "bool":
		return "bool"
	case "float", "double":
		return "float"
	case "bytes":
		return "bytes"
	case "timestamp":
		return "str"
	case "struct":
		return "dict[str, Any]"
	case "array":
		if ts.ElementType != nil {
			return "list[" + pyTypeForTypeSpec(ts.ElementType) + "]"
		}
		return "list[str]"
	case "map":
		kt := "str"
		vt := "str"
		if ts.KeyType != nil {
			kt = pyTypeForTypeSpec(ts.KeyType)
		}
		if ts.ValueType != nil {
			vt = pyTypeForTypeSpec(ts.ValueType)
		}
		return "dict[" + kt + ", " + vt + "]"
	case "message":
		switch ts.MessageType {
		case "EnvironmentSpec":
			return "EnvSpecInput"
		case "EnvironmentValue", "ExecutionValue":
			return "EnvVarInput"
		case "ApiResourceReference":
			return "ResourceRef"
		default:
			return ts.MessageType + "Input"
		}
	default:
		return "str"
	}
}

// pyDefaultForField returns the Python default-value expression for an optional
// dataclass field. Required fields return "" (no default).
func pyDefaultForField(f *FieldSchema) string {
	if f.Required {
		return ""
	}
	return pyDefaultForTypeSpec(&f.Type)
}

func pyDefaultForTypeSpec(ts *TypeSpec) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			return "0"
		}
		return `""`
	case "timestamp":
		return `""`
	case "int32", "uint32", "int64":
		return "0"
	case "bool":
		return "False"
	case "float", "double":
		return "0.0"
	case "bytes":
		return `b""`
	case "struct":
		return "field(default_factory=dict)"
	case "array":
		return "field(default_factory=list)"
	case "map":
		return "field(default_factory=dict)"
	case "message":
		return "None"
	default:
		return `""`
	}
}

func pyIsNullableType(ts *TypeSpec) bool {
	return ts.Kind == "message"
}

func pyNeedsFieldImport(ts *TypeSpec) bool {
	switch ts.Kind {
	case "struct", "array", "map":
		return true
	default:
		return false
	}
}

// pythonKeywords are reserved words that cannot be used as identifiers.
var pythonKeywords = map[string]bool{
	"False": true, "None": true, "True": true,
	"and": true, "as": true, "assert": true, "async": true, "await": true,
	"break": true, "class": true, "continue": true, "def": true, "del": true,
	"elif": true, "else": true, "except": true, "finally": true, "for": true,
	"from": true, "global": true, "if": true, "import": true, "in": true,
	"is": true, "lambda": true, "nonlocal": true, "not": true, "or": true,
	"pass": true, "raise": true, "return": true, "try": true, "while": true,
	"with": true, "yield": true,
}

// pyFieldName returns a safe Python identifier for a proto field name,
// appending a trailing underscore if the name is a Python keyword.
func pyFieldName(protoField string) string {
	if pythonKeywords[protoField] {
		return protoField + "_"
	}
	return protoField
}

func pyIsScalarKind(kind string) bool {
	switch kind {
	case "string", "int32", "uint32", "int64", "bool", "float", "double", "bytes":
		return true
	default:
		return false
	}
}

// pyProtoModuleAlias derives a Python import alias from a fully-qualified proto
// package name. E.g. "ai.stigmer.agentic.agent.v1" → "agent_spec_pb2".
func pyProtoModuleAlias(protoPkg string) string {
	parts := strings.Split(protoPkg, ".")
	if len(parts) >= 2 {
		return parts[len(parts)-2] + "_spec_pb2"
	}
	return protoPkg + "_spec_pb2"
}

// pyProtoImportLine returns a Python import statement for a cross-package proto module.
// E.g. "ai.stigmer.agentic.agent.v1" → "from ai.stigmer.agentic.agent.v1 import spec_pb2 as agent_spec_pb2"
func pyProtoImportLine(protoPkg string) string {
	alias := pyProtoModuleAlias(protoPkg)
	return fmt.Sprintf("from %s import spec_pb2 as %s", protoPkg, alias)
}

// =========================================================================
// Import tracking
// =========================================================================

type pyImports struct {
	resourcePkg string

	needsDataclass bool
	needsField     bool
	needsIterator    bool
	needsBidiStream  bool
	needsAny         bool

	services   map[string]bool
	needsIoPb2 bool
	needsSpec  bool

	needsApiResIo   bool
	needsMetadata   bool
	needsEmptyPb2   bool
	needsSearch     bool
	needsApiResKind bool
	needsEnvV1      bool
	needsExecCtxV1  bool

	typesNames         map[string]bool
	crossResourceTypes map[string][]string // "._agent" -> ["McpServerUsageInput", ...]
	crossProtoPackages map[string]bool     // "ai.stigmer.agentic.agent.v1" -> true
	extraPb2Modules    map[string]bool     // additional _pb2 modules beyond io_pb2 (e.g., "token_pb2")
}

func newPyImports(pkg string) *pyImports {
	return &pyImports{
		resourcePkg:        pkg,
		services:           make(map[string]bool),
		typesNames:         make(map[string]bool),
		crossResourceTypes: make(map[string][]string),
		crossProtoPackages: make(map[string]bool),
		extraPb2Modules:    make(map[string]bool),
	}
}

func (p *pyImports) addService(role string) {
	p.services[role] = true
}

func (p *pyImports) addTypesImport(name string) {
	p.typesNames[name] = true
}

func (p *pyImports) addCrossResourceImport(resource, typeName string) {
	module := "._" + resource
	p.crossResourceTypes[module] = append(p.crossResourceTypes[module], typeName)
}

func (p *pyImports) addCrossProtoPackage(protoPkg string) {
	p.crossProtoPackages[protoPkg] = true
}

func (p *pyImports) emit(buf *bytes.Buffer) {
	buf.WriteString("from __future__ import annotations\n\n")

	var stdLines []string
	if p.needsDataclass && p.needsField {
		stdLines = append(stdLines, "from dataclasses import dataclass, field")
	} else if p.needsDataclass {
		stdLines = append(stdLines, "from dataclasses import dataclass")
	}
	var typingParts []string
	if p.needsAny {
		typingParts = append(typingParts, "Any")
	}
	if p.needsIterator {
		typingParts = append(typingParts, "Iterator")
	}
	if len(typingParts) > 0 {
		sort.Strings(typingParts)
		stdLines = append(stdLines, fmt.Sprintf("from typing import %s", strings.Join(typingParts, ", ")))
	}
	if len(stdLines) > 0 {
		for _, l := range stdLines {
			buf.WriteString(l + "\n")
		}
		buf.WriteString("\n")
	}

	buf.WriteString("import grpc\n\n")

	fmt.Fprintf(buf, "from %s import api_pb2\n", p.resourcePkg)
	var roles []string
	for r := range p.services {
		roles = append(roles, r)
	}
	sort.Strings(roles)
	for _, r := range roles {
		fmt.Fprintf(buf, "from %s import %s_pb2_grpc\n", p.resourcePkg, r)
	}
	if p.needsIoPb2 {
		fmt.Fprintf(buf, "from %s import io_pb2\n", p.resourcePkg)
	}
	if len(p.extraPb2Modules) > 0 {
		var modules []string
		for m := range p.extraPb2Modules {
			if m == "io_pb2" && p.needsIoPb2 {
				continue
			}
			if m == "spec_pb2" && p.needsSpec {
				continue
			}
			modules = append(modules, m)
		}
		sort.Strings(modules)
		for _, m := range modules {
			fmt.Fprintf(buf, "from %s import %s\n", p.resourcePkg, m)
		}
	}
	if p.needsSpec {
		fmt.Fprintf(buf, "from %s import spec_pb2\n", p.resourcePkg)
	}
	if p.needsApiResIo {
		buf.WriteString("from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2\n")
	}
	if p.needsMetadata {
		buf.WriteString("from ai.stigmer.commons.apiresource import metadata_pb2\n")
	}
	if p.needsEmptyPb2 {
		buf.WriteString("from google.protobuf import empty_pb2\n")
	}
	if p.needsEnvV1 {
		buf.WriteString("from ai.stigmer.agentic.environment.v1 import spec_pb2 as environment_spec_pb2\n")
	}
	if p.needsExecCtxV1 {
		buf.WriteString("from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as executioncontext_spec_pb2\n")
	}
	if p.needsSearch || p.needsApiResKind {
		buf.WriteString("from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2\n")
	}
	if p.needsSearch {
		buf.WriteString("from ai.stigmer.search.v1 import query_pb2_grpc as search_query_pb2_grpc\n")
		buf.WriteString("from ai.stigmer.search.v1 import io_pb2 as search_io_pb2\n")
		buf.WriteString("from ai.stigmer.commons.rpc import pagination_pb2\n")
	}
	if len(p.crossProtoPackages) > 0 {
		var pkgs []string
		for pkg := range p.crossProtoPackages {
			pkgs = append(pkgs, pkg)
		}
		sort.Strings(pkgs)
		for _, pkg := range pkgs {
			buf.WriteString(pyProtoImportLine(pkg) + "\n")
		}
	}
	buf.WriteString("\n")

	buf.WriteString("from ._errors import wrap_error\n")
	if p.needsBidiStream {
		buf.WriteString("from ._bidi import BidiStream\n")
	}
	if len(p.typesNames) > 0 {
		var names []string
		for n := range p.typesNames {
			names = append(names, n)
		}
		sort.Strings(names)
		fmt.Fprintf(buf, "from ._types import %s\n", strings.Join(names, ", "))
	}
	if len(p.crossResourceTypes) > 0 {
		var modules []string
		for m := range p.crossResourceTypes {
			modules = append(modules, m)
		}
		sort.Strings(modules)
		for _, m := range modules {
			typeNames := p.crossResourceTypes[m]
			sort.Strings(typeNames)
			fmt.Fprintf(buf, "from %s import %s\n", m, strings.Join(typeNames, ", "))
		}
	}
	buf.WriteString("\n\n")
}

// =========================================================================
// Entry point
// =========================================================================

func runSDKClientPythonGeneration(schemaDir, outputDir string) error {
	servicesDir := filepath.Join(schemaDir, "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		return fmt.Errorf("failed to read services directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	if err := generatePythonErrors(outputDir); err != nil {
		return fmt.Errorf("failed to generate _errors.py: %w", err)
	}
	fmt.Printf("   -> _errors.py\n")

	if err := generatePythonTypes(outputDir); err != nil {
		return fmt.Errorf("failed to generate _types.py: %w", err)
	}
	fmt.Printf("   -> _types.py\n")

	if err := generatePythonBidiStream(outputDir); err != nil {
		return fmt.Errorf("failed to generate _bidi.py: %w", err)
	}
	fmt.Printf("   -> _bidi.py\n")

	var allResources []resourceGenInfo
	globalEmitted := make(map[string]string)

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

		code, genInfo, err := generatePythonResourceClient(&schema, cfg, specSchema, specTypes, globalEmitted)
		if err != nil {
			return fmt.Errorf("failed to generate Python client for %s: %w", resource, err)
		}

		outputPath := filepath.Join(outputDir, "_"+resource+".py")
		if err := os.WriteFile(outputPath, code, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", outputPath, err)
		}
		fmt.Printf("   -> _%s.py\n", resource)

		allResources = append(allResources, genInfo)
	}

	sort.Slice(allResources, func(i, j int) bool {
		return allResources[i].resource < allResources[j].resource
	})

	if err := generatePythonClientFile(outputDir, allResources); err != nil {
		return fmt.Errorf("failed to generate _client.py: %w", err)
	}
	fmt.Printf("   -> _client.py\n")

	if err := generatePythonInit(outputDir, allResources); err != nil {
		return fmt.Errorf("failed to generate __init__.py: %w", err)
	}
	fmt.Printf("   -> __init__.py\n")

	return nil
}

// =========================================================================
// Per-resource client generation
// =========================================================================

func generatePythonResourceClient(schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema, globalEmitted map[string]string) ([]byte, resourceGenInfo, error) {
	hasInputType := specSchema != nil
	needsSearch := schema.ListVia == "SearchService"

	genInfo := resourceGenInfo{
		resource:   schema.Resource,
		clientName: cfg.clientName,
	}

	imports := newPyImports(schema.Package)

	// Build a map of same-package method type names to their _pb2 module names.
	// Types like MintUserTokenRequest live in token.proto (→ token_pb2), not io.proto.
	// Cross-package types are excluded — they use separate import handling.
	methodTypePb2Map := make(map[string]string)
	for _, mt := range schema.MethodTypes {
		if mt.ProtoFile != "" && strings.HasPrefix(mt.ProtoType, schema.Package+".") {
			methodTypePb2Map[mt.Name] = pyProtoFileToModule(mt.ProtoFile)
		}
	}

	for _, svc := range schema.Services {
		imports.addService(svc.Role)
		for _, m := range svc.Methods {
			if isIDType(m.InputType) {
				imports.needsIoPb2 = true
			}
			if m.InputType == "ApiResourceId" || m.InputType == "ApiResourceReference" || m.InputType == "ApiResourceDeleteInput" {
				imports.needsApiResIo = true
			}
			if m.InputType == "ApiResourceReference" {
				imports.addTypesImport("ResourceRef")
				imports.needsApiResKind = true
			}
			if m.InputType == "ApiResourceDeleteInput" {
				imports.addTypesImport("DeleteResourceInput")
			}
			if isEmptyType(m.InputFullType) {
				imports.needsEmptyPb2 = true
			}
			if m.ServerStreaming {
				genInfo.streamTypes = append(genInfo.streamTypes, cfg.protoResType+m.Name+"Stream")
				if m.ClientStreaming {
					imports.needsBidiStream = true
				} else {
					imports.needsIterator = true
				}
			}
			pyTrackMethodTypeImport(m.OutputType, m.OutputFullType, cfg, schema, methodTypePb2Map, imports)
			pyTrackMethodTypeImport(m.InputType, m.InputFullType, cfg, schema, methodTypePb2Map, imports)
		}
	}

	if hasInputType {
		imports.needsDataclass = true
		imports.needsSpec = true
		imports.needsMetadata = true
	}

	if needsSearch {
		imports.needsSearch = true
		imports.addTypesImport("ListParams")
		imports.addTypesImport("ListResult")
	}

	typeMap := make(map[string]*TypeSchema)
	for _, t := range specTypes {
		typeMap[t.Name] = t
	}

	if specSchema != nil {
		scanPySpecFields(specSchema.Fields, typeMap, imports)
	}

	// Generate body
	var body bytes.Buffer

	// Client class
	fmt.Fprintf(&body, "class %s:\n", cfg.clientName)
	fmt.Fprintf(&body, "    \"\"\"Provides operations on %s resources.\"\"\"\n\n", schema.Resource)

	body.WriteString("    def __init__(self, channel: grpc.Channel) -> None:\n")
	for _, svc := range schema.Services {
		fmt.Fprintf(&body, "        self._%s = %s_pb2_grpc.%sStub(channel)\n", svc.Role, svc.Role, svc.Name)
	}
	if needsSearch {
		body.WriteString("        self._search = search_query_pb2_grpc.SearchServiceStub(channel)\n")
	}
	body.WriteString("\n")

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			generatePythonMethod(&body, &m, &svc, schema, cfg, hasInputType, imports, methodTypePb2Map)
		}
	}
	if needsSearch {
		generatePythonSearchList(&body, schema, cfg)
	}

	body.WriteString("\n")

	// Input types — each class includes its own _to_proto method
	if specSchema != nil {
		inputTypes := generatePythonInputAndProto(&body, schema, cfg, specSchema, typeMap, imports, globalEmitted)
		genInfo.inputTypes = inputTypes
	}

	// Assemble final output
	var buf bytes.Buffer
	buf.WriteString("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	imports.emit(&buf)
	buf.Write(body.Bytes())

	return buf.Bytes(), genInfo, nil
}

func scanPySpecFields(fields []*FieldSchema, typeMap map[string]*TypeSchema, imports *pyImports) {
	for _, f := range fields {
		scanPyFieldImports(f, typeMap, imports)
	}
}

func scanPyFieldImports(f *FieldSchema, typeMap map[string]*TypeSchema, imports *pyImports) {
	switch {
	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		imports.addTypesImport("EnvSpecInput")
	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		imports.addTypesImport("ResourceRef")
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		imports.addTypesImport("ResourceRef")
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue":
		imports.addTypesImport("EnvVarInput")
		imports.needsEnvV1 = true
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue":
		imports.addTypesImport("EnvVarInput")
		imports.needsExecCtxV1 = true
	case f.Type.Kind == "struct":
		imports.needsAny = true
	case f.Type.Kind == "message":
		if ts, ok := typeMap[f.Type.MessageType]; ok {
			for _, sf := range ts.Fields {
				scanPyFieldImports(sf, typeMap, imports)
			}
		}
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if !isSpecialType(elemMsg) {
			if ts, ok := typeMap[elemMsg]; ok {
				for _, sf := range ts.Fields {
					scanPyFieldImports(sf, typeMap, imports)
				}
			}
		}
	}
	if !f.Required && pyNeedsFieldImport(&f.Type) {
		imports.needsField = true
	}
}

// =========================================================================
// Method generation
// =========================================================================

func generatePythonMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, hasInputType bool, imports *pyImports, methodTypePb2Map map[string]string) {
	if m.ServerStreaming {
		generatePythonStreamingMethod(buf, m, svc, schema, cfg, imports, methodTypePb2Map)
		return
	}

	emptyInput := isEmptyType(m.InputFullType)
	emptyOutput := isEmptyType(m.OutputFullType)
	isIDInput := isIDType(m.InputType)
	isDeleteInput := m.InputType == "ApiResourceDeleteInput"
	isResourceInput := m.InputType == cfg.protoResType
	isApiResourceIdInput := m.InputType == "ApiResourceId"
	isApiResourceRefInput := m.InputType == "ApiResourceReference"

	methodName := pyMethodName(m.Name)
	stubMethod := pyStubMethodName(m.Name)

	outputAnnotation := "api_pb2." + cfg.protoResType
	if emptyOutput {
		outputAnnotation = "None"
	} else if m.OutputType != cfg.protoResType {
		outputAnnotation = pyMethodTypePb2Prefix(m.OutputType, methodTypePb2Map) + "." + m.OutputType
	}

	returnKw := "return "
	if emptyOutput {
		returnKw = ""
	}

	switch {
	case emptyInput:
		fmt.Fprintf(buf, "    def %s(self) -> %s:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(empty_pb2.Empty())\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isResourceInput && hasInputType:
		inputTypeName := cfg.inputPrefix + "Input"
		fmt.Fprintf(buf, "    def %s(self, input: %s) -> %s:\n", methodName, inputTypeName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(input._to_proto())\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isResourceInput && !hasInputType:
		fmt.Fprintf(buf, "    def %s(self, input: api_pb2.%s) -> %s:\n", methodName, cfg.protoResType, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(input)\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isApiResourceIdInput:
		fmt.Fprintf(buf, "    def %s(self, id: str) -> %s:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(apiresource_io_pb2.ApiResourceId(value=id))\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isApiResourceRefInput:
		kindConst := cfg.resourceKind
		fmt.Fprintf(buf, "    def %s(self, ref: ResourceRef) -> %s:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            proto = ref._to_proto()\n")
		fmt.Fprintf(buf, "            proto.kind = api_resource_kind_pb2.%s\n", kindConst)
		fmt.Fprintf(buf, "            %sself._%s.%s(proto)\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isDeleteInput:
		fmt.Fprintf(buf, "    def %s(self, input: DeleteResourceInput) -> %s:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(input._to_proto())\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	case isIDInput:
		idMod := pyMethodTypePb2Prefix(m.InputType, methodTypePb2Map)
		fmt.Fprintf(buf, "    def %s(self, id: str) -> %s:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(%s.%s(value=id))\n", returnKw, svc.Role, stubMethod, idMod, m.InputType)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")

	default:
		inputMod := pyMethodTypePb2Prefix(m.InputType, methodTypePb2Map)
		inputAnnotation := inputMod + "." + m.InputType
		fmt.Fprintf(buf, "    def %s(self, input: %s) -> %s:\n", methodName, inputAnnotation, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            %sself._%s.%s(input)\n", returnKw, svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")
	}
}

func generatePythonStreamingMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, imports *pyImports, methodTypePb2Map map[string]string) {
	isIDInput := isIDType(m.InputType)
	methodName := pyMethodName(m.Name)
	stubMethod := pyStubMethodName(m.Name)

	outputAnnotation := "api_pb2." + cfg.protoResType
	if m.OutputType != cfg.protoResType {
		outMod := pyMethodTypePb2Prefix(m.OutputType, methodTypePb2Map)
		outputAnnotation = outMod + "." + m.OutputType
	}

	if m.ClientStreaming {
		// Bidi streaming: return a BidiStream with send/close/iteration.
		inputMod := pyMethodTypePb2Prefix(m.InputType, methodTypePb2Map)
		inputAnnotation := inputMod + "." + m.InputType
		fmt.Fprintf(buf, "    def %s(self) -> BidiStream[%s, %s]:\n", methodName, inputAnnotation, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            return BidiStream(lambda reqs: self._%s.%s(reqs))\n", svc.Role, stubMethod)
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")
	} else if isIDInput {
		idMod := pyMethodTypePb2Prefix(m.InputType, methodTypePb2Map)
		fmt.Fprintf(buf, "    def %s(self, id: str) -> Iterator[%s]:\n", methodName, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            for msg in self._%s.%s(%s.%s(value=id)):\n", svc.Role, stubMethod, idMod, m.InputType)
		fmt.Fprintf(buf, "                yield msg\n")
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")
	} else {
		inputMod := pyMethodTypePb2Prefix(m.InputType, methodTypePb2Map)
		inputAnnotation := inputMod + "." + m.InputType
		fmt.Fprintf(buf, "    def %s(self, input: %s) -> Iterator[%s]:\n", methodName, inputAnnotation, outputAnnotation)
		fmt.Fprintf(buf, "        try:\n")
		fmt.Fprintf(buf, "            for msg in self._%s.%s(input):\n", svc.Role, stubMethod)
		fmt.Fprintf(buf, "                yield msg\n")
		fmt.Fprintf(buf, "        except grpc.RpcError as e:\n")
		fmt.Fprintf(buf, "            raise wrap_error(e) from e\n\n")
	}
}

func generatePythonSearchList(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig) {
	kindConst := cfg.resourceKind

	buf.WriteString("    def list(self, params: ListParams) -> ListResult:\n")
	buf.WriteString("        try:\n")
	buf.WriteString("            req = search_io_pb2.SearchRequest(\n")
	fmt.Fprintf(buf, "                kinds=[api_resource_kind_pb2.ApiResourceKind.%s],\n", kindConst)
	buf.WriteString("                query=params.query,\n")
	buf.WriteString("                org=params.org,\n")
	buf.WriteString("                exclude_public=params.exclude_public,\n")
	buf.WriteString("                cross_org_public=params.cross_org_public,\n")
	buf.WriteString("            )\n")
	buf.WriteString("            if params.page is not None:\n")
	buf.WriteString("                req.page.CopyFrom(pagination_pb2.PageInfo(\n")
	buf.WriteString("                    num=params.page.num,\n")
	buf.WriteString("                    size=params.page.size,\n")
	buf.WriteString("                ))\n")
	buf.WriteString("            resp = self._search.search(req)\n")
	buf.WriteString("            return ListResult(\n")
	buf.WriteString("                entries=list(resp.entries),\n")
	buf.WriteString("                total_count=resp.total_count,\n")
	buf.WriteString("                total_pages=resp.total_pages,\n")
	buf.WriteString("            )\n")
	buf.WriteString("        except grpc.RpcError as e:\n")
	buf.WriteString("            raise wrap_error(e) from e\n\n")
}

// =========================================================================
// Input types + _to_proto (each class is self-contained)
// =========================================================================

// generatePythonInputAndProto writes the main input @dataclass with its
// _to_proto method, then all nested input @dataclasses with their _to_proto
// methods. Returns the list of all emitted type names.
func generatePythonInputAndProto(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, imports *pyImports, globalEmitted map[string]string) []string {
	inputName := cfg.inputPrefix + "Input"
	emitted := make(map[string]bool)
	var allTypes []string

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	// Partition: required first, optional second (Python dataclass ordering)
	var requiredFields, optionalFields []*FieldSchema
	for _, f := range specFields {
		if f.Required {
			requiredFields = append(requiredFields, f)
		} else {
			optionalFields = append(optionalFields, f)
		}
	}

	// --- Main input class ---
	buf.WriteString("@dataclass\n")
	fmt.Fprintf(buf, "class %s:\n", inputName)
	fmt.Fprintf(buf, "    \"\"\"Input for creating or updating a %s.\"\"\"\n\n", cfg.protoResType)
	buf.WriteString("    name: str\n")
	buf.WriteString("    org: str\n")
	emitPyFields(buf, requiredFields, imports)
	buf.WriteString("    slug: str | None = None\n")
	buf.WriteString("    labels: dict[str, str] | None = None\n")
	emitPyFields(buf, optionalFields, imports)

	// _to_proto method inside the class
	emitPyMainToProto(buf, cfg, spec, specFields, imports)

	allTypes = append(allTypes, inputName)

	// --- Nested input classes (each with their own _to_proto) ---
	for _, f := range specFields {
		emitPyNestedClassWithProto(buf, f, typeMap, emitted, &allTypes, imports, globalEmitted, schema.Resource)
	}

	return allTypes
}

// emitPyFields writes dataclass field definitions at 4-space indent.
func emitPyFields(buf *bytes.Buffer, fields []*FieldSchema, imports *pyImports) {
	for _, f := range fields {
		pyType := pyTypeForTypeSpec(&f.Type)
		if pyIsNullableType(&f.Type) {
			pyType += " | None"
		}
		name := pyFieldName(f.ProtoField)
		dflt := pyDefaultForField(f)
		if dflt != "" {
			fmt.Fprintf(buf, "    %s: %s = %s\n", name, pyType, dflt)
			if pyNeedsFieldImport(&f.Type) {
				imports.needsField = true
			}
		} else {
			fmt.Fprintf(buf, "    %s: %s\n", name, pyType)
		}
	}
}

// emitPyMainToProto writes the _to_proto method for the main resource input type.
func emitPyMainToProto(buf *bytes.Buffer, cfg sdkResourceConfig, spec *TaskConfigSchema, specFields []*FieldSchema, imports *pyImports) {
	var safeScalars, kwScalars, complexFields []*FieldSchema
	for _, f := range specFields {
		if pyIsScalarKind(f.Type.Kind) {
			if pythonKeywords[f.ProtoField] {
				kwScalars = append(kwScalars, f)
			} else {
				safeScalars = append(safeScalars, f)
			}
		} else {
			complexFields = append(complexFields, f)
		}
	}

	fmt.Fprintf(buf, "\n    def _to_proto(self) -> api_pb2.%s:\n", cfg.protoResType)

	if len(safeScalars) > 0 {
		fmt.Fprintf(buf, "        spec = spec_pb2.%s(\n", spec.Name)
		for _, f := range safeScalars {
			fmt.Fprintf(buf, "            %s=self.%s,\n", f.ProtoField, pyFieldName(f.ProtoField))
		}
		buf.WriteString("        )\n")
	} else {
		fmt.Fprintf(buf, "        spec = spec_pb2.%s()\n", spec.Name)
	}

	for _, f := range kwScalars {
		fmt.Fprintf(buf, "        setattr(spec, %q, self.%s)\n", f.ProtoField, pyFieldName(f.ProtoField))
	}

	for _, f := range complexFields {
		emitPyToProtoFieldAssign(buf, f, "spec", "self", "        ", imports)
	}

	buf.WriteString("        metadata = metadata_pb2.ApiResourceMetadata(\n")
	buf.WriteString("            name=self.name,\n")
	buf.WriteString("            org=self.org,\n")
	buf.WriteString("        )\n")
	buf.WriteString("        if self.slug:\n")
	buf.WriteString("            metadata.slug = self.slug\n")
	buf.WriteString("        if self.labels:\n")
	buf.WriteString("            metadata.labels.update(self.labels)\n")
	fmt.Fprintf(buf, "        return api_pb2.%s(\n", cfg.protoResType)
	fmt.Fprintf(buf, "            api_version=%q,\n", cfg.apiVersion)
	fmt.Fprintf(buf, "            kind=%q,\n", cfg.protoResType)
	buf.WriteString("            metadata=metadata,\n")
	buf.WriteString("            spec=spec,\n")
	buf.WriteString("        )\n\n")
}

// emitPyNestedClassWithProto writes a nested @dataclass with its _to_proto method,
// then recurses for any deeper nested types.
func emitPyNestedClassWithProto(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, allTypes *[]string, imports *pyImports, globalEmitted map[string]string, resource string) {
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

	if sourceResource, alreadyGlobal := globalEmitted[msgName]; alreadyGlobal {
		imports.addCrossResourceImport(sourceResource, inputName)
		for _, field := range ts.Fields {
			emitPyNestedClassWithProto(buf, field, typeMap, emitted, allTypes, imports, globalEmitted, resource)
		}
		return
	}
	globalEmitted[msgName] = resource

	var requiredFields, optionalFields []*FieldSchema
	for _, field := range ts.Fields {
		if field.Required {
			requiredFields = append(requiredFields, field)
		} else {
			optionalFields = append(optionalFields, field)
		}
	}

	// Class header + fields
	fmt.Fprintf(buf, "\n@dataclass\nclass %s:\n", inputName)
	fmt.Fprintf(buf, "    \"\"\"SDK input type for %s.\"\"\"\n\n", msgName)
	emitPyFields(buf, requiredFields, imports)
	emitPyFields(buf, optionalFields, imports)

	// _to_proto method inside the class
	var safeScalars, kwScalars, complexFields []*FieldSchema
	for _, field := range ts.Fields {
		if pyIsScalarKind(field.Type.Kind) {
			if pythonKeywords[field.ProtoField] {
				kwScalars = append(kwScalars, field)
			} else {
				safeScalars = append(safeScalars, field)
			}
		} else {
			complexFields = append(complexFields, field)
		}
	}

	protoModule := "spec_pb2"
	if ts.ProtoType != "" {
		parts := strings.Split(ts.ProtoType, ".")
		if len(parts) > 1 {
			typePkg := strings.Join(parts[:len(parts)-1], ".")
			resourcePkg := imports.resourcePkg
			if typePkg != resourcePkg {
				protoModule = pyProtoModuleAlias(typePkg)
				imports.addCrossProtoPackage(typePkg)
			}
		}
	}

	fmt.Fprintf(buf, "\n    def _to_proto(self) -> %s.%s:\n", protoModule, msgName)
	if len(safeScalars) > 0 {
		fmt.Fprintf(buf, "        msg = %s.%s(\n", protoModule, msgName)
		for _, field := range safeScalars {
			fmt.Fprintf(buf, "            %s=self.%s,\n", field.ProtoField, pyFieldName(field.ProtoField))
		}
		buf.WriteString("        )\n")
	} else {
		fmt.Fprintf(buf, "        msg = %s.%s()\n", protoModule, msgName)
	}
	for _, field := range kwScalars {
		fmt.Fprintf(buf, "        setattr(msg, %q, self.%s)\n", field.ProtoField, pyFieldName(field.ProtoField))
	}
	for _, field := range complexFields {
		emitPyToProtoFieldAssign(buf, field, "msg", "self", "        ", imports)
	}
	buf.WriteString("        return msg\n\n")

	*allTypes = append(*allTypes, inputName)

	// Recurse for deeper nested types
	for _, field := range ts.Fields {
		emitPyNestedClassWithProto(buf, field, typeMap, emitted, allTypes, imports, globalEmitted, resource)
	}
}

// =========================================================================
// _to_proto field assignment helpers
// =========================================================================

func emitPyToProtoFieldAssign(buf *bytes.Buffer, f *FieldSchema, msgVar, selfVar, indent string, imports *pyImports) {
	protoField := f.ProtoField
	selfField := pyFieldName(f.ProtoField)
	isKw := pythonKeywords[protoField]

	// Helper to emit proto field access (handles keywords via getattr)
	protoAccess := func(v, field string) string {
		if isKw {
			return fmt.Sprintf("getattr(%s, %q)", v, field)
		}
		return v + "." + field
	}
	switch {
	case f.Type.Kind == "timestamp":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.FromJsonString(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "struct":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.update(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference" && f.ReferenceKind != 0:
		fmt.Fprintf(buf, "%sif %s.%s is not None:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    _ref = %s.%s._to_proto()\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    _ref.kind = %d\n", indent, f.ReferenceKind)
		fmt.Fprintf(buf, "%s    %s.CopyFrom(_ref)\n", indent, protoAccess(msgVar, protoField))

	case f.Type.Kind == "message":
		fmt.Fprintf(buf, "%sif %s.%s is not None:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.CopyFrom(%s.%s._to_proto())\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.extend(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		if f.ReferenceKind != 0 {
			fmt.Fprintf(buf, "%sfor ref in %s.%s:\n", indent, selfVar, selfField)
			fmt.Fprintf(buf, "%s    _ref = ref._to_proto()\n", indent)
			fmt.Fprintf(buf, "%s    _ref.kind = %d\n", indent, f.ReferenceKind)
			fmt.Fprintf(buf, "%s    %s.append(_ref)\n", indent, protoAccess(msgVar, protoField))
		} else {
			fmt.Fprintf(buf, "%sfor ref in %s.%s:\n", indent, selfVar, selfField)
			fmt.Fprintf(buf, "%s    %s.append(ref._to_proto())\n", indent, protoAccess(msgVar, protoField))
		}

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		fmt.Fprintf(buf, "%sfor item in %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.append(item._to_proto())\n", indent, protoAccess(msgVar, protoField))

	case f.Type.Kind == "array":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.extend(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "string":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.update(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue":
		imports.needsEnvV1 = true
		fmt.Fprintf(buf, "%sfor k, v in %s.%s.items():\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s[k].CopyFrom(environment_spec_pb2.EnvironmentValue(\n", indent, protoAccess(msgVar, protoField))
		fmt.Fprintf(buf, "%s        value=v.value, is_secret=v.is_secret, description=v.description,\n", indent)
		fmt.Fprintf(buf, "%s    ))\n", indent)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue":
		imports.needsExecCtxV1 = true
		fmt.Fprintf(buf, "%sfor k, v in %s.%s.items():\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s[k].CopyFrom(executioncontext_spec_pb2.ExecutionValue(\n", indent, protoAccess(msgVar, protoField))
		fmt.Fprintf(buf, "%s        value=v.value, is_secret=v.is_secret,\n", indent)
		fmt.Fprintf(buf, "%s    ))\n", indent)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		fmt.Fprintf(buf, "%sfor k, v in %s.%s.items():\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s[k].CopyFrom(v._to_proto())\n", indent, protoAccess(msgVar, protoField))

	case f.Type.Kind == "map":
		fmt.Fprintf(buf, "%sif %s.%s:\n", indent, selfVar, selfField)
		fmt.Fprintf(buf, "%s    %s.update(%s.%s)\n", indent, protoAccess(msgVar, protoField), selfVar, selfField)
	}
}

// =========================================================================
// Generated _client.py (aggregate client)
// =========================================================================

func generatePythonClientFile(outputDir string, resources []resourceGenInfo) error {
	var buf bytes.Buffer
	buf.WriteString("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("from __future__ import annotations\n\n")
	buf.WriteString("import grpc\n\n")

	for _, r := range resources {
		fmt.Fprintf(&buf, "from ._%s import %s\n", r.resource, r.clientName)
	}
	buf.WriteString("\n\n")

	buf.WriteString("class GeneratedClient:\n")
	buf.WriteString("    \"\"\"Aggregate client composing all resource-specific sub-clients.\"\"\"\n\n")

	buf.WriteString("    def __init__(self, channel: grpc.Channel) -> None:\n")
	for _, r := range resources {
		fieldName := pyClientFieldName(r.resource)
		fmt.Fprintf(&buf, "        self.%s = %s(channel)\n", fieldName, r.clientName)
	}
	buf.WriteString("\n")

	return os.WriteFile(filepath.Join(outputDir, "_client.py"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated _errors.py
// =========================================================================

func generatePythonErrors(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`# Code generated by stigmer-codegen. DO NOT EDIT.

from __future__ import annotations

import enum

import grpc


class ErrorCode(enum.Enum):
    """Error codes mapped from gRPC status codes."""

    UNKNOWN = "unknown"
    NOT_FOUND = "not-found"
    PERMISSION_DENIED = "permission-denied"
    UNAUTHENTICATED = "unauthenticated"
    INVALID_ARGUMENT = "invalid-argument"
    ALREADY_EXISTS = "already-exists"
    RESOURCE_EXHAUSTED = "resource-exhausted"
    FAILED_PRECONDITION = "failed-precondition"
    INTERNAL = "internal"
    UNAVAILABLE = "unavailable"
    CANCELLED = "cancelled"


_GRPC_CODE_MAP: dict[grpc.StatusCode, ErrorCode] = {
    grpc.StatusCode.NOT_FOUND: ErrorCode.NOT_FOUND,
    grpc.StatusCode.PERMISSION_DENIED: ErrorCode.PERMISSION_DENIED,
    grpc.StatusCode.UNAUTHENTICATED: ErrorCode.UNAUTHENTICATED,
    grpc.StatusCode.INVALID_ARGUMENT: ErrorCode.INVALID_ARGUMENT,
    grpc.StatusCode.ALREADY_EXISTS: ErrorCode.ALREADY_EXISTS,
    grpc.StatusCode.RESOURCE_EXHAUSTED: ErrorCode.RESOURCE_EXHAUSTED,
    grpc.StatusCode.FAILED_PRECONDITION: ErrorCode.FAILED_PRECONDITION,
    grpc.StatusCode.INTERNAL: ErrorCode.INTERNAL,
    grpc.StatusCode.UNAVAILABLE: ErrorCode.UNAVAILABLE,
    grpc.StatusCode.CANCELLED: ErrorCode.CANCELLED,
}


class StigmerError(Exception):
    """Structured error type returned by all SDK operations."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        grpc_code: grpc.StatusCode,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.grpc_code = grpc_code

    def __repr__(self) -> str:
        return f"StigmerError(code={self.code.value!r}, message={str(self)!r})"


def wrap_error(err: grpc.RpcError) -> StigmerError:
    """Convert a gRPC RpcError into a StigmerError."""
    grpc_code = err.code()
    code = _GRPC_CODE_MAP.get(grpc_code, ErrorCode.UNKNOWN)
    message = err.details() or str(err)
    return StigmerError(code, message, grpc_code)


def is_not_found(err: BaseException) -> bool:
    """Check whether an error represents a NOT_FOUND status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.NOT_FOUND


def is_unauthenticated(err: BaseException) -> bool:
    """Check whether an error represents an UNAUTHENTICATED status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.UNAUTHENTICATED


def is_permission_denied(err: BaseException) -> bool:
    """Check whether an error represents a PERMISSION_DENIED status."""
    return isinstance(err, StigmerError) and err.code == ErrorCode.PERMISSION_DENIED


def is_retryable(err: BaseException) -> bool:
    """Check whether the error is transient and the operation can be retried."""
    return isinstance(err, StigmerError) and err.code in (
        ErrorCode.INTERNAL,
        ErrorCode.UNAVAILABLE,
    )
`)
	return os.WriteFile(filepath.Join(outputDir, "_errors.py"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated _types.py
// =========================================================================

func generatePythonTypes(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString(`# Code generated by stigmer-codegen. DO NOT EDIT.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ai.stigmer.agentic.environment.v1 import spec_pb2 as environment_spec_pb2
from ai.stigmer.commons.apiresource import io_pb2 as apiresource_io_pb2
from ai.stigmer.search.v1 import io_pb2 as search_io_pb2


@dataclass
class DeleteResourceInput:
    """Arguments for deleting a resource."""

    resource_id: str = ""
    version_message: str = ""
    force: bool = False

    def _to_proto(self) -> apiresource_io_pb2.ApiResourceDeleteInput:
        return apiresource_io_pb2.ApiResourceDeleteInput(
            resource_id=self.resource_id,
            version_message=self.version_message,
            force=self.force,
        )


@dataclass
class ResourceRef:
    """Identifies an API resource by org, slug, and optional version."""

    org: str = ""
    slug: str = ""
    version: str = ""
    kind: int = 0

    def _to_proto(self) -> apiresource_io_pb2.ApiResourceReference:
        return apiresource_io_pb2.ApiResourceReference(
            org=self.org,
            slug=self.slug,
            version=self.version,
            kind=self.kind,
        )


@dataclass
class Page:
    """Offset-based pagination parameters."""

    num: int = 1
    size: int = 20


@dataclass
class ListParams:
    """Parameters for SearchService-backed list queries."""

    org: str = ""
    query: str = ""
    exclude_public: bool = False
    cross_org_public: bool = False
    page: Page | None = None


@dataclass
class ListResult:
    """Response from a SearchService-backed list query."""

    entries: list[search_io_pb2.SearchResult] = field(default_factory=list)
    total_count: int = 0
    total_pages: int = 0


@dataclass
class EnvVarInput:
    """A single environment variable."""

    value: str = ""
    is_secret: bool = False
    description: str = ""


@dataclass
class EnvSpecInput:
    """Environment variable configuration."""

    variables: dict[str, EnvVarInput] = field(default_factory=dict)

    def _to_proto(self) -> environment_spec_pb2.EnvironmentSpec:
        spec = environment_spec_pb2.EnvironmentSpec()
        for name, var in self.variables.items():
            spec.data[name].CopyFrom(
                environment_spec_pb2.EnvironmentValue(
                    value=var.value,
                    is_secret=var.is_secret,
                    description=var.description,
                )
            )
        return spec
`)
	return os.WriteFile(filepath.Join(outputDir, "_types.py"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated _bidi.py
// =========================================================================

func generatePythonBidiStream(outputDir string) error {
	var buf bytes.Buffer
	buf.WriteString("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("from __future__ import annotations\n\n")
	buf.WriteString("import queue\n")
	buf.WriteString("from typing import Generic, Iterator, TypeVar\n\n")
	buf.WriteString("Send = TypeVar(\"Send\")\n")
	buf.WriteString("Receive = TypeVar(\"Receive\")\n\n")
	buf.WriteString("_SENTINEL = object()\n\n\n")
	buf.WriteString("class BidiStream(Generic[Send, Receive]):\n")
	buf.WriteString("    \"\"\"Wraps a bidirectional streaming RPC with send/receive/close.\"\"\"\n\n")
	buf.WriteString("    def __init__(self, open_fn):\n")
	buf.WriteString("        self._queue: queue.SimpleQueue = queue.SimpleQueue()\n")
	buf.WriteString("        self._responses = open_fn(self._iter_requests())\n\n")
	buf.WriteString("    def _iter_requests(self):\n")
	buf.WriteString("        while True:\n")
	buf.WriteString("            msg = self._queue.get()\n")
	buf.WriteString("            if msg is _SENTINEL:\n")
	buf.WriteString("                return\n")
	buf.WriteString("            yield msg\n\n")
	buf.WriteString("    def send(self, msg: Send) -> None:\n")
	buf.WriteString("        \"\"\"Send a message to the server.\"\"\"\n")
	buf.WriteString("        self._queue.put(msg)\n\n")
	buf.WriteString("    def close(self) -> None:\n")
	buf.WriteString("        \"\"\"Signal that no more messages will be sent.\"\"\"\n")
	buf.WriteString("        self._queue.put(_SENTINEL)\n\n")
	buf.WriteString("    def __iter__(self) -> Iterator[Receive]:\n")
	buf.WriteString("        return iter(self._responses)\n\n")
	buf.WriteString("    def __next__(self) -> Receive:\n")
	buf.WriteString("        return next(self._responses)\n")
	return os.WriteFile(filepath.Join(outputDir, "_bidi.py"), buf.Bytes(), 0644)
}

// =========================================================================
// Generated __init__.py
// =========================================================================

func generatePythonInit(outputDir string, resources []resourceGenInfo) error {
	var buf bytes.Buffer
	buf.WriteString("# Code generated by stigmer-codegen. DO NOT EDIT.\n\n")

	buf.WriteString("from ._bidi import BidiStream\n")
	buf.WriteString("from ._client import GeneratedClient\n")

	for _, r := range resources {
		exports := []string{r.clientName}
		exports = append(exports, r.inputTypes...)
		fmt.Fprintf(&buf, "from ._%s import %s\n", r.resource, strings.Join(exports, ", "))
	}

	buf.WriteString("from ._types import (\n")
	buf.WriteString("    DeleteResourceInput,\n")
	buf.WriteString("    EnvSpecInput,\n")
	buf.WriteString("    EnvVarInput,\n")
	buf.WriteString("    ListParams,\n")
	buf.WriteString("    ListResult,\n")
	buf.WriteString("    Page,\n")
	buf.WriteString("    ResourceRef,\n")
	buf.WriteString(")\n")

	buf.WriteString("from ._errors import (\n")
	buf.WriteString("    ErrorCode,\n")
	buf.WriteString("    StigmerError,\n")
	buf.WriteString("    is_not_found,\n")
	buf.WriteString("    is_permission_denied,\n")
	buf.WriteString("    is_retryable,\n")
	buf.WriteString("    is_unauthenticated,\n")
	buf.WriteString("    wrap_error,\n")
	buf.WriteString(")\n")

	buf.WriteString("\n__all__ = [\n")
	buf.WriteString("    \"GeneratedClient\",\n")
	for _, r := range resources {
		fmt.Fprintf(&buf, "    %q,\n", r.clientName)
		for _, t := range r.inputTypes {
			fmt.Fprintf(&buf, "    %q,\n", t)
		}
	}
	buf.WriteString("    \"DeleteResourceInput\",\n")
	buf.WriteString("    \"EnvSpecInput\",\n")
	buf.WriteString("    \"EnvVarInput\",\n")
	buf.WriteString("    \"ListParams\",\n")
	buf.WriteString("    \"ListResult\",\n")
	buf.WriteString("    \"Page\",\n")
	buf.WriteString("    \"ResourceRef\",\n")
	buf.WriteString("    \"ErrorCode\",\n")
	buf.WriteString("    \"StigmerError\",\n")
	buf.WriteString("    \"is_not_found\",\n")
	buf.WriteString("    \"is_permission_denied\",\n")
	buf.WriteString("    \"is_retryable\",\n")
	buf.WriteString("    \"is_unauthenticated\",\n")
	buf.WriteString("    \"wrap_error\",\n")
	buf.WriteString("]\n")

	return os.WriteFile(filepath.Join(outputDir, "__init__.py"), buf.Bytes(), 0644)
}
