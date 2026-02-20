package main

import (
	"bytes"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// apiResourceKindEnumNames maps ApiResourceKind proto enum values to Go constant
// suffix names. This list must stay in sync with api_resource_kind.proto.
var apiResourceKindEnumNames = map[int32]string{
	40: "agent",
	43: "skill",
	44: "mcp_server",
	50: "workflow",
	53: "environment",
}

// versionedKinds tracks which resource kinds support versioning.
var versionedKinds = map[int32]bool{
	43: true, // skill
}

// mcpInputType describes one Go struct to generate.
type mcpInputType struct {
	name        string
	description string
	isTopLevel  bool
	isReference bool
	refKindVal  int32
	protoType   string // fully-qualified proto type
	fields      []*mcpInputField
}

// mcpInputField describes one field inside an mcpInputType.
type mcpInputField struct {
	goName        string
	protoField    string
	goType        string
	jsonTag       string
	schemaTag     string
	description   string // for doc comment
	inputTypeName string // non-empty when this field references a nested input type with toProto()
	oneofGroup    string // non-empty when this field belongs to a proto oneof group
}

// mcpGen holds all state for a single MCP code generation run.
type mcpGen struct {
	spec        *TaskConfigSchema
	types       map[string]*TypeSchema
	inputTypes  []*mcpInputType
	seenTypes   map[string]bool
	packageName string
	outputDir   string

	imports map[string]string // path → alias
}

// GenerateMCP generates MCP input types and ToProto conversion code from the
// loaded schemas. It expects exactly one resource spec loaded in resourceSpecs.
func (g *Generator) GenerateMCP() error {
	// When --schema-dir points directly at a resource directory (e.g.,
	// schemas/agentic/agent/), the loader categorises the spec JSON as a
	// taskConfig. Promote it so the rest of the method works uniformly.
	if len(g.resourceSpecs) == 0 && len(g.taskConfigs) == 1 {
		g.resourceSpecs = g.taskConfigs
		g.taskConfigs = nil
	}

	if len(g.resourceSpecs) == 0 {
		return fmt.Errorf("no resource spec found; expected one *Spec schema in %s", g.schemaDir)
	}
	if len(g.resourceSpecs) > 1 {
		names := make([]string, len(g.resourceSpecs))
		for i, s := range g.resourceSpecs {
			names[i] = s.Name
		}
		return fmt.Errorf("expected one resource spec, found %d: %v", len(g.resourceSpecs), names)
	}

	spec := g.resourceSpecs[0]

	typesMap := make(map[string]*TypeSchema, len(g.sharedTypes))
	for _, t := range g.sharedTypes {
		typesMap[t.Name] = t
	}

	m := &mcpGen{
		spec:        spec,
		types:       typesMap,
		seenTypes:   make(map[string]bool),
		packageName: g.packageName,
		outputDir:   g.outputDir,
		imports:     make(map[string]string),
	}

	m.collectInputTypes()

	return m.generateFile()
}

// --------------------------------------------------------------------
// Type collection
// --------------------------------------------------------------------

// identityFieldNames are the proto field names provided by the inline identity
// fields on every top-level input struct. Spec fields with these names are
// skipped to avoid duplicate Go struct fields.
var identityFieldNames = map[string]bool{
	"name": true, "slug": true, "org": true,
	"visibility": true, "labels": true, "tags": true,
}

func (m *mcpGen) collectInputTypes() {
	resourceName := strings.TrimSuffix(m.spec.Name, "Spec")
	topLevel := &mcpInputType{
		name:        resourceName + "Input",
		description: m.spec.Description,
		isTopLevel:  true,
		protoType:   m.spec.ProtoType,
	}

	for _, f := range m.spec.Fields {
		if identityFieldNames[f.ProtoField] {
			continue
		}
		topLevel.fields = append(topLevel.fields, m.resolveField(f))
	}

	m.inputTypes = append([]*mcpInputType{topLevel}, m.inputTypes...)
}

// resolveField converts a schema field to an mcpInputField, creating nested
// input types as a side effect.
func (m *mcpGen) resolveField(f *FieldSchema) *mcpInputField {
	field := &mcpInputField{
		goName:     f.Name,
		protoField: f.ProtoField,
	}

	switch {
	// Array of ApiResourceReference with referenceKind → flattened ref input
	case f.Type.Kind == "array" && f.Type.ElementType != nil &&
		f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference" &&
		f.ReferenceKind != 0:
		inputName := m.refInputTypeName(f)
		m.ensureRefInputType(inputName, f.ReferenceKind)
		field.goType = "[]" + inputName
		field.inputTypeName = inputName

	// Singular ApiResourceReference with referenceKind
	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference" && f.ReferenceKind != 0:
		inputName := m.refInputTypeName(f)
		m.ensureRefInputType(inputName, f.ReferenceKind)
		field.goType = inputName
		field.inputTypeName = inputName

	// Array of messages
	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		inputName := m.messageInputTypeName(f.Type.ElementType.MessageType)
		m.ensureMessageInputType(f.Type.ElementType.MessageType, inputName)
		field.goType = "[]" + inputName
		field.inputTypeName = inputName

	// Singular message
	case f.Type.Kind == "message":
		inputName := m.messageInputTypeName(f.Type.MessageType)
		m.ensureMessageInputType(f.Type.MessageType, inputName)
		field.goType = "*" + inputName
		field.inputTypeName = inputName

	// Map with message values
	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		keyType := scalarGoType(f.Type.KeyType.Kind)
		inputName := m.messageInputTypeName(f.Type.ValueType.MessageType)
		m.ensureMessageInputType(f.Type.ValueType.MessageType, inputName)
		field.goType = fmt.Sprintf("map[%s]*%s", keyType, inputName)
		field.inputTypeName = inputName

	// Map of scalars
	case f.Type.Kind == "map":
		keyType := scalarGoType(f.Type.KeyType.Kind)
		valType := scalarGoType(f.Type.ValueType.Kind)
		field.goType = fmt.Sprintf("map[%s]%s", keyType, valType)

	// Array of scalars
	case f.Type.Kind == "array" && f.Type.ElementType != nil:
		field.goType = "[]" + scalarGoType(f.Type.ElementType.Kind)

	default:
		field.goType = scalarGoType(f.Type.Kind)
	}

	field.jsonTag = m.buildJsonTag(f)
	field.schemaTag = m.buildJsonSchemaTag(f)
	field.description = sanitizeDescription(f.Description)
	field.oneofGroup = f.OneofGroup

	return field
}

// refInputTypeName derives the input type name for a flattened reference field.
// e.g., "skill_refs" → "SkillRefInput", "mcp_server_ref" → "McpServerRefInput"
func (m *mcpGen) refInputTypeName(f *FieldSchema) string {
	name := f.Name // PascalCase from schema
	if f.Type.Kind == "array" {
		name = singularize(name)
	}
	return name + "Input"
}

// messageInputTypeName derives the input type name for a proto message.
func (m *mcpGen) messageInputTypeName(messageName string) string {
	if strings.HasSuffix(messageName, "Spec") {
		return strings.TrimSuffix(messageName, "Spec") + "Input"
	}
	if strings.HasSuffix(messageName, "Value") {
		return messageName // leaf value types keep their name
	}
	return messageName + "Input"
}

func (m *mcpGen) ensureRefInputType(inputName string, kindVal int32) {
	if m.seenTypes[inputName] {
		return
	}
	m.seenTypes[inputName] = true

	refSchema, ok := m.types["ApiResourceReference"]
	if !ok {
		return
	}

	it := &mcpInputType{
		name:        inputName,
		description: fmt.Sprintf("Identifies a resource by org, slug, and optional version. Kind is auto-populated."),
		isReference: true,
		refKindVal:  kindVal,
		protoType:   refSchema.ProtoType,
	}

	for _, f := range refSchema.Fields {
		if f.ProtoField == "kind" {
			continue // auto-populated
		}
		if f.ProtoField == "version" && !versionedKinds[kindVal] {
			continue // skip version for non-versioned resources
		}
		it.fields = append(it.fields, m.resolveField(f))
	}

	m.inputTypes = append(m.inputTypes, it)
}

func (m *mcpGen) ensureMessageInputType(messageName, inputName string) {
	if m.seenTypes[inputName] {
		return
	}
	m.seenTypes[inputName] = true

	ts, ok := m.types[messageName]
	if !ok {
		return
	}

	it := &mcpInputType{
		name:        inputName,
		description: sanitizeDescription(ts.Description),
		protoType:   ts.ProtoType,
	}

	for _, f := range ts.Fields {
		it.fields = append(it.fields, m.resolveField(f))
	}

	m.inputTypes = append(m.inputTypes, it)
}

// --------------------------------------------------------------------
// Tag builders
// --------------------------------------------------------------------

func (m *mcpGen) buildJsonTag(f *FieldSchema) string {
	if f.Required {
		return f.ProtoField
	}
	return f.ProtoField + ",omitempty"
}

func (m *mcpGen) buildJsonSchemaTag(f *FieldSchema) string {
	var parts []string
	if f.Required {
		parts = append(parts, "required")
	}

	if f.Description != "" {
		desc := strings.ReplaceAll(f.Description, "\n", " ")
		for strings.Contains(desc, "  ") {
			desc = strings.ReplaceAll(desc, "  ", " ")
		}
		desc = strings.TrimSpace(desc)
		desc = strings.ReplaceAll(desc, ",", "\\,")
		parts = append(parts, "description="+desc)
	}
	return strings.Join(parts, ",")
}

// --------------------------------------------------------------------
// Code generation
// --------------------------------------------------------------------

func (m *mcpGen) generateFile() error {
	if err := os.MkdirAll(m.outputDir, 0755); err != nil {
		return err
	}

	resourceName := strings.TrimSuffix(m.spec.Name, "Spec")

	var body bytes.Buffer

	// Struct definitions
	for _, it := range m.inputTypes {
		m.genStruct(&body, it)
	}

	// ToProto methods
	m.genTopLevelToProto(&body, m.inputTypes[0], resourceName)

	for _, it := range m.inputTypes[1:] {
		m.genNestedToProto(&body, it)
	}

	// Build header with imports
	var header bytes.Buffer
	fmt.Fprintf(&header, "// Code generated by stigmer-codegen --target=mcp. DO NOT EDIT.\n")
	fmt.Fprintf(&header, "// Generated: %s\n\n", time.Now().Format(time.RFC3339))
	fmt.Fprintf(&header, "package %s\n\n", m.packageName)
	m.writeImports(&header)

	var full bytes.Buffer
	full.Write(header.Bytes())
	full.Write(body.Bytes())

	formatted, err := format.Source(full.Bytes())
	if err != nil {
		fmt.Printf("\n=== UNFORMATTED CODE ===\n%s\n", full.String())
		return fmt.Errorf("gofmt failed: %w", err)
	}

	filename := toSnakeCase(resourceName) + "_gen.go"
	outPath := filepath.Join(m.outputDir, filename)
	if err := os.WriteFile(outPath, formatted, 0644); err != nil {
		return err
	}
	fmt.Printf("  Generated %s\n", outPath)
	return nil
}

// genStruct writes a single input type struct.
func (m *mcpGen) genStruct(w *bytes.Buffer, it *mcpInputType) {
	if it.description != "" {
		for _, line := range strings.Split(it.description, "\n") {
			if line == "" {
				fmt.Fprintf(w, "//\n")
			} else {
				fmt.Fprintf(w, "// %s\n", line)
			}
		}
	}
	fmt.Fprintf(w, "type %s struct {\n", it.name)

	if it.isTopLevel {
		fmt.Fprintf(w, "\t// Human-readable name of the resource.\n")
		fmt.Fprintf(w, "\tName string `json:\"name\" jsonschema:\"required,description=Human-readable name of the resource.\"`\n")
		fmt.Fprintf(w, "\t// URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted.\n")
		fmt.Fprintf(w, "\tSlug string `json:\"slug,omitempty\" jsonschema:\"description=URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted.\"`\n")
		fmt.Fprintf(w, "\t// Organization that owns this resource (e.g. acme).\n")
		fmt.Fprintf(w, "\tOrg string `json:\"org\" jsonschema:\"required,description=Organization that owns this resource (e.g. acme).\"`\n")
		fmt.Fprintf(w, "\t// Resource visibility: PRIVATE (default) or PUBLIC.\n")
		fmt.Fprintf(w, "\tVisibility string `json:\"visibility,omitempty\" jsonschema:\"description=Resource visibility: PRIVATE (default) or PUBLIC.\"`\n")
		fmt.Fprintf(w, "\t// Key-value labels for organization and filtering.\n")
		fmt.Fprintf(w, "\tLabels map[string]string `json:\"labels,omitempty\" jsonschema:\"description=Key-value labels for organization and filtering.\"`\n")
		fmt.Fprintf(w, "\t// Tags for categorization and discovery.\n")
		fmt.Fprintf(w, "\tTags []string `json:\"tags,omitempty\" jsonschema:\"description=Tags for categorization and discovery.\"`\n\n")
	}

	for _, f := range it.fields {
		if f.description != "" {
			fmt.Fprintf(w, "\t// %s\n", f.description)
		}
		fmt.Fprintf(w, "\t%s %s `json:\"%s\" jsonschema:\"%s\"`\n",
			f.goName, f.goType, f.jsonTag, f.schemaTag)
	}

	fmt.Fprintf(w, "}\n\n")
}

// genTopLevelToProto generates the exported ToProto method for the top-level input.
func (m *mcpGen) genTopLevelToProto(w *bytes.Buffer, it *mcpInputType, resourceName string) {
	specPkg, specAlias := m.protoImport(it.protoType)
	m.addImport(specPkg, specAlias)

	apiVersion := m.deriveApiVersion(it.protoType)
	kind := resourceName

	m.addImport("github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource", "")
	m.addImport("github.com/stigmer/stigmer/mcp-server/internal/convert", "")

	fmt.Fprintf(w, "// ToProto converts the flat MCP input into a fully-formed %s proto message.\n", kind)
	fmt.Fprintf(w, "func (input *%s) ToProto() *%s.%s {\n", it.name, specAlias, kind)
	fmt.Fprintf(w, "\tslug := input.Slug\n")
	fmt.Fprintf(w, "\tif slug == \"\" {\n")
	fmt.Fprintf(w, "\t\tslug = convert.GenerateSlug(input.Name)\n")
	fmt.Fprintf(w, "\t}\n\n")
	fmt.Fprintf(w, "\treturn &%s.%s{\n", specAlias, kind)
	fmt.Fprintf(w, "\t\tApiVersion: %q,\n", apiVersion)
	fmt.Fprintf(w, "\t\tKind: %q,\n", kind)
	fmt.Fprintf(w, "\t\tMetadata: &apiresource.ApiResourceMetadata{\n")
	fmt.Fprintf(w, "\t\t\tName:       input.Name,\n")
	fmt.Fprintf(w, "\t\t\tSlug:       slug,\n")
	fmt.Fprintf(w, "\t\t\tOrg:        input.Org,\n")
	fmt.Fprintf(w, "\t\t\tVisibility: convert.VisibilityFromString(input.Visibility),\n")
	fmt.Fprintf(w, "\t\t\tLabels:     input.Labels,\n")
	fmt.Fprintf(w, "\t\t\tTags:       input.Tags,\n")
	fmt.Fprintf(w, "\t\t},\n")
	fmt.Fprintf(w, "\t\tSpec: input.specToProto(),\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")

	// specToProto helper
	fmt.Fprintf(w, "func (input *%s) specToProto() *%s.%sSpec {\n", it.name, specAlias, kind)
	fmt.Fprintf(w, "\tspec := &%s.%sSpec{}\n\n", specAlias, kind)

	for _, f := range it.fields {
		m.genFieldAssignment(w, f, "input", "spec", it)
	}

	fmt.Fprintf(w, "\treturn spec\n")
	fmt.Fprintf(w, "}\n\n")
}

// genNestedToProto generates a toProto method for a nested input type.
func (m *mcpGen) genNestedToProto(w *bytes.Buffer, it *mcpInputType) {
	if it.isReference {
		m.genRefToProto(w, it)
		return
	}

	pkg, alias := m.protoImport(it.protoType)
	m.addImport(pkg, alias)
	protoName := protoTypeName(it.protoType)

	fmt.Fprintf(w, "func (input *%s) toProto() *%s.%s {\n", it.name, alias, protoName)
	fmt.Fprintf(w, "\tresult := &%s.%s{}\n\n", alias, protoName)

	for _, f := range it.fields {
		m.genFieldAssignment(w, f, "input", "result", it)
	}

	fmt.Fprintf(w, "\treturn result\n")
	fmt.Fprintf(w, "}\n\n")
}

// genRefToProto generates a toProto method for a flattened reference input.
func (m *mcpGen) genRefToProto(w *bytes.Buffer, it *mcpInputType) {
	m.addImport("github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource", "")
	m.addImport("github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind", "")

	enumName, ok := apiResourceKindEnumNames[it.refKindVal]
	if !ok {
		enumName = fmt.Sprintf("ApiResourceKind(%d)", it.refKindVal)
	}

	fmt.Fprintf(w, "func (input *%s) toProto() *apiresource.ApiResourceReference {\n", it.name)
	fmt.Fprintf(w, "\treturn &apiresource.ApiResourceReference{\n")
	fmt.Fprintf(w, "\t\tOrg:  input.Org,\n")
	fmt.Fprintf(w, "\t\tSlug: input.Slug,\n")
	fmt.Fprintf(w, "\t\tKind: apiresourcekind.ApiResourceKind_%s,\n", enumName)
	if versionedKinds[it.refKindVal] {
		fmt.Fprintf(w, "\t\tVersion: input.Version,\n")
	}
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "}\n\n")
}

