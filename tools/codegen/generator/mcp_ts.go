package main

// TypeScript MCP apply-input emitter.
//
// This is the TS sibling of mcp.go's Go emitter. Both consume the identical
// mcpGen.inputTypes model (built by buildMcpGen -> collectInputTypes), so the
// flattened ergonomic projection — metadata hoist, enum->string, reference
// flattening with kind injection, oneof flattening, and the workflow
// task_config discriminated-union expansion — is computed once and cannot drift
// between the two languages.
//
// Why a generator at all (vs. a runtime protobuf-es descriptor walker): the
// per-field descriptions and required flags that make the apply tools usable by
// an LLM come from proto comments + buf.validate, neither of which survives in
// the runtime protobuf-es descriptors (SourceCodeInfo is stripped from the
// embedded fileDesc). Capturing them at build time is the only way to reach
// description parity with the Go MCP server.

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// mcpTSApplyResources is the set of resources the TS MCP server exposes an
// apply_* tool for. The original three mirror the Go server's registered apply
// surface (agents.ApplyTool + mcpservers.ApplyTool) plus workflow, which the
// Go server had temporarily disabled for a recursive-type limitation that
// protobuf-es + zod's z.lazy resolves — so the TS server re-enables it.
// Environment and datastore complete the authoring loop (agents and records
// reference both). Each entry is a "<domain>/<resource>" schema directory
// under tools/codegen/schemas.
var mcpTSApplyResources = []string{
	"agentic/agent",
	"agentic/datastore",
	"agentic/environment",
	"agentic/mcpserver",
	"agentic/workflow",
}

// runMCPTSGeneration generates the TypeScript apply-input modules for the
// apply-capable resources into outputDir (mcp-server/src/gen). It reuses the
// satellite (workflow tasks) index so the workflow task_config expand-struct is
// auto-detected, exactly as the Go MCP generator does.
func runMCPTSGeneration(schemaDir, outputDir string) error {
	fmt.Printf("TypeScript MCP apply-input generation from %s\n", schemaDir)
	fmt.Printf("Output directory: %s\n\n", outputDir)

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return err
	}

	if err := writeApplyRuntime(outputDir); err != nil {
		return fmt.Errorf("write apply-runtime.ts: %w", err)
	}
	fmt.Printf("   -> apply-runtime.ts\n")

	_, satellitePaths, err := discoverDomains(schemaDir)
	if err != nil {
		return err
	}
	satellites, err := indexSatellites(satellitePaths)
	if err != nil {
		return err
	}

	for _, rel := range mcpTSApplyResources {
		resourceSchemaDir := filepath.Join(schemaDir, rel)
		resource := filepath.Base(rel)

		gen, err := NewGenerator(resourceSchemaDir, outputDir, resource, "")
		if err != nil {
			return fmt.Errorf("load schemas for %s: %w", rel, err)
		}
		detectExpandStructFromSchema(gen, satellites)

		if err := gen.GenerateMCPTS(); err != nil {
			return fmt.Errorf("generate TS for %s: %w", rel, err)
		}
		fmt.Printf("   -> %s.ts\n", resource)
	}

	fmt.Printf("\nGenerated %d TS apply modules\n", len(mcpTSApplyResources))
	return nil
}

// GenerateMCPTS builds the shared mcpGen model and emits the TypeScript module.
func (g *Generator) GenerateMCPTS() error {
	m, err := g.buildMcpGen()
	if err != nil {
		return err
	}
	return m.generateTSFile()
}

// --------------------------------------------------------------------
// TS field classification (interpreting the mcpInputField model)
// --------------------------------------------------------------------

// tsCollection describes the cardinality of a field.
type tsCollection int

const (
	tsSingular tsCollection = iota
	tsArray
	tsMap
)

