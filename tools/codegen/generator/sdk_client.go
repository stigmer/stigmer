package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// MethodTypeSchema describes a proto message type used as a method parameter
// or return value, extracted by proto2schema for SDK documentation.
type MethodTypeSchema struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	ProtoType   string         `json:"protoType"`
	ProtoFile   string         `json:"protoFile"`
	Fields      []*FieldSchema `json:"fields"`
}

// EnumSchema describes a proto enum type referenced by resource fields.
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

// CommonsSchemaFile holds shared types and enums from the commons package.
type CommonsSchemaFile struct {
	MessageTypes []MethodTypeSchema `json:"messageTypes"`
	EnumTypes    []EnumSchema       `json:"enumTypes"`
}

type ServiceSchemaFile struct {
	Resource            string              `json:"resource"`
	Package             string              `json:"package"`
	GoImportPath        string              `json:"goImportPath"`
	Services            []ServiceDefinition `json:"services"`
	ListVia             string              `json:"listVia,omitempty"`
	MethodTypes         []MethodTypeSchema  `json:"methodTypes,omitempty"`
	EnumTypes           []EnumSchema        `json:"enumTypes,omitempty"`
	ResourceDescription string              `json:"resourceDescription,omitempty"`
	StatusType          *MethodTypeSchema   `json:"statusType,omitempty"`
	StatusNestedTypes   []MethodTypeSchema  `json:"statusNestedTypes,omitempty"`
}

type ServiceDefinition struct {
	Name      string         `json:"name"`
	Role      string         `json:"role"`
	ProtoFile string         `json:"protoFile,omitempty"`
	Methods   []MethodSchema `json:"methods"`
}

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

type sdkResourceConfig struct {
	clientName   string
	protoResType string
	inputPrefix  string
	idType       string
	specSchema   string
	apiVersion   string
	idPrefix     string
	resourceKind string
	isVersioned  bool
}

// metaFieldNames are fields that always come from ApiResourceMetadata.
// Spec fields with these names are skipped to avoid struct field conflicts.
var metaFieldNames = map[string]bool{
	"Name": true, "Org": true, "Tags": true, "Visibility": true, "Labels": true,
}

// resourceGenInfo tracks generated type names per resource for client.go/types.go generation.
type resourceGenInfo struct {
	resource    string
	clientName  string
	inputTypes  []string // all exported input/nested types (e.g., "AgentInput", "McpServerUsageInput")
	streamTypes []string // all exported stream types (e.g., "SubscribeStream")
	fromProto   *fromProtoFuncInfo
}

// fromProtoFuncInfo tracks the generated FromProto function for SDK root re-export.
type fromProtoFuncInfo struct {
	funcName   string // e.g., "AgentInputFromProto"
	protoAlias string // e.g., "agentv1"
	protoPath  string // e.g., "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agent/v1"
	protoType  string // e.g., "Agent"
	inputType  string // e.g., "AgentInput"
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

	var allResources []resourceGenInfo
	globalEmitted := make(map[string]bool)

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

		code, genInfo, err := generateResourceClient(&schema, cfg, specSchema, specTypes, globalEmitted)
		if err != nil {
			return fmt.Errorf("failed to generate client for %s: %w", resource, err)
		}

		outputPath := filepath.Join(outputDir, resource+".go")
		if err := os.WriteFile(outputPath, code, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", outputPath, err)
		}
		fmt.Printf("   -> %s.go\n", resource)

		allResources = append(allResources, genInfo)
	}

	sort.Slice(allResources, func(i, j int) bool {
		return allResources[i].resource < allResources[j].resource
	})

	if err := generateGenClientFile(outputDir, allResources); err != nil {
		return fmt.Errorf("failed to generate client.go: %w", err)
	}
	fmt.Printf("   -> client.go\n")

	sdkRootDir := filepath.Dir(filepath.Dir(outputDir))
	if err := generateSDKTypesFile(sdkRootDir, allResources); err != nil {
		return fmt.Errorf("failed to generate types.go: %w", err)
	}
	fmt.Printf("   -> ../../types.go (sdk root)\n")

	if err := generateSDKFromProtoFile(sdkRootDir, allResources); err != nil {
		return fmt.Errorf("failed to generate from_proto.go: %w", err)
	}
	fmt.Printf("   -> ../../from_proto.go (sdk root)\n")

	return nil
}

// deriveResourceConfig auto-derives all config from the service schema JSON.
func deriveResourceConfig(schema *ServiceSchemaFile, schemaDir string) sdkResourceConfig {
	cfg := sdkResourceConfig{}

	// Derive protoResType from the command service methods. Prefer the
	// update or delete method's output type (which always returns the
	// resource directly) over create (which may return a wrapper like
	// PlatformClientCreateResponse).
	for _, svc := range schema.Services {
		if svc.Role == "command" && len(svc.Methods) > 0 {
			cfg.protoResType = svc.Methods[0].OutputType
			for _, m := range svc.Methods {
				if strings.EqualFold(m.Name, "Update") || strings.EqualFold(m.Name, "Delete") {
					cfg.protoResType = m.OutputType
					break
				}
			}
			break
		}
	}
	if cfg.protoResType == "" {
		for _, svc := range schema.Services {
			if svc.Role == "query" && len(svc.Methods) > 0 {
				cfg.protoResType = svc.Methods[0].OutputType
				break
			}
		}
	}

	cfg.clientName = cfg.protoResType + "Client"
	cfg.inputPrefix = cfg.protoResType

	// Derive idType from the Get method's input type
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if m.Name == "Get" && isIDType(m.InputType) {
				cfg.idType = m.InputType
				break
			}
		}
	}

	// Derive spec schema path by convention: <namespace>/<resource>/<resource>.json
	parts := strings.Split(schema.Package, ".")
	if len(parts) >= 5 {
		namespace := parts[2]
		resource := parts[3]
		candidate := filepath.Join(namespace, resource, resource+".json")
		if _, err := os.Stat(filepath.Join(schemaDir, candidate)); err == nil {
			cfg.specSchema = candidate
		}
	}

	cfg.apiVersion = deriveApiVersion(schema.Package)
	cfg.resourceKind = resolveResourceKind(schema)
	cfg.isVersioned = isVersionedKind(cfg.resourceKind)

	return cfg
}

// isVersionedKind returns true if the given kind name corresponds to a
// versioned resource (is_versioned: true in ApiResourceKindMeta).
func isVersionedKind(kindName string) bool {
	for num, name := range apiResourceKindEnumNames {
		if name == kindName {
			return versionedKinds[num]
		}
	}
	return false
}

// resolveResourceKind finds the ApiResourceKind enum value name that matches
// the schema's resource identifier. It matches by stripping underscores from
// the enum value and comparing against schema.Resource (e.g., enum "oauth_app"
// → "oauthapp" matches resource "oauthapp"). Falls back to pascalToSnake for
// schemas that don't embed the ApiResourceKind enum.
func resolveResourceKind(schema *ServiceSchemaFile) string {
	for _, e := range schema.EnumTypes {
		if e.Name == "ApiResourceKind" {
			for _, v := range e.Values {
				if strings.ReplaceAll(v.Name, "_", "") == schema.Resource {
					return v.Name
				}
			}
		}
	}
	return pascalToSnake(schema.Resource)
}

// deriveApiVersion derives the API version string from the proto package.
// e.g., "ai.stigmer.agentic.agent.v1" -> "agentic.stigmer.ai/v1"
func deriveApiVersion(pkg string) string {
	parts := strings.Split(pkg, ".")
	if len(parts) >= 5 {
		return parts[2] + ".stigmer.ai/v1"
	}
	return "stigmer.ai/v1"
}

// deriveGoImportPath derives the full Go import path from a proto package name.
func deriveGoImportPath(pkg string) string {
	return "github.com/stigmer/stigmer/sdk/go/v3/proto/" + strings.ReplaceAll(pkg, ".", "/")
}

