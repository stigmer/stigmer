package main

// =========================================================================
// Update-input mapper generation — the inverse of buildXxxProto.
//
// The platform's update RPCs are FULL-SPEC REPLACEMENTS: the request spec
// wholesale overwrites the stored spec, so a client that sends only the
// fields it edits silently WIPES every other mutable field (the bug class
// behind stigmer/stigmer#319 and the oss#293 wipe bugs). The generated
// toXxxUpdateInput maps a FETCHED resource to a complete XxxInput, so
// editors spread it and override only what they change. It is the
// TypeScript twin of the Go SDK's generated XxxInputFromProto
// (sdk_client.go, generateFromProto).
//
// Semantic rules (mirrored by the round-trip tests in
// sdk/typescript/src/__tests__):
//   - Proto3 scalar defaults (empty string, false, enum 0, 0/0n) map to
//     `undefined` — the builders' canonical shape; omitting a default is
//     wire-identical to sending it. Empty arrays/maps also map to
//     `undefined`.
//   - ApiResourceReference narrows to the ResourceRef input shape:
//     `version` is PRESERVED (dropping it would reset a pinned reference
//     to "latest") and so is `kind` — builders overwrite it where the
//     proto annotates a reference kind, but un-annotated refs (e.g. an
//     organization's identityProviderRef) carry the stored kind.
//   - Timestamps map to `Date`; Struct (JsonObject) and bytes pass
//     through.
//   - `versionMessage` is NEVER carried over: it is the commit message of
//     the NEXT update, not resource state.
//   - `visibility` maps as the current value (sending it back is
//     idempotent).
//   - Required Input fields fall back to their zero value so the mapper
//     is total even on a degenerate proto.
//
// Only resources whose command controller exposes an Update RPC get a
// mapper — resources without one (artifact, iampolicy, invitation, skill,
// executioncontext) have nothing to protect.
// =========================================================================

import (
	"bytes"
	"fmt"
	"strings"
)

// tsHasUpdateRPC reports whether the resource's controllers expose an
// Update method that takes the resource itself (full-spec replace).
func tsHasUpdateRPC(schema *ServiceSchemaFile, cfg sdkResourceConfig) bool {
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if strings.EqualFold(m.Name, "Update") && m.InputType == cfg.protoResType {
				return true
			}
		}
	}
	return false
}

// tsAddMessageTypeImport adds the TYPE import for a nested message (the
// mapper parameter type). Twin of tsAddSchemaImport, which imports the
// value-level Schema.
func tsAddMessageTypeImport(ts *TypeSchema, imports *tsImportSet, importBase string) {
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
		imports.addType(effectiveBase+"/"+suffix, ts.Name)
	} else {
		imports.addType(importBase+"/spec_pb", ts.Name)
	}
}

// generateTSUpdateInputMapper emits toXxxUpdateInput plus one private
// toXxxInput helper per nested message type (mirroring the nested-builder
// structure, so every level of the input round-trips completely).
func generateTSUpdateInputMapper(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) {
	importBase := deriveTSImportBase(schema.Package)
	inputName := cfg.inputPrefix + "Input"

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	// Nested mappers first, mirroring emitTSNestedBuilders order.
	emitted := make(map[string]bool)
	for _, f := range specFields {
		emitTSNestedUpdateInputMappers(buf, f, typeMap, emitted, imports, importBase)
	}

	fmt.Fprintf(buf, "/**\n")
	fmt.Fprintf(buf, " * Maps a fetched {@link %s} to a complete {@link %s} for `update()`.\n", cfg.protoResType, inputName)
	fmt.Fprintf(buf, " *\n")
	fmt.Fprintf(buf, " * The update RPC replaces the ENTIRE spec — spread this mapper's output\n")
	fmt.Fprintf(buf, " * and override only the fields you edit (spread nested objects the same\n")
	fmt.Fprintf(buf, " * way):\n")
	fmt.Fprintf(buf, " *\n")
	fmt.Fprintf(buf, " *   await client.update({ ...to%sUpdateInput(res), description: next });\n", cfg.protoResType)
	fmt.Fprintf(buf, " *\n")
	fmt.Fprintf(buf, " * Proto3 defaults normalize to `undefined`; resource references keep\n")
	fmt.Fprintf(buf, " * `version` (pinned refs) and `kind`.\n")
	fmt.Fprintf(buf, " */\n")
	fmt.Fprintf(buf, "export function to%sUpdateInput(resource: %s): %s {\n", cfg.protoResType, cfg.protoResType, inputName)
	fmt.Fprintf(buf, "  const meta = resource.metadata;\n")
	fmt.Fprintf(buf, "  const spec = resource.spec ?? create(%sSchema);\n", spec.Name)
	fmt.Fprintf(buf, "  return {\n")
	fmt.Fprintf(buf, "    name: meta?.name ?? \"\",\n")
	fmt.Fprintf(buf, "    slug: meta?.slug || undefined,\n")
	if schema.Resource == "organization" {
		// An organization's own metadata.org may be unset; updates address
		// the org by its slug in that case (matches the update pipeline's
		// org+slug resolution).
		fmt.Fprintf(buf, "    org: meta?.org || meta?.slug || \"\",\n")
	} else {
		fmt.Fprintf(buf, "    org: meta?.org ?? \"\",\n")
	}
	fmt.Fprintf(buf, "    labels: meta?.labels && Object.keys(meta.labels).length > 0 ? { ...meta.labels } : undefined,\n")
	fmt.Fprintf(buf, "    visibility: meta?.visibility || undefined,\n")
	if cfg.isVersioned {
		fmt.Fprintf(buf, "    // Never carried over: a version message describes the NEXT update.\n")
		fmt.Fprintf(buf, "    versionMessage: undefined,\n")
	}
	emitTSUpdateInputFields(buf, "    ", "spec", specFields, typeMap, imports)
	fmt.Fprintf(buf, "  };\n")
	fmt.Fprintf(buf, "}\n")
}