// genFieldAssignment generates code to assign a single field from input to proto.
func (m *mcpGen) genFieldAssignment(w *bytes.Buffer, f *mcpInputField, src, dst string, parentType *mcpInputType) {
	goType := f.goType
	hasToProto := f.inputTypeName != ""

	// Proto oneof fields use a wrapper type: SpecName_FieldName{FieldName: value}
	if f.oneofGroup != "" && hasToProto && strings.HasPrefix(goType, "*") {
		specName := protoTypeName(parentType.protoType)
		specPkg, specAlias := m.protoImport(parentType.protoType)
		m.addImport(specPkg, specAlias)
		fmt.Fprintf(w, "\tif %s.%s != nil {\n", src, f.goName)
		fmt.Fprintf(w, "\t\t%s.%s = &%s.%s_%s{%s: %s.%s.toProto()}\n",
			dst, toPascalCase(f.oneofGroup), specAlias, specName, f.goName, f.goName, src, f.goName)
		fmt.Fprintf(w, "\t}\n")
		return
	}

	switch {
	// Pointer to a nested input → nil-check + toProto
	case hasToProto && strings.HasPrefix(goType, "*"):
		fmt.Fprintf(w, "\tif %s.%s != nil {\n", src, f.goName)
		fmt.Fprintf(w, "\t\t%s.%s = %s.%s.toProto()\n", dst, f.goName, src, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// Value struct with toProto (e.g., required reference — McpServerRefInput)
	case hasToProto && !strings.HasPrefix(goType, "[]") && !strings.HasPrefix(goType, "map["):
		fmt.Fprintf(w, "\t%s.%s = %s.%s.toProto()\n", dst, f.goName, src, f.goName)

	// Slice of nested inputs → loop + toProto
	case hasToProto && strings.HasPrefix(goType, "[]"):
		fmt.Fprintf(w, "\tfor _, item := range %s.%s {\n", src, f.goName)
		fmt.Fprintf(w, "\t\t%s.%s = append(%s.%s, item.toProto())\n", dst, f.goName, dst, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// Map with nested input values → loop + toProto
	case hasToProto && strings.HasPrefix(goType, "map["):
		inputType := m.findInputType(f.inputTypeName)
		if inputType != nil {
			protoPkg, protoAlias := m.protoImport(inputType.protoType)
			m.addImport(protoPkg, protoAlias)
			protoName := protoTypeName(inputType.protoType)

			fmt.Fprintf(w, "\tif len(%s.%s) > 0 {\n", src, f.goName)
			fmt.Fprintf(w, "\t\t%s.%s = make(map[string]*%s.%s, len(%s.%s))\n",
				dst, f.goName, protoAlias, protoName, src, f.goName)
			fmt.Fprintf(w, "\t\tfor k, v := range %s.%s {\n", src, f.goName)
			fmt.Fprintf(w, "\t\t\t%s.%s[k] = v.toProto()\n", dst, f.goName)
			fmt.Fprintf(w, "\t\t}\n")
			fmt.Fprintf(w, "\t}\n")
		}

	// Scalar, scalar slice, or scalar map → direct assignment
	default:
		fmt.Fprintf(w, "\t%s.%s = %s.%s\n", dst, f.goName, src, f.goName)
	}
}

// --------------------------------------------------------------------
// Import management
// --------------------------------------------------------------------

func (m *mcpGen) addImport(path, alias string) {
	if path == "" {
		return
	}
	if _, ok := m.imports[path]; !ok {
		m.imports[path] = alias
	}
}

func (m *mcpGen) writeImports(w *bytes.Buffer) {
	if len(m.imports) == 0 {
		return
	}

	type entry struct {
		path  string
		alias string
	}
	var entries []entry
	for p, a := range m.imports {
		entries = append(entries, entry{p, a})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].path < entries[j].path })

	fmt.Fprintf(w, "import (\n")
	for _, e := range entries {
		if e.alias != "" {
			fmt.Fprintf(w, "\t%s %q\n", e.alias, e.path)
		} else {
			fmt.Fprintf(w, "\t%q\n", e.path)
		}
	}
	fmt.Fprintf(w, ")\n\n")
}