// tsField is the TS-emitter view of an mcpInputField: it resolves the model's
// Go-typed representation into the leaf kind + cardinality the zod/type/toProto
// emitters need.
type tsField struct {
	key      string // snake_case proto field name (the MCP input key, Go-parity)
	camel    string // camelCase proto field name (protobuf-es localName)
	required bool
	desc     string
	coll     tsCollection
	expanded bool // workflow task_config expansion sibling field

	// Exactly one leaf classification is set.
	nested       *mcpInputType // message or reference input type
	isRef        bool
	refEnum      string
	refVersioned bool
	enumType     string // fully-qualified proto enum type
	isStruct     bool
	isValue      bool
	isTimestamp  bool
	scalar       string // scalar leaf goType when none of the above
	isInt64      bool

	oneof string // real (non-synthetic) oneof group, camelCase wrapper name
}

func (m *mcpGen) classifyField(f *mcpInputField) tsField {
	tf := tsField{
		key:      f.protoField,
		camel:    tsProtoFieldName(f.protoField),
		required: !strings.Contains(f.jsonTag, "omitempty"),
		desc:     f.schemaTag,
		expanded: f.isExpandedConfig,
	}
	if f.oneofGroup != "" && !strings.HasPrefix(f.oneofGroup, "_") {
		tf.oneof = tsProtoFieldName(f.oneofGroup)
	}

	// Struct (google.protobuf.Struct), Value (google.protobuf.Value), and
	// Timestamp are leaf kinds whose Go type (map[string]any / any / string)
	// would otherwise be misread as a collection or scalar, so they are
	// classified before any collection-prefix inspection.
	switch {
	case f.isStruct:
		tf.isStruct = true
		return tf
	case f.isValue:
		tf.isValue = true
		return tf
	case f.isTimestamp:
		tf.isTimestamp = true
		return tf
	}

	goType := f.goType
	switch {
	case strings.HasPrefix(goType, "[]") && goType != "[]byte":
		tf.coll = tsArray
		goType = strings.TrimPrefix(goType, "[]")
	case strings.HasPrefix(goType, "map["):
		tf.coll = tsMap
		_, goType = parseMapType(goType)
	}
	goType = strings.TrimPrefix(goType, "*")

	switch {
	case f.inputTypeName != "":
		tf.nested = m.findInputType(strings.TrimPrefix(strings.TrimPrefix(f.inputTypeName, "[]"), "*"))
		if tf.nested != nil && tf.nested.isReference {
			tf.isRef = true
			tf.refEnum = apiResourceKindEnumNames[tf.nested.refKindVal]
			tf.refVersioned = versionedKinds[tf.nested.refKindVal]
		}
	case f.enumType != "":
		tf.enumType = f.enumType
	case goType == "[]byte":
		tf.scalar = "bytes"
	default:
		tf.scalar = goType
		tf.isInt64 = goType == "int64" || goType == "uint64"
	}
	return tf
}

// --------------------------------------------------------------------
// Naming helpers
// --------------------------------------------------------------------

// tsToProtoFn is the toProto function name for a nested input type.
func tsToProtoFn(it *mcpInputType) string { return lowerFirst(it.name) + "ToProto" }

// tsSchemaConst is the zod schema const name for an input type.
func tsSchemaConst(name string) string { return name + "Schema" }

// --------------------------------------------------------------------
// Dependency graph + cycle detection (drives z.lazy + explicit interfaces)
// --------------------------------------------------------------------

func (m *mcpGen) typeDeps(it *mcpInputType) []string {
	var deps []string
	for _, f := range it.fields {
		if f.inputTypeName == "" {
			continue
		}
		name := strings.TrimPrefix(strings.TrimPrefix(f.inputTypeName, "[]"), "*")
		deps = append(deps, name)
	}
	return deps
}

// cyclicTypes returns the set of input-type names that participate in a
// reference cycle (directly or transitively). These need an explicit TS
// interface + z.ZodType annotation because z.infer cannot resolve a recursive
// zod schema on its own.
func (m *mcpGen) cyclicTypes() map[string]bool {
	graph := make(map[string][]string, len(m.inputTypes))
	for _, it := range m.inputTypes {
		graph[it.name] = m.typeDeps(it)
	}

	cyclic := make(map[string]bool)
	for _, start := range m.inputTypes {
		// BFS/DFS from start; if we can return to start, it is on a cycle.
		seen := make(map[string]bool)
		var stack []string
		stack = append(stack, graph[start.name]...)
		for len(stack) > 0 {
			n := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if n == start.name {
				cyclic[start.name] = true
				break
			}
			if seen[n] {
				continue
			}
			seen[n] = true
			stack = append(stack, graph[n]...)
		}
	}
	return cyclic
}

