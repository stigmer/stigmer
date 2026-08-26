// sdk-client-java target: typed resource clients for the Java SDK
// (sdk/java/src/main/java/ai/stigmer/sdk/gen). Byte-parity port of
// sdk_client_java.go — per resource: the client class over the gRPC stubs
// and the builder-style Input class with nested static inner Input types
// and toProto methods; plus the static shared classes and the aggregate
// GeneratedClient with its extensible-client factory hooks.

import * as fs from "node:fs";
import * as path from "node:path";

import type { MethodSchema, ServiceDefinition, ServiceSchemaFile } from "./gen-common.js";
import { goQuote, isEmptyType, isIDType, isSpecialType, searchListSupersedesMethod, tsClientFieldName } from "./gen-common.js";
import { javaCamel, javaCapCamel } from "./lang-names.js";
import { apiResourceKindEnumNames } from "./resource-kind.js";
import type { ResourceGenInfo, SdkResourceConfig } from "./sdk-resource-config.js";
import { deriveResourceConfig, loadSpecSchemaWithTypes, META_FIELD_NAMES } from "./sdk-resource-config.js";
import type { FieldSchema, TaskConfigSchema, TypeSchema, TypeSpec } from "./schema.js";
import { readDirSorted } from "./schema.js";

const JAVA_GEN_PACKAGE = "ai.stigmer.sdk.gen";

// Resource clients customized by a handwritten subclass in the sdk root
// package: emitted non-final with a protected constructor, plus a protected
// factory method on GeneratedClient (the handwritten-wraps-generated
// layering, never the reverse).
const JAVA_EXTENSIBLE_CLIENTS = new Map<string, string>([
  ["SkillClient", "push routing over the artifact transfer lane (stigmer#675/#701)"],
]);

// =========================================================================
// Import tracking
// =========================================================================

class JavaImportSet {
  private readonly imports = new Set<string>();

  add(fqcn: string): void {
    if (fqcn.startsWith("java.lang.") && (fqcn.match(/\./g) ?? []).length === 2) {
      return;
    }
    this.imports.add(fqcn);
  }

  emit(buf: string[]): void {
    if (this.imports.size === 0) return;
    const sorted = [...this.imports].sort();
    for (const imp of sorted) {
      buf.push(`import ${imp};\n`);
    }
    buf.push("\n");
  }
}

// =========================================================================
// Naming + type mapping
// =========================================================================

const javaSetterName = (protoField: string): string => "set" + javaCapCamel(protoField);
const javaAddAllName = (protoField: string): string => "addAll" + javaCapCamel(protoField);
const javaAddName = (protoField: string): string => "add" + javaCapCamel(protoField);
const javaPutName = (protoField: string): string => "put" + javaCapCamel(protoField);
const javaPutAllName = (protoField: string): string => "putAll" + javaCapCamel(protoField);

function javaMethodLower(name: string): string {
  if (name.length === 0) return name;
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

function resolveJavaFQCN(fullType: string): string {
  if (isEmptyType(fullType)) return "com.google.protobuf.Empty";
  return fullType;
}

function javaTypeForField(f: FieldSchema): string {
  return javaTypeForTypeSpec(f.type);
}

function javaTypeForTypeSpec(ts: TypeSpec): string {
  switch (ts.kind) {
    case "string":
      if (ts.enumType !== undefined && ts.enumType !== "") {
        const parts = ts.enumType.split(".");
        return parts[parts.length - 1];
      }
      return "String";
    case "int32":
    case "uint32":
      return "int";
    case "int64":
      return "long";
    case "bool":
      return "boolean";
    case "float":
      return "float";
    case "double":
      return "double";
    case "bytes":
      return "byte[]";
    case "timestamp":
      return "String";
    case "struct":
      return "java.util.Map<String, Object>";
    case "value":
      return "Object";
    case "array":
      if (ts.elementType !== undefined) {
        return "java.util.List<" + javaBoxed(javaTypeForTypeSpec(ts.elementType)) + ">";
      }
      return "java.util.List<String>";
    case "map": {
      const keyType = ts.keyType !== undefined ? javaBoxed(javaTypeForTypeSpec(ts.keyType)) : "String";
      const valType = ts.valueType !== undefined ? javaBoxed(javaTypeForTypeSpec(ts.valueType)) : "String";
      return "java.util.Map<" + keyType + ", " + valType + ">";
    }
    case "message":
      switch (ts.messageType) {
        case "EnvironmentSpec":
          return "EnvSpecInput";
        case "EnvironmentValue":
        case "ExecutionValue":
          return "EnvVarInput";
        case "ApiResourceReference":
          return "ResourceRef";
        default:
          return (ts.messageType ?? "") + "Input";
      }
    default:
      return "String";
  }
}

function javaBoxed(t: string): string {
  switch (t) {
    case "int":
      return "Integer";
    case "long":
      return "Long";
    case "boolean":
      return "Boolean";
    case "float":
      return "Float";
    case "double":
      return "Double";
    default:
      return t;
  }
}

function javaEnumImportsForFields(fields: FieldSchema[], imports: JavaImportSet): void {
  for (const f of fields) {
    javaEnumImportsForTypeSpec(f.type, imports);
  }
}

function javaEnumImportsForTypeSpec(ts: TypeSpec, imports: JavaImportSet): void {
  if (ts.kind === "string" && ts.enumType !== undefined && ts.enumType !== "") {
    imports.add(ts.enumType);
  }
  if (ts.elementType !== undefined) {
    javaEnumImportsForTypeSpec(ts.elementType, imports);
  }
  if (ts.valueType !== undefined) {
    javaEnumImportsForTypeSpec(ts.valueType, imports);
  }
}

// =========================================================================
// File writer
// =========================================================================

function writeJavaFile(outputDir: string, filename: string, packageName: string, imports: JavaImportSet, body: string): void {
  const buf: string[] = [];
  buf.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  buf.push(`package ${packageName};\n\n`);
  imports.emit(buf);
  buf.push(body);
  buf.push("\n");
  fs.writeFileSync(path.join(outputDir, filename), buf.join(""));
}

// =========================================================================
// Entry point
// =========================================================================

/** Port of runSDKClientJavaGeneration. */
export function runSDKClientJavaGeneration(schemaDir: string, outputDir: string): void {
  const servicesDir = path.join(schemaDir, "services");
  const entries = readDirSorted(servicesDir);
  fs.mkdirSync(outputDir, { recursive: true });

  generateJavaErrors(outputDir);
  generateJavaErrorCode(outputDir);
  generateJavaSharedTypes(outputDir);

  const allResources: ResourceGenInfo[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() || !entry.name.endsWith(".json")) continue;
    const resource = entry.name.slice(0, -".json".length);
    if (resource === "search" || resource === "commons") continue;

    const schema = JSON.parse(fs.readFileSync(path.join(servicesDir, entry.name), "utf8")) as ServiceSchemaFile;
    const cfg = deriveResourceConfig(schema, schemaDir);

    let specSchema: TaskConfigSchema | null = null;
    let specTypes: TypeSchema[] = [];
    if (cfg.specSchema !== "") {
      [specSchema, specTypes] = loadSpecSchemaWithTypes(path.join(schemaDir, cfg.specSchema));
    }

    const [clientCode, genInfo] = generateJavaClientClass(schema, cfg, specSchema !== null);
    fs.writeFileSync(path.join(outputDir, cfg.protoResType + "Client.java"), clientCode);

    if (specSchema !== null) {
      const typeMap = new Map<string, TypeSchema>();
      for (const t of specTypes) typeMap.set(t.name, t);

      const [inputCode, inputTypes] = generateJavaInputClass(schema, cfg, specSchema, specTypes, typeMap);
      fs.writeFileSync(path.join(outputDir, cfg.protoResType + "Input.java"), inputCode);
      genInfo.inputTypes = inputTypes;
    }

    allResources.push(genInfo);
  }

  allResources.sort((a, b) => (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0));

  generateJavaClientFile(outputDir, allResources);
  process.stderr.write(`sdk-client-java: generated ${allResources.length} resource clients in ${outputDir}\n`);
}