// emitTSUpdateInputFields emits one `field: expr,` line per field in schema
// order, dispatching oneof members to case-guarded expressions so the
// emitted literal matches the Input interface field-for-field.
func emitTSUpdateInputFields(buf *bytes.Buffer, indent, src string, fields []*FieldSchema, typeMap map[string]*TypeSchema, imports *tsImportSet) {
	for _, f := range fields {
		fieldName := tsProtoFieldName(f.ProtoField)
		var expr string
		if f.OneofGroup != "" && !isSyntheticOneof(f.OneofGroup) {
			expr = tsUpdateInputOneofExpr(f, src, typeMap, imports)
		} else {
			expr = tsUpdateInputFieldExpr(f, src+"."+fieldName, typeMap, imports)
		}
		fmt.Fprintf(buf, "%s%s: %s,\n", indent, fieldName, expr)
	}
}

// tsUpdateInputOneofExpr maps one oneof member: set when the oneof's case
// matches, undefined otherwise (the Input flattens oneofs to optional
// sibling fields).
func tsUpdateInputOneofExpr(f *FieldSchema, src string, typeMap map[string]*TypeSchema, imports *tsImportSet) string {
	group := src + "." + tsProtoFieldName(f.OneofGroup)
	member := tsProtoFieldName(f.ProtoField)
	guard := fmt.Sprintf("%s.case === %q", group, member)
	value := group + ".value"

	msgType := f.Type.MessageType
	switch {
	case msgType == "ApiResourceReference":
		imports.addValue("./proto-utils", "toResourceRefInput")
		return fmt.Sprintf("%s ? toResourceRefInput(%s) : undefined", guard, value)
	case msgType != "" && !isSpecialType(msgType):
		if _, ok := typeMap[msgType]; ok {
			return fmt.Sprintf("%s ? to%sInput(%s) : undefined", guard, msgType, value)
		}
		return fmt.Sprintf("%s ? %s : undefined", guard, value)
	default:
		return fmt.Sprintf("%s ? %s : undefined", guard, value)
	}
}