// --------------------------------------------------------------------
// File generation
// --------------------------------------------------------------------

func (m *mcpGen) generateTSFile() error {
	resourceName := strings.TrimSuffix(m.spec.Name, "Spec")
	kind := resourceName
	apiVersion := m.deriveApiVersion(m.spec.ProtoType)
	resourceBase := deriveTSImportBase(tsProtoPkg(m.spec.ProtoType))

	cyclic := m.cyclicTypes()
	imports := newTSImportSet()
	imports.addValue("zod", "z")
	imports.addValue("@bufbuild/protobuf", "create")
	imports.addValue(resourceBase+"/api_pb", kind+"Schema")
	imports.addType(resourceBase+"/api_pb", kind)
	imports.addValue("./apply-runtime.js", "generateSlug")
	imports.addValue("./apply-runtime.js", "visibilityFromString")

	var body bytes.Buffer

	// Zod schemas (top-level first, then nested). z.lazy on every message/ref
	// reference makes declaration order irrelevant at runtime.
	m.genTSTopLevelSchema(&body, kind, imports)
	for _, it := range m.inputTypes[1:] {
		m.genTSNestedSchema(&body, it, cyclic, imports)
	}

	// toProto functions.
	body.WriteString("\n")
	m.genTSTopLevelToProto(&body, kind, apiVersion, resourceBase, imports)
	for _, it := range m.inputTypes[1:] {
		m.genTSNestedToProto(&body, it, resourceBase, imports)
	}

	var full bytes.Buffer
	full.WriteString("// Code generated by stigmer-codegen --target=mcp-ts. DO NOT EDIT.\n")
	full.WriteString("//\n")
	full.WriteString("// Flattened apply-input zod schema + toProto bridge for the " + kind + " resource.\n")
	full.WriteString("// Source proto package: " + tsProtoPkg(m.spec.ProtoType) + "\n\n")
	imports.emit(&full)
	full.Write(body.Bytes())

	filename := lowerFirst(resourceName)
	// Match the schema directory's resource name (e.g. "mcpserver"), not the
	// proto Kind ("McpServer"), so the file is "<resource>.ts".
	filename = strings.ToLower(filename)
	outPath := filepath.Join(m.outputDir, filename+".ts")
	if err := os.WriteFile(outPath, full.Bytes(), 0644); err != nil {
		return err
	}
	return nil
}

// tsProtoPkg returns the proto package (everything but the final type segment).
func tsProtoPkg(protoType string) string {
	parts := strings.Split(protoType, ".")
	if len(parts) < 2 {
		return protoType
	}
	return strings.Join(parts[:len(parts)-1], ".")
}

// --------------------------------------------------------------------
// Zod schema emission
// --------------------------------------------------------------------

// identityZodFields emits the six hoisted identity fields shared by every
// top-level apply input. Descriptions are byte-for-byte the Go genStruct copy.
func identityZodFields(w *bytes.Buffer) {
	fmt.Fprintf(w, "  name: z.string().describe(%s),\n", strconv.Quote("Human-readable name of the resource."))
	fmt.Fprintf(w, "  slug: z.string().optional().describe(%s),\n", strconv.Quote("URL-friendly identifier (lowercase alphanumeric with hyphens). Auto-generated from name if omitted."))
	fmt.Fprintf(w, "  org: z.string().describe(%s),\n", strconv.Quote("Organization that owns this resource (e.g. acme)."))
	fmt.Fprintf(w, "  visibility: z.string().optional().describe(%s),\n", strconv.Quote("Resource visibility: PRIVATE or PUBLIC. Omit to leave unchanged on updates."))
	fmt.Fprintf(w, "  labels: z.record(z.string()).optional().describe(%s),\n", strconv.Quote("Key-value labels for organization and filtering."))
	fmt.Fprintf(w, "  tags: z.array(z.string()).optional().describe(%s),\n", strconv.Quote("Tags for categorization and discovery."))
}

