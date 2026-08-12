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

	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/protobuf/proto"
)

const mdFence = "```"

// =========================================================================
// Entry point
// =========================================================================

func runSDKDocsGeneration(schemaDir, outputDir, apisDir string) error {
	servicesDir := filepath.Join(schemaDir, "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		return fmt.Errorf("failed to read services directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	prefixMap := buildIdPrefixMap()

	// Load commons schema to determine which types live on the commons page.
	commonsTypes := make(map[string]bool)
	commonsPath := filepath.Join(servicesDir, "commons.json")
	if data, err := os.ReadFile(commonsPath); err == nil {
		var commonsSchema CommonsSchemaFile
		if err := json.Unmarshal(data, &commonsSchema); err == nil {
			for _, mt := range commonsSchema.MessageTypes {
				commonsTypes[mt.Name] = true
			}
			for _, et := range commonsSchema.EnumTypes {
				commonsTypes[et.Name] = true
			}
		}
	}

	var slugs []string

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
		cfg.idPrefix = prefixMap[cfg.protoResType]

		var specSchema *TaskConfigSchema
		var specTypes []*TypeSchema
		if cfg.specSchema != "" {
			specPath := filepath.Join(schemaDir, cfg.specSchema)
			specSchema, specTypes, err = loadSpecSchemaWithTypes(specPath, schemaDir, resource)
			if err != nil {
				fmt.Printf("   Warning: could not load spec schema for %s: %v\n", resource, err)
			}
		}

		page := generateSDKDocPage(&schema, cfg, specSchema, specTypes, apisDir, commonsTypes)
		slug := docSlug(cfg.protoResType)
		outputPath := filepath.Join(outputDir, slug+".mdx")
		if err := os.WriteFile(outputPath, page, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", outputPath, err)
		}
		fmt.Printf("   -> %s.mdx\n", slug)

		slugs = append(slugs, slug)
	}

	// Generate commons page if commons.json exists
	if data, err := os.ReadFile(commonsPath); err == nil {
		var commonsSchema CommonsSchemaFile
		if err := json.Unmarshal(data, &commonsSchema); err != nil {
			return fmt.Errorf("failed to parse commons.json: %w", err)
		}
		page := generateCommonsDocPage(&commonsSchema)
		outputPath := filepath.Join(outputDir, "commons.mdx")
		if err := os.WriteFile(outputPath, page, 0644); err != nil {
			return fmt.Errorf("failed to write commons.mdx: %w", err)
		}
		fmt.Printf("   -> commons.mdx\n")
		slugs = append(slugs, "commons")
	}

	sort.Strings(slugs)

	if err := docWriteMetaJSON(outputDir, slugs); err != nil {
		return fmt.Errorf("failed to generate meta.json: %w", err)
	}
	fmt.Printf("   -> meta.json\n")

	removed, err := docRemoveStalePages(outputDir, slugs)
	if err != nil {
		return fmt.Errorf("failed to remove stale pages: %w", err)
	}
	for _, name := range removed {
		fmt.Printf("   -> removed stale %s\n", name)
	}

	return nil
}

// docRemoveStalePages deletes .mdx files in outputDir that this generation
// run did not produce, returning the deleted file names. The output directory
// is generator-owned in its entirety (DD-01 §7: never hand-edit), so any
// unrecognized page is a leftover from an earlier generator version — e.g.
// platform-client-create-response.mdx, orphaned when a resource-type
// inference bug was fixed but its output was never cleaned up. Stale pages
// are invisible to the freshness check (it only diffs freshly generated
// files) yet ship as live URLs in the static export.
func docRemoveStalePages(outputDir string, slugs []string) ([]string, error) {
	generated := make(map[string]bool, len(slugs))
	for _, slug := range slugs {
		generated[slug+".mdx"] = true
	}

	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read output directory: %w", err)
	}

	var removed []string
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".mdx") || generated[name] {
			continue
		}
		if err := os.Remove(filepath.Join(outputDir, name)); err != nil {
			return nil, fmt.Errorf("failed to remove stale page %s: %w", name, err)
		}
		removed = append(removed, name)
	}
	sort.Strings(removed)
	return removed, nil
}

// generateCommonsDocPage creates the commons.mdx page documenting shared
// types and enums used across all API resources.
func generateCommonsDocPage(schema *CommonsSchemaFile) []byte {
	var buf bytes.Buffer

	buf.WriteString("---\ntitle: Commons\n---\n\n")
	buf.WriteString("{/* Auto-generated by stigmer-codegen. DO NOT EDIT. */}\n\n")
	buf.WriteString("Shared types and enums used across all API resources. Fields on resource\n")
	buf.WriteString("pages that reference these types link here.\n\n")

	// Build documented type set for cross-linking within the commons page
	documentedTypes := make(map[string]bool)
	for i := range schema.MessageTypes {
		documentedTypes[schema.MessageTypes[i].Name] = true
	}
	for i := range schema.EnumTypes {
		documentedTypes[schema.EnumTypes[i].Name] = true
	}

	buf.WriteString("## Types\n\n")

	for i := range schema.MessageTypes {
		mt := &schema.MessageTypes[i]
		fmt.Fprintf(&buf, "### %s\n\n", mt.Name)
		if mt.Description != "" {
			content := docFirstSentence(mt.Description)
			if content != "" {
				buf.WriteString(docEscapeMDX(content))
				buf.WriteString("\n\n")
			}
		}
		if len(mt.Fields) > 0 {
			buf.WriteString("<TypeTable\n  type={{\n")
			for _, field := range mt.Fields {
				docWriteCommonsField(&buf, field, documentedTypes)
			}
			buf.WriteString("  }}\n/>\n\n")
		}
	}

	if len(schema.EnumTypes) > 0 {
		buf.WriteString("## Enums\n\n")
		docWriteEnumTypes(&buf, schema.EnumTypes)
	}

	return buf.Bytes()
}

// docWriteCommonsField emits a single field entry in a commons TypeTable,
// using response-style names (no "Input" suffix) and linking to other
// commons types on the same page.
func docWriteCommonsField(buf *bytes.Buffer, f *FieldSchema, documentedTypes map[string]bool) {
	fieldName := tsProtoFieldName(f.ProtoField)
	fieldType := docResponseTypeString(&f.Type)
	desc := docEscapeJSString(docFirstSentence(f.Description))

	// Try enum link first, then message link
	link := ""
	if enumName := docEnumTypeName(&f.Type); enumName != "" && documentedTypes[enumName] {
		link = "#" + strings.ToLower(enumName)
	} else {
		link = docResponseFieldTypeLink(&f.Type, documentedTypes)
	}

	var props []string
	props = append(props, fmt.Sprintf("type: \"%s\"", fieldType))
	props = append(props, fmt.Sprintf("description: \"%s\"", desc))
	if link != "" {
		props = append(props, fmt.Sprintf("typeDescriptionLink: \"%s\"", link))
	}
	if f.Required {
		props = append(props, "required: true")
	}
	fmt.Fprintf(buf, "    %s: { %s },\n", fieldName, strings.Join(props, ", "))
}

// =========================================================================
// Navigation metadata
// =========================================================================