// tsUpdateInputFieldExpr returns the expression mapping proto field access
// `access` to its Input value, applying the normalization rules in the
// file-header comment. `access` is always non-optional (nested mappers take
// a concrete message; the top-level mapper defaults an absent spec).
func tsUpdateInputFieldExpr(f *FieldSchema, access string, typeMap map[string]*TypeSchema, imports *tsImportSet) string {
	switch {
	case f.Type.Kind == "timestamp":
		imports.addValue("@bufbuild/protobuf/wkt", "timestampDate")
		if f.Required {
			return fmt.Sprintf("%s ? timestampDate(%s) : new Date(0)", access, access)
		}
		return fmt.Sprintf("%s ? timestampDate(%s) : undefined", access, access)

	case f.Type.Kind == "value":
		// Value FIELDS are Value messages in protobuf-es (unlike Struct
		// fields) — convert back to the input's JsonValue via toJson.
		imports.addValue("@bufbuild/protobuf", "toJson")
		imports.addValue("@bufbuild/protobuf/wkt", "ValueSchema")
		if f.Required {
			return fmt.Sprintf("%s ? toJson(ValueSchema, %s) : null", access, access)
		}
		return fmt.Sprintf("%s ? toJson(ValueSchema, %s) : undefined", access, access)

	case f.Type.Kind == "struct":
		if f.Required {
			return fmt.Sprintf("%s ?? {}", access)
		}
		return access

	case f.Type.Kind == "bytes":
		if f.Required {
			return access
		}
		return fmt.Sprintf("%s.length > 0 ? %s : undefined", access, access)

	case f.Type.Kind == "string" || f.Type.Kind == "bool" || f.Type.Kind == "int32" ||
		f.Type.Kind == "int64" || f.Type.Kind == "uint32" || f.Type.Kind == "float" ||
		f.Type.Kind == "double":
		if f.Required {
			return access
		}
		return fmt.Sprintf("%s || undefined", access)

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		imports.addValue("./proto-utils", "toEnvSpecInput")
		if f.Required {
			return fmt.Sprintf("toEnvSpecInput(%s) ?? { variables: {} }", access)
		}
		return fmt.Sprintf("toEnvSpecInput(%s)", access)

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		imports.addValue("./proto-utils", "toResourceRefInput")
		if f.Required {
			return fmt.Sprintf("toResourceRefInput(%s) ?? { org: \"\", slug: \"\" }", access)
		}
		return fmt.Sprintf("toResourceRefInput(%s)", access)

	case f.Type.Kind == "message":
		msgType := f.Type.MessageType
		if f.Required {
			return fmt.Sprintf("to%sInput(%s ?? create(%sSchema))", msgType, access, msgType)
		}
		return fmt.Sprintf("%s ? to%sInput(%s) : undefined", access, msgType, access)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message" && f.Type.ElementType.MessageType == "ApiResourceReference":
		imports.addValue("./proto-utils", "toResourceRefInputs")
		if f.Required {
			return fmt.Sprintf("toResourceRefInputs(%s) ?? []", access)
		}
		return fmt.Sprintf("toResourceRefInputs(%s)", access)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if f.Required {
			return fmt.Sprintf("%s.map(to%sInput)", access, elemMsg)
		}
		return fmt.Sprintf("%s.length > 0 ? %s.map(to%sInput) : undefined", access, access, elemMsg)

	case f.Type.Kind == "array":
		if f.Required {
			return fmt.Sprintf("[...%s]", access)
		}
		return fmt.Sprintf("%s.length > 0 ? [...%s] : undefined", access, access)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue":
		imports.addValue("./proto-utils", "toEnvVarInputMap")
		if f.Required {
			return fmt.Sprintf("toEnvVarInputMap(%s) ?? {}", access)
		}
		return fmt.Sprintf("toEnvVarInputMap(%s)", access)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue":
		imports.addValue("./proto-utils", "toExecVarInputMap")
		if f.Required {
			return fmt.Sprintf("toExecVarInputMap(%s) ?? {}", access)
		}
		return fmt.Sprintf("toExecVarInputMap(%s)", access)

	case f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.Kind == "message":
		elemMsg := f.Type.ValueType.MessageType
		mapExpr := fmt.Sprintf("Object.fromEntries(Object.entries(%s).map(([k, v]) => [k, to%sInput(v)]))", access, elemMsg)
		if f.Required {
			return mapExpr
		}
		return fmt.Sprintf("Object.keys(%s).length > 0 ? %s : undefined", access, mapExpr)

	case f.Type.Kind == "map":
		if f.Required {
			return fmt.Sprintf("{ ...%s }", access)
		}
		return fmt.Sprintf("Object.keys(%s).length > 0 ? { ...%s } : undefined", access, access)

	default:
		return access
	}
}

// emitTSNestedUpdateInputMappers recursively generates a private
// toXxxInput(msg) helper for each non-special nested message type, in the
// same order as emitTSNestedBuilders (sub-types first).
func emitTSNestedUpdateInputMappers(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, imports *tsImportSet, importBase string) {
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

	// Sub-types first so their mappers are defined before use (function
	// declarations hoist, but this keeps reading order sensible and
	// matches the builder layout).
	for _, field := range ts.Fields {
		emitTSNestedUpdateInputMappers(buf, field, typeMap, emitted, imports, importBase)
	}

	tsAddMessageTypeImport(ts, imports, importBase)

	fmt.Fprintf(buf, "function to%sInput(msg: %s): %sInput {\n", msgName, msgName, msgName)
	fmt.Fprintf(buf, "  return {\n")
	emitTSUpdateInputFields(buf, "    ", "msg", ts.Fields, typeMap, imports)
	fmt.Fprintf(buf, "  };\n")
	fmt.Fprintf(buf, "}\n\n")
}