// pascalToSnake converts PascalCase to snake_case for ApiResourceKind enum values.
func pascalToSnake(s string) string {
	var result []rune
	for i, r := range s {
		if i > 0 && unicode.IsUpper(r) {
			result = append(result, '_')
		}
		result = append(result, unicode.ToLower(r))
	}
	return string(result)
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

func generateResourceClient(schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema, globalEmitted map[string]bool) ([]byte, resourceGenInfo, error) {
	importPath := deriveGoImportPath(schema.Package)
	alias := schema.GoImportPath

	genInfo := resourceGenInfo{
		resource:   schema.Resource,
		clientName: cfg.clientName,
	}

	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package gen\n\n")

	needsIO := false
	needsEmptypb := false
	needsApiResource := false
	needsApiResourceRef := false
	needsSearch := schema.ListVia == "SearchService"
	hasInputType := specSchema != nil
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if searchListSupersedesMethod(schema, &m) {
				continue
			}
			if m.ServerStreaming {
				needsIO = true
			}
			if strings.Contains(m.InputFullType, "commons.apiresource") {
				needsApiResource = true
			}
			if m.InputType == "ApiResourceReference" {
				needsApiResourceRef = true
			}
			if isEmptyType(m.InputFullType) {
				needsEmptypb = true
			}
		}
	}

	typeMap := make(map[string]*TypeSchema)
	for _, t := range specTypes {
		typeMap[t.Name] = t
	}

	needsExecutionContext := false
	needsEnvironmentV1 := false
	needsTimestamppb := false
	needsStructpb := false
	needsRefKindOverride := false
	// Cross-package proto imports (alias → Go import path) for nested spec
	// types living in another proto package (e.g. a datastore subject
	// referencing iampolicy's ApiResourceRef). environmentv1 and
	// executioncontextv1 keep their dedicated flags above.
	crossPkgImports := make(map[string]string)
	if specSchema != nil {
		scanFieldsForImports := func(fields []*FieldSchema) {
			for _, f := range fields {
				if f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue" {
					needsExecutionContext = true
				}
				if f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message" {
					elemMsg := f.Type.ValueType.MessageType
					if elemMsg == "EnvironmentValue" {
						needsEnvironmentV1 = true
					} else if ts, ok := typeMap[elemMsg]; ok && ts.ProtoType != "" {
						if protoTypeToPackageAlias(ts.ProtoType) == "environmentv1" {
							needsEnvironmentV1 = true
						}
					}
				}
				if f.Type.Kind == "message" && f.Type.MessageType != "" && !isSpecialType(f.Type.MessageType) {
					if ts, ok := typeMap[f.Type.MessageType]; ok && ts.ProtoType != "" {
						if a := protoTypeToPackageAlias(ts.ProtoType); a != "" && a != alias &&
							a != "environmentv1" && a != "executioncontextv1" {
							if idx := strings.LastIndex(ts.ProtoType, "."); idx > 0 {
								protoPkg := ts.ProtoType[:idx]
								crossPkgImports[a] = "github.com/stigmer/stigmer/sdk/go/v3/proto/" + strings.ReplaceAll(protoPkg, ".", "/")
							}
						}
					}
				}
				if f.Type.Kind == "timestamp" {
					needsTimestamppb = true
				}
				if f.Type.Kind == "struct" || f.Type.Kind == "value" ||
					(f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "struct") {
					needsStructpb = true
				}
				if f.ReferenceKind != 0 {
					needsRefKindOverride = true
				}
			}
		}
		scanFieldsForImports(specSchema.Fields)
		for _, t := range specTypes {
			if !isSpecialType(t.Name) {
				scanFieldsForImports(t.Fields)
			}
		}
	}

	enumImports := make(map[string]string)
	if specSchema != nil {
		enumImports = collectSDKEnumImports(specSchema, specTypes, typeMap)
	}

	subPkgImports := collectSubPackageImports(schema)

	// The body is rendered BEFORE the import block so cross-package imports
	// can be emitted only when the body actually names them. Cross-package
	// helper types (a nested message from another proto package, e.g.
	// agentexecution's RunConfig) are emitted once per Go package via
	// globalEmitted, so a second resource embedding the same message
	// references only the already-emitted helpers and never names the
	// foreign alias itself — a structurally-derived import there is unused
	// and fails the build.
	var bodyBuf bytes.Buffer
	fmt.Fprintf(&bodyBuf, "// %s provides operations on %s resources.\n", cfg.clientName, schema.Resource)
	fmt.Fprintf(&bodyBuf, "type %s struct {\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&bodyBuf, "\t%s %s.%sClient\n", svc.Role, alias, svc.Name)
	}
	if needsSearch {
		bodyBuf.WriteString("\tsearch searchv1.SearchServiceClient\n")
	}
	bodyBuf.WriteString("}\n\n")

	fmt.Fprintf(&bodyBuf, "func New%s(conn grpc.ClientConnInterface) *%s {\n", cfg.clientName, cfg.clientName)
	fmt.Fprintf(&bodyBuf, "\treturn &%s{\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&bodyBuf, "\t\t%s: %s.New%sClient(conn),\n", svc.Role, alias, svc.Name)
	}
	if needsSearch {
		bodyBuf.WriteString("\t\tsearch: searchv1.NewSearchServiceClient(conn),\n")
	}
	bodyBuf.WriteString("\t}\n}\n\n")

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if searchListSupersedesMethod(schema, &m) {
				continue
			}
			generateMethod(&bodyBuf, &m, &svc, schema, cfg, alias, hasInputType)
			if m.ServerStreaming {
				genInfo.streamTypes = append(genInfo.streamTypes, cfg.protoResType+m.Name+"Stream")
			}
		}
	}

	if needsSearch {
		generateSearchList(&bodyBuf, schema, cfg)
	}

	if specSchema != nil {
		inputTypes := generateInputTypesV2(&bodyBuf, schema, cfg, specSchema, typeMap, alias, needsExecutionContext, globalEmitted)
		genInfo.inputTypes = inputTypes

		generateFromProto(&bodyBuf, schema, cfg, specSchema, specTypes, typeMap, alias, globalEmitted)
		genInfo.fromProto = &fromProtoFuncInfo{
			funcName:   cfg.inputPrefix + "InputFromProto",
			protoAlias: alias,
			protoPath:  importPath,
			protoType:  cfg.protoResType,
			inputType:  cfg.inputPrefix + "Input",
		}
	}
	bodyAliases, bodyParsed := usedPackageAliases(bodyBuf.Bytes())

	buf.WriteString("import (\n")
	buf.WriteString("\t\"context\"\n")
	if needsIO {
		buf.WriteString("\t\"io\"\n")
	}
	if needsTimestamppb {
		buf.WriteString("\t\"time\"\n")
	}
	buf.WriteString("\n")
	fmt.Fprintf(&buf, "\t%s %q\n", alias, importPath)
	if len(subPkgImports) > 0 {
		var subAliases []string
		for a := range subPkgImports {
			subAliases = append(subAliases, a)
		}
		sort.Strings(subAliases)
		for _, a := range subAliases {
			fmt.Fprintf(&buf, "\t%s %q\n", a, subPkgImports[a])
		}
	}
	if len(enumImports) > 0 {
		var enumAliases []string
		for a := range enumImports {
			// Usage-driven for the same reason as crossPkgImports below: a
			// shared nested type carrying a foreign enum (RunConfig's
			// ServiceTier) is emitted once per Go package, so only the
			// resource that won the dedup names the enum's package.
			if a != alias && (!bodyParsed || bodyAliases[a]) {
				enumAliases = append(enumAliases, a)
			}
		}
		sort.Strings(enumAliases)
		for _, a := range enumAliases {
			fmt.Fprintf(&buf, "\t%s %q\n", a, enumImports[a])
		}
	}
	if needsApiResource || hasInputType {
		buf.WriteString("\tapiresource \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource\"\n")
	}
	if needsSearch || needsApiResourceRef || needsRefKindOverride {
		buf.WriteString("\tapiresourcekind \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind\"\n")
	}
	if needsSearch {
		buf.WriteString("\trpc \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/rpc\"\n")
		buf.WriteString("\tsearchv1 \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/search/v1\"\n")
	}
	if needsExecutionContext {
		buf.WriteString("\texecutioncontextv1 \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/executioncontext/v1\"\n")
	}
	if needsEnvironmentV1 {
		buf.WriteString("\tenvironmentv1 \"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/environment/v1\"\n")
	}
	if len(crossPkgImports) > 0 {
		aliases := make([]string, 0, len(crossPkgImports))
		for a := range crossPkgImports {
			// Usage-driven, unlike every flag above: crossPkgImports is
			// derived structurally from the spec, but whether this file
			// NAMES the foreign package depends on which resource won the
			// globalEmitted dedup for the shared helper.
			if !bodyParsed || bodyAliases[a] {
				aliases = append(aliases, a)
			}
		}
		sort.Strings(aliases)
		for _, a := range aliases {
			fmt.Fprintf(&buf, "\t%s %q\n", a, crossPkgImports[a])
		}
	}
	if needsEmptypb {
		buf.WriteString("\t\"google.golang.org/protobuf/types/known/emptypb\"\n")
	}
	if needsStructpb {
		buf.WriteString("\t\"google.golang.org/protobuf/types/known/structpb\"\n")
	}
	if needsTimestamppb {
		buf.WriteString("\t\"google.golang.org/protobuf/types/known/timestamppb\"\n")
	}
	buf.WriteString("\t\"google.golang.org/grpc\"\n")
	buf.WriteString(")\n\n")

	buf.Write(bodyBuf.Bytes())

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return buf.Bytes(), genInfo, fmt.Errorf("gofmt failed: %w\ngenerated:\n%s", err, buf.String())
	}
	return formatted, genInfo, nil
}