func docWriteMetaJSON(outputDir string, pages []string) error {
	meta := struct {
		Title string   `json:"title"`
		Pages []string `json:"pages"`
	}{
		Title: "Resources",
		Pages: pages,
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(filepath.Join(outputDir, "meta.json"), data, 0644)
}

// =========================================================================
// Page generation
// =========================================================================

// docLangNames holds the per-language client accessor names used in SDK code
// examples. Each SDK language has its own naming convention for the client
// sub-resource accessor: TS and Go use singular, Python and Java use plural.
type docLangNames struct {
	ts   string // singular camelCase:  "agentExecution"
	go_  string // singular PascalCase: "AgentExecution"
	py   string // plural snake_case:   "agent_executions"
	java string // plural camelCase:    "agentExecutions"
}

func generateSDKDocPage(schema *ServiceSchemaFile, cfg sdkResourceConfig, specSchema *TaskConfigSchema, specTypes []*TypeSchema, apisDir string, commonsTypes map[string]bool) []byte {
	displayName := docDisplayName(cfg.protoResType)
	hasInputType := specSchema != nil
	names := docLangNames{
		ts:   tsClientFieldName(schema.Resource),
		go_:  strings.TrimSuffix(cfg.clientName, "Client"),
		py:   pyClientFieldName(schema.Resource),
		java: javaAccessorName(schema.Resource),
	}

	var buf bytes.Buffer

	// Try loading overview.md from the resource's docs/ directory
	var overviewContent []byte
	if apisDir != "" {
		ovPath := docOverviewFilePath(apisDir, schema.Package)
		if data, err := os.ReadFile(ovPath); err == nil {
			if trimmed := bytes.TrimSpace(data); len(trimmed) > 0 {
				overviewContent = trimmed
			}
		}
	}

	// Frontmatter — omit description when overview.md provides the body text
	// (Fumadocs renders `description` as a subtitle, which would duplicate the overview).
	if overviewContent != nil {
		fmt.Fprintf(&buf, "---\ntitle: %s\n---\n\n", displayName)
	} else {
		desc := "SDK reference for " + displayName + " resources."
		fmt.Fprintf(&buf, "---\ntitle: %s\ndescription: \"%s\"\n---\n\n", displayName, docEscapeJSString(desc))
	}
	buf.WriteString("{/* Auto-generated by stigmer-codegen. DO NOT EDIT. */}\n\n")

	// Overview: prefer overview.md, fall back to proto-based overview
	if overviewContent != nil {
		buf.Write(overviewContent)
		buf.WriteString("\n\n")
	} else if specSchema != nil && specSchema.Description != "" {
		overview := docOverviewSummary(specSchema.Description)
		if overview != "" {
			buf.WriteString(docEscapeMDX(overview))
			buf.WriteString("\n\n")
		}
	}

	// Build the set of type names that will have documented sections on this page.
	// Computed before methods so type references can be rendered as clickable links.
	documentedTypes := docBuildDocumentedTypeSet(cfg, schema, specSchema, specTypes)

	// Add commons types to the documented set with cross-page link resolution.
	// Commons types are always linkable from resource pages.
	for name := range commonsTypes {
		documentedTypes[name] = true
	}

	// Client Access
	docWriteClientAccess(&buf, schema, cfg, names)

	// Methods
	methodTypeMap := make(map[string]*MethodTypeSchema)
	for i := range schema.MethodTypes {
		methodTypeMap[schema.MethodTypes[i].Name] = &schema.MethodTypes[i]
	}
	docWriteMethodsWithCommons(&buf, schema, cfg, names, hasInputType, documentedTypes, specSchema, methodTypeMap, commonsTypes)

	// Types — shared emitted set prevents duplicate sections when a type
	// appears in both spec nested types and method types.
	typeEmitted := make(map[string]bool)
	if specSchema != nil {
		typeMap := make(map[string]*TypeSchema)
		for _, t := range specTypes {
			typeMap[t.Name] = t
		}
		docWriteTypesWithCommons(&buf, cfg, specSchema, typeMap, documentedTypes, typeEmitted, commonsTypes)
	} else {
		buf.WriteString("## Types\n\n")
	}

	if len(schema.MethodTypes) > 0 {
		docWriteMethodTypesWithCommons(&buf, schema.MethodTypes, documentedTypes, typeEmitted, commonsTypes)
	}

	docWriteResourceAndStatusTypesWithCommons(&buf, cfg, schema, documentedTypes, commonsTypes)

	// Only emit resource-specific enums (exclude commons enums that have
	// a dedicated section on the commons page).
	var resourceEnums []EnumSchema
	for _, et := range schema.EnumTypes {
		if !commonsTypes[et.Name] {
			resourceEnums = append(resourceEnums, et)
		}
	}
	docWriteEnumTypes(&buf, resourceEnums)

	return buf.Bytes()
}

// =========================================================================
// Client Access section
// =========================================================================

func docWriteClientAccess(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, names docLangNames) {
	varName := docVarName(cfg.protoResType)
	pyVarName := docPyVarName(cfg.protoResType)
	exampleID := docExampleID(cfg.idPrefix)

	// Find a Get method for the example
	var getMethod *MethodSchema
	for si := range schema.Services {
		for mi := range schema.Services[si].Methods {
			if schema.Services[si].Methods[mi].Name == "Get" {
				getMethod = &schema.Services[si].Methods[mi]
				break
			}
		}
	}
	if getMethod == nil {
		return
	}

	buf.WriteString("## Client Access\n\n")
	buf.WriteString("<SDKTabs>\n")

	docWriteTab(buf, "TypeScript", "typescript",
		fmt.Sprintf("const %s = await stigmer.%s.get(\"%s\");", varName, names.ts, exampleID))
	docWriteTab(buf, "Go", "go",
		fmt.Sprintf("%s, err := client.%s.Get(ctx, \"%s\")", varName, names.go_, exampleID))
	docWriteTab(buf, "Python", "python",
		fmt.Sprintf("%s = client.%s.get(\"%s\")", pyVarName, names.py, exampleID))
	docWriteTab(buf, "Java", "java",
		fmt.Sprintf("%s %s = client.%s().get(\"%s\");", cfg.protoResType, varName, names.java, exampleID))

	buf.WriteString("</SDKTabs>\n\n")
}

// =========================================================================
// Methods section
// =========================================================================

func docWriteMethodsWithCommons(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, names docLangNames, hasInputType bool, documentedTypes map[string]bool, specSchema *TaskConfigSchema, methodTypeMap map[string]*MethodTypeSchema, commonsTypes map[string]bool) {
	methods := docCollectMethods(schema)
	docSortMethods(methods)

	buf.WriteString("## Methods\n\n")
	docWriteMethodOverview(buf, methods)

	for i := range methods {
		docWriteMethodWithCommons(buf, &methods[i], cfg, names, hasInputType, documentedTypes, specSchema, methodTypeMap, commonsTypes)
	}
}

func docWriteMethodWithCommons(buf *bytes.Buffer, m *MethodSchema, cfg sdkResourceConfig, names docLangNames, hasInputType bool, documentedTypes map[string]bool, specSchema *TaskConfigSchema, methodTypeMap map[string]*MethodTypeSchema, commonsTypes map[string]bool) {
	tsName := tsMethodName(m.Name)
	pyName := pascalToSnake(m.Name)
	resultVar := docVarName(m.OutputType)
	inputTypeName := cfg.inputPrefix + "Input"

	emptyInput := isEmptyType(m.InputFullType)
	emptyOutput := isEmptyType(m.OutputFullType)
	idInput := isIDType(m.InputType)
	resourceInput := m.InputType == cfg.protoResType
	deleteInput := m.InputType == "ApiResourceDeleteInput"

	fmt.Fprintf(buf, "### %s\n\n", tsName)

	if m.ServerStreaming {
		buf.WriteString("> **Server Streaming** — This method returns a stream of updates, not a single response.\n\n")
	}

	if m.Description != "" {
		content := docSDKContent(m.Description)
		if content != "" {
			buf.WriteString(docEscapeMDX(content))
			buf.WriteString("\n\n")
		}
	}

	buf.WriteString("<SDKTabs>\n")
	docWriteMethodSigs(buf, m, cfg, names, tsName, pyName, resultVar, inputTypeName, emptyInput, emptyOutput, idInput, resourceInput, deleteInput, hasInputType, specSchema, methodTypeMap)
	buf.WriteString("</SDKTabs>\n\n")

	switch {
	case emptyInput:
	case idInput:
		buf.WriteString("**Parameters**\n\n")
		buf.WriteString("| Parameter | Type | Description |\n")
		buf.WriteString("|-----------|------|-------------|\n")
		fmt.Fprintf(buf, "| `id` | `string` | %s identifier. |\n\n", docDisplayName(cfg.protoResType))
	case resourceInput && hasInputType:
		fmt.Fprintf(buf, "**Parameters**: [`%s`](#%s)\n\n", inputTypeName, strings.ToLower(inputTypeName))
	case deleteInput:
		buf.WriteString("**Parameters**\n\n")
		buf.WriteString("| Parameter | Type | Description |\n")
		buf.WriteString("|-----------|------|-------------|\n")
		buf.WriteString("| `resourceId` | `string` | ID of the resource to delete. |\n")
		buf.WriteString("| `versionMessage` | `string` | Optional deletion reason. |\n")
		buf.WriteString("| `force` | `boolean` | Force delete even if resource is in use. |\n\n")
	default:
		fmt.Fprintf(buf, "**Parameters**: %s\n\n", docTypeRefWithCommons(m.InputType, documentedTypes, commonsTypes))
	}

	if emptyOutput {
		buf.WriteString("**Returns**: `void`\n\n")
	} else if m.ServerStreaming {
		fmt.Fprintf(buf, "**Returns**: Stream&lt;%s&gt;\n\n", docTypeRefWithCommons(m.OutputType, documentedTypes, commonsTypes))
	} else {
		fmt.Fprintf(buf, "**Returns**: %s\n\n", docTypeRefWithCommons(m.OutputType, documentedTypes, commonsTypes))
	}
}

func docWriteMethodSigs(buf *bytes.Buffer, m *MethodSchema, cfg sdkResourceConfig, names docLangNames, tsName, pyName, resultVar, inputTypeName string, emptyInput, emptyOutput, idInput, resourceInput, deleteInput, hasInputType bool, specSchema *TaskConfigSchema, methodTypeMap map[string]*MethodTypeSchema) {
	exampleName := docExampleResourceName(cfg.protoResType)
	pyResultVar := docPyVarName(m.OutputType)

	if m.ServerStreaming {
		docWriteStreamingSigs(buf, m, names, tsName, pyName, idInput)
		return
	}

	switch {
	case emptyInput && emptyOutput:
		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("await stigmer.%s.%s();", names.ts, tsName))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("err := client.%s.%s(ctx)", names.go_, m.Name))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("client.%s.%s()", names.py, pyName))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("client.%s().%s();", names.java, tsName))

	case emptyInput:
		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("const %s = await stigmer.%s.%s();", resultVar, names.ts, tsName))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("%s, err := client.%s.%s(ctx)", resultVar, names.go_, m.Name))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("%s = client.%s.%s()", pyResultVar, names.py, pyName))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("%s %s = client.%s().%s();", m.OutputType, resultVar, names.java, tsName))

	case idInput && emptyOutput:
		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("await stigmer.%s.%s(id);", names.ts, tsName))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("err := client.%s.%s(ctx, id)", names.go_, m.Name))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("client.%s.%s(id)", names.py, pyName))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("client.%s().%s(id);", names.java, tsName))

	case idInput:
		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("const %s = await stigmer.%s.%s(id);", resultVar, names.ts, tsName))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("%s, err := client.%s.%s(ctx, id)", resultVar, names.go_, m.Name))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("%s = client.%s.%s(id)", pyResultVar, names.py, pyName))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("%s %s = client.%s().%s(id);", m.OutputType, resultVar, names.java, tsName))

	case resourceInput && hasInputType:
		goFields := docInputFields(specSchema, "go", exampleName)
		tsFields := docInputFields(specSchema, "typescript", exampleName)
		pyFields := docInputFields(specSchema, "python", exampleName)
		javaFields := docInputFields(specSchema, "java", exampleName)

		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("const %s = await stigmer.%s.%s({\n%s\n});", resultVar, names.ts, tsName, docFormatInputTS(tsFields)))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("%s, err := client.%s.%s(ctx, &stigmer.%s{\n%s\n})", resultVar, names.go_, m.Name, inputTypeName, docFormatInputGo(goFields)))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("%s = client.%s.%s(%s(\n%s\n))", pyResultVar, names.py, pyName, inputTypeName, docFormatInputPython(pyFields)))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("%s %s = client.%s().%s(%s.builder()\n%s\n    .build());", cfg.protoResType, resultVar, names.java, tsName, inputTypeName, docFormatInputJava(javaFields)))

	case deleteInput:
		docWriteTab(buf, "TypeScript", "typescript",
			fmt.Sprintf("const %s = await stigmer.%s.%s({ resourceId: id });", resultVar, names.ts, tsName))
		docWriteTab(buf, "Go", "go",
			fmt.Sprintf("%s, err := client.%s.%s(ctx, &stigmer.DeleteResourceInput{\n  ResourceID: id,\n})", resultVar, names.go_, m.Name))
		docWriteTab(buf, "Python", "python",
			fmt.Sprintf("%s = client.%s.%s(DeleteResourceInput(resource_id=id))", pyResultVar, names.py, pyName))
		docWriteTab(buf, "Java", "java",
			fmt.Sprintf("%s %s = client.%s().%s(DeleteResourceInput.builder()\n    .resourceId(id)\n    .build());", m.OutputType, resultVar, names.java, tsName))

	default:
		if mt, ok := methodTypeMap[m.InputType]; ok && len(mt.Fields) > 0 {
			goFields := docMethodTypeFields(mt, "go")
			tsFields := docMethodTypeFields(mt, "typescript")
			pyFields := docMethodTypeFields(mt, "python")
			javaFields := docMethodTypeFields(mt, "java")
			mtName := m.InputType

			docWriteTab(buf, "TypeScript", "typescript",
				fmt.Sprintf("const %s = await stigmer.%s.%s({\n%s\n});", resultVar, names.ts, tsName, docFormatInputTS(tsFields)))
			docWriteTab(buf, "Go", "go",
				fmt.Sprintf("%s, err := client.%s.%s(ctx, &stigmer.%s{\n%s\n})", resultVar, names.go_, m.Name, mtName, docFormatInputGo(goFields)))
			docWriteTab(buf, "Python", "python",
				fmt.Sprintf("%s = client.%s.%s(%s(\n%s\n))", pyResultVar, names.py, pyName, mtName, docFormatInputPython(pyFields)))
			docWriteTab(buf, "Java", "java",
				fmt.Sprintf("%s %s = client.%s().%s(%s.builder()\n%s\n    .build());", m.OutputType, resultVar, names.java, tsName, mtName, docFormatInputJava(javaFields)))
		} else {
			docWriteTab(buf, "TypeScript", "typescript",
				fmt.Sprintf("const %s = await stigmer.%s.%s(input);", resultVar, names.ts, tsName))
			docWriteTab(buf, "Go", "go",
				fmt.Sprintf("%s, err := client.%s.%s(ctx, input)", resultVar, names.go_, m.Name))
			docWriteTab(buf, "Python", "python",
				fmt.Sprintf("%s = client.%s.%s(input)", pyResultVar, names.py, pyName))
			docWriteTab(buf, "Java", "java",
				fmt.Sprintf("%s %s = client.%s().%s(input);", m.OutputType, resultVar, names.java, tsName))
		}
	}
}