// =========================================================================
// Static files
// =========================================================================

function generateJavaErrors(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("io.grpc.Status");
  imports.add("io.grpc.StatusRuntimeException");

  const body = `public final class StigmerException extends RuntimeException {
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

    /**
     * The server does not implement the called RPC — the code clients key
     * capability fallbacks on (e.g. the skill artifact transfer lane's
     * unary fallback, stigmer#675/#701). Checks the raw grpc code:
     * UNIMPLEMENTED deliberately has no ErrorCode mapping.
     */
    public boolean isUnimplemented() { return grpcCode == Status.Code.UNIMPLEMENTED; }

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
`;
  writeJavaFile(outputDir, "StigmerException.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaErrorCode(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("io.grpc.Status");

  const body = `public enum ErrorCode {
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
`;
  writeJavaFile(outputDir, "ErrorCode.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaSharedTypes(outputDir: string): void {
  generateJavaDeleteResourceInput(outputDir);
  generateJavaResourceRef(outputDir);
  generateJavaPage(outputDir);
  generateJavaListParams(outputDir);
  generateJavaListResult(outputDir);
  generateJavaEnvVarInput(outputDir);
  generateJavaEnvSpecInput(outputDir);
  generateJavaStigmerStream(outputDir);
  generateJavaStigmerBidiStream(outputDir);
  generateJavaProtoConvert(outputDir);
}

function generateJavaDeleteResourceInput(outputDir: string): void {
  const body = `public final class DeleteResourceInput {
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
`;
  writeJavaFile(outputDir, "DeleteResourceInput.java", JAVA_GEN_PACKAGE, new JavaImportSet(), body);
}

function generateJavaResourceRef(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("ai.stigmer.commons.apiresource.ApiResourceReference");
  imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind");

  const body = `public final class ResourceRef {
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
`;
  writeJavaFile(outputDir, "ResourceRef.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaPage(outputDir: string): void {
  const body = `public final class Page {
    private final int num;
    private final int size;

    public Page(int num, int size) {
        this.num = num;
        this.size = size;
    }

    public int getNum() { return num; }
    public int getSize() { return size; }
}
`;
  writeJavaFile(outputDir, "Page.java", JAVA_GEN_PACKAGE, new JavaImportSet(), body);
}

function generateJavaListParams(outputDir: string): void {
  const body = `public final class ListParams {
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
`;
  writeJavaFile(outputDir, "ListParams.java", JAVA_GEN_PACKAGE, new JavaImportSet(), body);
}

function generateJavaListResult(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("ai.stigmer.search.v1.SearchResult");

  const body = `public final class ListResult {
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
`;
  writeJavaFile(outputDir, "ListResult.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaEnvVarInput(outputDir: string): void {
  const body = `public final class EnvVarInput {
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
`;
  writeJavaFile(outputDir, "EnvVarInput.java", JAVA_GEN_PACKAGE, new JavaImportSet(), body);
}

function generateJavaEnvSpecInput(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("ai.stigmer.agentic.environment.v1.EnvironmentSpec");
  imports.add("ai.stigmer.agentic.environment.v1.EnvironmentValue");

  const body = `public final class EnvSpecInput {
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
`;
  writeJavaFile(outputDir, "EnvSpecInput.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaStigmerStream(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("io.grpc.StatusRuntimeException");

  const body = `public final class StigmerStream<T> implements java.util.Iterator<T> {
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
`;
  writeJavaFile(outputDir, "StigmerStream.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaStigmerBidiStream(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("io.grpc.StatusRuntimeException");
  imports.add("io.grpc.stub.StreamObserver");
  imports.add("java.util.concurrent.LinkedBlockingQueue");

  const body = `public final class StigmerBidiStream<Send, Receive> {
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
`;
  writeJavaFile(outputDir, "StigmerBidiStream.java", JAVA_GEN_PACKAGE, imports, body);
}

function generateJavaProtoConvert(outputDir: string): void {
  const imports = new JavaImportSet();
  imports.add("com.google.protobuf.NullValue");
  imports.add("com.google.protobuf.Struct");
  imports.add("com.google.protobuf.Value");
  imports.add("io.grpc.Status");

  const body = `// Struct/Value conversion for the generated Input types.
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
                objectToValue(entry.getValue(), path + "[\\"" + key + "\\"]"));
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
`;
  writeJavaFile(outputDir, "ProtoConvert.java", JAVA_GEN_PACKAGE, imports, body);
}

// =========================================================================
// Per-resource client class
// =========================================================================

function generateJavaClientClass(schema: ServiceSchemaFile, cfg: SdkResourceConfig, hasInputType: boolean): [string, ResourceGenInfo] {
  const imports = new JavaImportSet();
  imports.add("io.grpc.Channel");
  imports.add("io.grpc.StatusRuntimeException");

  const genInfo: ResourceGenInfo = {
    resource: schema.resource,
    clientName: cfg.clientName,
    inputTypes: [],
    streamTypes: [],
  };

  const needsSearch = schema.listVia === "SearchService";

  for (const svc of schema.services) {
    imports.add(schema.package + "." + svc.name + "Grpc");
  }

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      imports.add(resolveJavaFQCN(m.outputFullType));

      if (isIDType(m.inputType)) {
        imports.add(resolveJavaFQCN(m.inputFullType));
      }

      if (isEmptyType(m.inputFullType)) {
        imports.add("com.google.protobuf.Empty");
      }

      if (m.inputType === "ApiResourceDeleteInput") {
        imports.add("ai.stigmer.commons.apiresource.ApiResourceDeleteInput");
      }

      if (m.serverStreaming === true) {
        genInfo.streamTypes.push(cfg.protoResType + m.name + "Stream");
      }
    }
  }

  if (needsSearch) {
    imports.add("ai.stigmer.search.v1.SearchRequest");
    imports.add("ai.stigmer.search.v1.SearchResponse");
    imports.add("ai.stigmer.search.v1.SearchServiceGrpc");
    imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind");
    imports.add("ai.stigmer.commons.rpc.PageInfo");
  }

  const svcNeedsBidi = new Set<string>();
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (m.serverStreaming === true && m.clientStreaming === true) {
        svcNeedsBidi.add(svc.role);
        imports.add("io.grpc.stub.StreamObserver");
        imports.add("java.util.concurrent.LinkedBlockingQueue");
      }
    }
  }

  const body: string[] = [];

  body.push(`/** Provides operations on ${schema.resource} resources. */\n`);
  if (JAVA_EXTENSIBLE_CLIENTS.has(cfg.clientName)) {
    body.push(`public class ${cfg.clientName} {\n`);
  } else {
    body.push(`public final class ${cfg.clientName} {\n`);
  }

  for (const svc of schema.services) {
    body.push(`    private final ${svc.name}Grpc.${svc.name}BlockingStub ${svc.role};\n`);
    if (svcNeedsBidi.has(svc.role)) {
      body.push(`    private final ${svc.name}Grpc.${svc.name}Stub ${svc.role}Async;\n`);
    }
  }
  if (needsSearch) {
    body.push("    private final SearchServiceGrpc.SearchServiceBlockingStub search;\n");
  }
  body.push("\n");

  const ctorVisibility = JAVA_EXTENSIBLE_CLIENTS.has(cfg.clientName) ? "protected " : "";
  body.push(`    ${ctorVisibility}${cfg.clientName}(Channel channel) {\n`);
  for (const svc of schema.services) {
    body.push(`        this.${svc.role} = ${svc.name}Grpc.newBlockingStub(channel);\n`);
    if (svcNeedsBidi.has(svc.role)) {
      body.push(`        this.${svc.role}Async = ${svc.name}Grpc.newStub(channel);\n`);
    }
  }
  if (needsSearch) {
    body.push("        this.search = SearchServiceGrpc.newBlockingStub(channel);\n");
  }
  body.push("    }\n");

  for (const svc of schema.services) {
    for (const m of svc.methods) {
      if (searchListSupersedesMethod(schema, m)) continue;
      body.push("\n");
      if (m.serverStreaming === true) {
        generateJavaStreamingMethod(body, m, svc, imports);
      } else {
        generateJavaMethod(body, m, svc, cfg, hasInputType, imports);
      }
    }
  }

  if (needsSearch) {
    body.push("\n");
    generateJavaSearchList(body, cfg);
  }

  body.push("}\n");

  const full: string[] = [];
  full.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  full.push(`package ${JAVA_GEN_PACKAGE};\n\n`);
  imports.emit(full);
  full.push(...body);

  return [full.join(""), genInfo];
}

// =========================================================================
// Method generation
// =========================================================================

function generateJavaMethod(
  buf: string[],
  m: MethodSchema,
  svc: ServiceDefinition,
  cfg: SdkResourceConfig,
  hasInputType: boolean,
  imports: JavaImportSet,
): void {
  const emptyInput = isEmptyType(m.inputFullType);
  const emptyOutput = isEmptyType(m.outputFullType);
  const isIDIn = isIDType(m.inputType);
  const isDeleteIn = m.inputType === "ApiResourceDeleteInput";
  const isResourceIn = m.inputType === cfg.protoResType;
  const isApiResRefIn = m.inputType === "ApiResourceReference";

  const outputType = emptyOutput ? "void" : m.outputType;
  const methodName = javaMethodLower(m.name);
  const role = svc.role;
  const returnKw = emptyOutput ? "" : "return ";

  if (emptyInput && emptyOutput) {
    buf.push(`    public void ${methodName}() {\n`);
    buf.push("        try {\n");
    buf.push(`            ${role}.${javaMethodLower(m.name)}(Empty.getDefaultInstance());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (emptyInput) {
    buf.push(`    public ${outputType} ${methodName}() {\n`);
    buf.push("        try {\n");
    buf.push(`            return ${role}.${javaMethodLower(m.name)}(Empty.getDefaultInstance());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (isResourceIn && hasInputType) {
    const inputTypeName = cfg.inputPrefix + "Input";
    buf.push(`    public ${outputType} ${methodName}(${inputTypeName} input) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(input.toProto());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (isResourceIn && !hasInputType) {
    imports.add(resolveJavaFQCN(m.inputFullType));
    buf.push(`    public ${outputType} ${methodName}(${m.inputType} input) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(input);\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (emptyOutput && isIDIn) {
    buf.push(`    public void ${methodName}(String id) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${role}.${javaMethodLower(m.name)}(${m.inputType}.newBuilder().setValue(id).build());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (isIDIn) {
    buf.push(`    public ${outputType} ${methodName}(String id) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(${m.inputType}.newBuilder().setValue(id).build());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (isDeleteIn) {
    imports.add("ai.stigmer.commons.apiresource.ApiResourceDeleteInput");
    buf.push(`    public ${outputType} ${methodName}(DeleteResourceInput input) {\n`);
    buf.push("        try {\n");
    buf.push("            ApiResourceDeleteInput.Builder req = ApiResourceDeleteInput.newBuilder()\n");
    buf.push("                .setResourceId(input.getResourceId())\n");
    buf.push("                .setForce(input.isForce());\n");
    buf.push("            if (input.getVersionMessage() != null) {\n");
    buf.push("                req.setVersionMessage(input.getVersionMessage());\n");
    buf.push("            }\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(req.build());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else if (isApiResRefIn) {
    imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind");
    buf.push(`    public ${outputType} ${methodName}(ResourceRef ref) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(ref.toProto().toBuilder().setKind(ApiResourceKind.${cfg.resourceKind}).build());\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else {
    imports.add(resolveJavaFQCN(m.inputFullType));
    buf.push(`    public ${outputType} ${methodName}(${m.inputType} input) {\n`);
    buf.push("        try {\n");
    buf.push(`            ${returnKw}${role}.${javaMethodLower(m.name)}(input);\n`);
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  }
}

function generateJavaStreamingMethod(buf: string[], m: MethodSchema, svc: ServiceDefinition, imports: JavaImportSet): void {
  const isIDIn = isIDType(m.inputType);
  const outputType = m.outputType;
  const methodName = javaMethodLower(m.name);

  if (m.clientStreaming === true) {
    imports.add(resolveJavaFQCN(m.inputFullType));
    imports.add(resolveJavaFQCN(m.outputFullType));
    buf.push(`    public StigmerBidiStream<${m.inputType}, ${outputType}> ${methodName}() {\n`);
    buf.push("        LinkedBlockingQueue<Object> queue = new LinkedBlockingQueue<>();\n");
    buf.push(`        StreamObserver<${m.inputType}> requests = ${svc.role}Async.${javaMethodLower(m.name)}(\n`);
    buf.push("            StigmerBidiStream.responseObserver(queue));\n");
    buf.push("        return new StigmerBidiStream<>(requests, queue);\n");
    buf.push("    }\n");
  } else if (isIDIn) {
    imports.add(resolveJavaFQCN(m.inputFullType));
    buf.push(`    public StigmerStream<${outputType}> ${methodName}(String id) {\n`);
    buf.push("        try {\n");
    buf.push(`            java.util.Iterator<${outputType}> iter = ${svc.role}.${javaMethodLower(m.name)}(\n`);
    buf.push(`                ${m.inputType}.newBuilder().setValue(id).build());\n`);
    buf.push("            return new StigmerStream<>(iter);\n");
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  } else {
    imports.add(resolveJavaFQCN(m.inputFullType));
    buf.push(`    public StigmerStream<${outputType}> ${methodName}(${m.inputType} input) {\n`);
    buf.push("        try {\n");
    buf.push(`            java.util.Iterator<${outputType}> iter = ${svc.role}.${javaMethodLower(m.name)}(input);\n`);
    buf.push("            return new StigmerStream<>(iter);\n");
    buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
    buf.push("    }\n");
  }
}

function generateJavaSearchList(buf: string[], cfg: SdkResourceConfig): void {
  buf.push("    public ListResult list(ListParams params) {\n");
  buf.push("        try {\n");
  buf.push("            SearchRequest.Builder req = SearchRequest.newBuilder()\n");
  buf.push(`                .addKinds(ApiResourceKind.${cfg.resourceKind});\n`);
  buf.push("            if (params.getOrg() != null) {\n");
  buf.push("                req.setOrg(params.getOrg());\n");
  buf.push("            }\n");
  buf.push("            if (params.getQuery() != null) {\n");
  buf.push("                req.setQuery(params.getQuery());\n");
  buf.push("            }\n");
  buf.push("            req.setExcludePublic(params.isExcludePublic());\n");
  buf.push("            req.setCrossOrgPublic(params.isCrossOrgPublic());\n");
  buf.push("            if (params.getPage() != null) {\n");
  buf.push("                req.setPage(PageInfo.newBuilder()\n");
  buf.push("                    .setNum(params.getPage().getNum())\n");
  buf.push("                    .setSize(params.getPage().getSize())\n");
  buf.push("                    .build());\n");
  buf.push("            }\n");
  buf.push("            SearchResponse resp = search.search(req.build());\n");
  buf.push("            return new ListResult(resp.getEntriesList(), resp.getTotalCount(), resp.getTotalPages());\n");
  buf.push("        } catch (StatusRuntimeException e) { throw StigmerException.wrap(e); }\n");
  buf.push("    }\n");
}

// =========================================================================
// Input type generation
// =========================================================================

function generateJavaInputClass(
  schema: ServiceSchemaFile,
  cfg: SdkResourceConfig,
  spec: TaskConfigSchema,
  specTypes: TypeSchema[],
  typeMap: Map<string, TypeSchema>,
): [string, string[]] {
  const imports = new JavaImportSet();
  const inputName = cfg.inputPrefix + "Input";
  const protoPackage = schema.package;

  imports.add(protoPackage + "." + cfg.protoResType);
  imports.add(protoPackage + "." + spec.name);
  imports.add("ai.stigmer.commons.apiresource.ApiResourceMetadata");
  imports.add("ai.stigmer.commons.apiresource.ApiResourceVisibility");
  if (cfg.isVersioned) {
    imports.add("ai.stigmer.commons.apiresource.ApiResourceMetadataVersion");
  }

  const specFields = spec.fields.filter((f) => !META_FIELD_NAMES.has(f.name));

  javaEnumImportsForFields(specFields, imports);

  let needsTimestamp = false;
  let needsStruct = false;
  let needsExecCtx = false;
  let needsEnvV1 = false;
  let needsRefKindOverride = false;
  const scanJavaImports = (fields: FieldSchema[]): void => {
    for (const f of fields) {
      if (f.type.kind === "timestamp") needsTimestamp = true;
      if (f.type.kind === "struct" || f.type.kind === "value") needsStruct = true;
      if (f.type.kind === "map" && f.type.valueType?.messageType === "ExecutionValue") needsExecCtx = true;
      if (f.type.kind === "map" && f.type.valueType?.messageType === "EnvironmentValue") needsEnvV1 = true;
      if ((f.referenceKind ?? 0) !== 0) needsRefKindOverride = true;
    }
  };
  scanJavaImports(specFields);
  for (const t of specTypes) {
    if (!isSpecialType(t.name)) {
      scanJavaImports(t.fields);
      javaEnumImportsForFields(t.fields, imports);
    }
  }
  if (needsTimestamp) imports.add("com.google.protobuf.Timestamp");
  if (needsStruct) imports.add("com.google.protobuf.Struct");
  if (needsExecCtx) imports.add("ai.stigmer.agentic.executioncontext.v1.ExecutionValue");
  if (needsEnvV1) imports.add("ai.stigmer.agentic.environment.v1.EnvironmentValue");
  if (needsRefKindOverride) imports.add("ai.stigmer.commons.apiresource.apiresourcekind.ApiResourceKind");

  for (const t of specTypes) {
    if (!isSpecialType(t.name) && t.protoType !== "") {
      const parts = t.protoType.split(".");
      if (parts.length > 1) {
        imports.add(t.protoType);
      }
    }
  }

  const allTypes: string[] = [inputName];

  const body: string[] = [];

  body.push(`/** Input for creating/updating a ${cfg.protoResType}. */\n`);
  body.push(`public final class ${inputName} {\n`);

  body.push("    private final String id;\n");
  body.push("    private final String name;\n");
  body.push("    private final String org;\n");
  body.push("    private final String slug;\n");
  body.push("    private final java.util.Map<String, String> labels;\n");
  body.push("    private final ApiResourceVisibility visibility;\n");
  if (cfg.isVersioned) {
    body.push("    private final String versionMessage;\n");
  }
  for (const f of specFields) {
    body.push(`    private final ${javaTypeForField(f)} ${javaCamel(f.protoField)};\n`);
  }
  body.push("\n");

  body.push(`    private ${inputName}(Builder builder) {\n`);
  body.push("        this.id = builder.id;\n");
  body.push("        this.name = builder.name;\n");
  body.push("        this.org = builder.org;\n");
  body.push("        this.slug = builder.slug;\n");
  body.push("        this.labels = builder.labels;\n");
  body.push("        this.visibility = builder.visibility;\n");
  if (cfg.isVersioned) {
    body.push("        this.versionMessage = builder.versionMessage;\n");
  }
  for (const f of specFields) {
    const fieldName = javaCamel(f.protoField);
    body.push(`        this.${fieldName} = builder.${fieldName};\n`);
  }
  body.push("    }\n\n");

  emitJavaToProto(body, cfg, spec, specFields);

  body.push("\n    public static Builder builder() { return new Builder(); }\n\n");

  body.push("    public static final class Builder {\n");
  body.push("        private String id;\n");
  body.push("        private String name;\n");
  body.push("        private String org;\n");
  body.push("        private String slug;\n");
  body.push("        private java.util.Map<String, String> labels;\n");
  body.push("        private ApiResourceVisibility visibility;\n");
  if (cfg.isVersioned) {
    body.push("        private String versionMessage;\n");
  }
  for (const f of specFields) {
    body.push(`        private ${javaTypeForField(f)} ${javaCamel(f.protoField)};\n`);
  }
  body.push("\n        private Builder() {}\n\n");
  body.push("        /**\n");
  body.push("         * The resource's metadata.id, for exact update addressing when set\n");
  body.push("         * from a loaded resource. Required for updates to platform-scoped\n");
  body.push("         * (org-less) kinds, where the org+slug fallback cannot match.\n");
  body.push("         */\n");
  body.push("        public Builder id(String id) { this.id = id; return this; }\n");
  body.push("        public Builder name(String name) { this.name = name; return this; }\n");
  body.push("        public Builder org(String org) { this.org = org; return this; }\n");
  body.push("        public Builder slug(String slug) { this.slug = slug; return this; }\n");
  body.push("        public Builder labels(java.util.Map<String, String> labels) { this.labels = labels; return this; }\n");
  body.push("        public Builder visibility(ApiResourceVisibility visibility) { this.visibility = visibility; return this; }\n");
  if (cfg.isVersioned) {
    body.push("        public Builder versionMessage(String versionMessage) { this.versionMessage = versionMessage; return this; }\n");
  }
  for (const f of specFields) {
    const jType = javaTypeForField(f);
    const fieldName = javaCamel(f.protoField);
    body.push(`        public Builder ${fieldName}(${jType} ${fieldName}) { this.${fieldName} = ${fieldName}; return this; }\n`);
  }
  body.push(`\n        public ${inputName} build() { return new ${inputName}(this); }\n`);
  body.push("    }\n");

  const emitted = new Set<string>();
  for (const f of specFields) {
    emitJavaNestedTypes(body, f, typeMap, emitted, allTypes, imports);
  }

  body.push("}\n");

  const full: string[] = [];
  full.push("// Code generated by stigmer-codegen. DO NOT EDIT.\n\n");
  full.push(`package ${JAVA_GEN_PACKAGE};\n\n`);
  imports.emit(full);
  full.push(...body);

  return [full.join(""), allTypes];
}

// =========================================================================
// Nested input types (static inner classes)
// =========================================================================

function emitJavaNestedTypes(
  buf: string[],
  f: FieldSchema,
  typeMap: Map<string, TypeSchema>,
  emitted: Set<string>,
  allTypes: string[],
  imports: JavaImportSet,
): void {
  let msgName: string;
  const t = f.type;
  if (t.kind === "message") {
    msgName = t.messageType ?? "";
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    msgName = t.elementType.messageType ?? "";
  } else if (t.kind === "map" && t.valueType?.kind === "message") {
    msgName = t.valueType.messageType ?? "";
  } else {
    return;
  }

  if (isSpecialType(msgName) || emitted.has(msgName)) return;
  const ts = typeMap.get(msgName);
  if (ts === undefined) return;
  emitted.add(msgName);

  const inputName = msgName + "Input";
  const protoType = msgName;

  if (ts.protoType !== "") {
    imports.add(ts.protoType);
  }

  javaEnumImportsForFields(ts.fields, imports);

  buf.push("\n");
  buf.push(`    /** SDK input type for ${msgName}. */\n`);
  buf.push(`    public static final class ${inputName} {\n`);

  for (const field of ts.fields) {
    buf.push(`        private final ${javaTypeForField(field)} ${javaCamel(field.protoField)};\n`);
  }
  buf.push("\n");

  buf.push(`        private ${inputName}(Builder builder) {\n`);
  for (const field of ts.fields) {
    const fieldName = javaCamel(field.protoField);
    buf.push(`            this.${fieldName} = builder.${fieldName};\n`);
  }
  buf.push("        }\n\n");

  buf.push(`        ${protoType} toProto() {\n`);
  buf.push(`            ${protoType}.Builder builder = ${protoType}.newBuilder();\n`);
  for (const field of ts.fields) {
    emitJavaNestedToProtoField(buf, field, "            ");
  }
  buf.push("            return builder.build();\n");
  buf.push("        }\n\n");

  buf.push("        public static Builder builder() { return new Builder(); }\n\n");
  buf.push("        public static final class Builder {\n");
  for (const field of ts.fields) {
    buf.push(`            private ${javaTypeForField(field)} ${javaCamel(field.protoField)};\n`);
  }
  buf.push("\n            private Builder() {}\n\n");
  for (const field of ts.fields) {
    const jType = javaTypeForField(field);
    const fieldName = javaCamel(field.protoField);
    buf.push(`            public Builder ${fieldName}(${jType} ${fieldName}) { this.${fieldName} = ${fieldName}; return this; }\n`);
  }
  buf.push(`\n            public ${inputName} build() { return new ${inputName}(this); }\n`);
  buf.push("        }\n");
  buf.push("    }\n");

  allTypes.push(inputName);

  for (const field of ts.fields) {
    emitJavaNestedTypes(buf, field, typeMap, emitted, allTypes, imports);
  }
}

// =========================================================================
// toProto() generation
// =========================================================================

function emitJavaToProto(buf: string[], cfg: SdkResourceConfig, spec: TaskConfigSchema, specFields: FieldSchema[]): void {
  const resType = cfg.protoResType;
  const specType = spec.name;

  buf.push(`    ${resType} toProto() {\n`);
  buf.push(`        ${specType}.Builder spec = ${specType}.newBuilder();\n`);

  for (const f of specFields) {
    emitJavaToProtoField(buf, f, "        ");
  }

  buf.push("        ApiResourceMetadata.Builder metaBuilder = ApiResourceMetadata.newBuilder()\n");
  buf.push("            .setName(this.name)\n");
  buf.push("            .setOrg(this.org);\n");
  buf.push("        if (this.id != null) {\n");
  buf.push("            metaBuilder.setId(this.id);\n");
  buf.push("        }\n");
  buf.push("        if (this.slug != null) {\n");
  buf.push("            metaBuilder.setSlug(this.slug);\n");
  buf.push("        }\n");
  buf.push("        if (this.labels != null) {\n");
  buf.push("            metaBuilder.putAllLabels(this.labels);\n");
  buf.push("        }\n");
  buf.push("        if (this.visibility != null) {\n");
  buf.push("            metaBuilder.setVisibility(this.visibility);\n");
  buf.push("        }\n");
  if (cfg.isVersioned) {
    buf.push("        if (this.versionMessage != null && !this.versionMessage.isEmpty()) {\n");
    buf.push("            metaBuilder.setVersion(ApiResourceMetadataVersion.newBuilder()\n");
    buf.push("                .setMessage(this.versionMessage)\n");
    buf.push("                .build());\n");
    buf.push("        }\n");
  }
  buf.push(`        return ${resType}.newBuilder()\n`);
  buf.push(`            .setApiVersion(${goQuote(cfg.apiVersion)})\n`);
  buf.push(`            .setKind(${goQuote(cfg.protoResType)})\n`);
  buf.push("            .setMetadata(metaBuilder.build())\n");
  buf.push("            .setSpec(spec.build())\n");
  buf.push("            .build();\n");
  buf.push("    }\n");
}

function emitJavaToProtoField(buf: string[], f: FieldSchema, indent: string): void {
  const fieldName = javaCamel(f.protoField);
  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "timestamp") {
    buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
    buf.push(`${indent}    java.time.Instant instant = java.time.Instant.parse(this.${fieldName});\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(Timestamp.newBuilder()\n`);
    buf.push(`${indent}        .setSeconds(instant.getEpochSecond())\n`);
    buf.push(`${indent}        .setNanos(instant.getNano())\n`);
    buf.push(`${indent}        .build());\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "struct") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(ProtoConvert.mapToStruct(this.${fieldName}, ${goQuote(fieldName)}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "value") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(ProtoConvert.objectToValue(this.${fieldName}, ${goQuote(fieldName)}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "string" && t.enumType !== undefined && t.enumType !== "") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "string") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "bool" || t.kind === "int32" || t.kind === "uint32" || t.kind === "int64" || t.kind === "float" || t.kind === "double") {
    buf.push(`${indent}spec.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
  } else if (t.kind === "bytes") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(com.google.protobuf.ByteString.copyFrom(this.${fieldName}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "message" && t.messageType === "EnvironmentSpec") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName}.toProto());\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    buf.push(`${indent}if (this.${fieldName} != null && this.${fieldName}.hasIdentifier()) {\n`);
    if (refKind !== 0) {
      const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
      buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName}.toProto().toBuilder()\n`);
      buf.push(`${indent}        .setKind(ApiResourceKind.${enumName}).build());\n`);
    } else {
      buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName}.toProto());\n`);
    }
    buf.push(`${indent}}\n`);
  } else if (t.kind === "message") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName}.toProto());\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "string") {
    buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
    buf.push(`${indent}    spec.${javaAddAllName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (elemMsg === "ApiResourceReference") {
      buf.push(`${indent}if (this.${fieldName} != null) {\n`);
      buf.push(`${indent}    for (ResourceRef item : this.${fieldName}) {\n`);
      if (refKind !== 0) {
        const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
        buf.push(`${indent}        spec.${javaAddName(f.protoField)}(item.toProto().toBuilder()\n`);
        buf.push(`${indent}            .setKind(ApiResourceKind.${enumName}).build());\n`);
      } else {
        buf.push(`${indent}        spec.${javaAddName(f.protoField)}(item.toProto());\n`);
      }
      buf.push(`${indent}    }\n`);
      buf.push(`${indent}}\n`);
    } else {
      buf.push(`${indent}if (this.${fieldName} != null) {\n`);
      buf.push(`${indent}    for (${elemMsg}Input item : this.${fieldName}) {\n`);
      buf.push(`${indent}        spec.${javaAddName(f.protoField)}(item.toProto());\n`);
      buf.push(`${indent}    }\n`);
      buf.push(`${indent}}\n`);
    }
  } else if (t.kind === "map") {
    if (t.valueType?.kind === "message") {
      const elemMsg = t.valueType.messageType ?? "";
      if (elemMsg === "ExecutionValue") {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, EnvVarInput> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        spec.${javaPutName(f.protoField)}(entry.getKey(), ExecutionValue.newBuilder()\n`);
        buf.push(`${indent}            .setValue(entry.getValue().getValue())\n`);
        buf.push(`${indent}            .setIsSecret(entry.getValue().isSecret())\n`);
        buf.push(`${indent}            .build());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      } else if (elemMsg === "EnvironmentValue") {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, EnvVarInput> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        EnvironmentValue.Builder vb = EnvironmentValue.newBuilder()\n`);
        buf.push(`${indent}            .setValue(entry.getValue().getValue())\n`);
        buf.push(`${indent}            .setIsSecret(entry.getValue().isSecret());\n`);
        buf.push(`${indent}        if (entry.getValue().getDescription() != null) {\n`);
        buf.push(`${indent}            vb.setDescription(entry.getValue().getDescription());\n`);
        buf.push(`${indent}        }\n`);
        buf.push(`${indent}        spec.${javaPutName(f.protoField)}(entry.getKey(), vb.build());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      } else {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, ${elemMsg}Input> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        spec.${javaPutName(f.protoField)}(entry.getKey(), entry.getValue().toProto());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      }
    } else {
      buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
      buf.push(`${indent}    spec.${javaPutAllName(f.protoField)}(this.${fieldName});\n`);
      buf.push(`${indent}}\n`);
    }
  } else {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    spec.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  }
}

function emitJavaNestedToProtoField(buf: string[], f: FieldSchema, indent: string): void {
  const fieldName = javaCamel(f.protoField);
  const t = f.type;
  const refKind = f.referenceKind ?? 0;

  if (t.kind === "string" && t.enumType !== undefined && t.enumType !== "") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "string") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "bytes") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(com.google.protobuf.ByteString.copyFrom(this.${fieldName}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "bool" || t.kind === "int32" || t.kind === "uint32" || t.kind === "int64" || t.kind === "float" || t.kind === "double") {
    buf.push(`${indent}builder.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
  } else if (t.kind === "timestamp") {
    buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
    buf.push(`${indent}    java.time.Instant instant = java.time.Instant.parse(this.${fieldName});\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(com.google.protobuf.Timestamp.newBuilder()\n`);
    buf.push(`${indent}        .setSeconds(instant.getEpochSecond())\n`);
    buf.push(`${indent}        .setNanos(instant.getNano())\n`);
    buf.push(`${indent}        .build());\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "struct") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(ProtoConvert.mapToStruct(this.${fieldName}, ${goQuote(fieldName)}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "value") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(ProtoConvert.objectToValue(this.${fieldName}, ${goQuote(fieldName)}));\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "message" && t.messageType === "ApiResourceReference") {
    buf.push(`${indent}if (this.${fieldName} != null && this.${fieldName}.hasIdentifier()) {\n`);
    if (refKind !== 0) {
      const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
      buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName}.toProto().toBuilder()\n`);
      buf.push(`${indent}        .setKind(ApiResourceKind.${enumName}).build());\n`);
    } else {
      buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName}.toProto());\n`);
    }
    buf.push(`${indent}}\n`);
  } else if (t.kind === "message") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName}.toProto());\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "string") {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaAddAllName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  } else if (t.kind === "array" && t.elementType?.kind === "message") {
    const elemMsg = t.elementType.messageType ?? "";
    if (elemMsg === "ApiResourceReference") {
      buf.push(`${indent}if (this.${fieldName} != null) {\n`);
      buf.push(`${indent}    for (ResourceRef item : this.${fieldName}) {\n`);
      if (refKind !== 0) {
        const enumName = apiResourceKindEnumNames.get(refKind) ?? "";
        buf.push(`${indent}        builder.${javaAddName(f.protoField)}(item.toProto().toBuilder()\n`);
        buf.push(`${indent}            .setKind(ApiResourceKind.${enumName}).build());\n`);
      } else {
        buf.push(`${indent}        builder.${javaAddName(f.protoField)}(item.toProto());\n`);
      }
      buf.push(`${indent}    }\n`);
      buf.push(`${indent}}\n`);
    } else {
      buf.push(`${indent}if (this.${fieldName} != null) {\n`);
      buf.push(`${indent}    for (${elemMsg}Input item : this.${fieldName}) {\n`);
      buf.push(`${indent}        builder.${javaAddName(f.protoField)}(item.toProto());\n`);
      buf.push(`${indent}    }\n`);
      buf.push(`${indent}}\n`);
    }
  } else if (t.kind === "map") {
    if (t.valueType?.kind === "message") {
      const elemMsg = t.valueType.messageType ?? "";
      if (elemMsg === "ExecutionValue") {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, EnvVarInput> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        builder.${javaPutName(f.protoField)}(entry.getKey(), ai.stigmer.agentic.executioncontext.v1.ExecutionValue.newBuilder()\n`);
        buf.push(`${indent}            .setValue(entry.getValue().getValue())\n`);
        buf.push(`${indent}            .setIsSecret(entry.getValue().isSecret())\n`);
        buf.push(`${indent}            .build());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      } else if (elemMsg === "EnvironmentValue") {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, EnvVarInput> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        ai.stigmer.agentic.environment.v1.EnvironmentValue.Builder vb = ai.stigmer.agentic.environment.v1.EnvironmentValue.newBuilder()\n`);
        buf.push(`${indent}            .setValue(entry.getValue().getValue())\n`);
        buf.push(`${indent}            .setIsSecret(entry.getValue().isSecret());\n`);
        buf.push(`${indent}        if (entry.getValue().getDescription() != null) {\n`);
        buf.push(`${indent}            vb.setDescription(entry.getValue().getDescription());\n`);
        buf.push(`${indent}        }\n`);
        buf.push(`${indent}        builder.${javaPutName(f.protoField)}(entry.getKey(), vb.build());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      } else {
        buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
        buf.push(`${indent}    for (java.util.Map.Entry<String, ${elemMsg}Input> entry : this.${fieldName}.entrySet()) {\n`);
        buf.push(`${indent}        builder.${javaPutName(f.protoField)}(entry.getKey(), entry.getValue().toProto());\n`);
        buf.push(`${indent}    }\n`);
        buf.push(`${indent}}\n`);
      }
    } else {
      buf.push(`${indent}if (this.${fieldName} != null && !this.${fieldName}.isEmpty()) {\n`);
      buf.push(`${indent}    builder.${javaPutAllName(f.protoField)}(this.${fieldName});\n`);
      buf.push(`${indent}}\n`);
    }
  } else {
    buf.push(`${indent}if (this.${fieldName} != null) {\n`);
    buf.push(`${indent}    builder.${javaSetterName(f.protoField)}(this.${fieldName});\n`);
    buf.push(`${indent}}\n`);
  }
}

// =========================================================================
// Aggregate client (GeneratedClient.java)
// =========================================================================

function generateJavaClientFile(outputDir: string, resources: ResourceGenInfo[]): void {
  const imports = new JavaImportSet();
  imports.add("io.grpc.Channel");

  const body: string[] = [];
  body.push("/** Aggregate client with all resource-specific sub-clients. */\n");
  body.push("public class GeneratedClient {\n");

  for (const r of resources) {
    body.push(`    public final ${r.clientName} ${tsClientFieldName(r.resource)};\n`);
  }
  body.push("\n");

  body.push("    public GeneratedClient(Channel channel) {\n");
  for (const r of resources) {
    const fieldName = tsClientFieldName(r.resource);
    if (JAVA_EXTENSIBLE_CLIENTS.has(r.clientName)) {
      body.push(`        this.${fieldName} = new${r.clientName}(channel);\n`);
    } else {
      body.push(`        this.${fieldName} = new ${r.clientName}(channel);\n`);
    }
  }
  body.push("    }\n");

  for (const r of resources) {
    const reason = JAVA_EXTENSIBLE_CLIENTS.get(r.clientName);
    if (reason === undefined) continue;
    body.push("\n");
    body.push("    /**\n");
    body.push(`     * Factory hook for the ${tsClientFieldName(r.resource)} field (${reason}).\n`);
    body.push("     * Overrides run during this class's constructor, so they must build\n");
    body.push("     * the client from the channel argument alone — never from subclass\n");
    body.push("     * instance state, which is not initialized yet.\n");
    body.push("     */\n");
    body.push(`    protected ${r.clientName} new${r.clientName}(Channel channel) {\n`);
    body.push(`        return new ${r.clientName}(channel);\n`);
    body.push("    }\n");
  }
  body.push("}\n");

  writeJavaFile(outputDir, "GeneratedClient.java", JAVA_GEN_PACKAGE, imports, body.join(""));
}