// usedPackageAliases reports which package qualifiers a rendered body
// actually names — the `pkg` of every `pkg.Symbol` selector. The second
// return is false when the body could not be parsed.
//
// Parsing rather than string-matching so a doc comment mentioning a foreign
// type cannot pin an import the code never uses. On a parse failure callers
// fall back to emitting every structurally-derived import: that is the
// pre-existing behavior, and the format.Source call downstream reports the
// real syntax error instead of this helper masking it as a missing import.
func usedPackageAliases(body []byte) (map[string]bool, bool) {
	// The body is a fragment; a synthetic package clause makes it a file.
	src := append([]byte("package gen\n"), body...)
	file, err := parser.ParseFile(token.NewFileSet(), "body.go", src, parser.SkipObjectResolution)
	if err != nil {
		return nil, false
	}
	used := make(map[string]bool)
	ast.Inspect(file, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			if ident, ok := sel.X.(*ast.Ident); ok {
				used[ident.Name] = true
			}
		}
		return true
	})
	return used, true
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

	emptyInput := isEmptyType(m.InputFullType)
	emptyOutput := isEmptyType(m.OutputFullType)
	isIDInput := isIDType(m.InputType)
	isDeleteInput := m.InputType == "ApiResourceDeleteInput"
	isResourceInput := m.InputType == cfg.protoResType
	isApiResRefInput := m.InputType == "ApiResourceReference"

	switch {
	case emptyInput && emptyOutput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context) error {\n",
			receiver, cfg.clientName, m.Name)
		fmt.Fprintf(buf, "\t_, err := %s.%s.%s(ctx, &emptypb.Empty{})\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn wrapErr(err)\n}\n\n")

	case emptyInput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, &emptypb.Empty{})\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

	case emptyOutput && isIDInput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, id string) error {\n",
			receiver, cfg.clientName, m.Name)
		fmt.Fprintf(buf, "\t_, err := %s.%s.%s(ctx, &%s.%s{Value: id})\n",
			receiver, svc.Role, m.Name, inputPkg, m.InputType)
		buf.WriteString("\treturn wrapErr(err)\n}\n\n")

	case emptyOutput:
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s.%s) error {\n",
			receiver, cfg.clientName, m.Name, inputPkg, inputType)
		fmt.Fprintf(buf, "\t_, err := %s.%s.%s(ctx, input)\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn wrapErr(err)\n}\n\n")

	case isResourceInput && hasInputType:
		inputTypeName := cfg.inputPrefix + "Input"
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, input *%s) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, inputTypeName, outputPkg, outputType)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, input.toProto())\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

	case isResourceInput && !hasInputType:
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

	case isApiResRefInput:
		kindConst := "apiresourcekind.ApiResourceKind_" + cfg.resourceKind
		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, ref ResourceRef) (*%s.%s, error) {\n",
			receiver, cfg.clientName, m.Name, outputPkg, outputType)
		fmt.Fprintf(buf, "\tref.Kind = %s\n", kindConst)
		fmt.Fprintf(buf, "\tresp, err := %s.%s.%s(ctx, ref.toProto())\n",
			receiver, svc.Role, m.Name)
		buf.WriteString("\treturn resp, wrapErr(err)\n}\n\n")

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
	streamTypeName := cfg.protoResType + m.Name + "Stream"

	if m.ClientStreaming {
		// Bidi streaming: Send + Recv + CloseSend, open with CallOptions only.
		fmt.Fprintf(buf, "// %s wraps the bidi stream for %s, providing\n", streamTypeName, m.Name)
		fmt.Fprintf(buf, "// Send, Recv, and CloseSend for the %s command channel.\n", strings.ToLower(cfg.protoResType))
		fmt.Fprintf(buf, "type %s struct {\n", streamTypeName)
		fmt.Fprintf(buf, "\tstream %s.%s_%sClient\n", inputPkg, svc.Name, m.Name)
		buf.WriteString("}\n\n")

		fmt.Fprintf(buf, "func (s *%s) Send(msg *%s.%s) error {\n", streamTypeName, inputPkg, inputType)
		buf.WriteString("\treturn wrapErr(s.stream.Send(msg))\n}\n\n")

		fmt.Fprintf(buf, "func (s *%s) Recv() (*%s.%s, error) {\n", streamTypeName, outputPkg, outputType)
		buf.WriteString("\tmsg, err := s.stream.Recv()\n")
		buf.WriteString("\tif err != nil {\n\t\tif err == io.EOF {\n\t\t\treturn nil, io.EOF\n\t\t}\n\t\treturn nil, wrapErr(err)\n\t}\n\treturn msg, nil\n}\n\n")

		fmt.Fprintf(buf, "func (s *%s) CloseSend() error {\n", streamTypeName)
		buf.WriteString("\treturn wrapErr(s.stream.CloseSend())\n}\n\n")

		fmt.Fprintf(buf, "func (%s *%s) %s(ctx context.Context, opts ...grpc.CallOption) (*%s, error) {\n",
			receiver, cfg.clientName, m.Name, streamTypeName)
		fmt.Fprintf(buf, "\tstream, err := %s.%s.%s(ctx, opts...)\n",
			receiver, svc.Role, m.Name)
	} else {
		// Server-streaming: Recv only, open with input message.
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
	}
	buf.WriteString("\tif err != nil {\n\t\treturn nil, wrapErr(err)\n\t}\n")
	fmt.Fprintf(buf, "\treturn &%s{stream: stream}, nil\n}\n\n", streamTypeName)
}