func (m *mcpGen) genTSTopLevelSchema(w *bytes.Buffer, kind string, imports *tsImportSet) {
	top := m.inputTypes[0]
	if top.description != "" {
		fmt.Fprintf(w, "/** %s */\n", sanitizeDescription(top.description))
	}
	fmt.Fprintf(w, "export const %sInputShape = {\n", kind)
	identityZodFields(w)
	for _, f := range top.fields {
		m.genTSZodField(w, m.classifyField(f), imports)
	}
	fmt.Fprintf(w, "} as const;\n\n")
	fmt.Fprintf(w, "export const %sInputSchema = z.object(%sInputShape);\n", kind, kind)
	fmt.Fprintf(w, "export type %sInput = z.infer<typeof %sInputSchema>;\n\n", kind, kind)
}

func (m *mcpGen) genTSNestedSchema(w *bytes.Buffer, it *mcpInputType, cyclic map[string]bool, imports *tsImportSet) {
	if it.isReference {
		// Reference inputs are plain {org, slug[, version]} objects.
		fmt.Fprintf(w, "const %s = z.object({\n", tsSchemaConst(it.name))
		for _, f := range it.fields {
			m.genTSZodField(w, m.classifyField(f), imports)
		}
		fmt.Fprintf(w, "});\n")
		fmt.Fprintf(w, "type %s = z.infer<typeof %s>;\n\n", it.name, tsSchemaConst(it.name))
		return
	}

	if cyclic[it.name] {
		// Recursive type: emit an explicit interface and annotate the schema so
		// z.infer does not hit a circular self-reference.
		m.genTSInterface(w, it)
		fmt.Fprintf(w, "const %s: z.ZodType<%s> = z.lazy(() => z.object({\n", tsSchemaConst(it.name), it.name)
		for _, f := range it.fields {
			m.genTSZodField(w, m.classifyField(f), imports)
		}
		fmt.Fprintf(w, "}));\n\n")
		return
	}

	fmt.Fprintf(w, "const %s = z.object({\n", tsSchemaConst(it.name))
	for _, f := range it.fields {
		m.genTSZodField(w, m.classifyField(f), imports)
	}
	fmt.Fprintf(w, "});\n")
	fmt.Fprintf(w, "type %s = z.infer<typeof %s>;\n\n", it.name, tsSchemaConst(it.name))
}

func (m *mcpGen) genTSZodField(w *bytes.Buffer, tf tsField, imports *tsImportSet) {
	leaf := m.tsZodLeaf(tf, imports)
	expr := leaf
	switch tf.coll {
	case tsArray:
		expr = "z.array(" + leaf + ")"
	case tsMap:
		expr = "z.record(" + leaf + ")"
	}
	if !tf.required {
		expr += ".optional()"
	}
	if tf.desc != "" {
		expr += ".describe(" + strconv.Quote(tf.desc) + ")"
	}
	fmt.Fprintf(w, "  %s: %s,\n", tsObjectKey(tf.key), expr)
}

func (m *mcpGen) tsZodLeaf(tf tsField, imports *tsImportSet) string {
	switch {
	case tf.nested != nil:
		// z.lazy makes forward/recursive references safe regardless of order.
		return "z.lazy(() => " + tsSchemaConst(tf.nested.name) + ")"
	case tf.enumType != "":
		return "z.string()"
	case tf.isStruct:
		return "z.record(z.unknown())"
	case tf.isValue:
		// google.protobuf.Value accepts any JSON shape (string, object, array, ...).
		return "z.unknown()"
	case tf.isTimestamp:
		return "z.string()"
	default:
		return tsZodScalar(tf.scalar)
	}
}

func tsZodScalar(goType string) string {
	switch goType {
	case "string", "bytes":
		return "z.string()"
	case "bool":
		return "z.boolean()"
	case "int32", "uint32", "float32", "float64":
		return "z.number()"
	case "int64", "uint64":
		return "z.union([z.number(), z.string()])"
	default:
		return "z.string()"
	}
}

// tsObjectKey quotes an object key only when it is not a valid bare identifier.
func tsObjectKey(k string) string {
	for i, r := range k {
		ok := r == '_' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (i > 0 && r >= '0' && r <= '9')
		if !ok {
			return strconv.Quote(k)
		}
	}
	return k
}

