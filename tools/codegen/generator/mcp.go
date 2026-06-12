package main

import (
	"bytes"
	"fmt"
	"go/format"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// mcpInputType describes one Go struct to generate.
type mcpInputType struct {
	name        string
	description string
	isTopLevel  bool
	isReference bool
	refKindVal  int32
	protoType   string // fully-qualified proto type
	protoFile   string // source .proto file (used by the TS emitter for _pb schema imports)
	fields      []*mcpInputField
}

// mcpInputField describes one field inside an mcpInputType.
type mcpInputField struct {
	goName             string
	protoField         string
	goType             string
	jsonTag            string
	schemaTag          string
	description        string // for doc comment
	inputTypeName      string // non-empty when this field references a nested input type with toProto()
	oneofGroup         string // non-empty when this field belongs to a proto oneof group
	enumType           string // fully-qualified proto enum type (e.g., "ai.stigmer.agentic.workflow.v1.WorkflowTaskKind")
	isStruct           bool   // true when the proto field is google.protobuf.Struct
	isTimestamp        bool   // true when the proto field is google.protobuf.Timestamp
	isExpandedConfig   bool   // true when this field is a typed config from expand-struct expansion
	useExportedToProto bool   // true when this field references a cross-package input type with exported ToProto()
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

	expandStruct *expandStructConfig // optional: expand a Struct field into typed config fields
}

// GenerateMCP generates MCP input types and ToProto conversion code from the
// loaded schemas. It expects exactly one resource spec loaded in resourceSpecs.
func (g *Generator) GenerateMCP() error {
	m, err := g.buildMcpGen()
	if err != nil {
		return err
	}
	return m.generateFile()
}

// buildMcpGen promotes/validates the loaded schemas into a single resource spec
// and constructs the fully-resolved mcpGen model (the same intermediate the Go
// and TS emitters both consume, so the two outputs cannot drift). Extracted from
// GenerateMCP so the TS emitter reuses the identical model.
func (g *Generator) buildMcpGen() (*mcpGen, error) {
	// When --schema-dir points directly at a resource directory (e.g.,
	// schemas/agentic/agent/), the loader categorises the spec JSON as a
	// taskConfig. Promote it so the rest of the method works uniformly.
	if len(g.resourceSpecs) == 0 && len(g.taskConfigs) > 0 {
		dirBase := strings.ToLower(filepath.Base(g.schemaDir))
		var promoted *TaskConfigSchema
		var remaining []*TaskConfigSchema
		for _, tc := range g.taskConfigs {
			nameLower := strings.ToLower(strings.TrimSuffix(tc.Name, "Spec"))
			if promoted == nil && nameLower == dirBase {
				promoted = tc
			} else {
				remaining = append(remaining, tc)
			}
		}
		if promoted == nil && len(g.taskConfigs) == 1 {
			promoted = g.taskConfigs[0]
			remaining = nil
		}
		if promoted != nil {
			g.resourceSpecs = []*TaskConfigSchema{promoted}
			g.taskConfigs = remaining
		}
	}

	if len(g.resourceSpecs) == 0 {
		return nil, fmt.Errorf("no resource spec found; expected one *Spec schema in %s", g.schemaDir)
	}
	if len(g.resourceSpecs) > 1 {
		names := make([]string, len(g.resourceSpecs))
		for i, s := range g.resourceSpecs {
			names[i] = s.Name
		}
		return nil, fmt.Errorf("expected one resource spec, found %d: %v", len(g.resourceSpecs), names)
	}

	spec := g.resourceSpecs[0]

	typesMap := make(map[string]*TypeSchema, len(g.sharedTypes))
	for _, t := range g.sharedTypes {
		typesMap[t.Name] = t
	}

	if g.expandStruct != nil {
		for _, t := range g.expandStruct.configTypes {
			if typesMap[t.Name] == nil {
				typesMap[t.Name] = t
			}
		}
	}

	m := &mcpGen{
		spec:         spec,
		types:        typesMap,
		seenTypes:    make(map[string]bool),
		packageName:  g.packageName,
		outputDir:    g.outputDir,
		imports:      make(map[string]string),
		expandStruct: g.expandStruct,
	}

	m.collectInputTypes()

	return m, nil
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
		protoFile:   m.spec.ProtoFile,
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
	// Array of resource wrappers → cross-package import of existing *Input type
	case f.Type.Kind == "array" && f.Type.ElementType != nil &&
		f.Type.ElementType.Kind == "message" && m.isResourceWrapper(f.Type.ElementType.MessageType):
		importPath, pkgName, inputType := m.resourceWrapperGenImport(f.Type.ElementType.MessageType)
		m.addImport(importPath, "")
		qualifiedType := pkgName + "." + inputType
		field.goType = "[]" + qualifiedType
		field.inputTypeName = qualifiedType
		field.useExportedToProto = true

	// Singular resource wrapper → cross-package import of existing *Input type
	case f.Type.Kind == "message" && m.isResourceWrapper(f.Type.MessageType):
		importPath, pkgName, inputType := m.resourceWrapperGenImport(f.Type.MessageType)
		m.addImport(importPath, "")
		qualifiedType := pkgName + "." + inputType
		field.goType = "*" + qualifiedType
		field.inputTypeName = qualifiedType
		field.useExportedToProto = true

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
		if f.Required {
			field.goType = inputName
		} else {
			field.goType = "*" + inputName
		}
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

	// google.protobuf.Struct → map[string]any
	case f.Type.Kind == "struct":
		field.goType = "map[string]any"
		field.isStruct = true

	// google.protobuf.Timestamp → string (ISO 8601)
	case f.Type.Kind == "timestamp":
		field.goType = "string"
		field.isTimestamp = true

	default:
		field.goType = scalarGoType(f.Type.Kind)
	}

	field.jsonTag = m.buildJsonTag(f)
	field.schemaTag = m.buildJsonSchemaTag(f)
	field.description = sanitizeDescription(f.Description)
	field.oneofGroup = f.OneofGroup
	field.enumType = f.Type.EnumType

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
		protoFile:   refSchema.ProtoFile,
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

	hasExpansion := m.expandStruct != nil && m.typeHasExpandableField(ts)

	it := &mcpInputType{
		name:      inputName,
		protoType: ts.ProtoType,
		protoFile: ts.ProtoFile,
	}

	if hasExpansion {
		it.description = fmt.Sprintf("A single workflow task. Set kind to the task type and populate exactly one matching config field (e.g. kind='http_call' -> set the http_call field).")
	} else {
		it.description = sanitizeDescription(ts.Description)
	}

	for _, f := range ts.Fields {
		if hasExpansion && f.ProtoField == m.expandStruct.structField {
			for _, cfg := range m.expandStruct.configs {
				it.fields = append(it.fields, m.expandedConfigField(cfg))
			}
			continue
		}
		if hasExpansion && f.ProtoField == m.expandStruct.discriminatorField {
			f.Description = "Task type. Set the matching config field (e.g. kind='http_call' -> populate http_call)."
		}
		it.fields = append(it.fields, m.resolveField(f))
	}

	m.inputTypes = append(m.inputTypes, it)
}