func generateSearchList(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig) {
	receiver := strings.ToLower(cfg.clientName[:1])
	kindConst := "apiresourcekind.ApiResourceKind_" + cfg.resourceKind

	fmt.Fprintf(buf, "func (%s *%s) List(ctx context.Context, params *ListParams) (*ListResult, error) {\n", receiver, cfg.clientName)
	buf.WriteString("\treq := &searchv1.SearchRequest{\n")
	fmt.Fprintf(buf, "\t\tKinds: []apiresourcekind.ApiResourceKind{%s},\n", kindConst)
	buf.WriteString("\t\tQuery: params.Query,\n")
	buf.WriteString("\t\tOrg:            params.Org,\n")
	buf.WriteString("\t\tExcludePublic:  params.ExcludePublic,\n")
	buf.WriteString("\t\tCrossOrgPublic: params.CrossOrgPublic,\n")
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

// =========================================================================
// Input type generation from spec schemas
// =========================================================================

func generateInputTypesV2(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, alias string, needsExecCtx bool, globalEmitted map[string]bool) []string {
	inputName := cfg.inputPrefix + "Input"
	emitted := make(map[string]bool)
	var allTypes []string

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	fmt.Fprintf(buf, "// %s holds the fields for creating/updating a %s.\n", inputName, cfg.protoResType)
	fmt.Fprintf(buf, "type %s struct {\n", inputName)
	buf.WriteString("\tName       string\n")
	buf.WriteString("\tSlug       string\n")
	buf.WriteString("\tOrg        string\n")
	buf.WriteString("\tLabels     map[string]string\n")
	buf.WriteString("\tVisibility apiresource.ApiResourceVisibility\n")
	if cfg.isVersioned {
		buf.WriteString("\tVersionMessage string\n")
	}
	for _, f := range specFields {
		goType := goTypeForField(f, typeMap, alias)
		fmt.Fprintf(buf, "\t%s %s\n", f.Name, goType)
	}
	buf.WriteString("}\n\n")
	allTypes = append(allTypes, inputName)

	for _, f := range specFields {
		emitNestedTypes(buf, f, typeMap, emitted, &allTypes, alias, globalEmitted)
	}

	fmt.Fprintf(buf, "func (i *%s) toProto() *%s.%s {\n", inputName, alias, cfg.protoResType)
	fmt.Fprintf(buf, "\tresource := &%s.%s{\n", alias, cfg.protoResType)
	fmt.Fprintf(buf, "\t\tApiVersion: %q,\n", cfg.apiVersion)
	fmt.Fprintf(buf, "\t\tKind:       %q,\n", cfg.protoResType)
	buf.WriteString("\t\tMetadata: &apiresource.ApiResourceMetadata{\n")
	buf.WriteString("\t\t\tName:       i.Name,\n")
	buf.WriteString("\t\t\tSlug:       i.Slug,\n")
	buf.WriteString("\t\t\tOrg:        i.Org,\n")
	buf.WriteString("\t\t\tLabels:     i.Labels,\n")
	buf.WriteString("\t\t\tVisibility: i.Visibility,\n")
	buf.WriteString("\t\t},\n")
	fmt.Fprintf(buf, "\t\tSpec: &%s.%s{},\n", alias, spec.Name)
	buf.WriteString("\t}\n")
	if cfg.isVersioned {
		buf.WriteString("\tif i.VersionMessage != \"\" {\n")
		buf.WriteString("\t\tresource.Metadata.Version = &apiresource.ApiResourceMetadataVersion{\n")
		buf.WriteString("\t\t\tMessage: i.VersionMessage,\n")
		buf.WriteString("\t\t}\n")
		buf.WriteString("\t}\n")
	}

	for _, f := range specFields {
		emitToProtoField(buf, f, alias, typeMap, spec.Name)
	}

	buf.WriteString("\treturn resource\n}\n\n")

	for _, f := range specFields {
		emitNestedToProto(buf, f, alias, typeMap, emitted, spec.Name, globalEmitted)
	}

	return allTypes
}

func goTypeForField(f *FieldSchema, typeMap map[string]*TypeSchema, alias string) string {
	return goTypeForTypeSpec(&f.Type, typeMap, alias)
}

func goTypeForTypeSpec(ts *TypeSpec, typeMap map[string]*TypeSchema, alias string) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			return goSDKEnumGoType(ts.EnumType)
		}
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
	case "value":
		// google.protobuf.Value — any JSON-representable scalar or composite.
		return "any"
	case "array":
		if ts.ElementType != nil {
			return "[]" + goTypeForTypeSpec(ts.ElementType, typeMap, alias)
		}
		return "[]string"
	case "map":
		keyType := "string"
		valType := "string"
		if ts.KeyType != nil {
			keyType = goTypeForTypeSpec(ts.KeyType, typeMap, alias)
		}
		if ts.ValueType != nil {
			valType = goTypeForTypeSpec(ts.ValueType, typeMap, alias)
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

func emitNestedTypes(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, allTypes *[]string, alias string, globalEmitted map[string]bool) {
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

	if !globalEmitted[msgName] {
		globalEmitted[msgName] = true

		inputName := msgName + "Input"
		fmt.Fprintf(buf, "// %s is the SDK input type for %s.\n", inputName, msgName)
		fmt.Fprintf(buf, "type %s struct {\n", inputName)
		for _, field := range ts.Fields {
			goType := goTypeForField(field, typeMap, alias)
			fmt.Fprintf(buf, "\t%s %s\n", field.Name, goType)
		}
		buf.WriteString("}\n\n")
		*allTypes = append(*allTypes, inputName)
	}

	for _, field := range ts.Fields {
		emitNestedTypes(buf, field, typeMap, emitted, allTypes, alias, globalEmitted)
	}
}

func emitToProtoField(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema, specName string) {
	protoField := goProtoFieldName(f.ProtoField)

	switch {
	case f.Type.Kind == "timestamp":
		fmt.Fprintf(buf, "\tif i.%s != \"\" {\n", f.Name)
		fmt.Fprintf(buf, "\t\tif t, err := time.Parse(time.RFC3339, i.%s); err == nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\t\tresource.Spec.%s = timestamppb.New(t)\n", protoField)
		buf.WriteString("\t\t}\n\t}\n")

	case f.Type.Kind == "struct":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s, _ = structpb.NewStruct(i.%s)\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "value":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s, _ = structpb.NewValue(i.%s)\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "string" || f.Type.Kind == "bool" || f.Type.Kind == "int32" || f.Type.Kind == "int64" ||
		f.Type.Kind == "uint32" || f.Type.Kind == "float" || f.Type.Kind == "double" || f.Type.Kind == "bytes":
		fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s = i.%s.toProto()\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		fmt.Fprintf(buf, "\tif i.%s.Org != \"\" || i.%s.Slug != \"\" {\n", f.Name, f.Name)
		if f.ReferenceKind != 0 {
			enumName := apiResourceKindEnumNames[f.ReferenceKind]
			fmt.Fprintf(buf, "\t\tref := i.%s.toProto()\n", f.Name)
			fmt.Fprintf(buf, "\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
			fmt.Fprintf(buf, "\t\tresource.Spec.%s = ref\n", protoField)
		} else {
			fmt.Fprintf(buf, "\t\tresource.Spec.%s = i.%s.toProto()\n", protoField, f.Name)
		}
		buf.WriteString("\t}\n")

	case f.Type.Kind == "message" && f.OneofGroup != "":
		emitOneofMemberToProto(buf, f, alias, specName, "resource.Spec", typeMap)

	case f.Type.Kind == "message":
		fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
		fmt.Fprintf(buf, "\t\tresource.Spec.%s = i.%s.toProto()\n", protoField, f.Name)
		buf.WriteString("\t}\n")

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "\tresource.Spec.%s = i.%s\n", protoField, f.Name)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "struct":
		fmt.Fprintf(buf, "\tfor _, item := range i.%s {\n", f.Name)
		fmt.Fprintf(buf, "\t\tif s, err := structpb.NewStruct(item); err == nil {\n")
		fmt.Fprintf(buf, "\t\t\tresource.Spec.%s = append(resource.Spec.%s, s)\n", protoField, protoField)
		buf.WriteString("\t\t}\n\t}\n")

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if elemMsg == "ApiResourceReference" {
			fmt.Fprintf(buf, "\tfor _, r := range i.%s {\n", f.Name)
			if f.ReferenceKind != 0 {
				enumName := apiResourceKindEnumNames[f.ReferenceKind]
				buf.WriteString("\t\tref := r.toProto()\n")
				fmt.Fprintf(buf, "\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = append(resource.Spec.%s, ref)\n", protoField, protoField)
			} else {
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = append(resource.Spec.%s, r.toProto())\n", protoField, protoField)
			}
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
			case "EnvironmentValue":
				fmt.Fprintf(buf, "\tif len(i.%s) > 0 {\n", f.Name)
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = make(map[string]*environmentv1.EnvironmentValue, len(i.%s))\n", protoField, f.Name)
				fmt.Fprintf(buf, "\t\tfor k, v := range i.%s {\n", f.Name)
				fmt.Fprintf(buf, "\t\t\tresource.Spec.%s[k] = &environmentv1.EnvironmentValue{Value: v.Value, IsSecret: v.IsSecret, Description: v.Description}\n", protoField)
				buf.WriteString("\t\t}\n\t}\n")
			default:
				elemAlias := alias
				if ts, ok := typeMap[elemMsg]; ok && ts.ProtoType != "" {
					if derivedAlias := protoTypeToPackageAlias(ts.ProtoType); derivedAlias != "" {
						elemAlias = derivedAlias
					}
				}
				fmt.Fprintf(buf, "\tif len(i.%s) > 0 {\n", f.Name)
				fmt.Fprintf(buf, "\t\tresource.Spec.%s = make(map[string]*%s.%s, len(i.%s))\n", protoField, elemAlias, elemMsg, f.Name)
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

// emitOneofMemberToProto writes the guarded assignment of one message-typed
// oneof member onto its container's oneof field:
//
//	if i.<Member> != nil {
//		m := &<alias>.<MemberType>{}
//		m.<Field> = i.<Member>.<Field>
//		...
//		<dst>.<Group> = &<alias>.<Container>_<Member>{<Member>: m}
//	}
//
// containerMsg is the Go name of the message declaring the oneof — the spec
// for top-level oneofs (e.g. McpServerSpec_Stdio), the nested message for
// oneofs inside nested types (e.g. WorkspaceSource_GitRepo).
//
// Member fields are copied directly (scalars, enums, maps). A member field in
// a synthetic oneof (proto3 optional, group "_<field>") maps to a pointer on
// the proto struct: the zero value is left absent (proto presence semantics)
// and any other value is set via a pointer. An ApiResourceReference member
// converts through ResourceRef.toProto() with the schema's referenceKind
// stamped, mirroring the spec-level and nested-message handling — a direct
// copy would not compile (ResourceRef vs *apiresource.ApiResourceReference;
// Schedule's AgentTarget.agent_ref was the first schema to hit this).
// Repeated-reference and message-typed members convert the same way their
// spec-level twins do (loop + kind stamp; guarded .toProto()) — Schedule's
// AgentTarget.environment_refs and .run_config were the first schema fields
// to hit those (project DD-017). Anything else still fails compilation
// rather than silently misconverting.
func emitOneofMemberToProto(buf *bytes.Buffer, f *FieldSchema, alias, containerMsg, dst string, typeMap map[string]*TypeSchema) {
	protoField := goProtoFieldName(f.ProtoField)
	oneofWrapper := containerMsg + "_" + protoField
	msgType := f.Type.MessageType

	ts, ok := typeMap[msgType]
	if !ok {
		return
	}

	// The member type may live in a different proto package than the
	// container; derive its alias from its own proto type when known.
	memberAlias := alias
	if ts.ProtoType != "" {
		if derived := protoTypeToPackageAlias(ts.ProtoType); derived != "" {
			memberAlias = derived
		}
	}

	// The oneof container field on the proto message is named after the
	// oneof group (e.g. "server_type" -> ServerType, "source" -> Source),
	// not after any individual member field.
	oneofContainer := goProtoFieldName(f.OneofGroup)
	fmt.Fprintf(buf, "\tif i.%s != nil {\n", f.Name)
	fmt.Fprintf(buf, "\t\tm := &%s.%s{}\n", memberAlias, msgType)
	for _, field := range ts.Fields {
		pf := goProtoFieldName(field.ProtoField)
		if strings.HasPrefix(field.OneofGroup, "_") {
			zero := goZeroValueForTypeSpec(&field.Type)
			fmt.Fprintf(buf, "\t\tif i.%s.%s != %s {\n", f.Name, field.Name, zero)
			fmt.Fprintf(buf, "\t\t\tv := i.%s.%s\n", f.Name, field.Name)
			fmt.Fprintf(buf, "\t\t\tm.%s = &v\n", pf)
			buf.WriteString("\t\t}\n")
			continue
		}
		if field.Type.Kind == "message" && field.Type.MessageType == "ApiResourceReference" {
			fmt.Fprintf(buf, "\t\tif i.%s.%s.Org != \"\" || i.%s.%s.Slug != \"\" {\n",
				f.Name, field.Name, f.Name, field.Name)
			if field.ReferenceKind != 0 {
				enumName := apiResourceKindEnumNames[field.ReferenceKind]
				fmt.Fprintf(buf, "\t\t\tref := i.%s.%s.toProto()\n", f.Name, field.Name)
				fmt.Fprintf(buf, "\t\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
				fmt.Fprintf(buf, "\t\t\tm.%s = ref\n", pf)
			} else {
				fmt.Fprintf(buf, "\t\t\tm.%s = i.%s.%s.toProto()\n", pf, f.Name, field.Name)
			}
			buf.WriteString("\t\t}\n")
			continue
		}
		if field.Type.Kind == "message" {
			// A message-typed member converts through its Input type's
			// own toProto (emitNestedToProto descends into oneof members
			// to emit it) — a direct copy would not compile.
			fmt.Fprintf(buf, "\t\tif i.%s.%s != nil {\n", f.Name, field.Name)
			fmt.Fprintf(buf, "\t\t\tm.%s = i.%s.%s.toProto()\n", pf, f.Name, field.Name)
			buf.WriteString("\t\t}\n")
			continue
		}
		if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message" {
			// Mirror the spec-level array-of-message handling: references
			// get the schema's kind stamped so callers only provide
			// org/slug; other message elements convert element-wise.
			if field.Type.ElementType.MessageType == "ApiResourceReference" {
				fmt.Fprintf(buf, "\t\tfor _, r := range i.%s.%s {\n", f.Name, field.Name)
				if field.ReferenceKind != 0 {
					enumName := apiResourceKindEnumNames[field.ReferenceKind]
					buf.WriteString("\t\t\tref := r.toProto()\n")
					fmt.Fprintf(buf, "\t\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
					fmt.Fprintf(buf, "\t\t\tm.%s = append(m.%s, ref)\n", pf, pf)
				} else {
					fmt.Fprintf(buf, "\t\t\tm.%s = append(m.%s, r.toProto())\n", pf, pf)
				}
				buf.WriteString("\t\t}\n")
			} else {
				fmt.Fprintf(buf, "\t\tfor _, item := range i.%s.%s {\n", f.Name, field.Name)
				fmt.Fprintf(buf, "\t\t\tm.%s = append(m.%s, item.toProto())\n", pf, pf)
				buf.WriteString("\t\t}\n")
			}
			continue
		}
		fmt.Fprintf(buf, "\t\tm.%s = i.%s.%s\n", pf, f.Name, field.Name)
	}
	fmt.Fprintf(buf, "\t\t%s.%s = &%s.%s{%s: m}\n", dst, oneofContainer, alias, oneofWrapper, protoField)
	buf.WriteString("\t}\n")
}

// goZeroValueForTypeSpec returns the Go zero-value literal used to test
// presence of a synthetic-oneof (proto3 optional) member field on an SDK
// input struct, whose fields are plain (non-pointer) Go types.
func goZeroValueForTypeSpec(ts *TypeSpec) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			return "0"
		}
		return `""`
	case "bool":
		return "false"
	default:
		return "0"
	}
}

func emitNestedToProto(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema, emitted map[string]bool, specName string, globalEmitted map[string]bool) {
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
		// A oneof member's own conversion is inlined by
		// emitOneofMemberToProto — no method for the member itself. Its
		// message-typed FIELDS still need their toProto converters
		// (Schedule's AgentTarget.run_config was the first schema field
		// to hit this, project DD-017); descend without emitting.
		descendKey := msgName + "_oneofDescend"
		if emitted[descendKey] {
			return
		}
		emitted[descendKey] = true
		if ts, ok := typeMap[msgName]; ok {
			for _, field := range ts.Fields {
				emitNestedToProto(buf, field, alias, typeMap, emitted, specName, globalEmitted)
			}
		}
		return
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

	globalToProtoKey := msgName + "_toProto"
	if globalEmitted[globalToProtoKey] {
		for _, field := range ts.Fields {
			emitNestedToProto(buf, field, alias, typeMap, emitted, specName, globalEmitted)
		}
		return
	}
	globalEmitted[globalToProtoKey] = true

	inputName := msgName + "Input"

	protoAlias := alias
	if ts.ProtoType != "" {
		if derivedAlias := protoTypeToPackageAlias(ts.ProtoType); derivedAlias != "" {
			protoAlias = derivedAlias
		}
	}

	needsImperative := false
	for _, field := range ts.Fields {
		if field.Type.Kind == "struct" || field.Type.Kind == "value" || field.Type.Kind == "timestamp" {
			needsImperative = true
			break
		}
		if field.Type.Kind == "message" {
			needsImperative = true
			break
		}
		if field.Type.Kind == "array" && field.Type.ElementType != nil &&
			(field.Type.ElementType.Kind == "message" || field.Type.ElementType.Kind == "struct") {
			needsImperative = true
			break
		}
	}

	if needsImperative {
		fmt.Fprintf(buf, "func (i *%s) toProto() *%s.%s {\n", inputName, protoAlias, msgName)
		fmt.Fprintf(buf, "\tp := &%s.%s{}\n", protoAlias, msgName)
		for _, field := range ts.Fields {
			pf := goProtoFieldName(field.ProtoField)
			if field.Type.Kind == "struct" {
				fmt.Fprintf(buf, "\tif i.%s != nil {\n", field.Name)
				fmt.Fprintf(buf, "\t\tp.%s, _ = structpb.NewStruct(i.%s)\n", pf, field.Name)
				buf.WriteString("\t}\n")
			} else if field.Type.Kind == "value" {
				fmt.Fprintf(buf, "\tif i.%s != nil {\n", field.Name)
				fmt.Fprintf(buf, "\t\tp.%s, _ = structpb.NewValue(i.%s)\n", pf, field.Name)
				buf.WriteString("\t}\n")
			} else if field.Type.Kind == "timestamp" {
				fmt.Fprintf(buf, "\tif i.%s != \"\" {\n", field.Name)
				fmt.Fprintf(buf, "\t\tif t, err := time.Parse(time.RFC3339, i.%s); err == nil {\n", field.Name)
				fmt.Fprintf(buf, "\t\t\tp.%s = timestamppb.New(t)\n", pf)
				buf.WriteString("\t\t}\n\t}\n")
			} else if field.Type.Kind == "message" {
				if field.OneofGroup != "" {
					// Message-typed oneof member (e.g. WorkspaceSource's
					// git_repo/local_path): emit the guarded wrapper
					// assignment. Skipping it would silently drop the
					// caller's value (stigmer/stigmer#249 review).
					emitOneofMemberToProto(buf, field, protoAlias, msgName, "p", typeMap)
					continue
				}
				if field.Type.MessageType == "ApiResourceReference" {
					fmt.Fprintf(buf, "\tif i.%s.Org != \"\" || i.%s.Slug != \"\" {\n", field.Name, field.Name)
					if field.ReferenceKind != 0 {
						enumName := apiResourceKindEnumNames[field.ReferenceKind]
						fmt.Fprintf(buf, "\t\tref := i.%s.toProto()\n", field.Name)
						fmt.Fprintf(buf, "\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
						fmt.Fprintf(buf, "\t\tp.%s = ref\n", pf)
					} else {
						fmt.Fprintf(buf, "\t\tp.%s = i.%s.toProto()\n", pf, field.Name)
					}
					buf.WriteString("\t}\n")
				} else {
					fmt.Fprintf(buf, "\tif i.%s != nil {\n", field.Name)
					fmt.Fprintf(buf, "\t\tp.%s = i.%s.toProto()\n", pf, field.Name)
					buf.WriteString("\t}\n")
				}
			} else if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message" {
				// Mirror the spec-level array-of-ApiResourceReference handling:
				// a declared reference_kind is stamped onto every element so
				// callers only provide org/slug (the server validates kind).
				if field.Type.ElementType.MessageType == "ApiResourceReference" && field.ReferenceKind != 0 {
					enumName := apiResourceKindEnumNames[field.ReferenceKind]
					fmt.Fprintf(buf, "\tfor _, r := range i.%s {\n", field.Name)
					buf.WriteString("\t\tref := r.toProto()\n")
					fmt.Fprintf(buf, "\t\tref.Kind = apiresourcekind.ApiResourceKind_%s\n", enumName)
					fmt.Fprintf(buf, "\t\tp.%s = append(p.%s, ref)\n", pf, pf)
					buf.WriteString("\t}\n")
				} else {
					fmt.Fprintf(buf, "\tfor _, item := range i.%s {\n", field.Name)
					fmt.Fprintf(buf, "\t\tp.%s = append(p.%s, item.toProto())\n", pf, pf)
					buf.WriteString("\t}\n")
				}
			} else if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "struct" {
				fmt.Fprintf(buf, "\tfor _, item := range i.%s {\n", field.Name)
				fmt.Fprintf(buf, "\t\tif s, err := structpb.NewStruct(item); err == nil {\n")
				fmt.Fprintf(buf, "\t\t\tp.%s = append(p.%s, s)\n", pf, pf)
				buf.WriteString("\t\t}\n\t}\n")
			} else {
				fmt.Fprintf(buf, "\tp.%s = i.%s\n", pf, field.Name)
			}
		}
		buf.WriteString("\treturn p\n}\n\n")
	} else {
		fmt.Fprintf(buf, "func (i *%s) toProto() *%s.%s {\n", inputName, protoAlias, msgName)
		fmt.Fprintf(buf, "\treturn &%s.%s{\n", protoAlias, msgName)
		for _, field := range ts.Fields {
			pf := goProtoFieldName(field.ProtoField)
			if field.OneofGroup != "" {
				continue
			}
			if field.Type.Kind == "message" {
				fmt.Fprintf(buf, "\t\t%s: i.%s.toProto(),\n", pf, field.Name)
			} else if field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message" {
				continue
			} else {
				fmt.Fprintf(buf, "\t\t%s: i.%s,\n", pf, field.Name)
			}
		}
		buf.WriteString("\t}\n}\n\n")
	}

	for _, field := range ts.Fields {
		emitNestedToProto(buf, field, alias, typeMap, emitted, specName, globalEmitted)
	}
}

// =========================================================================
// FromProto generation — reverse of toProto for CLI/infrastructure use
// =========================================================================

func generateFromProto(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema, typeMap map[string]*TypeSchema, alias string, globalEmitted map[string]bool) {
	if specSchema == nil {
		return
	}

	inputName := cfg.inputPrefix + "Input"
	funcName := inputName + "FromProto"

	var specFields []*FieldSchema
	for _, f := range specSchema.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	oneofGroups := make(map[string][]*FieldSchema)
	var regularFields []*FieldSchema
	for _, f := range specFields {
		if f.OneofGroup != "" {
			oneofGroups[f.OneofGroup] = append(oneofGroups[f.OneofGroup], f)
		} else {
			regularFields = append(regularFields, f)
		}
	}

	fmt.Fprintf(buf, "// %s creates a %s from a proto %s resource.\n", funcName, inputName, cfg.protoResType)
	fmt.Fprintf(buf, "func %s(p *%s.%s) *%s {\n", funcName, alias, cfg.protoResType, inputName)
	fmt.Fprintf(buf, "\tif p == nil {\n\t\treturn &%s{}\n\t}\n", inputName)
	fmt.Fprintf(buf, "\tinput := &%s{}\n", inputName)

	buf.WriteString("\tif m := p.GetMetadata(); m != nil {\n")
	buf.WriteString("\t\tinput.Name = m.GetName()\n")
	buf.WriteString("\t\tinput.Slug = m.GetSlug()\n")
	buf.WriteString("\t\tinput.Org = m.GetOrg()\n")
	buf.WriteString("\t\tinput.Labels = m.GetLabels()\n")
	buf.WriteString("\t\tinput.Visibility = m.GetVisibility()\n")
	buf.WriteString("\t}\n")

	buf.WriteString("\tif s := p.GetSpec(); s != nil {\n")
	for _, f := range regularFields {
		emitFromProtoField(buf, f, alias, typeMap)
	}
	for _, fields := range oneofGroups {
		emitFromProtoOneof(buf, fields, alias, typeMap)
	}
	buf.WriteString("\t}\n")

	buf.WriteString("\treturn input\n}\n\n")

	emitted := make(map[string]bool)
	for _, f := range specFields {
		emitNestedFromProtoFunc(buf, f, alias, typeMap, emitted, globalEmitted)
	}
}

func emitFromProtoField(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema) {
	getter := "Get" + goProtoFieldName(f.ProtoField) + "()"

	switch {
	case f.Type.Kind == "timestamp":
		fmt.Fprintf(buf, "\t\tif ts := s.%s; ts != nil {\n", getter)
		fmt.Fprintf(buf, "\t\t\tinput.%s = ts.AsTime().Format(time.RFC3339)\n", f.Name)
		buf.WriteString("\t\t}\n")

	case f.Type.Kind == "struct":
		fmt.Fprintf(buf, "\t\tif sv := s.%s; sv != nil {\n", getter)
		fmt.Fprintf(buf, "\t\t\tinput.%s = sv.AsMap()\n", f.Name)
		buf.WriteString("\t\t}\n")

	case f.Type.Kind == "value":
		fmt.Fprintf(buf, "\t\tif sv := s.%s; sv != nil {\n", getter)
		fmt.Fprintf(buf, "\t\t\tinput.%s = sv.AsInterface()\n", f.Name)
		buf.WriteString("\t\t}\n")

	case f.Type.Kind == "string" || f.Type.Kind == "bool" || f.Type.Kind == "int32" ||
		f.Type.Kind == "int64" || f.Type.Kind == "uint32" || f.Type.Kind == "float" ||
		f.Type.Kind == "double" || f.Type.Kind == "bytes":
		fmt.Fprintf(buf, "\t\tinput.%s = s.%s\n", f.Name, getter)

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		fmt.Fprintf(buf, "\t\tinput.%s = envSpecInputFromProto(s.%s)\n", f.Name, getter)

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		fmt.Fprintf(buf, "\t\tinput.%s = resourceRefFromProto(s.%s)\n", f.Name, getter)

	case f.Type.Kind == "message":
		converterName := lowerFirst(f.Type.MessageType) + "InputFromProto"
		fmt.Fprintf(buf, "\t\tinput.%s = %s(s.%s)\n", f.Name, converterName, getter)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "\t\tinput.%s = s.%s\n", f.Name, getter)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "struct":
		fmt.Fprintf(buf, "\t\tfor _, item := range s.%s {\n", getter)
		fmt.Fprintf(buf, "\t\t\tinput.%s = append(input.%s, item.AsMap())\n", f.Name, f.Name)
		buf.WriteString("\t\t}\n")

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if elemMsg == "ApiResourceReference" {
			fmt.Fprintf(buf, "\t\tfor _, r := range s.%s {\n", getter)
			fmt.Fprintf(buf, "\t\t\tinput.%s = append(input.%s, resourceRefFromProto(r))\n", f.Name, f.Name)
			buf.WriteString("\t\t}\n")
		} else {
			converterName := lowerFirst(elemMsg) + "InputFromProto"
			fmt.Fprintf(buf, "\t\tfor _, item := range s.%s {\n", getter)
			fmt.Fprintf(buf, "\t\t\tinput.%s = append(input.%s, %s(item))\n", f.Name, f.Name, converterName)
			buf.WriteString("\t\t}\n")
		}

	case f.Type.Kind == "map":
		if f.Type.ValueType != nil && f.Type.ValueType.Kind == "message" {
			elemMsg := f.Type.ValueType.MessageType
			switch elemMsg {
			case "ExecutionValue":
				fmt.Fprintf(buf, "\t\tif len(s.%s) > 0 {\n", getter)
				fmt.Fprintf(buf, "\t\t\tinput.%s = make(map[string]EnvVarInput, len(s.%s))\n", f.Name, getter)
				fmt.Fprintf(buf, "\t\t\tfor k, v := range s.%s {\n", getter)
				fmt.Fprintf(buf, "\t\t\t\tinput.%s[k] = EnvVarInput{Value: v.GetValue(), IsSecret: v.GetIsSecret()}\n", f.Name)
				buf.WriteString("\t\t\t}\n\t\t}\n")
			case "EnvironmentValue":
				fmt.Fprintf(buf, "\t\tif len(s.%s) > 0 {\n", getter)
				fmt.Fprintf(buf, "\t\t\tinput.%s = make(map[string]EnvVarInput, len(s.%s))\n", f.Name, getter)
				fmt.Fprintf(buf, "\t\t\tfor k, v := range s.%s {\n", getter)
				fmt.Fprintf(buf, "\t\t\t\tinput.%s[k] = EnvVarInput{Value: v.GetValue(), IsSecret: v.GetIsSecret(), Description: v.GetDescription()}\n", f.Name)
				buf.WriteString("\t\t\t}\n\t\t}\n")
			default:
				converterName := lowerFirst(elemMsg) + "InputFromProto"
				goType := elemMsg + "Input"
				fmt.Fprintf(buf, "\t\tif len(s.%s) > 0 {\n", getter)
				fmt.Fprintf(buf, "\t\t\tinput.%s = make(map[string]*%s, len(s.%s))\n", f.Name, goType, getter)
				fmt.Fprintf(buf, "\t\t\tfor k, v := range s.%s {\n", getter)
				fmt.Fprintf(buf, "\t\t\t\tinput.%s[k] = %s(v)\n", f.Name, converterName)
				buf.WriteString("\t\t\t}\n\t\t}\n")
			}
		} else {
			fmt.Fprintf(buf, "\t\tinput.%s = s.%s\n", f.Name, getter)
		}

	default:
		fmt.Fprintf(buf, "\t\tinput.%s = s.%s\n", f.Name, getter)
	}
}