// --------------------------------------------------------------------
// Explicit interface emission (recursive types only)
// --------------------------------------------------------------------

func (m *mcpGen) genTSInterface(w *bytes.Buffer, it *mcpInputType) {
	fmt.Fprintf(w, "interface %s {\n", it.name)
	for _, f := range it.fields {
		tf := m.classifyField(f)
		opt := "?"
		if tf.required {
			opt = ""
		}
		fmt.Fprintf(w, "  %s%s: %s;\n", tsObjectKey(tf.key), opt, m.tsTypeLeaf(tf))
	}
	fmt.Fprintf(w, "}\n")
}

func (m *mcpGen) tsTypeLeaf(tf tsField) string {
	var leaf string
	switch {
	case tf.nested != nil:
		leaf = tf.nested.name
	case tf.enumType != "":
		leaf = "string"
	case tf.isStruct:
		leaf = "Record<string, unknown>"
	case tf.isValue:
		leaf = "unknown"
	case tf.isTimestamp:
		leaf = "string"
	default:
		leaf = tsScalarType(tf.scalar)
	}
	switch tf.coll {
	case tsArray:
		return leaf + "[]"
	case tsMap:
		return "Record<string, " + leaf + ">"
	}
	return leaf
}

func tsScalarType(goType string) string {
	switch goType {
	case "string", "bytes":
		return "string"
	case "bool":
		return "boolean"
	case "int32", "uint32", "float32", "float64":
		return "number"
	case "int64", "uint64":
		return "number | string"
	default:
		return "string"
	}
}

// --------------------------------------------------------------------
// toProto emission
// --------------------------------------------------------------------

func (m *mcpGen) genTSTopLevelToProto(w *bytes.Buffer, kind, apiVersion, resourceBase string, imports *tsImportSet) {
	top := m.inputTypes[0]
	specName := protoTypeName(m.spec.ProtoType)
	specSuffix := tsProtoFileToSuffix(m.spec.ProtoFile)
	imports.addValue(resourceBase+"/"+specSuffix, specName+"Schema")
	imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb", "ApiResourceMetadataSchema")

	fmt.Fprintf(w, "/** Build the fully-formed %s proto from the flat MCP apply input. */\n", kind)
	fmt.Fprintf(w, "export function %sInputToProto(input: %sInput): %s {\n", lowerFirst(kind), kind, kind)
	fmt.Fprintf(w, "  const slug = input.slug && input.slug.length > 0 ? input.slug : generateSlug(input.name);\n")
	fmt.Fprintf(w, "  const spec = create(%sSchema);\n", specName)
	m.genTSSpecAssignments(w, top, "spec", imports)
	fmt.Fprintf(w, "  return Object.assign(create(%sSchema), {\n", kind)
	fmt.Fprintf(w, "    apiVersion: %s,\n", strconv.Quote(apiVersion))
	fmt.Fprintf(w, "    kind: %s,\n", strconv.Quote(kind))
	fmt.Fprintf(w, "    metadata: Object.assign(create(ApiResourceMetadataSchema), {\n")
	fmt.Fprintf(w, "      name: input.name,\n")
	fmt.Fprintf(w, "      slug,\n")
	fmt.Fprintf(w, "      org: input.org,\n")
	fmt.Fprintf(w, "      ...(input.visibility !== undefined && { visibility: visibilityFromString(input.visibility) }),\n")
	fmt.Fprintf(w, "      ...(input.labels !== undefined && { labels: input.labels }),\n")
	fmt.Fprintf(w, "      ...(input.tags !== undefined && { tags: input.tags }),\n")
	fmt.Fprintf(w, "    }),\n")
	fmt.Fprintf(w, "    spec,\n")
	fmt.Fprintf(w, "  }) as %s;\n", kind)
	fmt.Fprintf(w, "}\n\n")
}