func (m *mcpGen) typeHasExpandableField(ts *TypeSchema) bool {
	for _, f := range ts.Fields {
		if f.ProtoField == m.expandStruct.structField && f.Type.Kind == "struct" {
			return true
		}
	}
	return false
}

func (m *mcpGen) expandedConfigField(cfg *TaskConfigSchema) *mcpInputField {
	fieldName := m.expandStruct.kindToEnum[cfg.Kind]
	if fieldName == "" {
		fieldName = strings.ToLower(cfg.Kind)
	}
	inputName := m.messageInputTypeName(cfg.Name)

	m.ensureConfigInputType(cfg, inputName)

	desc := sanitizeDescription(cfg.Description)
	shortDesc := fmt.Sprintf("Required when kind='%s'. %s", fieldName, desc)

	schemaTag := strings.ReplaceAll(
		strings.ReplaceAll(shortDesc, "`", "'"),
		`"`, "'")

	return &mcpInputField{
		goName:           toPascalCase(fieldName),
		protoField:       fieldName,
		goType:           "*" + inputName,
		jsonTag:          fieldName + ",omitempty",
		schemaTag:        schemaTag,
		description:      shortDesc,
		inputTypeName:    inputName,
		isExpandedConfig: true,
	}
}

func (m *mcpGen) ensureConfigInputType(cfg *TaskConfigSchema, inputName string) {
	if m.seenTypes[inputName] {
		return
	}
	m.seenTypes[inputName] = true

	it := &mcpInputType{
		name:        inputName,
		description: sanitizeDescription(cfg.Description),
		protoType:   cfg.ProtoType,
		protoFile:   cfg.ProtoFile,
	}

	for _, f := range cfg.Fields {
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
	// google/jsonschema-go v0.4.2 treats the entire jsonschema tag value as
	// a plain description string. Structured prefixes like "required",
	// "enum=", or "description=" are not supported and will cause a panic.
	// Required is inferred automatically from the json tag (no omitempty = required).
	desc := f.Description
	if desc == "" {
		return ""
	}

	desc = strings.ReplaceAll(desc, "\n", " ")
	for strings.Contains(desc, "  ") {
		desc = strings.ReplaceAll(desc, "  ", " ")
	}
	desc = strings.TrimSpace(desc)
	desc = strings.ReplaceAll(desc, "`", "'")
	desc = strings.ReplaceAll(desc, `"`, "'")

	enumVals := f.Type.EnumValues
	if len(enumVals) == 0 && f.Validation != nil {
		enumVals = f.Validation.Enum
	}
	if len(enumVals) > 0 {
		desc += " Allowed values: " + strings.Join(enumVals, ", ") + "."
	}

	return desc
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

	// protoToStruct helper (if expand-struct is active)
	if m.expandStruct != nil {
		m.genProtoToStructHelper(&body)
	}

	// ToProto methods
	m.genTopLevelToProto(&body, m.inputTypes[0], resourceName)

	for _, it := range m.inputTypes[1:] {
		m.genNestedToProto(&body, it)
	}

	// Build header with imports
	var header bytes.Buffer
	fmt.Fprintf(&header, "// Code generated by stigmer-codegen --target=mcp. DO NOT EDIT.\n\n")
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

// genProtoToStructHelper generates the protoToStruct helper function that
// converts a proto message to structpb.Struct via protojson serialization.
func (m *mcpGen) genProtoToStructHelper(w *bytes.Buffer) {
	m.addImport("encoding/json", "")
	m.addImport("fmt", "")
	m.addImport("google.golang.org/protobuf/types/known/structpb", "structpb")
	m.addImport("google.golang.org/protobuf/proto", "")
	m.addImport("google.golang.org/protobuf/encoding/protojson", "")

	fmt.Fprintf(w, "func protoToStruct(msg proto.Message) (*structpb.Struct, error) {\n")
	fmt.Fprintf(w, "\tdata, err := protojson.Marshal(msg)\n")
	fmt.Fprintf(w, "\tif err != nil {\n")
	fmt.Fprintf(w, "\t\treturn nil, fmt.Errorf(\"protojson marshal: %%w\", err)\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "\tvar m map[string]any\n")
	fmt.Fprintf(w, "\tif err := json.Unmarshal(data, &m); err != nil {\n")
	fmt.Fprintf(w, "\t\treturn nil, fmt.Errorf(\"json unmarshal: %%w\", err)\n")
	fmt.Fprintf(w, "\t}\n")
	fmt.Fprintf(w, "\treturn structpb.NewStruct(m)\n")
	fmt.Fprintf(w, "}\n\n")
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
		fmt.Fprintf(w, "\tName string `json:\"name\" jsonschema:\"Human-readable name of the resource.\"`\n")
		fmt.Fprintf(w, "\t// URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted.\n")
		fmt.Fprintf(w, "\tSlug string `json:\"slug,omitempty\" jsonschema:\"URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted.\"`\n")
		fmt.Fprintf(w, "\t// Organization that owns this resource (e.g. acme).\n")
		fmt.Fprintf(w, "\tOrg string `json:\"org\" jsonschema:\"Organization that owns this resource (e.g. acme).\"`\n")
		fmt.Fprintf(w, "\t// Resource visibility: PRIVATE or PUBLIC. Omit to leave unchanged on updates.\n")
		fmt.Fprintf(w, "\tVisibility string `json:\"visibility,omitempty\" jsonschema:\"Resource visibility: PRIVATE or PUBLIC. Omit to leave unchanged on updates.\"`\n")
		fmt.Fprintf(w, "\t// Key-value labels for organization and filtering.\n")
		fmt.Fprintf(w, "\tLabels map[string]string `json:\"labels,omitempty\" jsonschema:\"Key-value labels for organization and filtering.\"`\n")
		fmt.Fprintf(w, "\t// Tags for categorization and discovery.\n")
		fmt.Fprintf(w, "\tTags []string `json:\"tags,omitempty\" jsonschema:\"Tags for categorization and discovery.\"`\n\n")
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

	m.addImport(mcpProtoPrefix+"/ai/stigmer/commons/apiresource", "")
	m.addImport("github.com/stigmer/stigmer/mcp-server/internal/convert", "")

	fmt.Fprintf(w, "// ToProto converts the flat MCP input into a fully-formed %s proto message.\n", kind)
	fmt.Fprintf(w, "func (input *%s) ToProto() (*%s.%s, error) {\n", it.name, specAlias, kind)
	fmt.Fprintf(w, "\tslug := input.Slug\n")
	fmt.Fprintf(w, "\tif slug == \"\" {\n")
	fmt.Fprintf(w, "\t\tslug = convert.GenerateSlug(input.Name)\n")
	fmt.Fprintf(w, "\t}\n\n")
	fmt.Fprintf(w, "\tspec, err := input.specToProto()\n")
	fmt.Fprintf(w, "\tif err != nil {\n")
	fmt.Fprintf(w, "\t\treturn nil, err\n")
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
	fmt.Fprintf(w, "\t\tSpec: spec,\n")
	fmt.Fprintf(w, "\t}, nil\n")
	fmt.Fprintf(w, "}\n\n")

	// specToProto helper
	fmt.Fprintf(w, "func (input *%s) specToProto() (*%s.%sSpec, error) {\n", it.name, specAlias, kind)
	fmt.Fprintf(w, "\tspec := &%s.%sSpec{}\n\n", specAlias, kind)

	for _, f := range it.fields {
		m.genFieldAssignment(w, f, "input", "spec", it)
	}

	fmt.Fprintf(w, "\treturn spec, nil\n")
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

	fmt.Fprintf(w, "func (input *%s) toProto() (*%s.%s, error) {\n", it.name, alias, protoName)
	fmt.Fprintf(w, "\tresult := &%s.%s{}\n\n", alias, protoName)

	for _, f := range it.fields {
		m.genFieldAssignment(w, f, "input", "result", it)
	}

	if m.hasExpandedConfigFields(it) {
		m.genConfigToStructSwitch(w, it)
	}

	fmt.Fprintf(w, "\treturn result, nil\n")
	fmt.Fprintf(w, "}\n\n")
}

func (m *mcpGen) hasExpandedConfigFields(it *mcpInputType) bool {
	for _, f := range it.fields {
		if f.isExpandedConfig {
			return true
		}
	}
	return false
}

func (m *mcpGen) genConfigToStructSwitch(w *bytes.Buffer, it *mcpInputType) {
	m.addImport("fmt", "")

	structFieldName := toPascalCase(m.expandStruct.structField)

	fmt.Fprintf(w, "\tswitch input.Kind {\n")
	for _, f := range it.fields {
		if !f.isExpandedConfig {
			continue
		}
		fmt.Fprintf(w, "\tcase %q:\n", f.protoField)
		fmt.Fprintf(w, "\t\tif input.%s == nil {\n", f.goName)
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"%s config required when kind=%%q\", input.Kind)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\tp, err := input.%s.toProto()\n", f.goName)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"convert %s config: %%w\", err)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\tv, err := protoToStruct(p)\n")
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"marshal %s config: %%w\", err)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\tresult.%s = v\n", structFieldName)
	}
	fmt.Fprintf(w, "\tdefault:\n")
	fmt.Fprintf(w, "\t\tif input.Kind != \"\" {\n")
	fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"unknown task kind: %%q\", input.Kind)\n")
	fmt.Fprintf(w, "\t\t}\n")
	fmt.Fprintf(w, "\t}\n")
}