// =========================================================================
// Input field expansion for code examples
// =========================================================================

type docFieldEntry struct {
	name  string
	value string
}

func docInputFields(specSchema *TaskConfigSchema, lang, exampleName string) []docFieldEntry {
	var fields []docFieldEntry

	fields = append(fields,
		docFieldEntry{docFieldName("name", lang), docQuote(exampleName, lang)},
		docFieldEntry{docFieldName("org", lang), docQuote("acme", lang)},
		docFieldEntry{docFieldName("slug", lang), docQuote("...", lang)},
		docFieldEntry{docFieldName("labels", lang), docEmptyMap(lang)},
	)

	if specSchema == nil {
		return fields
	}

	for _, f := range specSchema.Fields {
		if metaFieldNames[f.Name] {
			continue
		}
		fname := docFieldName(f.ProtoField, lang)
		fields = append(fields, docFieldEntry{fname, docPlaceholder(&f.Type, lang)})
	}
	return fields
}

func docFieldName(protoField, lang string) string {
	switch lang {
	case "go":
		parts := strings.Split(protoField, "_")
		for i := range parts {
			if len(parts[i]) > 0 {
				parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
			}
		}
		return strings.Join(parts, "")
	case "python":
		// Route through the client generator's naming so docs never show an
		// identifier the generated SDK doesn't have (keyword escaping).
		return pyFieldName(protoField)
	case "java":
		return javaCamel(protoField)
	default:
		return tsProtoFieldName(protoField)
	}
}