func (m *mcpGen) genTSNestedToProto(w *bytes.Buffer, it *mcpInputType, resourceBase string, imports *tsImportSet) {
	if it.isReference {
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/io_pb", "ApiResourceReferenceSchema")
		imports.addValue("@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb", "ApiResourceKind")
		enumName := apiResourceKindEnumNames[it.refKindVal]
		fmt.Fprintf(w, "function %s(input: %s) {\n", tsToProtoFn(it), it.name)
		fmt.Fprintf(w, "  return create(ApiResourceReferenceSchema, {\n")
		fmt.Fprintf(w, "    org: input.org,\n")
		fmt.Fprintf(w, "    slug: input.slug,\n")
		fmt.Fprintf(w, "    kind: ApiResourceKind.%s,\n", enumName)
		if versionedKinds[it.refKindVal] {
			fmt.Fprintf(w, "    version: input.version,\n")
		}
		fmt.Fprintf(w, "  });\n")
		fmt.Fprintf(w, "}\n\n")
		return
	}

	protoName := protoTypeName(it.protoType)
	suffix := tsProtoFileToSuffix(it.protoFile)
	base := deriveTSImportBase(tsProtoPkg(it.protoType))
	imports.addValue(base+"/"+suffix, protoName+"Schema")

	fmt.Fprintf(w, "function %s(input: %s) {\n", tsToProtoFn(it), it.name)
	fmt.Fprintf(w, "  const result = create(%sSchema);\n", protoName)
	m.genTSSpecAssignments(w, it, "result", imports)
	fmt.Fprintf(w, "  return result;\n")
	fmt.Fprintf(w, "}\n\n")
}

// genTSSpecAssignments emits the field-by-field assignments converting the flat
// input into the proto message held in dst. Mirrors mcp.go genFieldAssignment.
func (m *mcpGen) genTSSpecAssignments(w *bytes.Buffer, it *mcpInputType, dst string, imports *tsImportSet) {
	for _, f := range it.fields {
		tf := m.classifyField(f)
		if tf.expanded {
			continue // handled by the task_config switch
		}
		m.genTSFieldAssign(w, tf, dst, imports)
	}
	if m.hasExpandedConfigFields(it) {
		m.genTSConfigSwitch(w, it, dst, imports)
	}
}

func (m *mcpGen) genTSFieldAssign(w *bytes.Buffer, tf tsField, dst string, imports *tsImportSet) {
	in := "input." + tsMemberAccess(tf.key)

	// Real oneof member: assign the { case, value } wrapper.
	if tf.oneof != "" {
		val := m.tsLeafValueExpr(tf, in, imports)
		fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = { case: %s, value: %s };\n",
			in, dst, tf.oneof, strconv.Quote(tf.camel), val)
		return
	}

	switch {
	case tf.enumType != "":
		from, enumName := tsResolveEnumImportSmart(tf.enumType)
		imports.addValue(from, enumName)
		imports.addValue("./apply-runtime.js", "enumFromString")
		if tf.coll == tsArray {
			fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s.map((v) => enumFromString(%s, v) as %s);\n", in, dst, tf.camel, in, enumName, enumName)
		} else {
			fmt.Fprintf(w, "  %s.%s = enumFromString(%s, %s) as %s;\n", dst, tf.camel, enumName, in, enumName)
		}

	case tf.isStruct:
		imports.addType("@bufbuild/protobuf", "JsonObject")
		fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s as JsonObject;\n", in, dst, tf.camel, in)

	case tf.isValue:
		// fromJson builds the google.protobuf.Value wrapper the proto field expects.
		imports.addValue("@bufbuild/protobuf", "fromJson")
		imports.addType("@bufbuild/protobuf", "JsonValue")
		imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema")
		fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = fromJson(ValueSchema, %s as JsonValue);\n", in, dst, tf.camel, in)

	case tf.isTimestamp:
		imports.addValue("./apply-runtime.js", "toTimestamp")
		fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = toTimestamp(%s);\n", in, dst, tf.camel, in)

	case tf.nested != nil:
		switch tf.coll {
		case tsArray:
			fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s.map(%s);\n", in, dst, tf.camel, in, m.tsNestedFn(tf, imports))
		case tsMap:
			fmt.Fprintf(w, "  if (%s !== undefined) {\n", in)
			fmt.Fprintf(w, "    for (const [k, v] of Object.entries(%s)) %s.%s[k] = %s(v);\n", in, dst, tf.camel, m.tsNestedFn(tf, imports))
			fmt.Fprintf(w, "  }\n")
		default:
			fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s(%s);\n", in, dst, tf.camel, m.tsNestedFn(tf, imports), in)
		}

	default: // scalar / scalar collection
		if tf.isInt64 && tf.coll == tsSingular {
			fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = BigInt(%s);\n", in, dst, tf.camel, in)
			return
		}
		if tf.isInt64 && tf.coll == tsArray {
			fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s.map((v) => BigInt(v));\n", in, dst, tf.camel, in)
			return
		}
		fmt.Fprintf(w, "  if (%s !== undefined) %s.%s = %s;\n", in, dst, tf.camel, in)
	}
}