// emitFromProtoOneof converts each set oneof member through the member
// type's own generated converter (<memberType>InputFromProto, emitted by
// emitNestedFromProtoFunc for every spec field including oneof members).
// This used to inline a struct literal that handled only scalar and
// single-reference members — a drifted second copy of the conversion that
// failed to compile the first time a member carried a repeated reference
// or a nested message (Schedule's AgentTarget.environment_refs /
// .run_config, project DD-017). One converter, two callers.
func emitFromProtoOneof(buf *bytes.Buffer, fields []*FieldSchema, alias string, typeMap map[string]*TypeSchema) {
	for _, f := range fields {
		protoField := goProtoFieldName(f.ProtoField)
		msgType := f.Type.MessageType

		if _, ok := typeMap[msgType]; !ok {
			continue
		}

		fmt.Fprintf(buf, "\t\tif ov := s.Get%s(); ov != nil {\n", protoField)
		fmt.Fprintf(buf, "\t\t\tinput.%s = %sInputFromProto(ov)\n", f.Name, lowerFirst(msgType))
		buf.WriteString("\t\t}\n")
	}
}

func emitNestedFromProtoFunc(buf *bytes.Buffer, f *FieldSchema, alias string, typeMap map[string]*TypeSchema, emitted, globalEmitted map[string]bool) {
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

	fromProtoKey := msgName + "_fromProto"
	if emitted[fromProtoKey] || globalEmitted[fromProtoKey] {
		return
	}
	emitted[fromProtoKey] = true
	globalEmitted[fromProtoKey] = true

	ts, ok := typeMap[msgName]
	if !ok {
		return
	}

	inputName := msgName + "Input"
	funcName := lowerFirst(msgName) + "InputFromProto"

	protoAlias := alias
	if ts.ProtoType != "" {
		if derivedAlias := protoTypeToPackageAlias(ts.ProtoType); derivedAlias != "" {
			protoAlias = derivedAlias
		}
	}

	fmt.Fprintf(buf, "func %s(p *%s.%s) *%s {\n", funcName, protoAlias, msgName, inputName)
	fmt.Fprintf(buf, "\tif p == nil {\n\t\treturn nil\n\t}\n")
	fmt.Fprintf(buf, "\tinput := &%s{}\n", inputName)

	for _, field := range ts.Fields {
		pf := goProtoFieldName(field.ProtoField)
		getter := "Get" + pf + "()"

		switch {
		case field.Type.Kind == "timestamp":
			fmt.Fprintf(buf, "\tif ts := p.%s; ts != nil {\n", getter)
			fmt.Fprintf(buf, "\t\tinput.%s = ts.AsTime().Format(time.RFC3339)\n", field.Name)
			buf.WriteString("\t}\n")

		case field.Type.Kind == "struct":
			fmt.Fprintf(buf, "\tif sv := p.%s; sv != nil {\n", getter)
			fmt.Fprintf(buf, "\t\tinput.%s = sv.AsMap()\n", field.Name)
			buf.WriteString("\t}\n")

		case field.Type.Kind == "value":
			fmt.Fprintf(buf, "\tif sv := p.%s; sv != nil {\n", getter)
			fmt.Fprintf(buf, "\t\tinput.%s = sv.AsInterface()\n", field.Name)
			buf.WriteString("\t}\n")

		case field.Type.Kind == "message" && field.Type.MessageType == "ApiResourceReference":
			fmt.Fprintf(buf, "\tinput.%s = resourceRefFromProto(p.%s)\n", field.Name, getter)

		case field.Type.Kind == "message":
			converter := lowerFirst(field.Type.MessageType) + "InputFromProto"
			fmt.Fprintf(buf, "\tinput.%s = %s(p.%s)\n", field.Name, converter, getter)

		case field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "message":
			elemMsg := field.Type.ElementType.MessageType
			if elemMsg == "ApiResourceReference" {
				fmt.Fprintf(buf, "\tfor _, r := range p.%s {\n", getter)
				fmt.Fprintf(buf, "\t\tinput.%s = append(input.%s, resourceRefFromProto(r))\n", field.Name, field.Name)
				buf.WriteString("\t}\n")
			} else {
				converter := lowerFirst(elemMsg) + "InputFromProto"
				fmt.Fprintf(buf, "\tfor _, item := range p.%s {\n", getter)
				fmt.Fprintf(buf, "\t\tinput.%s = append(input.%s, %s(item))\n", field.Name, field.Name, converter)
				buf.WriteString("\t}\n")
			}

		case field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "struct":
			fmt.Fprintf(buf, "\tfor _, item := range p.%s {\n", getter)
			fmt.Fprintf(buf, "\t\tinput.%s = append(input.%s, item.AsMap())\n", field.Name, field.Name)
			buf.WriteString("\t}\n")

		case field.Type.Kind == "array" && field.Type.ElementType != nil && field.Type.ElementType.Kind == "string":
			fmt.Fprintf(buf, "\tinput.%s = p.%s\n", field.Name, getter)

		case field.Type.Kind == "map":
			fmt.Fprintf(buf, "\tinput.%s = p.%s\n", field.Name, getter)

		default:
			fmt.Fprintf(buf, "\tinput.%s = p.%s\n", field.Name, getter)
		}
	}

	buf.WriteString("\treturn input\n}\n\n")

	for _, field := range ts.Fields {
		emitNestedFromProtoFunc(buf, field, alias, typeMap, emitted, globalEmitted)
	}
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

// =========================================================================
// Generated client.go (internal/gen/client.go)
// =========================================================================

func generateGenClientFile(outputDir string, resources []resourceGenInfo) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package gen\n\n")
	buf.WriteString("import \"google.golang.org/grpc\"\n\n")

	buf.WriteString("// Client aggregates all resource-specific sub-clients.\n")
	buf.WriteString("type Client struct {\n")
	for _, r := range resources {
		fieldName := strings.TrimSuffix(r.clientName, "Client")
		fmt.Fprintf(&buf, "\t%s *%s\n", fieldName, r.clientName)
	}
	buf.WriteString("}\n\n")

	buf.WriteString("// NewClient creates a Client with all resource sub-clients wired to the given connection.\n")
	buf.WriteString("func NewClient(conn grpc.ClientConnInterface) *Client {\n")
	buf.WriteString("\treturn &Client{\n")
	for _, r := range resources {
		fieldName := strings.TrimSuffix(r.clientName, "Client")
		fmt.Fprintf(&buf, "\t\t%s: New%s(conn),\n", fieldName, r.clientName)
	}
	buf.WriteString("\t}\n}\n")

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return fmt.Errorf("gofmt failed for client.go: %w\ngenerated:\n%s", err, buf.String())
	}
	return os.WriteFile(filepath.Join(outputDir, "client.go"), formatted, 0644)
}

