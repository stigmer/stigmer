// Shared MCP apply-input model.
//
// This file builds the fully-resolved, language-neutral model that the MCP
// apply-input emitters consume. Historically it also held the Go emitter, but
// the Go MCP server was retired (T03) and the TypeScript emitter (mcp_ts.go) is
// now the sole consumer. Everything here — buildMcpGen and the type-collection
// pass it drives — is shared model construction, deliberately kept free of any
// language-specific emission so the projection is computed exactly once.
package main

import (
	"fmt"
	"path/filepath"
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
	isValue            bool   // true when the proto field is google.protobuf.Value
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

	// google.protobuf.Value → arbitrary JSON (string, number, object, array, ...)
	case f.Type.Kind == "message" && f.Type.MessageType == "Value":
		field.goType = "any"
		field.isValue = true

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
// Expand-struct interrogation (shared with the TS emitter)
// --------------------------------------------------------------------

func (m *mcpGen) hasExpandedConfigFields(it *mcpInputType) bool {
	for _, f := range it.fields {
		if f.isExpandedConfig {
			return true
		}
	}
	return false
}

// --------------------------------------------------------------------
// Import accumulation (populated during model building)
// --------------------------------------------------------------------

// addImport records a Go import path discovered while resolving the model
// (cross-package resource-wrapper references). The TS emitter ignores this
// accumulator and computes its own imports; it is retained because the model
// pass populates it as a side effect of resolveField.
func (m *mcpGen) addImport(path, alias string) {
	if path == "" {
		return
	}
	if _, ok := m.imports[path]; !ok {
		m.imports[path] = alias
	}
}

// --------------------------------------------------------------------
// Proto type helpers
// --------------------------------------------------------------------

// mcpProtoPrefix is the historical Go import-path prefix for the retired Go MCP
// server's protobuf stubs (T03 deleted that module). It survives only as a fixed
// input to the protoTypeToGoImportPath unit test, which exercises the generic
// proto-package → Go-import mapping; no emitter uses it anymore.
const mcpProtoPrefix = "github.com/stigmer/stigmer/mcp-server/proto"

// mcpGenModuleBase is the historical Go import-path prefix for the retired Go MCP
// server's generated input packages. resourceWrapperGenImport still derives the
// package name and *Input type from it when the model resolves a composite
// resource that embeds a resource wrapper; the Go import string it also builds is
// dead (the TS emitter computes its own imports) but kept so the shared model
// pass is unchanged.
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
