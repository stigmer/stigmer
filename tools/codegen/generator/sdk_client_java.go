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

const javaGenPackage = "ai.stigmer.sdk.gen"

// =========================================================================
// Java Import Tracking
// =========================================================================

type javaImportSet struct {
	imports map[string]bool
}

func newJavaImportSet() *javaImportSet {
	return &javaImportSet{imports: make(map[string]bool)}
}

func (s *javaImportSet) add(fqcn string) {
	if strings.HasPrefix(fqcn, "java.lang.") && strings.Count(fqcn, ".") == 2 {
		return
	}
	s.imports[fqcn] = true
}

func (s *javaImportSet) emit(buf *bytes.Buffer) {
	if len(s.imports) == 0 {
		return
	}
	sorted := make([]string, 0, len(s.imports))
	for imp := range s.imports {
		sorted = append(sorted, imp)
	}
	sort.Strings(sorted)
	for _, imp := range sorted {
		fmt.Fprintf(buf, "import %s;\n", imp)
	}
	buf.WriteString("\n")
}

// =========================================================================
// Java Naming Helpers
// =========================================================================

// javaCapCamel converts a proto snake_case field name to capitalized CamelCase.
// "tool_approval_policy" -> "ToolApprovalPolicy"
func javaCapCamel(protoField string) string {
	parts := strings.Split(protoField, "_")
	for i, p := range parts {
		if len(p) > 0 {
			upper := strings.ToUpper(p[:1]) + p[1:]
			switch strings.ToLower(p) {
			case "url":
				upper = "Url"
			case "id":
				upper = "Id"
			case "md":
				upper = "Md"
			case "usd":
				upper = "Usd"
			}
			parts[i] = upper
		}
	}
	return strings.Join(parts, "")
}

// javaReservedNames is the set of identifiers that cannot be used as bare
// Java names in generated code. Two classes:
//   - reserved keywords (JLS §3.9) plus the boolean/null literals, which are
//     syntax errors as identifiers (broke the v3.3.0 release via
//     FieldDeclaration.default);
//   - java.lang.Object method names, because builder methods share every
//     object's inherited method namespace — `Builder equals(Object)` fails to
//     compile as an invalid override of Object.equals (datastore
//     UniqueWhere.equals). Escaped by name rather than by clashing signature
//     so a field's type can never change its public builder method name.
var javaReservedNames = map[string]bool{
	"abstract": true, "assert": true, "boolean": true, "break": true,
	"byte": true, "case": true, "catch": true, "char": true, "class": true,
	"const": true, "continue": true, "default": true, "do": true,
	"double": true, "else": true, "enum": true, "extends": true,
	"final": true, "finally": true, "float": true, "for": true,
	"goto": true, "if": true, "implements": true, "import": true,
	"instanceof": true, "int": true, "interface": true, "long": true,
	"native": true, "new": true, "package": true, "private": true,
	"protected": true, "public": true, "return": true, "short": true,
	"static": true, "strictfp": true, "super": true, "switch": true,
	"synchronized": true, "this": true, "throw": true, "throws": true,
	"transient": true, "try": true, "void": true, "volatile": true,
	"while": true,
	"true":  true, "false": true, "null": true,
	"equals": true, "hashCode": true, "toString": true, "getClass": true,
	"notify": true, "notifyAll": true, "wait": true, "clone": true,
	"finalize": true,
}

// javaCamel converts a proto snake_case field name to a safe camelCase Java
// identifier, appending a trailing underscore if the result is a reserved
// name (e.g. "default" -> "default_", "equals" -> "equals_"), mirroring
// pyFieldName and protoc-java's own escaping convention. Prefixed accessor
// names (setDefault, addAllX) are built via javaCapCamel and never collide.
func javaCamel(protoField string) string {
	cc := javaCapCamel(protoField)
	if len(cc) == 0 {
		return cc
	}
	name := strings.ToLower(cc[:1]) + cc[1:]
	if javaReservedNames[name] {
		return name + "_"
	}
	return name
}

func javaSetterName(protoField string) string { return "set" + javaCapCamel(protoField) }
func javaAddAllName(protoField string) string { return "addAll" + javaCapCamel(protoField) }
func javaAddName(protoField string) string    { return "add" + javaCapCamel(protoField) }
func javaPutName(protoField string) string    { return "put" + javaCapCamel(protoField) }
func javaPutAllName(protoField string) string { return "putAll" + javaCapCamel(protoField) }
func javaMethodLower(name string) string {
	if len(name) == 0 {
		return name
	}
	return strings.ToLower(name[:1]) + name[1:]
}

func javaAccessorName(resource string) string {
	fieldName := tsClientFieldName(resource)
	n := len(fieldName)
	if n >= 2 && fieldName[n-1] == 'y' {
		prev := fieldName[n-2]
		if prev != 'a' && prev != 'e' && prev != 'i' && prev != 'o' && prev != 'u' {
			return fieldName[:n-1] + "ies"
		}
	}
	return fieldName + "s"
}

// resolveJavaFQCN returns the fully qualified Java class name for a proto type.
func resolveJavaFQCN(fullType string) string {
	if isEmptyType(fullType) {
		return "com.google.protobuf.Empty"
	}
	return fullType
}

// =========================================================================
// Java Type Mapping
// =========================================================================

func javaTypeForField(f *FieldSchema, typeMap map[string]*TypeSchema) string {
	return javaTypeForTypeSpec(&f.Type, typeMap)
}

func javaTypeForTypeSpec(ts *TypeSpec, typeMap map[string]*TypeSchema) string {
	switch ts.Kind {
	case "string":
		if ts.EnumType != "" {
			parts := strings.Split(ts.EnumType, ".")
			return parts[len(parts)-1]
		}
		return "String"
	case "int32", "uint32":
		return "int"
	case "int64":
		return "long"
	case "bool":
		return "boolean"
	case "float":
		return "float"
	case "double":
		return "double"
	case "bytes":
		return "byte[]"
	case "timestamp":
		return "String"
	case "struct":
		return "java.util.Map<String, Object>"
	case "value":
		// google.protobuf.Value — any JSON-representable scalar or composite.
		return "Object"
	case "array":
		if ts.ElementType != nil {
			elemType := javaTypeForTypeSpec(ts.ElementType, typeMap)
			return "java.util.List<" + javaBoxed(elemType) + ">"
		}
		return "java.util.List<String>"
	case "map":
		keyType := "String"
		valType := "String"
		if ts.KeyType != nil {
			keyType = javaBoxed(javaTypeForTypeSpec(ts.KeyType, typeMap))
		}
		if ts.ValueType != nil {
			valType = javaBoxed(javaTypeForTypeSpec(ts.ValueType, typeMap))
		}
		return "java.util.Map<" + keyType + ", " + valType + ">"
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
		return "String"
	}
}

func javaBoxed(t string) string {
	switch t {
	case "int":
		return "Integer"
	case "long":
		return "Long"
	case "boolean":
		return "Boolean"
	case "float":
		return "Float"
	case "double":
		return "Double"
	default:
		return t
	}
}

func javaIsPrimitive(t string) bool {
	switch t {
	case "int", "long", "boolean", "float", "double":
		return true
	default:
		return false
	}
}

// =========================================================================
// Java Enum Import Resolution
// =========================================================================

func resolveJavaEnumImport(enumType string) string {
	return enumType
}

// javaEnumImportsForFields scans fields and adds enum imports.
func javaEnumImportsForFields(fields []*FieldSchema, imports *javaImportSet) {
	for _, f := range fields {
		javaEnumImportsForTypeSpec(&f.Type, imports)
	}
}

func javaEnumImportsForTypeSpec(ts *TypeSpec, imports *javaImportSet) {
	if ts.Kind == "string" && ts.EnumType != "" {
		imports.add(resolveJavaEnumImport(ts.EnumType))
	}
	if ts.ElementType != nil {
		javaEnumImportsForTypeSpec(ts.ElementType, imports)
	}
	if ts.ValueType != nil {
		javaEnumImportsForTypeSpec(ts.ValueType, imports)
	}
}

// =========================================================================
// File Writer
// =========================================================================