func docQuote(val, _ string) string {
	return `"` + val + `"`
}

func docEmptyMap(lang string) string {
	switch lang {
	case "go":
		return "map[string]string{}"
	case "python":
		return "{}"
	case "java":
		return "Map.of()"
	default:
		return "{}"
	}
}

func docPlaceholder(ts *TypeSpec, lang string) string {
	switch ts.Kind {
	case "string":
		return docQuote("...", lang)
	case "bool":
		if lang == "python" {
			return "False"
		}
		return "false"
	case "int32", "uint32", "int64", "float", "double":
		return "0"
	case "array":
		switch lang {
		case "go":
			if ts.ElementType != nil && ts.ElementType.Kind == "message" && ts.ElementType.MessageType != "" {
				return "[]stigmer." + docGoInputTypeName(ts.ElementType.MessageType) + "{}"
			}
			return "[]string{}"
		case "java":
			return "List.of()"
		default:
			return "[]"
		}
	case "map":
		return docEmptyMap(lang)
	case "message", "struct":
		switch lang {
		case "go":
			if ts.MessageType != "" {
				return "&stigmer." + docGoInputTypeName(ts.MessageType) + "{}"
			}
			return "nil"
		case "python":
			return "None"
		case "java":
			return "null"
		default:
			return "{}"
		}
	default:
		return docQuote("...", lang)
	}
}

func docMethodTypeFields(mt *MethodTypeSchema, lang string) []docFieldEntry {
	var fields []docFieldEntry
	for _, f := range mt.Fields {
		fname := docFieldName(f.ProtoField, lang)
		fields = append(fields, docFieldEntry{fname, docPlaceholder(&f.Type, lang)})
	}
	return fields
}

func docGoInputTypeName(messageType string) string {
	switch messageType {
	case "EnvironmentSpec":
		return "EnvSpecInput"
	case "EnvironmentValue", "ExecutionValue":
		return "EnvVarInput"
	case "ApiResourceReference":
		return "ResourceRef"
	default:
		return messageType + "Input"
	}
}

func docFormatInputGo(fields []docFieldEntry) string {
	maxLen := 0
	for _, f := range fields {
		if len(f.name) > maxLen {
			maxLen = len(f.name)
		}
	}
	var lines []string
	for _, f := range fields {
		padding := strings.Repeat(" ", maxLen-len(f.name))
		lines = append(lines, fmt.Sprintf("  %s:%s %s,", f.name, padding, f.value))
	}
	return strings.Join(lines, "\n")
}

func docFormatInputTS(fields []docFieldEntry) string {
	var lines []string
	for _, f := range fields {
		lines = append(lines, fmt.Sprintf("  %s: %s,", f.name, f.value))
	}
	return strings.Join(lines, "\n")
}

func docFormatInputPython(fields []docFieldEntry) string {
	var lines []string
	for _, f := range fields {
		lines = append(lines, fmt.Sprintf("    %s=%s,", f.name, f.value))
	}
	return strings.Join(lines, "\n")
}

func docFormatInputJava(fields []docFieldEntry) string {
	var lines []string
	for _, f := range fields {
		lines = append(lines, fmt.Sprintf("    .%s(%s)", f.name, f.value))
	}
	return strings.Join(lines, "\n")
}

// =========================================================================
// Method collection, ordering, and overview table
// =========================================================================

// docCollectMethods gathers all methods from all services into a flat slice.
func docCollectMethods(schema *ServiceSchemaFile) []MethodSchema {
	var methods []MethodSchema
	for si := range schema.Services {
		for mi := range schema.Services[si].Methods {
			m := schema.Services[si].Methods[mi]
			// Search-list kinds don't expose the typed query-controller List
			// on the SDK client, so it isn't documented either.
			if searchListSupersedesMethod(schema, &m) {
				continue
			}
			methods = append(methods, m)
		}
	}
	return methods
}

// docSortMethods reorders methods by category: queries first, then mutations,
// lifecycle operations, and utilities last.
func docSortMethods(methods []MethodSchema) {
	sort.SliceStable(methods, func(i, j int) bool {
		ki := docMethodSortKey(methods[i].Name)
		kj := docMethodSortKey(methods[j].Name)
		if ki != kj {
			return ki < kj
		}
		return methods[i].Name < methods[j].Name
	})
}

func docMethodSortKey(name string) int {
	lower := strings.ToLower(name)
	switch {
	case lower == "get":
		return 100
	case strings.HasPrefix(lower, "get"):
		return 110
	case lower == "list":
		return 200
	case strings.HasPrefix(lower, "list"):
		return 210
	case lower == "subscribe":
		return 300
	case strings.HasPrefix(lower, "find"):
		return 350
	case lower == "apply":
		return 400
	case lower == "create":
		return 500
	case lower == "update":
		return 600
	case strings.HasPrefix(lower, "update"):
		return 610
	case lower == "delete":
		return 700
	case lower == "pause":
		return 810
	case lower == "resume":
		return 820
	case lower == "cancel":
		return 830
	case lower == "terminate":
		return 840
	case lower == "recover":
		return 850
	case strings.HasPrefix(lower, "submit"):
		return 860
	default:
		return 900
	}
}

// docWriteMethodOverview emits a summary table of all methods at the top
// of the Methods section, giving readers a scannable at-a-glance reference.
func docWriteMethodOverview(buf *bytes.Buffer, methods []MethodSchema) {
	hasStreaming := false
	for i := range methods {
		if methods[i].ServerStreaming {
			hasStreaming = true
			break
		}
	}

	buf.WriteString("| Method | Description |")
	if hasStreaming {
		buf.WriteString(" Streaming |")
	}
	buf.WriteString("\n")

	buf.WriteString("|--------|-------------|")
	if hasStreaming {
		buf.WriteString("-----------|")
	}
	buf.WriteString("\n")

	for i := range methods {
		tsName := tsMethodName(methods[i].Name)
		anchor := strings.ToLower(tsName)
		desc := docFirstSentence(methods[i].Description)
		desc = strings.ReplaceAll(desc, "|", "\\|")

		fmt.Fprintf(buf, "| [`%s`](#%s) | %s |", tsName, anchor, desc)
		if hasStreaming {
			if methods[i].ServerStreaming {
				buf.WriteString(" Server |")
			} else {
				buf.WriteString(" |")
			}
		}
		buf.WriteString("\n")
	}
	buf.WriteString("\n")
}

// =========================================================================
// Types section
// =========================================================================

func docWriteTypesWithCommons(buf *bytes.Buffer, cfg sdkResourceConfig, specSchema *TaskConfigSchema, typeMap map[string]*TypeSchema, documentedTypes map[string]bool, emitted map[string]bool, commonsTypes map[string]bool) {
	buf.WriteString("## Types\n\n")

	inputName := cfg.inputPrefix + "Input"
	displayName := docDisplayName(cfg.protoResType)
	fmt.Fprintf(buf, "### %s\n\n", inputName)
	fmt.Fprintf(buf, "Input for creating or updating %s %s.\n\n", docArticle(displayName), displayName)

	var specFields []*FieldSchema
	for _, f := range specSchema.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	buf.WriteString("<TypeTable\n  type={{\n")
	buf.WriteString("    name: { type: \"string\", description: \"Resource name.\", required: true },\n")
	buf.WriteString("    slug: { type: \"string\", description: \"URL-friendly identifier.\" },\n")
	buf.WriteString("    org: { type: \"string\", description: \"Organization slug.\", required: true },\n")
	buf.WriteString("    labels: { type: \"Record<string, string>\", description: \"Key-value labels.\" },\n")
	for _, f := range specFields {
		docWriteTypeFieldWithCommons(buf, f, documentedTypes, commonsTypes)
	}
	buf.WriteString("  }}\n/>\n\n")

	for _, f := range specFields {
		docWriteNestedTypeWithCommons(buf, f, typeMap, emitted, documentedTypes, commonsTypes)
	}
}

