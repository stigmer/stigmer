// Python and Java naming helpers shared by the docs and SDK emitters —
// ports of the corresponding functions in sdk_client_python.go and
// sdk_client_java.go. Docs route through these so examples never show an
// identifier the generated SDKs don't have.

import { tsClientFieldName } from "./gen-common.js";

const PY_CLIENT_FIELD_NAMES = new Map<string, string>([
  ["agent", "agents"],
  ["agentchannel", "agent_channels"],
  ["agentexecution", "agent_executions"],
  ["agentinstance", "agent_instances"],
  ["agentshare", "agent_shares"],
  ["apikey", "api_keys"],
  ["environment", "environments"],
  ["executioncontext", "execution_contexts"],
  ["iampolicy", "iam_policies"],
  ["identityaccount", "identity_accounts"],
  ["identityprovider", "identity_providers"],
  ["mcpserver", "mcp_servers"],
  ["organization", "organizations"],
  ["project", "projects"],
  ["session", "sessions"],
  ["skill", "skills"],
  ["workflow", "workflows"],
  ["workflowexecution", "workflow_executions"],
  ["workflowinstance", "workflow_instances"],
]);

export function pyClientFieldName(resource: string): string {
  return PY_CLIENT_FIELD_NAMES.get(resource) ?? resource + "s";
}

const PYTHON_KEYWORDS = new Set([
  "False", "None", "True",
  "and", "as", "assert", "async", "await",
  "break", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for",
  "from", "global", "if", "import", "in",
  "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while",
  "with", "yield",
]);

/** Safe Python identifier: trailing underscore for keywords. */
export function pyFieldName(protoField: string): string {
  return PYTHON_KEYWORDS.has(protoField) ? protoField + "_" : protoField;
}

export function isPythonKeyword(name: string): boolean {
  return PYTHON_KEYWORDS.has(name);
}

const isUpper = (c: string): boolean => c >= "A" && c <= "Z";
const isLower = (c: string): boolean => c >= "a" && c <= "z";
const isDigit = (c: string): boolean => c >= "0" && c <= "9";

/**
 * PascalCase → snake_case for Python SDK method names (port of
 * pyMethodName's acronym-aware splitting: "GetByReference" →
 * "get_by_reference").
 */
export function pyMethodName(name: string): string {
  let result = "";
  for (let i = 0; i < name.length; i++) {
    const r = name[i];
    if (i > 0 && isUpper(r)) {
      const prev = name[i - 1];
      if (isLower(prev) || isDigit(prev)) {
        result += "_";
      } else if (isUpper(prev) && i + 1 < name.length && isLower(name[i + 1])) {
        result += "_";
      }
    }
    result += r.toLowerCase();
  }
  return result;
}

/** PascalCase → lowerCamelCase for Python gRPC stub calls. */
export function pyStubMethodName(name: string): string {
  if (name.length === 0) return name;
  return name.slice(0, 1).toLowerCase() + name.slice(1);
}

/** "apis/.../token.proto" → "token_pb2". */
export function pyProtoFileToModule(protoFile: string): string {
  const base = protoFile.slice(protoFile.lastIndexOf("/") + 1);
  const name = base.endsWith(".proto") ? base.slice(0, -".proto".length) : base;
  return name + "_pb2";
}

/** "ai.stigmer.agentic.agent.v1" → "agent_spec_pb2". */
export function pyProtoModuleAlias(protoPkg: string): string {
  const parts = protoPkg.split(".");
  if (parts.length >= 2) {
    return parts[parts.length - 2] + "_spec_pb2";
  }
  return protoPkg + "_spec_pb2";
}

/** Cross-package proto import line for Python. */
export function pyProtoImportLine(protoPkg: string): string {
  return `from ${protoPkg} import spec_pb2 as ${pyProtoModuleAlias(protoPkg)}`;
}

/** snake_case → CapCamel with the house acronym overrides. */
export function javaCapCamel(protoField: string): string {
  const parts = protoField.split("_");
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.length > 0) {
      let upper = p.slice(0, 1).toUpperCase() + p.slice(1);
      switch (p.toLowerCase()) {
        case "url":
          upper = "Url";
          break;
        case "id":
          upper = "Id";
          break;
        case "md":
          upper = "Md";
          break;
        case "usd":
          upper = "Usd";
          break;
      }
      parts[i] = upper;
    }
  }
  return parts.join("");
}

const JAVA_RESERVED_NAMES = new Set([
  "abstract", "assert", "boolean", "break",
  "byte", "case", "catch", "char", "class",
  "const", "continue", "default", "do",
  "double", "else", "enum", "extends",
  "final", "finally", "float", "for",
  "goto", "if", "implements", "import",
  "instanceof", "int", "interface", "long",
  "native", "new", "package", "private",
  "protected", "public", "return", "short",
  "static", "strictfp", "super", "switch",
  "synchronized", "this", "throw", "throws",
  "transient", "try", "void", "volatile",
  "while",
]);

export function javaCamel(protoField: string): string {
  const cc = javaCapCamel(protoField);
  if (cc.length === 0) return cc;
  const name = cc.slice(0, 1).toLowerCase() + cc.slice(1);
  return JAVA_RESERVED_NAMES.has(name) ? name + "_" : name;
}

/** Java accessor: tsClientFieldName pluralized with y→ies handling. */
export function javaAccessorName(resource: string): string {
  const fieldName = tsClientFieldName(resource);
  const n = fieldName.length;
  if (n >= 2 && fieldName[n - 1] === "y") {
    const prev = fieldName[n - 2];
    if (prev !== "a" && prev !== "e" && prev !== "i" && prev !== "o" && prev !== "u") {
      return fieldName.slice(0, n - 1) + "ies";
    }
  }
  return fieldName + "s";
}