// =========================================================================
// Generated types.go (sdk root package)
// =========================================================================

func generateSDKTypesFile(sdkRootDir string, resources []resourceGenInfo) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package stigmer\n\n")
	buf.WriteString("import \"github.com/stigmer/stigmer/sdk/go/v3/internal/gen\"\n\n")

	buf.WriteString("// Resource clients -- one per API resource.\n")
	for _, r := range resources {
		fmt.Fprintf(&buf, "type %s = gen.%s\n", r.clientName, r.clientName)
	}
	buf.WriteString("\n")

	hasInputTypes := false
	for _, r := range resources {
		if len(r.inputTypes) > 0 {
			hasInputTypes = true
			break
		}
	}
	if hasInputTypes {
		buf.WriteString("// Input types for resource mutation (Create, Update, Apply).\n")
		for _, r := range resources {
			for _, t := range r.inputTypes {
				fmt.Fprintf(&buf, "type %s = gen.%s\n", t, t)
			}
		}
		buf.WriteString("\n")
	}

	hasStreamTypes := false
	for _, r := range resources {
		if len(r.streamTypes) > 0 {
			hasStreamTypes = true
			break
		}
	}
	if hasStreamTypes {
		buf.WriteString("// Streaming types.\n")
		for _, r := range resources {
			for _, t := range r.streamTypes {
				fmt.Fprintf(&buf, "type %s = gen.%s\n", t, t)
			}
		}
		buf.WriteString("\n")
	}

	buf.WriteString("// Shared SDK types.\n")
	buf.WriteString("type DeleteResourceInput = gen.DeleteResourceInput\n")
	buf.WriteString("type ResourceRef = gen.ResourceRef\n")
	buf.WriteString("type Page = gen.Page\n")
	buf.WriteString("type ListParams = gen.ListParams\n")
	buf.WriteString("type ListResult = gen.ListResult\n")
	buf.WriteString("type EnvSpecInput = gen.EnvSpecInput\n")
	buf.WriteString("type EnvVarInput = gen.EnvVarInput\n")

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return fmt.Errorf("gofmt failed for types.go: %w\ngenerated:\n%s", err, buf.String())
	}
	return os.WriteFile(filepath.Join(sdkRootDir, "types.go"), formatted, 0644)
}