// genRefToProto generates a toProto method for a flattened reference input.
func (m *mcpGen) genRefToProto(w *bytes.Buffer, it *mcpInputType) {
	m.addImport(mcpProtoPrefix+"/ai/stigmer/commons/apiresource", "")
	m.addImport(mcpProtoPrefix+"/ai/stigmer/commons/apiresource/apiresourcekind", "")

	enumName, ok := apiResourceKindEnumNames[it.refKindVal]
	if !ok {
		enumName = fmt.Sprintf("ApiResourceKind(%d)", it.refKindVal)
	}

	fmt.Fprintf(w, "func (input *%s) toProto() (*apiresource.ApiResourceReference, error) {\n", it.name)
	fmt.Fprintf(w, "\treturn &apiresource.ApiResourceReference{\n")
	fmt.Fprintf(w, "\t\tOrg:  input.Org,\n")
	fmt.Fprintf(w, "\t\tSlug: input.Slug,\n")
	fmt.Fprintf(w, "\t\tKind: apiresourcekind.ApiResourceKind_%s,\n", enumName)
	if versionedKinds[it.refKindVal] {
		fmt.Fprintf(w, "\t\tVersion: input.Version,\n")
	}
	fmt.Fprintf(w, "\t}, nil\n")
	fmt.Fprintf(w, "}\n\n")
}