// --------------------------------------------------------------------
// Proto type helpers
// --------------------------------------------------------------------

// protoImport returns (go import path, package alias) for a fully-qualified proto type.
func (m *mcpGen) protoImport(protoType string) (string, string) {
	return protoTypeToGoImportPath(protoType), protoTypeToPackageAlias(protoType)
}

// deriveApiVersion converts "ai.stigmer.<namespace>.<resource>.<version>.<Type>"
// into "<namespace>.stigmer.ai/<version>".
func (m *mcpGen) deriveApiVersion(protoType string) string {
	parts := strings.Split(protoType, ".")
	if len(parts) < 6 {
		return "unknown"
	}
	namespace := parts[2] // "agentic"
	version := parts[4]   // "v1"
	return namespace + ".stigmer.ai/" + version
}

// protoTypeName returns the Go type name from a fully-qualified proto type.
func protoTypeName(protoType string) string {
	parts := strings.Split(protoType, ".")
	return parts[len(parts)-1]
}

func (m *mcpGen) findInputType(name string) *mcpInputType {
	for _, it := range m.inputTypes {
		if it.name == name {
			return it
		}
	}
	return nil
}

// --------------------------------------------------------------------
// Utility helpers
// --------------------------------------------------------------------

func scalarGoType(kind string) string {
	switch kind {
	case "string":
		return "string"
	case "bool":
		return "bool"
	case "int32":
		return "int32"
	case "int64":
		return "int64"
	case "float":
		return "float32"
	case "double":
		return "float64"
	case "bytes":
		return "[]byte"
	default:
		return "string"
	}
}