func writeJavaFile(outputDir, filename, packageName string, imports *javaImportSet, body []byte) error {
	var buf bytes.Buffer
	buf.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	fmt.Fprintf(&buf, "package %s;\n\n", packageName)
	imports.emit(&buf)
	buf.Write(body)
	buf.WriteString("\n")
	return os.WriteFile(filepath.Join(outputDir, filename), buf.Bytes(), 0644)
}

// =========================================================================
// Entry Point
// =========================================================================

func runSDKClientJavaGeneration(schemaDir, outputDir string) error {
	servicesDir := filepath.Join(schemaDir, "services")
	entries, err := os.ReadDir(servicesDir)
	if err != nil {
		return fmt.Errorf("failed to read services directory: %w", err)
	}
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("failed to create output directory: %w", err)
	}

	if err := generateJavaErrors(outputDir); err != nil {
		return fmt.Errorf("failed to generate StigmerException.java: %w", err)
	}
	fmt.Printf("   -> StigmerException.java\n")

	if err := generateJavaErrorCode(outputDir); err != nil {
		return fmt.Errorf("failed to generate ErrorCode.java: %w", err)
	}
	fmt.Printf("   -> ErrorCode.java\n")

	if err := generateJavaSharedTypes(outputDir); err != nil {
		return fmt.Errorf("failed to generate shared types: %w", err)
	}

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

		clientCode, genInfo, err := generateJavaClientClass(&schema, cfg, specSchema != nil)
		if err != nil {
			return fmt.Errorf("failed to generate Java client for %s: %w", resource, err)
		}
		clientFileName := cfg.protoResType + "Client.java"
		if err := os.WriteFile(filepath.Join(outputDir, clientFileName), clientCode, 0644); err != nil {
			return fmt.Errorf("failed to write %s: %w", clientFileName, err)
		}
		fmt.Printf("   -> %s\n", clientFileName)

		if specSchema != nil {
			typeMap := make(map[string]*TypeSchema)
			for _, t := range specTypes {
				typeMap[t.Name] = t
			}

			inputCode, inputTypes, err := generateJavaInputClass(&schema, cfg, specSchema, specTypes, typeMap)
			if err != nil {
				return fmt.Errorf("failed to generate Java input for %s: %w", resource, err)
			}
			inputFileName := cfg.protoResType + "Input.java"
			if err := os.WriteFile(filepath.Join(outputDir, inputFileName), inputCode, 0644); err != nil {
				return fmt.Errorf("failed to write %s: %w", inputFileName, err)
			}
			fmt.Printf("   -> %s\n", inputFileName)
			genInfo.inputTypes = inputTypes
		}

		allResources = append(allResources, genInfo)
	}

	sort.Slice(allResources, func(i, j int) bool {
		return allResources[i].resource < allResources[j].resource
	})

	if err := generateJavaClientFile(outputDir, allResources); err != nil {
		return fmt.Errorf("failed to generate GeneratedClient.java: %w", err)
	}
	fmt.Printf("   -> GeneratedClient.java\n")

	return nil
}

// =========================================================================
// StigmerException.java
// =========================================================================

func generateJavaErrors(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("io.grpc.Status")
	imports.add("io.grpc.StatusRuntimeException")

	var body bytes.Buffer
	body.WriteString(`public final class StigmerException extends RuntimeException {
    private final ErrorCode code;
    private final Status.Code grpcCode;

    public StigmerException(ErrorCode code, String message, Status.Code grpcCode) {
        super(message);
        this.code = code;
        this.grpcCode = grpcCode;
    }

    public ErrorCode getCode() { return code; }

    public Status.Code getGrpcCode() { return grpcCode; }

    public boolean isNotFound() { return code == ErrorCode.NOT_FOUND; }

    public boolean isUnauthenticated() { return code == ErrorCode.UNAUTHENTICATED; }

    public boolean isPermissionDenied() { return code == ErrorCode.PERMISSION_DENIED; }

    public boolean isRetryable() { return code == ErrorCode.INTERNAL || code == ErrorCode.UNAVAILABLE; }

    public static StigmerException wrap(StatusRuntimeException e) {
        ErrorCode code = ErrorCode.fromGrpcCode(e.getStatus().getCode());
        String msg = e.getStatus().getDescription();
        if (msg == null) {
            msg = e.getStatus().getCode().name();
        }
        return new StigmerException(code, msg, e.getStatus().getCode());
    }

    @Override
    public String toString() {
        return "StigmerException{code=" + code + ", grpcCode=" + grpcCode + ", message=" + getMessage() + "}";
    }
}
`)
	return writeJavaFile(outputDir, "StigmerException.java", javaGenPackage, imports, body.Bytes())
}

// =========================================================================
// ErrorCode.java
// =========================================================================

func generateJavaErrorCode(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("io.grpc.Status")

	var body bytes.Buffer
	body.WriteString(`public enum ErrorCode {
    UNKNOWN,
    NOT_FOUND,
    PERMISSION_DENIED,
    UNAUTHENTICATED,
    INVALID_ARGUMENT,
    ALREADY_EXISTS,
    RESOURCE_EXHAUSTED,
    FAILED_PRECONDITION,
    INTERNAL,
    UNAVAILABLE;

    static ErrorCode fromGrpcCode(Status.Code code) {
        switch (code) {
            case NOT_FOUND: return NOT_FOUND;
            case PERMISSION_DENIED: return PERMISSION_DENIED;
            case UNAUTHENTICATED: return UNAUTHENTICATED;
            case INVALID_ARGUMENT: return INVALID_ARGUMENT;
            case ALREADY_EXISTS: return ALREADY_EXISTS;
            case RESOURCE_EXHAUSTED: return RESOURCE_EXHAUSTED;
            case FAILED_PRECONDITION: return FAILED_PRECONDITION;
            case INTERNAL: return INTERNAL;
            case UNAVAILABLE: return UNAVAILABLE;
            default: return UNKNOWN;
        }
    }
}
`)
	return writeJavaFile(outputDir, "ErrorCode.java", javaGenPackage, imports, body.Bytes())
}

// =========================================================================
// Shared Types
// =========================================================================