// =========================================================================
// Generated from_proto.go (sdk root package)
// =========================================================================

func generateSDKFromProtoFile(sdkRootDir string, resources []resourceGenInfo) error {
	var hasFromProto bool
	for _, r := range resources {
		if r.fromProto != nil {
			hasFromProto = true
			break
		}
	}
	if !hasFromProto {
		return nil
	}

	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	buf.WriteString("package stigmer\n\n")

	buf.WriteString("import (\n")
	buf.WriteString("\t\"github.com/stigmer/stigmer/sdk/go/v3/internal/gen\"\n")
	for _, r := range resources {
		if r.fromProto != nil {
			fmt.Fprintf(&buf, "\t%s %q\n", r.fromProto.protoAlias, r.fromProto.protoPath)
		}
	}
	buf.WriteString(")\n\n")

	for _, r := range resources {
		if r.fromProto == nil {
			continue
		}
		fp := r.fromProto
		fmt.Fprintf(&buf, "// %s creates a %s from a proto %s resource.\n", fp.funcName, fp.inputType, fp.protoType)
		fmt.Fprintf(&buf, "func %s(p *%s.%s) *%s {\n", fp.funcName, fp.protoAlias, fp.protoType, fp.inputType)
		fmt.Fprintf(&buf, "\treturn gen.%s(p)\n", fp.funcName)
		buf.WriteString("}\n\n")
	}

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return fmt.Errorf("gofmt failed for from_proto.go: %w\ngenerated:\n%s", err, buf.String())
	}
	return os.WriteFile(filepath.Join(sdkRootDir, "from_proto.go"), formatted, 0644)
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
	environmentv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/environment/v1"
	searchv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/search/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource"
	apiresourcekind "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind"
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
	Org            string
	Query          string
	ExcludePublic  bool
	CrossOrgPublic bool
	Page           *Page
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