func isScalarSlice(goType string) bool {
	inner := strings.TrimPrefix(goType, "[]")
	switch inner {
	case "string", "bool", "int32", "int64", "float32", "float64", "byte":
		return true
	}
	return false
}

func parseMapType(goType string) (keyType, valType string) {
	// "map[string]*FooInput" → ("string", "*FooInput")
	inner := strings.TrimPrefix(goType, "map[")
	idx := strings.Index(inner, "]")
	if idx < 0 {
		return "string", "string"
	}
	return inner[:idx], inner[idx+1:]
}

// toPascalCase converts snake_case to PascalCase.
func toPascalCase(s string) string {
	parts := strings.Split(s, "_")
	for i, part := range parts {
		if len(part) > 0 {
			parts[i] = strings.ToUpper(part[:1]) + part[1:]
		}
	}
	return strings.Join(parts, "")
}

// singularize reduces a PascalCase plural to singular.
func singularize(name string) string {
	if strings.HasSuffix(name, "ies") {
		return name[:len(name)-3] + "y"
	}
	if strings.HasSuffix(name, "ses") {
		return name[:len(name)-2]
	}
	if strings.HasSuffix(name, "s") && !strings.HasSuffix(name, "ss") {
		return name[:len(name)-1]
	}
	return name
}