func generateJavaSharedTypes(outputDir string) error {
	if err := generateJavaDeleteResourceInput(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> DeleteResourceInput.java\n")

	if err := generateJavaResourceRef(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> ResourceRef.java\n")

	if err := generateJavaPage(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> Page.java\n")

	if err := generateJavaListParams(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> ListParams.java\n")

	if err := generateJavaListResult(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> ListResult.java\n")

	if err := generateJavaEnvVarInput(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> EnvVarInput.java\n")

	if err := generateJavaEnvSpecInput(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> EnvSpecInput.java\n")

	if err := generateJavaStigmerStream(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> StigmerStream.java\n")

	if err := generateJavaStigmerBidiStream(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> StigmerBidiStream.java\n")

	if err := generateJavaProtoConvert(outputDir); err != nil {
		return err
	}
	fmt.Printf("   -> ProtoConvert.java\n")

	return nil
}

func generateJavaDeleteResourceInput(outputDir string) error {
	imports := newJavaImportSet()
	var body bytes.Buffer
	body.WriteString(`public final class DeleteResourceInput {
    private final String resourceId;
    private final String versionMessage;
    private final boolean force;

    private DeleteResourceInput(Builder builder) {
        this.resourceId = builder.resourceId;
        this.versionMessage = builder.versionMessage;
        this.force = builder.force;
    }

    public String getResourceId() { return resourceId; }
    public String getVersionMessage() { return versionMessage; }
    public boolean isForce() { return force; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String resourceId;
        private String versionMessage;
        private boolean force;

        private Builder() {}

        public Builder resourceId(String resourceId) { this.resourceId = resourceId; return this; }
        public Builder versionMessage(String versionMessage) { this.versionMessage = versionMessage; return this; }
        public Builder force(boolean force) { this.force = force; return this; }

        public DeleteResourceInput build() { return new DeleteResourceInput(this); }
    }
}
`)
	return writeJavaFile(outputDir, "DeleteResourceInput.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaResourceRef(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("ai.stigmer.commons.apiresource.ApiResourceReference")
	imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind")

	var body bytes.Buffer
	body.WriteString(`public final class ResourceRef {
    private final String org;
    private final String slug;
    private final String version;
    private final ApiResourceKind kind;

    private ResourceRef(String org, String slug, String version, ApiResourceKind kind) {
        this.org = org;
        this.slug = slug;
        this.version = version;
        this.kind = kind;
    }

    public static ResourceRef of(String org, String slug) {
        return new ResourceRef(org, slug, null, ApiResourceKind.api_resource_kind_unknown);
    }

    public static ResourceRef of(String org, String slug, String version) {
        return new ResourceRef(org, slug, version, ApiResourceKind.api_resource_kind_unknown);
    }

    public static ResourceRef of(String org, ApiResourceKind kind, String slug) {
        return new ResourceRef(org, slug, null, kind);
    }

    public static ResourceRef of(String org, ApiResourceKind kind, String slug, String version) {
        return new ResourceRef(org, slug, version, kind);
    }

    public String getOrg() { return org; }
    public String getSlug() { return slug; }
    public String getVersion() { return version; }
    public ApiResourceKind getKind() { return kind; }

    boolean hasIdentifier() {
        return (this.org != null && !this.org.isEmpty()) || (this.slug != null && !this.slug.isEmpty());
    }

    ApiResourceReference toProto() {
        ApiResourceReference.Builder builder = ApiResourceReference.newBuilder()
            .setOrg(this.org)
            .setSlug(this.slug);
        if (this.kind != null && this.kind != ApiResourceKind.api_resource_kind_unknown) {
            builder.setKind(this.kind);
        }
        if (this.version != null) {
            builder.setVersion(this.version);
        }
        return builder.build();
    }
}
`)
	return writeJavaFile(outputDir, "ResourceRef.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaPage(outputDir string) error {
	imports := newJavaImportSet()
	var body bytes.Buffer
	body.WriteString(`public final class Page {
    private final int num;
    private final int size;

    public Page(int num, int size) {
        this.num = num;
        this.size = size;
    }

    public int getNum() { return num; }
    public int getSize() { return size; }
}
`)
	return writeJavaFile(outputDir, "Page.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaListParams(outputDir string) error {
	imports := newJavaImportSet()
	var body bytes.Buffer
	body.WriteString(`public final class ListParams {
    private final String org;
    private final String query;
    private final boolean excludePublic;
    private final boolean crossOrgPublic;
    private final Page page;

    private ListParams(Builder builder) {
        this.org = builder.org;
        this.query = builder.query;
        this.excludePublic = builder.excludePublic;
        this.crossOrgPublic = builder.crossOrgPublic;
        this.page = builder.page;
    }

    public String getOrg() { return org; }
    public String getQuery() { return query; }
    public boolean isExcludePublic() { return excludePublic; }
    public boolean isCrossOrgPublic() { return crossOrgPublic; }
    public Page getPage() { return page; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String org;
        private String query;
        private boolean excludePublic;
        private boolean crossOrgPublic;
        private Page page;

        private Builder() {}

        public Builder org(String org) { this.org = org; return this; }
        public Builder query(String query) { this.query = query; return this; }
        public Builder excludePublic(boolean excludePublic) { this.excludePublic = excludePublic; return this; }
        public Builder crossOrgPublic(boolean crossOrgPublic) { this.crossOrgPublic = crossOrgPublic; return this; }
        public Builder page(Page page) { this.page = page; return this; }

        public ListParams build() { return new ListParams(this); }
    }
}
`)
	return writeJavaFile(outputDir, "ListParams.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaListResult(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("ai.stigmer.search.v1.SearchResult")

	var body bytes.Buffer
	body.WriteString(`public final class ListResult {
    private final java.util.List<SearchResult> entries;
    private final int totalCount;
    private final int totalPages;

    ListResult(java.util.List<SearchResult> entries, int totalCount, int totalPages) {
        this.entries = entries;
        this.totalCount = totalCount;
        this.totalPages = totalPages;
    }

    public java.util.List<SearchResult> getEntries() { return entries; }
    public int getTotalCount() { return totalCount; }
    public int getTotalPages() { return totalPages; }
}
`)
	return writeJavaFile(outputDir, "ListResult.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaEnvVarInput(outputDir string) error {
	imports := newJavaImportSet()
	var body bytes.Buffer
	body.WriteString(`public final class EnvVarInput {
    private final String value;
    private final boolean isSecret;
    private final String description;

    private EnvVarInput(Builder builder) {
        this.value = builder.value;
        this.isSecret = builder.isSecret;
        this.description = builder.description;
    }

    public String getValue() { return value; }
    public boolean isSecret() { return isSecret; }
    public String getDescription() { return description; }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private String value;
        private boolean isSecret;
        private String description;

        private Builder() {}

        public Builder value(String value) { this.value = value; return this; }
        public Builder isSecret(boolean isSecret) { this.isSecret = isSecret; return this; }
        public Builder description(String description) { this.description = description; return this; }

        public EnvVarInput build() { return new EnvVarInput(this); }
    }
}
`)
	return writeJavaFile(outputDir, "EnvVarInput.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaEnvSpecInput(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("ai.stigmer.agentic.environment.v1.EnvironmentSpec")
	imports.add("ai.stigmer.agentic.environment.v1.EnvironmentValue")

	var body bytes.Buffer
	body.WriteString(`public final class EnvSpecInput {
    private final java.util.Map<String, EnvVarInput> variables;

    private EnvSpecInput(Builder builder) {
        this.variables = builder.variables;
    }

    public java.util.Map<String, EnvVarInput> getVariables() { return variables; }

    EnvironmentSpec toProto() {
        EnvironmentSpec.Builder builder = EnvironmentSpec.newBuilder();
        if (variables != null) {
            for (java.util.Map.Entry<String, EnvVarInput> entry : variables.entrySet()) {
                EnvironmentValue.Builder vb = EnvironmentValue.newBuilder()
                    .setValue(entry.getValue().getValue())
                    .setIsSecret(entry.getValue().isSecret());
                if (entry.getValue().getDescription() != null) {
                    vb.setDescription(entry.getValue().getDescription());
                }
                builder.putData(entry.getKey(), vb.build());
            }
        }
        return builder.build();
    }

    public static Builder builder() { return new Builder(); }

    public static final class Builder {
        private java.util.Map<String, EnvVarInput> variables;

        private Builder() {}

        public Builder variables(java.util.Map<String, EnvVarInput> variables) { this.variables = variables; return this; }

        public EnvSpecInput build() { return new EnvSpecInput(this); }
    }
}
`)
	return writeJavaFile(outputDir, "EnvSpecInput.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaStigmerStream(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("io.grpc.StatusRuntimeException")

	var body bytes.Buffer
	body.WriteString(`public final class StigmerStream<T> implements java.util.Iterator<T> {
    private final java.util.Iterator<T> delegate;

    StigmerStream(java.util.Iterator<T> delegate) {
        this.delegate = delegate;
    }

    @Override
    public boolean hasNext() {
        try {
            return delegate.hasNext();
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    @Override
    public T next() {
        try {
            return delegate.next();
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }
}
`)
	return writeJavaFile(outputDir, "StigmerStream.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaStigmerBidiStream(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("io.grpc.StatusRuntimeException")
	imports.add("io.grpc.stub.StreamObserver")
	imports.add("java.util.concurrent.LinkedBlockingQueue")

	var body bytes.Buffer
	body.WriteString(`public final class StigmerBidiStream<Send, Receive> {
    private final StreamObserver<Send> requests;
    private final LinkedBlockingQueue<Object> queue;
    private static final Object COMPLETED = new Object();

    StigmerBidiStream(StreamObserver<Send> requests, LinkedBlockingQueue<Object> queue) {
        this.requests = requests;
        this.queue = queue;
    }

    /** Send a message to the server. */
    public void send(Send msg) {
        requests.onNext(msg);
    }

    /** Signal that no more messages will be sent. */
    public void closeSend() {
        requests.onCompleted();
    }

    /**
     * Receive the next message from the server.
     * Returns null when the server has completed the stream.
     */
    @SuppressWarnings("unchecked")
    public Receive receive() {
        try {
            Object item = queue.take();
            if (item == COMPLETED) return null;
            if (item instanceof StatusRuntimeException) throw StigmerException.wrap((StatusRuntimeException) item);
            if (item instanceof Throwable) throw new RuntimeException((Throwable) item);
            return (Receive) item;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException(e);
        }
    }

    @SuppressWarnings("unchecked")
    static <T> StreamObserver<T> responseObserver(LinkedBlockingQueue<Object> queue) {
        return new StreamObserver<T>() {
            @Override public void onNext(T value) { queue.add(value); }
            @Override public void onError(Throwable t) { queue.add(t); }
            @Override public void onCompleted() { queue.add(COMPLETED); }
        };
    }
}
`)
	return writeJavaFile(outputDir, "StigmerBidiStream.java", javaGenPackage, imports, body.Bytes())
}

func generateJavaProtoConvert(outputDir string) error {
	imports := newJavaImportSet()
	imports.add("com.google.protobuf.NullValue")
	imports.add("com.google.protobuf.Struct")
	imports.add("com.google.protobuf.Value")
	imports.add("io.grpc.Status")

	var body bytes.Buffer
	body.WriteString(`// Struct/Value conversion for the generated Input types.
//
// objectToValue accepts only values with an exact protobuf Struct
// representation: String, Number, Boolean, String-keyed Map, Iterable,
// array, and null. Anything else used to be silently coerced to its
// String.valueOf — a POJO in a task config arrived on the wire as
// "com.example.Outcome@1a2b3c4d" with no failure until a human
// inspected the degraded resource (stigmer/stigmer#448; the Go twin of
// the class was #342). Unsupported values now throw StigmerException
// with INVALID_ARGUMENT naming the offending field path and type: a
// value the SDK refuses client-side surfaces exactly like a value the
// server would have refused.
//
// No lossy guessing: enums, java.time types, and POJOs are refused
// rather than coerced — callers convert explicitly (e.g. name() for an
// enum, toString() for an Instant). A JSON dependency for POJO
// normalization was deliberately rejected to keep the published SDK
// dependency-free; see #448 for the contract discussion.
final class ProtoConvert {
    private ProtoConvert() {}

    static Struct mapToStruct(java.util.Map<?, ?> map, String path) {
        if (map == null) {
            return Struct.getDefaultInstance();
        }
        Struct.Builder builder = Struct.newBuilder();
        for (java.util.Map.Entry<?, ?> entry : map.entrySet()) {
            Object key = entry.getKey();
            if (!(key instanceof String)) {
                throw invalidValue(path, "map key "
                    + (key == null ? "null" : "of type " + key.getClass().getName())
                    + " (Struct keys must be String)");
            }
            builder.putFields((String) key,
                objectToValue(entry.getValue(), path + "[\"" + key + "\"]"));
        }
        return builder.build();
    }

    static Value objectToValue(Object obj, String path) {
        if (obj == null) {
            return Value.newBuilder().setNullValue(NullValue.NULL_VALUE).build();
        }
        if (obj instanceof String) {
            return Value.newBuilder().setStringValue((String) obj).build();
        }
        if (obj instanceof Number) {
            return Value.newBuilder().setNumberValue(((Number) obj).doubleValue()).build();
        }
        if (obj instanceof Boolean) {
            return Value.newBuilder().setBoolValue((Boolean) obj).build();
        }
        if (obj instanceof java.util.Map) {
            return Value.newBuilder().setStructValue(
                mapToStruct((java.util.Map<?, ?>) obj, path)).build();
        }
        if (obj instanceof Iterable) {
            com.google.protobuf.ListValue.Builder list = com.google.protobuf.ListValue.newBuilder();
            int idx = 0;
            for (Object item : (Iterable<?>) obj) {
                list.addValues(objectToValue(item, path + "[" + idx + "]"));
                idx++;
            }
            return Value.newBuilder().setListValue(list.build()).build();
        }
        if (obj.getClass().isArray()) {
            com.google.protobuf.ListValue.Builder list = com.google.protobuf.ListValue.newBuilder();
            int length = java.lang.reflect.Array.getLength(obj);
            for (int idx = 0; idx < length; idx++) {
                list.addValues(objectToValue(
                    java.lang.reflect.Array.get(obj, idx), path + "[" + idx + "]"));
            }
            return Value.newBuilder().setListValue(list.build()).build();
        }
        throw invalidValue(path, "value of type " + obj.getClass().getName()
            + " (pass a Map, Iterable, array, String, Number, Boolean, or null;"
            + " convert other types explicitly, e.g. name() for an enum or"
            + " toString() for a timestamp)");
    }

    private static StigmerException invalidValue(String path, String detail) {
        return new StigmerException(
            ErrorCode.INVALID_ARGUMENT,
            path + ": unsupported " + detail,
            Status.Code.INVALID_ARGUMENT);
    }
}
`)
	return writeJavaFile(outputDir, "ProtoConvert.java", javaGenPackage, imports, body.Bytes())
}

// =========================================================================
// Per-Resource Client Class
// =========================================================================

func generateJavaClientClass(schema *ServiceSchemaFile, cfg sdkResourceConfig, hasInputType bool) ([]byte, resourceGenInfo, error) {
	imports := newJavaImportSet()
	imports.add("io.grpc.Channel")
	imports.add("io.grpc.StatusRuntimeException")

	genInfo := resourceGenInfo{
		resource:   schema.Resource,
		clientName: cfg.clientName,
	}

	needsSearch := schema.ListVia == "SearchService"

	for _, svc := range schema.Services {
		grpcClass := schema.Package + "." + svc.Name + "Grpc"
		imports.add(grpcClass)
	}

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if searchListSupersedesMethod(schema, &m) {
				continue
			}
			fqcn := resolveJavaFQCN(m.OutputFullType)
			imports.add(fqcn)

			if isIDType(m.InputType) {
				imports.add(resolveJavaFQCN(m.InputFullType))
			}

			if isEmptyType(m.InputFullType) {
				imports.add("com.google.protobuf.Empty")
			}

			if m.InputType == "ApiResourceDeleteInput" {
				imports.add("ai.stigmer.commons.apiresource.ApiResourceDeleteInput")
			}

			if m.ServerStreaming {
				genInfo.streamTypes = append(genInfo.streamTypes, cfg.protoResType+m.Name+"Stream")
			}
		}
	}

	if needsSearch {
		imports.add("ai.stigmer.search.v1.SearchRequest")
		imports.add("ai.stigmer.search.v1.SearchResponse")
		imports.add("ai.stigmer.search.v1.SearchServiceGrpc")
		imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind")
		imports.add("ai.stigmer.commons.rpc.PageInfo")
	}

	// Track which services need an async stub for bidi streaming.
	svcNeedsBidi := make(map[string]bool)
	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if m.ServerStreaming && m.ClientStreaming {
				svcNeedsBidi[svc.Role] = true
				imports.add("io.grpc.stub.StreamObserver")
				imports.add("java.util.concurrent.LinkedBlockingQueue")
			}
		}
	}

	var body bytes.Buffer

	fmt.Fprintf(&body, "/** Provides operations on %s resources. */\n", schema.Resource)
	fmt.Fprintf(&body, "public final class %s {\n", cfg.clientName)

	for _, svc := range schema.Services {
		stubType := svc.Name + "Grpc." + svc.Name + "BlockingStub"
		fmt.Fprintf(&body, "    private final %s %s;\n", stubType, svc.Role)
		if svcNeedsBidi[svc.Role] {
			asyncStubType := svc.Name + "Grpc." + svc.Name + "Stub"
			fmt.Fprintf(&body, "    private final %s %sAsync;\n", asyncStubType, svc.Role)
		}
	}
	if needsSearch {
		body.WriteString("    private final SearchServiceGrpc.SearchServiceBlockingStub search;\n")
	}
	body.WriteString("\n")

	fmt.Fprintf(&body, "    %s(Channel channel) {\n", cfg.clientName)
	for _, svc := range schema.Services {
		fmt.Fprintf(&body, "        this.%s = %sGrpc.newBlockingStub(channel);\n", svc.Role, svc.Name)
		if svcNeedsBidi[svc.Role] {
			fmt.Fprintf(&body, "        this.%sAsync = %sGrpc.newStub(channel);\n", svc.Role, svc.Name)
		}
	}
	if needsSearch {
		body.WriteString("        this.search = SearchServiceGrpc.newBlockingStub(channel);\n")
	}
	body.WriteString("    }\n")

	for _, svc := range schema.Services {
		for _, m := range svc.Methods {
			if searchListSupersedesMethod(schema, &m) {
				continue
			}
			body.WriteString("\n")
			if m.ServerStreaming {
				generateJavaStreamingMethod(&body, &m, &svc, schema, cfg, imports)
			} else {
				generateJavaMethod(&body, &m, &svc, schema, cfg, hasInputType, imports)
			}
		}
	}

	if needsSearch {
		body.WriteString("\n")
		generateJavaSearchList(&body, schema, cfg)
	}

	body.WriteString("}\n")

	var full bytes.Buffer
	full.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	fmt.Fprintf(&full, "package %s;\n\n", javaGenPackage)
	imports.emit(&full)
	full.Write(body.Bytes())

	return full.Bytes(), genInfo, nil
}

// =========================================================================
// Method Generation
// =========================================================================

func generateJavaMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, hasInputType bool, imports *javaImportSet) {
	emptyInput := isEmptyType(m.InputFullType)
	emptyOutput := isEmptyType(m.OutputFullType)
	isIDIn := isIDType(m.InputType)
	isDeleteIn := m.InputType == "ApiResourceDeleteInput"
	isResourceIn := m.InputType == cfg.protoResType
	isApiResRefIn := m.InputType == "ApiResourceReference"

	outputType := m.OutputType
	if emptyOutput {
		outputType = "void"
	}
	methodName := javaMethodLower(m.Name)
	role := svc.Role
	returnKw := "return "
	if emptyOutput {
		returnKw = ""
	}

	switch {
	case emptyInput && emptyOutput:
		fmt.Fprintf(buf, "    public void %s() {\n", methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s.%s(Empty.getDefaultInstance());\n", role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case emptyInput:
		fmt.Fprintf(buf, "    public %s %s() {\n", outputType, methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            return %s.%s(Empty.getDefaultInstance());\n", role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case isResourceIn && hasInputType:
		inputTypeName := cfg.inputPrefix + "Input"
		fmt.Fprintf(buf, "    public %s %s(%s input) {\n", outputType, methodName, inputTypeName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s%s.%s(input.toProto());\n", returnKw, role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case isResourceIn && !hasInputType:
		imports.add(resolveJavaFQCN(m.InputFullType))
		fmt.Fprintf(buf, "    public %s %s(%s input) {\n", outputType, methodName, m.InputType)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s%s.%s(input);\n", returnKw, role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case emptyOutput && isIDIn:
		fmt.Fprintf(buf, "    public void %s(String id) {\n", methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s.%s(%s.newBuilder().setValue(id).build());\n",
			role, javaMethodLower(m.Name), m.InputType)
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case isIDIn:
		fmt.Fprintf(buf, "    public %s %s(String id) {\n", outputType, methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s%s.%s(%s.newBuilder().setValue(id).build());\n",
			returnKw, role, javaMethodLower(m.Name), m.InputType)
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case isDeleteIn:
		imports.add("ai.stigmer.commons.apiresource.ApiResourceDeleteInput")
		fmt.Fprintf(buf, "    public %s %s(DeleteResourceInput input) {\n", outputType, methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            ApiResourceDeleteInput.Builder req = ApiResourceDeleteInput.newBuilder()\n")
		fmt.Fprintf(buf, "                .setResourceId(input.getResourceId())\n")
		fmt.Fprintf(buf, "                .setForce(input.isForce());\n")
		fmt.Fprintf(buf, "            if (input.getVersionMessage() != null) {\n")
		fmt.Fprintf(buf, "                req.setVersionMessage(input.getVersionMessage());\n")
		fmt.Fprintf(buf, "            }\n")
		fmt.Fprintf(buf, "            %s%s.%s(req.build());\n", returnKw, role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	case isApiResRefIn:
		imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind")
		kindConst := cfg.resourceKind
		fmt.Fprintf(buf, "    public %s %s(ResourceRef ref) {\n", outputType, methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s%s.%s(ref.toProto().toBuilder().setKind(ApiResourceKind.%s).build());\n", returnKw, role, javaMethodLower(m.Name), kindConst)
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")

	default:
		imports.add(resolveJavaFQCN(m.InputFullType))
		fmt.Fprintf(buf, "    public %s %s(%s input) {\n", outputType, methodName, m.InputType)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            %s%s.%s(input);\n", returnKw, role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")
	}
}

// =========================================================================
// Streaming Method Generation
// =========================================================================

func generateJavaStreamingMethod(buf *bytes.Buffer, m *MethodSchema, svc *ServiceDefinition, schema *ServiceSchemaFile, cfg sdkResourceConfig, imports *javaImportSet) {
	isIDIn := isIDType(m.InputType)
	outputType := m.OutputType
	methodName := javaMethodLower(m.Name)

	if m.ClientStreaming {
		// Bidi streaming: use async stub and StigmerBidiStream.
		imports.add(resolveJavaFQCN(m.InputFullType))
		imports.add(resolveJavaFQCN(m.OutputFullType))
		fmt.Fprintf(buf, "    public StigmerBidiStream<%s, %s> %s() {\n", m.InputType, outputType, methodName)
		fmt.Fprintf(buf, "        LinkedBlockingQueue<Object> queue = new LinkedBlockingQueue<>();\n")
		fmt.Fprintf(buf, "        StreamObserver<%s> requests = %sAsync.%s(\n", m.InputType, svc.Role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "            StigmerBidiStream.responseObserver(queue));\n")
		fmt.Fprintf(buf, "        return new StigmerBidiStream<>(requests, queue);\n")
		buf.WriteString("    }\n")
	} else if isIDIn {
		imports.add(resolveJavaFQCN(m.InputFullType))
		fmt.Fprintf(buf, "    public StigmerStream<%s> %s(String id) {\n", outputType, methodName)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            java.util.Iterator<%s> iter = %s.%s(\n", outputType, svc.Role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "                %s.newBuilder().setValue(id).build());\n", m.InputType)
		fmt.Fprintf(buf, "            return new StigmerStream<>(iter);\n")
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")
	} else {
		imports.add(resolveJavaFQCN(m.InputFullType))
		fmt.Fprintf(buf, "    public StigmerStream<%s> %s(%s input) {\n", outputType, methodName, m.InputType)
		fmt.Fprintf(buf, "        try {\n")
		fmt.Fprintf(buf, "            java.util.Iterator<%s> iter = %s.%s(input);\n", outputType, svc.Role, javaMethodLower(m.Name))
		fmt.Fprintf(buf, "            return new StigmerStream<>(iter);\n")
		fmt.Fprintf(buf, "        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
		buf.WriteString("    }\n")
	}
}

// =========================================================================
// SearchService List
// =========================================================================

func generateJavaSearchList(buf *bytes.Buffer, schema *ServiceSchemaFile, cfg sdkResourceConfig) {
	kindConst := cfg.resourceKind

	buf.WriteString("    public ListResult list(ListParams params) {\n")
	buf.WriteString("        try {\n")
	buf.WriteString("            SearchRequest.Builder req = SearchRequest.newBuilder()\n")
	fmt.Fprintf(buf, "                .addKinds(ApiResourceKind.%s);\n", kindConst)
	buf.WriteString("            if (params.getOrg() != null) {\n")
	buf.WriteString("                req.setOrg(params.getOrg());\n")
	buf.WriteString("            }\n")
	buf.WriteString("            if (params.getQuery() != null) {\n")
	buf.WriteString("                req.setQuery(params.getQuery());\n")
	buf.WriteString("            }\n")
	buf.WriteString("            req.setExcludePublic(params.isExcludePublic());\n")
	buf.WriteString("            req.setCrossOrgPublic(params.isCrossOrgPublic());\n")
	buf.WriteString("            if (params.getPage() != null) {\n")
	buf.WriteString("                req.setPage(PageInfo.newBuilder()\n")
	buf.WriteString("                    .setNum(params.getPage().getNum())\n")
	buf.WriteString("                    .setSize(params.getPage().getSize())\n")
	buf.WriteString("                    .build());\n")
	buf.WriteString("            }\n")
	buf.WriteString("            SearchResponse resp = search.search(req.build());\n")
	buf.WriteString("            return new ListResult(resp.getEntriesList(), resp.getTotalCount(), resp.getTotalPages());\n")
	buf.WriteString("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n")
	buf.WriteString("    }\n")
}

// =========================================================================
// Input Type Generation
// =========================================================================

func generateJavaInputClass(schema *ServiceSchemaFile, cfg sdkResourceConfig, spec *TaskConfigSchema, specTypes []*TypeSchema, typeMap map[string]*TypeSchema) ([]byte, []string, error) {
	imports := newJavaImportSet()
	inputName := cfg.inputPrefix + "Input"
	protoPackage := schema.Package

	imports.add(protoPackage + "." + cfg.protoResType)
	imports.add(protoPackage + "." + spec.Name)
	imports.add("ai.stigmer.commons.apiresource.ApiResourceMetadata")
	imports.add("ai.stigmer.commons.apiresource.ApiResourceVisibility")
	if cfg.isVersioned {
		imports.add("ai.stigmer.commons.apiresource.ApiResourceMetadataVersion")
	}

	var specFields []*FieldSchema
	for _, f := range spec.Fields {
		if !metaFieldNames[f.Name] {
			specFields = append(specFields, f)
		}
	}

	javaEnumImportsForFields(specFields, imports)

	needsTimestamp := false
	needsStruct := false
	needsExecCtx := false
	needsEnvV1 := false
	needsRefKindOverride := false
	scanJavaImports := func(fields []*FieldSchema) {
		for _, f := range fields {
			if f.Type.Kind == "timestamp" {
				needsTimestamp = true
			}
			if f.Type.Kind == "struct" || f.Type.Kind == "value" {
				needsStruct = true
			}
			if f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "ExecutionValue" {
				needsExecCtx = true
			}
			if f.Type.Kind == "map" && f.Type.ValueType != nil && f.Type.ValueType.MessageType == "EnvironmentValue" {
				needsEnvV1 = true
			}
			if f.ReferenceKind != 0 {
				needsRefKindOverride = true
			}
		}
	}
	scanJavaImports(specFields)
	for _, t := range specTypes {
		if !isSpecialType(t.Name) {
			scanJavaImports(t.Fields)
			javaEnumImportsForFields(t.Fields, imports)
		}
	}
	if needsTimestamp {
		imports.add("com.google.protobuf.Timestamp")
	}
	if needsStruct {
		imports.add("com.google.protobuf.Struct")
	}
	if needsExecCtx {
		imports.add("ai.stigmer.agentic.executioncontext.v1.ExecutionValue")
	}
	if needsEnvV1 {
		imports.add("ai.stigmer.agentic.environment.v1.EnvironmentValue")
	}
	if needsRefKindOverride {
		imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind")
	}

	for _, t := range specTypes {
		if !isSpecialType(t.Name) && t.ProtoType != "" {
			parts := strings.Split(t.ProtoType, ".")
			if len(parts) > 1 {
				imports.add(t.ProtoType)
			}
		}
	}

	var allTypes []string
	allTypes = append(allTypes, inputName)

	var body bytes.Buffer

	fmt.Fprintf(&body, "/** Input for creating/updating a %s. */\n", cfg.protoResType)
	fmt.Fprintf(&body, "public final class %s {\n", inputName)

	body.WriteString("    private final String name;\n")
	body.WriteString("    private final String org;\n")
	body.WriteString("    private final String slug;\n")
	body.WriteString("    private final java.util.Map<String, String> labels;\n")
	body.WriteString("    private final ApiResourceVisibility visibility;\n")
	if cfg.isVersioned {
		body.WriteString("    private final String versionMessage;\n")
	}
	for _, f := range specFields {
		jType := javaTypeForField(f, typeMap)
		fmt.Fprintf(&body, "    private final %s %s;\n", jType, javaCamel(f.ProtoField))
	}
	body.WriteString("\n")

	fmt.Fprintf(&body, "    private %s(Builder builder) {\n", inputName)
	body.WriteString("        this.name = builder.name;\n")
	body.WriteString("        this.org = builder.org;\n")
	body.WriteString("        this.slug = builder.slug;\n")
	body.WriteString("        this.labels = builder.labels;\n")
	body.WriteString("        this.visibility = builder.visibility;\n")
	if cfg.isVersioned {
		body.WriteString("        this.versionMessage = builder.versionMessage;\n")
	}
	for _, f := range specFields {
		fieldName := javaCamel(f.ProtoField)
		fmt.Fprintf(&body, "        this.%s = builder.%s;\n", fieldName, fieldName)
	}
	body.WriteString("    }\n\n")

	emitJavaToProto(&body, cfg, spec, specFields, typeMap, protoPackage)

	body.WriteString("\n    public static Builder builder() { return new Builder(); }\n\n")

	body.WriteString("    public static final class Builder {\n")
	body.WriteString("        private String name;\n")
	body.WriteString("        private String org;\n")
	body.WriteString("        private String slug;\n")
	body.WriteString("        private java.util.Map<String, String> labels;\n")
	body.WriteString("        private ApiResourceVisibility visibility;\n")
	if cfg.isVersioned {
		body.WriteString("        private String versionMessage;\n")
	}
	for _, f := range specFields {
		jType := javaTypeForField(f, typeMap)
		fmt.Fprintf(&body, "        private %s %s;\n", jType, javaCamel(f.ProtoField))
	}
	body.WriteString("\n        private Builder() {}\n\n")
	body.WriteString("        public Builder name(String name) { this.name = name; return this; }\n")
	body.WriteString("        public Builder org(String org) { this.org = org; return this; }\n")
	body.WriteString("        public Builder slug(String slug) { this.slug = slug; return this; }\n")
	body.WriteString("        public Builder labels(java.util.Map<String, String> labels) { this.labels = labels; return this; }\n")
	body.WriteString("        public Builder visibility(ApiResourceVisibility visibility) { this.visibility = visibility; return this; }\n")
	if cfg.isVersioned {
		body.WriteString("        public Builder versionMessage(String versionMessage) { this.versionMessage = versionMessage; return this; }\n")
	}
	for _, f := range specFields {
		jType := javaTypeForField(f, typeMap)
		fieldName := javaCamel(f.ProtoField)
		fmt.Fprintf(&body, "        public Builder %s(%s %s) { this.%s = %s; return this; }\n",
			fieldName, jType, fieldName, fieldName, fieldName)
	}
	fmt.Fprintf(&body, "\n        public %s build() { return new %s(this); }\n", inputName, inputName)
	body.WriteString("    }\n")

	emitted := make(map[string]bool)
	for _, f := range specFields {
		emitJavaNestedTypes(&body, f, typeMap, emitted, &allTypes, imports, protoPackage)
	}

	body.WriteString("}\n")

	var full bytes.Buffer
	full.WriteString("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n")
	fmt.Fprintf(&full, "package %s;\n\n", javaGenPackage)
	imports.emit(&full)
	full.Write(body.Bytes())

	return full.Bytes(), allTypes, nil
}

// =========================================================================
// Nested Input Types (static inner classes)
// =========================================================================

func emitJavaNestedTypes(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, emitted map[string]bool, allTypes *[]string, imports *javaImportSet, protoPackage string) {
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
	protoType := msgName

	if ts.ProtoType != "" {
		imports.add(ts.ProtoType)
	}

	javaEnumImportsForFields(ts.Fields, imports)

	buf.WriteString("\n")
	fmt.Fprintf(buf, "    /** SDK input type for %s. */\n", msgName)
	fmt.Fprintf(buf, "    public static final class %s {\n", inputName)

	for _, field := range ts.Fields {
		jType := javaTypeForField(field, typeMap)
		fmt.Fprintf(buf, "        private final %s %s;\n", jType, javaCamel(field.ProtoField))
	}
	buf.WriteString("\n")

	fmt.Fprintf(buf, "        private %s(Builder builder) {\n", inputName)
	for _, field := range ts.Fields {
		fieldName := javaCamel(field.ProtoField)
		fmt.Fprintf(buf, "            this.%s = builder.%s;\n", fieldName, fieldName)
	}
	buf.WriteString("        }\n\n")

	fmt.Fprintf(buf, "        %s toProto() {\n", protoType)
	fmt.Fprintf(buf, "            %s.Builder builder = %s.newBuilder();\n", protoType, protoType)
	for _, field := range ts.Fields {
		emitJavaNestedToProtoField(buf, field, typeMap, protoPackage, "            ")
	}
	buf.WriteString("            return builder.build();\n")
	buf.WriteString("        }\n\n")

	buf.WriteString("        public static Builder builder() { return new Builder(); }\n\n")
	buf.WriteString("        public static final class Builder {\n")
	for _, field := range ts.Fields {
		jType := javaTypeForField(field, typeMap)
		fmt.Fprintf(buf, "            private %s %s;\n", jType, javaCamel(field.ProtoField))
	}
	buf.WriteString("\n            private Builder() {}\n\n")
	for _, field := range ts.Fields {
		jType := javaTypeForField(field, typeMap)
		fieldName := javaCamel(field.ProtoField)
		fmt.Fprintf(buf, "            public Builder %s(%s %s) { this.%s = %s; return this; }\n",
			fieldName, jType, fieldName, fieldName, fieldName)
	}
	fmt.Fprintf(buf, "\n            public %s build() { return new %s(this); }\n", inputName, inputName)
	buf.WriteString("        }\n")
	buf.WriteString("    }\n")

	*allTypes = append(*allTypes, inputName)

	for _, field := range ts.Fields {
		emitJavaNestedTypes(buf, field, typeMap, emitted, allTypes, imports, protoPackage)
	}
}

// =========================================================================
// toProto() Generation
// =========================================================================

func emitJavaToProto(buf *bytes.Buffer, cfg sdkResourceConfig, spec *TaskConfigSchema, specFields []*FieldSchema, typeMap map[string]*TypeSchema, protoPackage string) {
	resType := cfg.protoResType
	specType := spec.Name

	fmt.Fprintf(buf, "    %s toProto() {\n", resType)
	fmt.Fprintf(buf, "        %s.Builder spec = %s.newBuilder();\n", specType, specType)

	for _, f := range specFields {
		emitJavaToProtoField(buf, f, typeMap, protoPackage, "        ")
	}

	buf.WriteString("        ApiResourceMetadata.Builder metaBuilder = ApiResourceMetadata.newBuilder()\n")
	buf.WriteString("            .setName(this.name)\n")
	buf.WriteString("            .setOrg(this.org);\n")
	buf.WriteString("        if (this.slug != null) {\n")
	buf.WriteString("            metaBuilder.setSlug(this.slug);\n")
	buf.WriteString("        }\n")
	buf.WriteString("        if (this.labels != null) {\n")
	buf.WriteString("            metaBuilder.putAllLabels(this.labels);\n")
	buf.WriteString("        }\n")
	buf.WriteString("        if (this.visibility != null) {\n")
	buf.WriteString("            metaBuilder.setVisibility(this.visibility);\n")
	buf.WriteString("        }\n")
	if cfg.isVersioned {
		buf.WriteString("        if (this.versionMessage != null && !this.versionMessage.isEmpty()) {\n")
		buf.WriteString("            metaBuilder.setVersion(ApiResourceMetadataVersion.newBuilder()\n")
		buf.WriteString("                .setMessage(this.versionMessage)\n")
		buf.WriteString("                .build());\n")
		buf.WriteString("        }\n")
	}
	fmt.Fprintf(buf, "        return %s.newBuilder()\n", resType)
	fmt.Fprintf(buf, "            .setApiVersion(%q)\n", cfg.apiVersion)
	fmt.Fprintf(buf, "            .setKind(%q)\n", cfg.protoResType)
	buf.WriteString("            .setMetadata(metaBuilder.build())\n")
	buf.WriteString("            .setSpec(spec.build())\n")
	buf.WriteString("            .build();\n")
	buf.WriteString("    }\n")
}

func emitJavaToProtoField(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, protoPackage, indent string) {
	fieldName := javaCamel(f.ProtoField)

	switch {
	case f.Type.Kind == "timestamp":
		fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
		fmt.Fprintf(buf, "%s    java.time.Instant instant = java.time.Instant.parse(this.%s);\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(Timestamp.newBuilder()\n", indent, javaSetterName(f.ProtoField))
		fmt.Fprintf(buf, "%s        .setSeconds(instant.getEpochSecond())\n", indent)
		fmt.Fprintf(buf, "%s        .setNanos(instant.getNano())\n", indent)
		fmt.Fprintf(buf, "%s        .build());\n", indent)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "struct":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(ProtoConvert.mapToStruct(this.%s, %q));\n", indent, javaSetterName(f.ProtoField), fieldName, fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "value":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(ProtoConvert.objectToValue(this.%s, %q));\n", indent, javaSetterName(f.ProtoField), fieldName, fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "string" && f.Type.EnumType != "":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "string":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "bool" || f.Type.Kind == "int32" || f.Type.Kind == "uint32" ||
		f.Type.Kind == "int64" || f.Type.Kind == "float" || f.Type.Kind == "double":
		fmt.Fprintf(buf, "%sspec.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)

	case f.Type.Kind == "bytes":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(com.google.protobuf.ByteString.copyFrom(this.%s));\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "message" && f.Type.MessageType == "EnvironmentSpec":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s.toProto());\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		fmt.Fprintf(buf, "%sif (this.%s != null && this.%s.hasIdentifier()) {\n", indent, fieldName, fieldName)
		if f.ReferenceKind != 0 {
			enumName := apiResourceKindEnumNames[f.ReferenceKind]
			fmt.Fprintf(buf, "%s    spec.%s(this.%s.toProto().toBuilder()\n", indent, javaSetterName(f.ProtoField), fieldName)
			fmt.Fprintf(buf, "%s        .setKind(ApiResourceKind.%s).build());\n", indent, enumName)
		} else {
			fmt.Fprintf(buf, "%s    spec.%s(this.%s.toProto());\n", indent, javaSetterName(f.ProtoField), fieldName)
		}
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "message":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s.toProto());\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s);\n", indent, javaAddAllName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if elemMsg == "ApiResourceReference" {
			fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
			fmt.Fprintf(buf, "%s    for (ResourceRef item : this.%s) {\n", indent, fieldName)
			if f.ReferenceKind != 0 {
				enumName := apiResourceKindEnumNames[f.ReferenceKind]
				fmt.Fprintf(buf, "%s        spec.%s(item.toProto().toBuilder()\n", indent, javaAddName(f.ProtoField))
				fmt.Fprintf(buf, "%s            .setKind(ApiResourceKind.%s).build());\n", indent, enumName)
			} else {
				fmt.Fprintf(buf, "%s        spec.%s(item.toProto());\n", indent, javaAddName(f.ProtoField))
			}
			fmt.Fprintf(buf, "%s    }\n", indent)
			fmt.Fprintf(buf, "%s}\n", indent)
		} else {
			fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
			fmt.Fprintf(buf, "%s    for (%sInput item : this.%s) {\n", indent, elemMsg, fieldName)
			fmt.Fprintf(buf, "%s        spec.%s(item.toProto());\n", indent, javaAddName(f.ProtoField))
			fmt.Fprintf(buf, "%s    }\n", indent)
			fmt.Fprintf(buf, "%s}\n", indent)
		}

	case f.Type.Kind == "map":
		if f.Type.ValueType != nil && f.Type.ValueType.Kind == "message" {
			elemMsg := f.Type.ValueType.MessageType
			switch elemMsg {
			case "ExecutionValue":
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, EnvVarInput> entry : this.%s.entrySet()) {\n", indent, fieldName)
				fmt.Fprintf(buf, "%s        spec.%s(entry.getKey(), ExecutionValue.newBuilder()\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s            .setValue(entry.getValue().getValue())\n", indent)
				fmt.Fprintf(buf, "%s            .setIsSecret(entry.getValue().isSecret())\n", indent)
				fmt.Fprintf(buf, "%s            .build());\n", indent)
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			case "EnvironmentValue":
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, EnvVarInput> entry : this.%s.entrySet()) {\n", indent, fieldName)
				fmt.Fprintf(buf, "%s        EnvironmentValue.Builder vb = EnvironmentValue.newBuilder()\n", indent)
				fmt.Fprintf(buf, "%s            .setValue(entry.getValue().getValue())\n", indent)
				fmt.Fprintf(buf, "%s            .setIsSecret(entry.getValue().isSecret());\n", indent)
				fmt.Fprintf(buf, "%s        if (entry.getValue().getDescription() != null) {\n", indent)
				fmt.Fprintf(buf, "%s            vb.setDescription(entry.getValue().getDescription());\n", indent)
				fmt.Fprintf(buf, "%s        }\n", indent)
				fmt.Fprintf(buf, "%s        spec.%s(entry.getKey(), vb.build());\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			default:
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, %sInput> entry : this.%s.entrySet()) {\n", indent, elemMsg, fieldName)
				fmt.Fprintf(buf, "%s        spec.%s(entry.getKey(), entry.getValue().toProto());\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			}
		} else {
			fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
			fmt.Fprintf(buf, "%s    spec.%s(this.%s);\n", indent, javaPutAllName(f.ProtoField), fieldName)
			fmt.Fprintf(buf, "%s}\n", indent)
		}

	default:
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    spec.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)
	}
}

func emitJavaNestedToProtoField(buf *bytes.Buffer, f *FieldSchema, typeMap map[string]*TypeSchema, protoPackage, indent string) {
	fieldName := javaCamel(f.ProtoField)

	switch {
	case f.Type.Kind == "string" && f.Type.EnumType != "":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "string":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "bytes":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(com.google.protobuf.ByteString.copyFrom(this.%s));\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "bool" || f.Type.Kind == "int32" || f.Type.Kind == "uint32" ||
		f.Type.Kind == "int64" || f.Type.Kind == "float" || f.Type.Kind == "double":
		fmt.Fprintf(buf, "%sbuilder.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)

	case f.Type.Kind == "timestamp":
		fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
		fmt.Fprintf(buf, "%s    java.time.Instant instant = java.time.Instant.parse(this.%s);\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(com.google.protobuf.Timestamp.newBuilder()\n", indent, javaSetterName(f.ProtoField))
		fmt.Fprintf(buf, "%s        .setSeconds(instant.getEpochSecond())\n", indent)
		fmt.Fprintf(buf, "%s        .setNanos(instant.getNano())\n", indent)
		fmt.Fprintf(buf, "%s        .build());\n", indent)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "struct":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(ProtoConvert.mapToStruct(this.%s, %q));\n", indent, javaSetterName(f.ProtoField), fieldName, fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "value":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(ProtoConvert.objectToValue(this.%s, %q));\n", indent, javaSetterName(f.ProtoField), fieldName, fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "message" && f.Type.MessageType == "ApiResourceReference":
		fmt.Fprintf(buf, "%sif (this.%s != null && this.%s.hasIdentifier()) {\n", indent, fieldName, fieldName)
		if f.ReferenceKind != 0 {
			enumName := apiResourceKindEnumNames[f.ReferenceKind]
			fmt.Fprintf(buf, "%s    builder.%s(this.%s.toProto().toBuilder()\n", indent, javaSetterName(f.ProtoField), fieldName)
			fmt.Fprintf(buf, "%s        .setKind(ApiResourceKind.%s).build());\n", indent, enumName)
		} else {
			fmt.Fprintf(buf, "%s    builder.%s(this.%s.toProto());\n", indent, javaSetterName(f.ProtoField), fieldName)
		}
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "message":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(this.%s.toProto());\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "string":
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(this.%s);\n", indent, javaAddAllName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)

	case f.Type.Kind == "array" && f.Type.ElementType != nil && f.Type.ElementType.Kind == "message":
		elemMsg := f.Type.ElementType.MessageType
		if elemMsg == "ApiResourceReference" {
			fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
			fmt.Fprintf(buf, "%s    for (ResourceRef item : this.%s) {\n", indent, fieldName)
			if f.ReferenceKind != 0 {
				enumName := apiResourceKindEnumNames[f.ReferenceKind]
				fmt.Fprintf(buf, "%s        builder.%s(item.toProto().toBuilder()\n", indent, javaAddName(f.ProtoField))
				fmt.Fprintf(buf, "%s            .setKind(ApiResourceKind.%s).build());\n", indent, enumName)
			} else {
				fmt.Fprintf(buf, "%s        builder.%s(item.toProto());\n", indent, javaAddName(f.ProtoField))
			}
			fmt.Fprintf(buf, "%s    }\n", indent)
			fmt.Fprintf(buf, "%s}\n", indent)
		} else {
			fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
			fmt.Fprintf(buf, "%s    for (%sInput item : this.%s) {\n", indent, elemMsg, fieldName)
			fmt.Fprintf(buf, "%s        builder.%s(item.toProto());\n", indent, javaAddName(f.ProtoField))
			fmt.Fprintf(buf, "%s    }\n", indent)
			fmt.Fprintf(buf, "%s}\n", indent)
		}

	case f.Type.Kind == "map":
		if f.Type.ValueType != nil && f.Type.ValueType.Kind == "message" {
			elemMsg := f.Type.ValueType.MessageType
			switch elemMsg {
			case "ExecutionValue":
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, EnvVarInput> entry : this.%s.entrySet()) {\n", indent, fieldName)
				fmt.Fprintf(buf, "%s        builder.%s(entry.getKey(), ai.stigmer.agentic.executioncontext.v1.ExecutionValue.newBuilder()\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s            .setValue(entry.getValue().getValue())\n", indent)
				fmt.Fprintf(buf, "%s            .setIsSecret(entry.getValue().isSecret())\n", indent)
				fmt.Fprintf(buf, "%s            .build());\n", indent)
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			case "EnvironmentValue":
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, EnvVarInput> entry : this.%s.entrySet()) {\n", indent, fieldName)
				fmt.Fprintf(buf, "%s        ai.stigmer.agentic.environment.v1.EnvironmentValue.Builder vb = ai.stigmer.agentic.environment.v1.EnvironmentValue.newBuilder()\n", indent)
				fmt.Fprintf(buf, "%s            .setValue(entry.getValue().getValue())\n", indent)
				fmt.Fprintf(buf, "%s            .setIsSecret(entry.getValue().isSecret());\n", indent)
				fmt.Fprintf(buf, "%s        if (entry.getValue().getDescription() != null) {\n", indent)
				fmt.Fprintf(buf, "%s            vb.setDescription(entry.getValue().getDescription());\n", indent)
				fmt.Fprintf(buf, "%s        }\n", indent)
				fmt.Fprintf(buf, "%s        builder.%s(entry.getKey(), vb.build());\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			default:
				fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
				fmt.Fprintf(buf, "%s    for (java.util.Map.Entry<String, %sInput> entry : this.%s.entrySet()) {\n", indent, elemMsg, fieldName)
				fmt.Fprintf(buf, "%s        builder.%s(entry.getKey(), entry.getValue().toProto());\n", indent, javaPutName(f.ProtoField))
				fmt.Fprintf(buf, "%s    }\n", indent)
				fmt.Fprintf(buf, "%s}\n", indent)
			}
		} else {
			fmt.Fprintf(buf, "%sif (this.%s != null && !this.%s.isEmpty()) {\n", indent, fieldName, fieldName)
			fmt.Fprintf(buf, "%s    builder.%s(this.%s);\n", indent, javaPutAllName(f.ProtoField), fieldName)
			fmt.Fprintf(buf, "%s}\n", indent)
		}

	default:
		fmt.Fprintf(buf, "%sif (this.%s != null) {\n", indent, fieldName)
		fmt.Fprintf(buf, "%s    builder.%s(this.%s);\n", indent, javaSetterName(f.ProtoField), fieldName)
		fmt.Fprintf(buf, "%s}\n", indent)
	}
}

// =========================================================================
// Aggregate Client (GeneratedClient.java)
// =========================================================================

func generateJavaClientFile(outputDir string, resources []resourceGenInfo) error {
	imports := newJavaImportSet()
	imports.add("io.grpc.Channel")

	var body bytes.Buffer
	body.WriteString("/** Aggregate client with all resource-specific sub-clients. */\n")
	body.WriteString("public class GeneratedClient {\n")

	for _, r := range resources {
		fieldName := tsClientFieldName(r.resource)
		fmt.Fprintf(&body, "    public final %s %s;\n", r.clientName, fieldName)
	}
	body.WriteString("\n")

	body.WriteString("    public GeneratedClient(Channel channel) {\n")
	for _, r := range resources {
		fieldName := tsClientFieldName(r.resource)
		fmt.Fprintf(&body, "        this.%s = new %s(channel);\n", fieldName, r.clientName)
	}
	body.WriteString("    }\n")
	body.WriteString("}\n")

	return writeJavaFile(outputDir, "GeneratedClient.java", javaGenPackage, imports, body.Bytes())
}