func docWriteTypeFieldWithCommons(buf *bytes.Buffer, f *FieldSchema, documentedTypes map[string]bool, commonsTypes map[string]bool) {
	fieldName := tsProtoFieldName(f.ProtoField)
	fieldType := docTypeString(&f.Type)
	desc := docEscapeJSString(docFirstSentence(f.Description))
	link := docFieldTypeLinkWithCommons(&f.Type, documentedTypes, commonsTypes)

	var props []string
	props = append(props, fmt.Sprintf("type: \"%s\"", fieldType))
	props = append(props, fmt.Sprintf("description: \"%s\"", desc))
	if link != "" {
		props = append(props, fmt.Sprintf("typeDescriptionLink: \"%s\"", link))
	}
	if f.Required {
		props = append(props, "required: true")
	}
	fmt.Fprintf(buf, "    %s: { %s },\n", fieldName, strings.Join(props, ", "))
}

func docWriteNestedTypeWithCommons(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, documentedTypes map[string]bool, commonsTypes map[string]bool) {
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

	inputName := docInputDisplayName(msgName)
	if emitted[inputName] {
		return
	}
	ts, ok := typeMap[msgName]
	if !ok {
		return
	}
	emitted[inputName] = true

	fmt.Fprintf(buf, "### %s\n\n", inputName)

	if ts.Description != "" {
		buf.WriteString(docEscapeMDX(docFirstSentence(ts.Description)))
		buf.WriteString("\n\n")
	}

	if len(ts.Fields) > 0 {
		buf.WriteString("<TypeTable\n  type={{\n")
		for _, field := range ts.Fields {
			docWriteTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes)
		}
		buf.WriteString("  }}\n/>\n\n")
	}

	for _, field := range ts.Fields {
		docWriteNestedTypeWithCommons(buf, field, typeMap, emitted, documentedTypes, commonsTypes)
	}
}

// =========================================================================
// Method types section (proto parameter/return types)
// =========================================================================

// docBuildDocumentedTypeSet returns the set of type names that will have
// a documented ### section on the page. This includes the resource type,
// its status sub-type, SDK input types (from spec schemas), and proto
// method types (from service schemas).
func docBuildDocumentedTypeSet(cfg sdkResourceConfig, schema *ServiceSchemaFile, specSchema *TaskConfigSchema, specTypes []*TypeSchema) map[string]bool {
	set := make(map[string]bool)

	set[cfg.protoResType] = true
	if schema.StatusType != nil {
		set[schema.StatusType.Name] = true
	}

	if specSchema != nil {
		inputName := cfg.inputPrefix + "Input"
		set[inputName] = true

		var specFields []*FieldSchema
		for _, f := range specSchema.Fields {
			if !metaFieldNames[f.Name] {
				specFields = append(specFields, f)
			}
		}

		typeMap := make(map[string]*TypeSchema)
		for _, t := range specTypes {
			typeMap[t.Name] = t
		}

		for _, f := range specFields {
			docCollectNestedTypeNames(f, typeMap, set)
		}
	}

	for i := range schema.MethodTypes {
		name := schema.MethodTypes[i].Name
		if isSpecialType(name) {
			set[docInputDisplayName(name)] = true
		} else {
			set[name] = true
		}
	}

	for i := range schema.StatusNestedTypes {
		set[schema.StatusNestedTypes[i].Name] = true
	}

	for i := range schema.EnumTypes {
		set[schema.EnumTypes[i].Name] = true
	}

	return set
}

// docCollectNestedTypeNames recursively collects the display names of
// nested spec types that will be rendered (matching docWriteNestedTypeWithCommons logic).
func docCollectNestedTypeNames(f *FieldSchema, typeMap map[string]*TypeSchema, set map[string]bool) {
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

	inputName := docInputDisplayName(msgName)
	if set[inputName] {
		return
	}
	ts, ok := typeMap[msgName]
	if !ok {
		return
	}
	set[inputName] = true

	for _, field := range ts.Fields {
		docCollectNestedTypeNames(field, typeMap, set)
	}
}

// docWriteMethodTypes renders TypeTable sections for proto types used as
// method parameters or return values that aren't covered by spec-based types.
// The emitted set tracks type headings already rendered by the spec types
// section, preventing duplicates when a type appears in both contexts.
func docWriteMethodTypesWithCommons(buf *bytes.Buffer, methodTypes []MethodTypeSchema, documentedTypes map[string]bool, emitted map[string]bool, commonsTypes map[string]bool) {
	for i := range methodTypes {
		mt := &methodTypes[i]

		if commonsTypes[mt.Name] {
			continue
		}

		heading := mt.Name
		if isSpecialType(mt.Name) {
			heading = docInputDisplayName(mt.Name)
		}
		if emitted[heading] {
			continue
		}
		emitted[heading] = true

		fmt.Fprintf(buf, "### %s\n\n", heading)

		if mt.Description != "" {
			content := docFirstSentence(mt.Description)
			if content != "" {
				buf.WriteString(docEscapeMDX(content))
				buf.WriteString("\n\n")
			}
		}

		if len(mt.Fields) > 0 {
			buf.WriteString("<TypeTable\n  type={{\n")
			for _, field := range mt.Fields {
				docWriteTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes)
			}
			buf.WriteString("  }}\n/>\n\n")
		}
	}
}

// docTypeRef renders a type name as a clickable markdown link if the type
// has a documented section on the page, or as plain backtick code otherwise.
// Special types are mapped to their SDK display names (e.g.,
// ApiResourceReference -> ResourceRef) before lookup.
func docTypeRefWithCommons(typeName string, documentedTypes map[string]bool, commonsTypes map[string]bool) string {
	if commonsTypes[typeName] {
		anchor := strings.ToLower(typeName)
		return fmt.Sprintf("[`%s`](/docs/sdk/resources/commons#%s)", typeName, anchor)
	}
	return docTypeRef(typeName, documentedTypes)
}

func docTypeRef(typeName string, documentedTypes map[string]bool) string {
	if documentedTypes[typeName] {
		anchor := strings.ToLower(typeName)
		return fmt.Sprintf("[`%s`](#%s)", typeName, anchor)
	}
	if isSpecialType(typeName) {
		mapped := docInputDisplayName(typeName)
		if documentedTypes[mapped] {
			anchor := strings.ToLower(mapped)
			return fmt.Sprintf("[`%s`](#%s)", mapped, anchor)
		}
	}
	return fmt.Sprintf("`%s`", typeName)
}

// =========================================================================
// Resource and status type sections (response types)
// =========================================================================

// docResponseTypeString converts a TypeSpec into a human-readable type string
// for response types. Unlike docTypeString, message types use their raw proto
// name (e.g., "ApiResourceAudit") instead of appending "Input".
func docResponseTypeString(ts *TypeSpec) string {
	switch ts.Kind {
	case "array":
		if ts.ElementType != nil {
			return docResponseTypeString(ts.ElementType) + "[]"
		}
		return "string[]"
	case "map":
		key := "string"
		val := "string"
		if ts.KeyType != nil {
			key = docResponseTypeString(ts.KeyType)
		}
		if ts.ValueType != nil {
			val = docResponseTypeString(ts.ValueType)
		}
		return fmt.Sprintf("Record<%s, %s>", key, val)
	case "message":
		return ts.MessageType
	default:
		return docTypeString(ts)
	}
}