// genFieldAssignment generates code to assign a single field from input to proto.
// All nested toProto calls propagate errors.
func (m *mcpGen) genFieldAssignment(w *bytes.Buffer, f *mcpInputField, src, dst string, parentType *mcpInputType) {
	if f.isExpandedConfig {
		return
	}

	goType := f.goType
	hasToProto := f.inputTypeName != ""

	// Proto3 optional scalar field (synthetic oneof "_field") → assign as pointer.
	// The proto generates *T types for these fields.
	if strings.HasPrefix(f.oneofGroup, "_") && !f.isTimestamp && !hasToProto {
		zeroVal := scalarZeroValue(goType)
		if zeroVal != "" {
			fmt.Fprintf(w, "\tif %s.%s != %s {\n", src, f.goName, zeroVal)
			fmt.Fprintf(w, "\t\tv := %s.%s\n", src, f.goName)
			fmt.Fprintf(w, "\t\t%s.%s = &v\n", dst, f.goName)
			fmt.Fprintf(w, "\t}\n")
			return
		}
	}

	// Proto oneof timestamp field → parse ISO 8601 and wrap in oneof
	if f.oneofGroup != "" && f.isTimestamp {
		specName := protoTypeName(parentType.protoType)
		specPkg, specAlias := m.protoImport(parentType.protoType)
		m.addImport(specPkg, specAlias)
		m.addImport("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		m.addImport("time", "")
		m.addImport("fmt", "")
		fmt.Fprintf(w, "\tif %s.%s != \"\" {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tt, err := time.Parse(time.RFC3339, %s.%s)\n", src, f.goName)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"parse %s: %%w\", err)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = &%s.%s_%s{%s: timestamppb.New(t)}\n",
			dst, toPascalCase(f.oneofGroup), specAlias, specName, f.goName, f.goName)
		fmt.Fprintf(w, "\t}\n")
		return
	}

	// Proto oneof fields use a wrapper type: SpecName_FieldName{FieldName: value}
	if f.oneofGroup != "" && hasToProto && strings.HasPrefix(goType, "*") {
		specName := protoTypeName(parentType.protoType)
		specPkg, specAlias := m.protoImport(parentType.protoType)
		m.addImport(specPkg, specAlias)
		fmt.Fprintf(w, "\tif %s.%s != nil {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tv, err := %s.%s.toProto()\n", src, f.goName)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, err\n")
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = &%s.%s_%s{%s: v}\n",
			dst, toPascalCase(f.oneofGroup), specAlias, specName, f.goName, f.goName)
		fmt.Fprintf(w, "\t}\n")
		return
	}

	switch {
	// google.protobuf.Timestamp field → parse ISO 8601 string
	case f.isTimestamp:
		m.addImport("google.golang.org/protobuf/types/known/timestamppb", "timestamppb")
		m.addImport("time", "")
		m.addImport("fmt", "")
		fmt.Fprintf(w, "\tif %s.%s != \"\" {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tt, err := time.Parse(time.RFC3339, %s.%s)\n", src, f.goName)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"parse %s: %%w\", err)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = timestamppb.New(t)\n", dst, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// google.protobuf.Struct field → structpb.NewStruct
	case f.isStruct:
		m.addImport("google.golang.org/protobuf/types/known/structpb", "structpb")
		m.addImport("fmt", "")
		fmt.Fprintf(w, "\tif len(%s.%s) > 0 {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tv, err := structpb.NewStruct(%s.%s)\n", src, f.goName)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, fmt.Errorf(\"marshal %s: %%w\", err)\n", f.protoField)
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = v\n", dst, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// Enum field → convert string to proto enum value
	case f.enumType != "":
		enumPkg, enumAlias := m.protoImport(f.enumType)
		m.addImport(enumPkg, enumAlias)
		enumName := protoTypeName(f.enumType)
		fmt.Fprintf(w, "\t%s.%s = %s.%s(%s.%s_value[%s.%s])\n",
			dst, f.goName, enumAlias, enumName, enumAlias, enumName, src, f.goName)

	// Pointer to a nested input → nil-check + toProto/ToProto
	case hasToProto && strings.HasPrefix(goType, "*"):
		toProtoCall := "toProto"
		if f.useExportedToProto {
			toProtoCall = "ToProto"
		}
		fmt.Fprintf(w, "\tif %s.%s != nil {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tv, err := %s.%s.%s()\n", src, f.goName, toProtoCall)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, err\n")
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = v\n", dst, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// Value struct with toProto (e.g., required reference — McpServerRefInput)
	case hasToProto && !strings.HasPrefix(goType, "[]") && !strings.HasPrefix(goType, "map["):
		toProtoCall := "toProto"
		if f.useExportedToProto {
			toProtoCall = "ToProto"
		}
		fmt.Fprintf(w, "\t{\n")
		fmt.Fprintf(w, "\t\tv, err := %s.%s.%s()\n", src, f.goName, toProtoCall)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, err\n")
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = v\n", dst, f.goName)
		fmt.Fprintf(w, "\t}\n")

	// Slice of nested inputs → loop + toProto/ToProto
	case hasToProto && strings.HasPrefix(goType, "[]"):
		toProtoCall := "toProto"
		if f.useExportedToProto {
			toProtoCall = "ToProto"
		}
		fmt.Fprintf(w, "\tfor _, item := range %s.%s {\n", src, f.goName)
		fmt.Fprintf(w, "\t\tv, err := item.%s()\n", toProtoCall)
		fmt.Fprintf(w, "\t\tif err != nil {\n")
		fmt.Fprintf(w, "\t\t\treturn nil, err\n")
		fmt.Fprintf(w, "\t\t}\n")
		fmt.Fprintf(w, "\t\t%s.%s = append(%s.%s, v)\n", dst, f.goName, dst, f.goName)
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
			fmt.Fprintf(w, "\t\t\tpv, err := v.toProto()\n")
			fmt.Fprintf(w, "\t\t\tif err != nil {\n")
			fmt.Fprintf(w, "\t\t\t\treturn nil, err\n")
			fmt.Fprintf(w, "\t\t\t}\n")
			fmt.Fprintf(w, "\t\t\t%s.%s[k] = pv\n", dst, f.goName)
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

// mcpProtoPrefix is the Go module import path prefix for protobuf stubs
// generated inside the MCP server module. Stubs live at mcp-server/proto/
// (same pattern as sdk/go/proto/) so the module has no replace directives
// and can be installed via `go install`.
const mcpProtoPrefix = "github.com/stigmer/stigmer/mcp-server/proto"

// mcpGenModuleBase is the Go module import path prefix for generated MCP
// input packages. Combined with "{domain}/{resource}" it produces a full
// import path such as "github.com/stigmer/stigmer/mcp-server/gen/agentic/agent".
const mcpGenModuleBase = "github.com/stigmer/stigmer/mcp-server/gen"

// isResourceWrapper reports whether messageName refers to a standard API
// resource envelope (has api_version, kind, metadata with
// ApiResourceMetadata, and spec fields). These types are generated as
// standalone packages and should be imported cross-package rather than
// re-generated inline.
func (m *mcpGen) isResourceWrapper(messageName string) bool {
	ts, ok := m.types[messageName]
	if !ok {
		return false
	}

	var hasApiVersion, hasKind, hasMetadata, hasSpec bool
	for _, f := range ts.Fields {
		switch f.ProtoField {
		case "api_version":
			hasApiVersion = true
		case "kind":
			hasKind = true
		case "metadata":
			if f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceMetadata" {
				hasMetadata = true
			}
		case "spec":
			hasSpec = true
		}
	}
	return hasApiVersion && hasKind && hasMetadata && hasSpec
}