// ResourceRefFromProto creates a ResourceRef from a proto ApiResourceReference.
func ResourceRefFromProto(r *apiresource.ApiResourceReference) ResourceRef {
	if r == nil {
		return ResourceRef{}
	}
	return ResourceRef{
		Org:     r.GetOrg(),
		Slug:    r.GetSlug(),
		Version: r.GetVersion(),
		Kind:    r.GetKind(),
	}
}

func resourceRefFromProto(r *apiresource.ApiResourceReference) ResourceRef {
	return ResourceRefFromProto(r)
}

// EnvSpecInputFromProto creates an EnvSpecInput from a proto EnvironmentSpec.
func EnvSpecInputFromProto(s *environmentv1.EnvironmentSpec) *EnvSpecInput {
	if s == nil {
		return nil
	}
	input := &EnvSpecInput{
		Variables: make(map[string]EnvVarInput, len(s.GetData())),
	}
	for k, v := range s.GetData() {
		input.Variables[k] = EnvVarInput{
			Value:       v.GetValue(),
			IsSecret:    v.GetIsSecret(),
			Description: v.GetDescription(),
		}
	}
	return input
}

func envSpecInputFromProto(s *environmentv1.EnvironmentSpec) *EnvSpecInput {
	return EnvSpecInputFromProto(s)
}
`)

	formatted, err := format.Source(buf.Bytes())
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outputDir, "types.go"), formatted, 0644)
}

// =========================================================================
// SDK enum imports (cross-package enums, e.g. ai.stigmer.iam.v1.IamRole)
// =========================================================================

const sdkProtoImportPrefix = "github.com/stigmer/stigmer/sdk/go/v3/proto"

func goSDKEnumGoType(enumProtoType string) string {
	parts := strings.Split(enumProtoType, ".")
	if len(parts) == 0 {
		return "string"
	}
	enumName := parts[len(parts)-1]
	pkg := protoTypeToPackageAlias(enumProtoType)
	if pkg == "" {
		return "string"
	}
	return pkg + "." + enumName
}

func walkTypeSpecEnumImports(ts *TypeSpec, out map[string]string) {
	if ts == nil {
		return
	}
	if ts.Kind == "string" && ts.EnumType != "" {
		path := protoTypeToGoImportPath(ts.EnumType, sdkProtoImportPrefix)
		pkgAlias := protoTypeToPackageAlias(ts.EnumType)
		if path != "" && pkgAlias != "" {
			out[pkgAlias] = path
		}
	}
	if ts.ElementType != nil {
		walkTypeSpecEnumImports(ts.ElementType, out)
	}
	if ts.KeyType != nil {
		walkTypeSpecEnumImports(ts.KeyType, out)
	}
	if ts.ValueType != nil {
		walkTypeSpecEnumImports(ts.ValueType, out)
	}
}

func collectSDKEnumImports(specSchema *TaskConfigSchema, specTypes []*TypeSchema, typeMap map[string]*TypeSchema) map[string]string {
	out := make(map[string]string)
	if specSchema == nil {
		return out
	}
	walkFields := func(fields []*FieldSchema) {
		for _, f := range fields {
			walkTypeSpecEnumImports(&f.Type, out)
		}
	}
	walkFields(specSchema.Fields)
	for _, t := range specTypes {
		if !isSpecialType(t.Name) {
			walkFields(t.Fields)
		}
	}
	return out
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
	if isEmptyType(fullType) {
		return "emptypb", "Empty"
	}
	if strings.HasPrefix(fullType, schemaPkg+".") {
		suffix := fullType[len(schemaPkg)+1:]
		if dotIdx := strings.LastIndex(suffix, "."); dotIdx > 0 {
			subPkgAlias := protoTypeToPackageAlias(fullType)
			return subPkgAlias, shortType
		}
		return alias, shortType
	}
	if strings.Contains(fullType, "commons.apiresource") {
		return "apiresource", shortType
	}
	return alias, shortType
}

func isEmptyType(fullType string) bool {
	return fullType == "google.protobuf.Empty"
}

// searchListSupersedesMethod reports whether a query-controller method is
// superseded by the SearchService-backed list. Search-list kinds (ListVia ==
// "SearchService") expose a single `list(ListParams)` on the SDK client, so a
// typed `List` RPC on the kind's own query controller is not emitted — the
// two would collide on the method name. The typed RPC stays available on the
// wire and in the raw proto stubs for callers that need it.
func searchListSupersedesMethod(schema *ServiceSchemaFile, m *MethodSchema) bool {
	return schema.ListVia == "SearchService" && strings.EqualFold(m.Name, "List")
}

// collectSubPackageImports scans method input/output types for types in
// sub-packages of the schema package (e.g. workflow.v1.serverless) and
// returns a map of alias -> Go import path for those sub-packages.
func collectSubPackageImports(schema *ServiceSchemaFile) map[string]string {
	imports := make(map[string]string)
	pkg := schema.Package
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			for _, ft := range []string{m.InputFullType, m.OutputFullType} {
				if !strings.HasPrefix(ft, pkg+".") {
					continue
				}
				suffix := ft[len(pkg)+1:]
				if dotIdx := strings.LastIndex(suffix, "."); dotIdx > 0 {
					subAlias := protoTypeToPackageAlias(ft)
					subPath := protoTypeToGoImportPath(ft, sdkProtoImportPrefix)
					if subAlias != "" && subPath != "" {
						imports[subAlias] = subPath
					}
				}
			}
		}
	}
	return imports
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