// docWriteResponseTypeFieldWithCommons emits a single field entry inside a
// <TypeTable> using response-oriented type names (no "Input" suffix for
// messages). Commons types are linked to the commons page.
func docWriteResponseTypeFieldWithCommons(buf *bytes.Buffer, f *FieldSchema, documentedTypes map[string]bool, commonsTypes map[string]bool) {
	fieldName := tsProtoFieldName(f.ProtoField)
	fieldType := docResponseTypeString(&f.Type)
	desc := docEscapeJSString(docFirstSentence(f.Description))
	link := docResponseFieldTypeLinkWithCommons(&f.Type, documentedTypes, commonsTypes)

	var props []string
	props = append(props, fmt.Sprintf("type: \"%s\"", fieldType))
	props = append(props, fmt.Sprintf("description: \"%s\"", desc))
	if link != "" {
		props = append(props, fmt.Sprintf("typeDescriptionLink: \"%s\"", link))
	}
	if f.Required {
		props = append(props, "required: true")
	}
	fmt.Fprintf(buf, "    %s: { %s },\n", fieldName, strings.Join(props, ", "))
}

// docWriteResourceAndStatusTypesWithCommons renders the resource type and its
// status sub-type with cross-page links for commons types.
func docWriteResourceAndStatusTypesWithCommons(buf *bytes.Buffer, cfg sdkResourceConfig, schema *ServiceSchemaFile, documentedTypes map[string]bool, commonsTypes map[string]bool) {
	inputTypeName := cfg.inputPrefix + "Input"
	statusTypeName := cfg.protoResType + "Status"

	fmt.Fprintf(buf, "### %s\n\n", cfg.protoResType)
	if schema.ResourceDescription != "" {
		content := docFirstSentence(schema.ResourceDescription)
		if content != "" {
			buf.WriteString(docEscapeMDX(content))
			buf.WriteString("\n\n")
		}
	}

	specRef := docTypeRef(inputTypeName, documentedTypes)
	statusRef := docTypeRef(statusTypeName, documentedTypes)

	specLink := ""
	if documentedTypes[inputTypeName] {
		specLink = fmt.Sprintf(", typeDescriptionLink: \"#%s\"", strings.ToLower(inputTypeName))
	}
	statusLink := ""
	if documentedTypes[statusTypeName] {
		statusLink = fmt.Sprintf(", typeDescriptionLink: \"#%s\"", strings.ToLower(statusTypeName))
	}

	metadataLink := ""
	if commonsTypes["ApiResourceMetadata"] {
		metadataLink = ", typeDescriptionLink: \"/docs/sdk/resources/commons#apiresourcemetadata\""
	}

	buf.WriteString("<TypeTable\n  type={{\n")
	fmt.Fprintf(buf, "    apiVersion: { type: \"string\", description: \"API version for this resource type.\" },\n")
	fmt.Fprintf(buf, "    kind: { type: \"string\", description: \"Resource kind identifier.\" },\n")
	fmt.Fprintf(buf, "    metadata: { type: \"ApiResourceMetadata\", description: \"Resource metadata including id, name, org, slug, labels, visibility, and timestamps.\"%s },\n", metadataLink)
	fmt.Fprintf(buf, "    spec: { type: \"%s\", description: \"Resource specification. See %s.\"%s },\n", inputTypeName, specRef, specLink)
	fmt.Fprintf(buf, "    status: { type: \"%s\", description: \"System-managed state. See %s.\"%s },\n", statusTypeName, statusRef, statusLink)
	buf.WriteString("  }}\n/>\n\n")

	if schema.StatusType != nil {
		fmt.Fprintf(buf, "### %s\n\n", schema.StatusType.Name)
		if schema.StatusType.Description != "" {
			content := docFirstSentence(schema.StatusType.Description)
			if content != "" {
				buf.WriteString(docEscapeMDX(content))
				buf.WriteString("\n\n")
			}
		}
		if len(schema.StatusType.Fields) > 0 {
			buf.WriteString("<TypeTable\n  type={{\n")
			for _, field := range schema.StatusType.Fields {
				docWriteResponseTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes)
			}
			buf.WriteString("  }}\n/>\n\n")
		}
	}

	docWriteStatusNestedTypesWithCommons(buf, schema.StatusNestedTypes, documentedTypes, commonsTypes)
}

// docWriteStatusNestedTypesWithCommons renders TypeTable sections for types
// nested inside the status type, skipping types that live on the commons page.
func docWriteStatusNestedTypesWithCommons(buf *bytes.Buffer, types []MethodTypeSchema, documentedTypes map[string]bool, commonsTypes map[string]bool) {
	emitted := make(map[string]bool)
	for i := range types {
		nt := &types[i]
		if emitted[nt.Name] || commonsTypes[nt.Name] {
			continue
		}
		emitted[nt.Name] = true

		fmt.Fprintf(buf, "### %s\n\n", nt.Name)
		if nt.Description != "" {
			content := docFirstSentence(nt.Description)
			if content != "" {
				buf.WriteString(docEscapeMDX(content))
				buf.WriteString("\n\n")
			}
		}
		if len(nt.Fields) > 0 {
			buf.WriteString("<TypeTable\n  type={{\n")
			for _, field := range nt.Fields {
				docWriteResponseTypeFieldWithCommons(buf, field, documentedTypes, commonsTypes)
			}
			buf.WriteString("  }}\n/>\n\n")
		}
	}
}

// =========================================================================
// Enum types section
// =========================================================================

// docWriteEnumTypes renders documented sections for enum types referenced
// by fields on this page. Each enum gets a ### heading, description, and
// a markdown table of valid values with their descriptions.
func docWriteEnumTypes(buf *bytes.Buffer, enumTypes []EnumSchema) {
	if len(enumTypes) == 0 {
		return
	}

	for i := range enumTypes {
		et := &enumTypes[i]
		fmt.Fprintf(buf, "### %s\n\n", et.Name)

		if et.Description != "" {
			content := docFirstSentence(et.Description)
			if content != "" {
				buf.WriteString(docEscapeMDX(content))
				buf.WriteString("\n\n")
			}
		}

		if len(et.Values) > 0 {
			buf.WriteString("| Value | Description |\n")
			buf.WriteString("|-------|-------------|\n")
			for _, v := range et.Values {
				desc := docEnumValueDescription(v.Description)
				desc = strings.ReplaceAll(desc, "|", "\\|")
				fmt.Fprintf(buf, "| `%s` | %s |\n", v.Name, desc)
			}
			buf.WriteString("\n")
		}
	}
}

// docEnumValueDescription extracts a concise description from an enum value's
// proto comment. Uses the first sentence of the leading comment, or the inline
// comment if no block comment exists. Falls back to empty string.
func docEnumValueDescription(desc string) string {
	if desc == "" {
		return ""
	}
	desc = docStripSince(desc)
	desc = strings.TrimSpace(desc)
	if desc == "" {
		return ""
	}
	return docFirstSentence(docCleanDesc(desc))
}

// =========================================================================
// Tab helper
// =========================================================================

func docWriteTab(buf *bytes.Buffer, lang, syntax, code string) {
	fmt.Fprintf(buf, "<Tab value=\"%s\">\n%s%s\n%s\n%s\n</Tab>\n", lang, mdFence, syntax, code, mdFence)
}