// tsNestedFn returns the toProto function name for a nested/ref leaf, importing
// the ApiResourceReference machinery when the leaf is a reference whose builder
// uses it (the builder is emitted by genTSNestedToProto for ref input types).
func (m *mcpGen) tsNestedFn(tf tsField, imports *tsImportSet) string {
	return tsToProtoFn(tf.nested)
}

// tsLeafValueExpr builds the value expression for a single (oneof) leaf.
func (m *mcpGen) tsLeafValueExpr(tf tsField, in string, imports *tsImportSet) string {
	switch {
	case tf.nested != nil:
		return tsToProtoFn(tf.nested) + "(" + in + ")"
	case tf.isValue:
		imports.addValue("@bufbuild/protobuf", "fromJson")
		imports.addType("@bufbuild/protobuf", "JsonValue")
		imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema")
		return "fromJson(ValueSchema, " + in + " as JsonValue)"
	case tf.isTimestamp:
		imports.addValue("./apply-runtime.js", "toTimestamp")
		return "toTimestamp(" + in + ")"
	case tf.enumType != "":
		from, enumName := tsResolveEnumImportSmart(tf.enumType)
		imports.addValue(from, enumName)
		imports.addValue("./apply-runtime.js", "enumFromString")
		return "enumFromString(" + enumName + ", " + in + ") as " + enumName
	default:
		return in
	}
}

// genTSConfigSwitch emits the workflow task_config discriminated-union switch:
// each kind sets the google.protobuf.Struct task_config from the typed per-kind
// config proto, serialized via toJson (mirrors Go protoToStruct/protojson).
func (m *mcpGen) genTSConfigSwitch(w *bytes.Buffer, it *mcpInputType, dst string, imports *tsImportSet) {
	imports.addValue("@bufbuild/protobuf", "toJson")
	imports.addType("@bufbuild/protobuf", "JsonObject")
	structFieldCamel := tsProtoFieldName(m.expandStruct.structField)

	fmt.Fprintf(w, "  switch (input.kind) {\n")
	for _, f := range it.fields {
		if !f.isExpandedConfig {
			continue
		}
		cfgType := m.findInputType(f.inputTypeName)
		if cfgType == nil {
			continue
		}
		cfgProtoName := protoTypeName(cfgType.protoType)
		cfgSuffix := tsProtoFileToSuffix(cfgType.protoFile)
		cfgBase := deriveTSImportBase(tsProtoPkg(cfgType.protoType))
		imports.addValue(cfgBase+"/"+cfgSuffix, cfgProtoName+"Schema")

		in := "input." + tsMemberAccess(f.protoField)
		fmt.Fprintf(w, "    case %s:\n", strconv.Quote(f.protoField))
		fmt.Fprintf(w, "      if (%s !== undefined) %s.%s = toJson(%sSchema, %s(%s)) as JsonObject;\n",
			in, dst, structFieldCamel, cfgProtoName, tsToProtoFn(cfgType), in)
		fmt.Fprintf(w, "      break;\n")
	}
	fmt.Fprintf(w, "    default:\n")
	fmt.Fprintf(w, "      if (input.kind !== undefined && input.kind !== \"\") {\n")
	fmt.Fprintf(w, "        throw new Error(`unknown task kind: ${input.kind}`);\n")
	fmt.Fprintf(w, "      }\n")
	fmt.Fprintf(w, "  }\n")
}