// resourceWrapperGenImport derives the cross-package MCP gen import path,
// Go package name, and input type name for a resource wrapper message.
//
// Example: messageName="Agent"
//
//	protoType = "ai.stigmer.agentic.agent.v1.Agent"
//	→ importPath = "github.com/stigmer/stigmer/mcp-server/gen/agentic/agent"
//	→ pkgName    = "agent"
//	→ inputType  = "AgentInput"
func (m *mcpGen) resourceWrapperGenImport(messageName string) (importPath, pkgName, inputType string) {
	ts, ok := m.types[messageName]
	if !ok {
		return "", "", ""
	}

	// Proto type format: ai.stigmer.<domain>.<resource>.<version>.<TypeName>
	parts := strings.Split(ts.ProtoType, ".")
	if len(parts) < 6 {
		return "", "", ""
	}

	domain := parts[2]   // e.g. "agentic"
	resource := parts[3] // e.g. "agent"

	importPath = mcpGenModuleBase + "/" + domain + "/" + resource
	pkgName = resource
	inputType = messageName + "Input"
	return importPath, pkgName, inputType
}

// protoImport returns (go import path, package alias) for a fully-qualified proto type.
func (m *mcpGen) protoImport(protoType string) (string, string) {
	return protoTypeToGoImportPath(protoType, mcpProtoPrefix), protoTypeToPackageAlias(protoType)
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

// scalarZeroValue returns the Go zero-value literal for a scalar type,
// used to guard proto3 optional pointer assignments.
func scalarZeroValue(goType string) string {
	switch goType {
	case "int32", "int64", "uint32", "uint64", "float32", "float64":
		return "0"
	case "bool":
		return "false"
	case "string":
		return `""`
	default:
		return ""
	}
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
	case "uint32":
		return "uint32"
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
	case "string", "bool", "int32", "uint32", "int64", "float32", "float64", "byte":
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