// docWriteStreamingSigs emits SDK code examples for server-streaming methods,
// showing the language-idiomatic iteration pattern in each SDK.
func docWriteStreamingSigs(buf *bytes.Buffer, m *MethodSchema, names docLangNames, tsName, pyName string, idInput bool) {
	eventVar := "event"
	pyEventVar := "event"
	if m.OutputType != "" {
		eventVar = strings.ToLower(m.OutputType[:1]) + m.OutputType[1:]
		pyEventVar = pascalToSnake(m.OutputType)
	}

	param := "input"
	if idInput {
		param = "id"
	}

	docWriteTab(buf, "TypeScript", "typescript", fmt.Sprintf(
		"const stream = stigmer.%s.%s(%s);\nfor await (const %s of stream) {\n  // process %s\n}",
		names.ts, tsName, param, eventVar, eventVar))

	docWriteTab(buf, "Go", "go", fmt.Sprintf(
		"stream, err := client.%s.%s(ctx, %s)\nfor {\n    %s, err := stream.Recv()\n    if err != nil {\n        break\n    }\n    // process %s\n}",
		names.go_, m.Name, param, eventVar, eventVar))

	docWriteTab(buf, "Python", "python", fmt.Sprintf(
		"for %s in client.%s.%s(%s):\n    # process %s",
		pyEventVar, names.py, pyName, param, pyEventVar))

	docWriteTab(buf, "Java", "java", fmt.Sprintf(
		"client.%s().%s(%s, %s -> {\n    // process %s\n});",
		names.java, tsName, param, eventVar, eventVar))
}

// =========================================================================
// Overview file resolution
// =========================================================================

// buildIdPrefixMap extracts the name → id_prefix mapping from the compiled
// ApiResourceKind enum options, so example IDs in SDK docs match the real
// ID format (e.g., "agt_01j5q3k7m8...").
func buildIdPrefixMap() map[string]string {
	result := make(map[string]string)
	enumDesc := apiresourcekind.ApiResourceKind(0).Descriptor()
	values := enumDesc.Values()
	for i := 0; i < values.Len(); i++ {
		val := values.Get(i)
		opts := val.Options()
		if opts == nil {
			continue
		}
		if !proto.HasExtension(opts, apiresourcekind.E_KindMeta) {
			continue
		}
		meta, ok := proto.GetExtension(opts, apiresourcekind.E_KindMeta).(*apiresourcekind.ApiResourceKindMeta)
		if !ok || meta == nil {
			continue
		}
		if name := meta.GetName(); name != "" {
			result[name] = meta.GetIdPrefix()
		}
	}
	return result
}

// docOverviewFilePath derives the path to a resource's overview.md from the
// proto package name. For example, package "ai.stigmer.agentic.agent.v1"
// maps to "<apisDir>/ai/stigmer/agentic/agent/docs/overview.md".
func docOverviewFilePath(apisDir, pkg string) string {
	parts := strings.Split(pkg, ".")
	if len(parts) < 2 {
		return ""
	}
	// Strip version suffix (e.g., "v1") to get the resource directory
	resourceParts := parts[:len(parts)-1]
	return filepath.Join(apisDir, filepath.Join(resourceParts...), "docs", "overview.md")
}

// =========================================================================
// Display name helpers
// =========================================================================

// docDisplayName converts a PascalCase proto type name to a human-readable
// display name with spaces and proper acronym handling.
func docDisplayName(protoResType string) string {
	var result []rune
	for i, r := range protoResType {
		if i > 0 && unicode.IsUpper(r) {
			result = append(result, ' ')
		}
		result = append(result, r)
	}
	name := string(result)
	name = strings.ReplaceAll(name, "O Auth", "OAuth")
	name = strings.ReplaceAll(name, "Mcp ", "MCP ")
	name = strings.ReplaceAll(name, "Api ", "API ")
	name = strings.ReplaceAll(name, "Iam ", "IAM ")
	return name
}

// docSlug converts a PascalCase proto type name to a URL-safe hyphenated slug.
func docSlug(protoResType string) string {
	return strings.ToLower(strings.ReplaceAll(docDisplayName(protoResType), " ", "-"))
}

// docVarName derives a short variable name from a type name for code examples.
// The result is lowerCamelCase, suitable for Go, TypeScript, and Java.
func docVarName(typeName string) string {
	if typeName == "" || strings.HasSuffix(typeName, "List") {
		return "result"
	}
	return strings.ToLower(typeName[:1]) + typeName[1:]
}

// docPyVarName derives a snake_case variable name for Python code examples.
func docPyVarName(typeName string) string {
	if typeName == "" || strings.HasSuffix(typeName, "List") {
		return "result"
	}
	return pascalToSnake(typeName)
}

// docExampleID generates a realistic resource ID using the id_prefix from
// ApiResourceKind and a fixed ULID-format suffix.
func docExampleID(idPrefix string) string {
	const exampleULID = "01j5q3k7m8r2s4tnz2hfp0q0c3"
	if idPrefix == "" {
		return "id_" + exampleULID
	}
	return idPrefix + "_" + exampleULID
}

// docExampleResourceName generates a human-readable resource name for
// create/update code examples.
func docExampleResourceName(protoResType string) string {
	return "my-" + docSlug(protoResType)
}

// docArticle returns the correct indefinite article ("a" or "an") for a
// display name based on whether it starts with a vowel sound.
func docArticle(name string) string {
	if len(name) == 0 {
		return "a"
	}
	switch unicode.ToLower(rune(name[0])) {
	case 'a', 'e', 'i', 'o', 'u':
		return "an"
	default:
		return "a"
	}
}

// =========================================================================
// Description helpers
// =========================================================================

// docCleanDesc normalizes a multi-line proto description for markdown output.
// Continuation lines (newline + leading whitespace) are joined into sentences;
// paragraph breaks (double newline) are preserved.
func docCleanDesc(desc string) string {
	desc = strings.TrimSpace(desc)
	paragraphs := strings.Split(desc, "\n\n")
	for i, p := range paragraphs {
		lines := strings.Split(strings.TrimSpace(p), "\n")
		for j := range lines {
			lines[j] = strings.TrimSpace(lines[j])
		}
		paragraphs[i] = strings.Join(lines, " ")
	}
	return strings.Join(paragraphs, "\n\n")
}

// docEscapeMDX escapes characters that have special meaning in MDX body text.
// Curly braces are JSX expression delimiters; angle brackets start JSX tags.
func docEscapeMDX(s string) string {
	s = strings.ReplaceAll(s, "{", "\\{")
	s = strings.ReplaceAll(s, "}", "\\}")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

// docFirstSentence extracts the first sentence from a description string.
// Returns the empty string for an empty input.
func docFirstSentence(desc string) string {
	if desc == "" {
		return ""
	}
	desc = docCleanDesc(desc)
	if idx := strings.Index(desc, "\n\n"); idx >= 0 {
		desc = desc[:idx]
	}
	idx := docSentenceEnd(desc)
	if idx >= 0 {
		return desc[:idx+1]
	}
	if strings.HasSuffix(desc, ".") {
		return desc
	}
	return desc + "."
}

// docSentenceEnd finds the index of the period that ends the first sentence,
// skipping periods that follow common abbreviations (e.g., i.e., etc., vs.).
func docSentenceEnd(s string) int {
	abbrevs := []string{"e.g.", "i.e.", "etc.", "vs.", "approx.", "incl.", "resp."}
	offset := 0
	for {
		idx := strings.Index(s[offset:], ". ")
		if idx < 0 {
			return -1
		}
		pos := offset + idx
		isAbbrev := false
		for _, abbr := range abbrevs {
			if pos+1 >= len(abbr) && strings.EqualFold(s[pos+1-len(abbr):pos+1], abbr) {
				isAbbrev = true
				break
			}
		}
		if !isAbbrev {
			return pos
		}
		offset = pos + 2
	}
}

// docEscapeJSString escapes a string for use inside a JavaScript/JSX string literal.
func docEscapeJSString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	s = strings.ReplaceAll(s, "\n", " ")
	return s
}