// tsMemberAccess returns input member access for a snake_case key, using bracket
// notation when the key is not a bare identifier.
func tsMemberAccess(k string) string {
	if tsObjectKey(k) == k {
		return k
	}
	return "[" + strconv.Quote(k) + "]"
}

func lastSegment(fq string) string {
	parts := strings.Split(fq, ".")
	return parts[len(parts)-1]
}

// tsStubsDir is the root of the generated protobuf-es TypeScript stubs, relative
// to the codegen working directory (repo root). Enums are scanned here to find
// their actual _pb file, since the schema model records the enum's type but not
// its source file (e.g. the workflow task enums all live in common_pb, which the
// package-heuristic in tsResolveEnumImport cannot infer).
var tsStubsDir = "apis/stubs/ts"

// tsResolveEnumImportSmart resolves the import path for a proto enum by scanning
// the generated stubs for the `export enum <Name>` declaration. Falls back to
// the package heuristic when the stub cannot be located.
func tsResolveEnumImportSmart(enumFullType string) (importFrom, enumName string) {
	parts := strings.Split(enumFullType, ".")
	enumName = parts[len(parts)-1]
	pkg := strings.Join(parts[:len(parts)-1], ".")
	pkgPath := strings.ReplaceAll(pkg, ".", "/")
	dir := filepath.Join(tsStubsDir, pkgPath)

	if entries, err := os.ReadDir(dir); err == nil {
		needle := "export enum " + enumName
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), "_pb.ts") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				continue
			}
			text := string(data)
			idx := strings.Index(text, needle)
			if idx < 0 {
				continue
			}
			// Confirm a real declaration boundary (next char is space or brace),
			// not a longer enum name that shares this prefix.
			next := idx + len(needle)
			if next < len(text) && (text[next] == ' ' || text[next] == '{' || text[next] == '\n') {
				suffix := strings.TrimSuffix(e.Name(), ".ts")
				return deriveTSImportBase(pkg) + "/" + suffix, enumName
			}
		}
	}
	return tsResolveEnumImport(enumFullType)
}

// --------------------------------------------------------------------
// apply-runtime.ts (shared, generated helpers)
// --------------------------------------------------------------------

func writeApplyRuntime(outputDir string) error {
	const content = `// Code generated by stigmer-codegen --target=mcp-ts. DO NOT EDIT.
//
// Shared runtime helpers for the generated apply-input toProto bridges.

import { timestampFromDate, type Timestamp } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

/**
 * Slugify a resource name: lowercase, collapse each run of non-alphanumeric
 * characters into a single hyphen, then trim leading/trailing hyphens.
 */
export function generateSlug(name: string): string {
  if (!name) return "";
  let out = "";
  let lastHyphen = false;
  for (const ch of name.toLowerCase()) {
    if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) {
      out += ch;
      lastHyphen = false;
    } else if (!lastHyphen) {
      out += "-";
      lastHyphen = true;
    }
  }
  return out.replace(/^-+/, "").replace(/-+$/, "");
}

/** Map the PUBLIC/PRIVATE apply input string to the visibility enum. */
export function visibilityFromString(s: string | undefined): ApiResourceVisibility {
  if (s && s.toUpperCase() === "PUBLIC") return ApiResourceVisibility.visibility_public;
  if (s && s.toUpperCase() === "PRIVATE") return ApiResourceVisibility.visibility_private;
  return ApiResourceVisibility.api_resource_visibility_unspecified;
}

/**
 * Resolve an enum value-name string to its numeric value, leniently: an unknown
 * or missing value yields 0 (the proto UNSPECIFIED sentinel), matching the Go
 * generator's EnumType_value[input] lookup.
 */
export function enumFromString(
  enumObj: Record<string, string | number>,
  value: string | undefined,
): number {
  if (value === undefined) return 0;
  const v = enumObj[value];
  return typeof v === "number" ? v : 0;
}

/** Convert an ISO-8601 string to a protobuf Timestamp message. */
export function toTimestamp(value: string): Timestamp {
  return timestampFromDate(new Date(value));
}
`
	return os.WriteFile(filepath.Join(outputDir, "apply-runtime.ts"), []byte(content), 0644)
}