// docSDKContent extracts the full SDK-facing content from a description,
// stripping @since annotations and ## markdown headings. @internal sections
// never reach this generator: proto2schema strips them at extraction, the
// single owner of that convention (oss#327).
// Unlike docMethodSummary (which truncated at the first paragraph break),
// this preserves multi-paragraph SDK content for richer method documentation.
func docSDKContent(desc string) string {
	if desc == "" {
		return ""
	}
	desc = strings.TrimSpace(desc)
	desc = docStripSince(desc)

	if strings.HasPrefix(desc, "## ") {
		return ""
	}

	var paragraphs []string
	for _, p := range strings.Split(desc, "\n\n") {
		p = strings.TrimSpace(p)
		if strings.HasPrefix(p, "## ") {
			break
		}
		if p == "" {
			continue
		}
		lines := strings.Split(p, "\n")
		for i := range lines {
			lines[i] = strings.TrimSpace(lines[i])
		}
		paragraphs = append(paragraphs, strings.Join(lines, " "))
	}
	return strings.TrimSpace(strings.Join(paragraphs, "\n\n"))
}

// docStripSince removes @since annotation lines from a description.
func docStripSince(desc string) string {
	lines := strings.Split(desc, "\n")
	var result []string
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "@since") {
			continue
		}
		result = append(result, line)
	}
	return strings.Join(result, "\n")
}

// docOverviewSummary extracts the full SDK-facing overview from a spec
// description. It strips @since annotations and proto-internal preambles
// like "XxxSpec defines..." (@internal sections are already stripped at
// extraction by proto2schema).
// Placeholder descriptions are dropped entirely.
func docOverviewSummary(desc string) string {
	if desc == "" {
		return ""
	}
	desc = strings.TrimSpace(desc)
	desc = docStripSince(desc)
	desc = docCleanDesc(desc)

	if desc == "" {
		return ""
	}

	// Drop placeholder specs
	firstLine := desc
	if idx := strings.Index(desc, "\n"); idx >= 0 {
		firstLine = desc[:idx]
	}
	firstLineLower := strings.ToLower(strings.TrimSpace(firstLine))
	if len(firstLineLower) < 30 && (strings.HasSuffix(firstLineLower, " spec") || strings.HasSuffix(firstLineLower, " spec.")) {
		return ""
	}

	// Strip "XxxSpec defines..." preamble from first paragraph
	words := strings.Fields(firstLine)
	if len(words) >= 2 && strings.HasSuffix(words[0], "Spec") {
		if idx := strings.Index(firstLine, ". "); idx >= 0 {
			remainder := strings.TrimSpace(firstLine[idx+2:])
			rest := ""
			if nlIdx := strings.Index(desc, "\n\n"); nlIdx >= 0 {
				rest = strings.TrimSpace(desc[nlIdx+2:])
			}
			if remainder != "" && rest != "" {
				return remainder + "\n\n" + rest
			}
			if remainder != "" {
				return remainder
			}
		}
		// The first paragraph is just the preamble; return subsequent paragraphs
		if nlIdx := strings.Index(desc, "\n\n"); nlIdx >= 0 {
			rest := strings.TrimSpace(desc[nlIdx+2:])
			if rest != "" {
				return rest
			}
		}
		return ""
	}

	return desc
}

// =========================================================================
// Type formatting
// =========================================================================

// docInputDisplayName maps a proto message name to its SDK input display name.
// Special types have friendly names (e.g., ApiResourceReference -> ResourceRef);
// all others get the standard "Input" suffix.
func docInputDisplayName(msgName string) string {
	switch msgName {
	case "EnvironmentSpec":
		return "EnvSpecInput"
	case "EnvironmentValue", "ExecutionValue":
		return "EnvVarInput"
	case "ApiResourceReference":
		return "ResourceRef"
	default:
		return msgName + "Input"
	}
}

// docFieldTypeLinkWithCommons returns a same-page anchor link (e.g., "#resourceref") if
// the field's message type has a documented section on this page, or a cross-page
// link to the commons page for shared types, or empty string otherwise. Handles
// direct message, array-of-message, and map-value-of-message fields.
func docFieldTypeLinkWithCommons(ts *TypeSpec, documentedTypes map[string]bool, commonsTypes map[string]bool) string {
	if enumName := docEnumTypeName(ts); enumName != "" {
		if commonsTypes[enumName] {
			return "/docs/sdk/resources/commons#" + strings.ToLower(enumName)
		}
		if documentedTypes[enumName] {
			return "#" + strings.ToLower(enumName)
		}
		return ""
	}

	var msgName string
	switch {
	case ts.Kind == "message":
		msgName = ts.MessageType
	case ts.Kind == "array" && ts.ElementType != nil && ts.ElementType.Kind == "message":
		msgName = ts.ElementType.MessageType
	case ts.Kind == "map" && ts.ValueType != nil && ts.ValueType.Kind == "message":
		msgName = ts.ValueType.MessageType
	default:
		return ""
	}

	if commonsTypes[msgName] {
		return "/docs/sdk/resources/commons#" + strings.ToLower(msgName)
	}

	displayName := docInputDisplayName(msgName)
	if documentedTypes[displayName] {
		return "#" + strings.ToLower(displayName)
	}
	return ""
}

// docResponseFieldTypeLink returns a same-page anchor link for a response-type
// field. Unlike docFieldTypeLink, response fields use raw proto names (no
// "Input" suffix), so the lookup checks the raw message name directly.
func docResponseFieldTypeLink(ts *TypeSpec, documentedTypes map[string]bool) string {
	return docResponseFieldTypeLinkWithCommons(ts, documentedTypes, nil)
}

func docResponseFieldTypeLinkWithCommons(ts *TypeSpec, documentedTypes map[string]bool, commonsTypes map[string]bool) string {
	if enumName := docEnumTypeName(ts); enumName != "" {
		if commonsTypes[enumName] {
			return "/docs/sdk/resources/commons#" + strings.ToLower(enumName)
		}
		if documentedTypes[enumName] {
			return "#" + strings.ToLower(enumName)
		}
		return ""
	}

	var typeName string
	switch {
	case ts.Kind == "message":
		typeName = ts.MessageType
	case ts.Kind == "array" && ts.ElementType != nil && ts.ElementType.Kind == "message":
		typeName = ts.ElementType.MessageType
	default:
		return ""
	}
	if commonsTypes[typeName] {
		return "/docs/sdk/resources/commons#" + strings.ToLower(typeName)
	}
	if documentedTypes[typeName] {
		return "#" + strings.ToLower(typeName)
	}
	return ""
}

// docEnumTypeName extracts the short enum type name from a TypeSpec if the
// field references an enum (directly, as array element, or as map value).
func docEnumTypeName(ts *TypeSpec) string {
	var enumFQN string
	switch {
	case ts.EnumType != "":
		enumFQN = ts.EnumType
	case ts.Kind == "array" && ts.ElementType != nil && ts.ElementType.EnumType != "":
		enumFQN = ts.ElementType.EnumType
	case ts.Kind == "map" && ts.ValueType != nil && ts.ValueType.EnumType != "":
		enumFQN = ts.ValueType.EnumType
	default:
		return ""
	}
	parts := strings.Split(enumFQN, ".")
	return parts[len(parts)-1]
}

// docTypeString converts a TypeSpec into a human-readable type string
// suitable for SDK reference documentation.
func docTypeString(ts *TypeSpec) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			parts := strings.Split(ts.EnumType, ".")
			return parts[len(parts)-1]
		}
		return "string"
	case "int32", "uint32", "float", "double":
		return "number"
	case "int64":
		return "number"
	case "bool":
		return "boolean"
	case "bytes":
		return "Uint8Array"
	case "timestamp":
		return "string"
	case "struct":
		return "object"
	case "value":
		return "any"
	case "array":
		if ts.ElementType != nil {
			return docTypeString(ts.ElementType) + "[]"
		}
		return "string[]"
	case "map":
		key := "string"
		val := "string"
		if ts.KeyType != nil {
			key = docTypeString(ts.KeyType)
		}
		if ts.ValueType != nil {
			val = docTypeString(ts.ValueType)
		}
		return fmt.Sprintf("Record<%s, %s>", key, val)
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
		return "string"
	}
}
