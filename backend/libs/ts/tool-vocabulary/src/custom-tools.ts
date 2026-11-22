// The host app's own tools (a session's `custom_tools`): the one check the
// control plane runs when a conversation declares them and the runner runs
// before it offers them and on every call, so "refused when declared" and
// "refused to the model" cannot drift.
//
// What a declaration must be, each rule with its reason:
//  - A name of letters, digits, `_` and `-`, at most 64: the name reaches
//    every model provider as a tool name, and 64 is the budget the runner
//    holds every model-facing name to (`mcp-tool-names.ts` in the runner).
//    Claude Managed Agents allows 128; a longer name is refused with the
//    limit named.
//  - Not a built-in tool's name on either engine, whatever its case, and
//    not starting `mcp__`: on the Stigmer engine a custom tool is bound under
//    its own name beside the engine's tools, and a model offered two tools
//    of one name, or a name that reads as an MCP tool's, cannot tell which
//    it calls. Managed Agents refuses `mcp__` names too.
//  - Unique in the session, with a description the model reads.
//  - An input schema that is a JSON Schema object (`{"type": "object"}`)
//    the validator accepts: every model provider takes a tool's input as an
//    object, and a schema the validator cannot read could never pass a call.
//  - At most 32 tools and 64 KB of schemas in all, so the tool list the
//    model reads stays within a turn's budget.
//
// A call's input is checked against its tool's schema with
// `@cfworker/json-schema` (draft 2020-12), the validator the Stigmer
// engine's LangChain stack already uses, so a call the runner admits is one
// the schema accepts on every engine. The check runs under a time budget
// (CUSTOM_TOOL_CHECK_BUDGET_MS): a schema's `pattern` is the host's and the
// input is the model's, so a pattern that backtracks exponentially could
// otherwise hold the runner's one thread for minutes, its stall watchdog
// included. It runs through `node:vm` with a timeout, as the runner's hook
// matchers do (`shared/hooks/matcher.ts` in the runner): V8 checks for the
// interrupt while it backtracks, and a check stopped there refuses the
// call.
//
// Proven by __tests__/custom-tools.test.ts.

import { createContext, Script, type Context } from "node:vm";

import { Validator, type OutputUnit, type Schema } from "@cfworker/json-schema";

import { CLAUDE_TOOLS, CLAUDE_TOOL_ALIASES, STIGMER_TOOL_COVERS } from "./vocabulary.js";

/** One tool the host app answers itself, as a conversation declares it. */
export interface CustomToolDeclaration {
  readonly name: string;
  readonly description: string;
  /** A JSON Schema object (`{"type": "object", ...}`). */
  readonly inputSchema: unknown;
}

/** The limits a conversation's custom tools are held to (the header). */
export const CUSTOM_TOOL_LIMITS = {
  maxTools: 32,
  maxNameLength: 64,
  maxDescriptionLength: 4096,
  maxSchemaBytes: 64 * 1024,
} as const;

/** A custom tool's name: letters, digits, `_` and `-`, 1 to 64 (the header). */
export const CUSTOM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** The prefix every MCP tool's model-facing name starts with, which a custom tool's may not. */
const MCP_PREFIX = "mcp__";

/**
 * The engines' own tool names a custom tool may not take, lower-cased: every
 * Claude Code built-in a Stigmer turn offers or a list may name (the
 * engine's tool search and structured-output tools included), and every
 * tool the Stigmer engine binds.
 */
const RESERVED_NAMES: ReadonlySet<string> = new Set(
  [
    ...CLAUDE_TOOLS,
    ...CLAUDE_TOOL_ALIASES.keys(),
    "ToolSearch",
    "StructuredOutput",
    ...STIGMER_TOOL_COVERS.keys(),
    "stop_background_command",
  ].map((name) => name.toLowerCase()),
);

/** Whether a name is an engine's own tool's, whatever its case (the header). */
export function isReservedCustomToolName(name: string): boolean {
  return RESERVED_NAMES.has(name.toLowerCase()) || name.toLowerCase().startsWith(MCP_PREFIX);
}

/**
 * Why a conversation's custom tools cannot be declared, as one sentence
 * naming the tool and the rule; undefined when every one may be.
 */
export function customToolsProblem(tools: readonly CustomToolDeclaration[]): string | undefined {
  if (tools.length > CUSTOM_TOOL_LIMITS.maxTools) {
    return `A conversation may declare at most ${CUSTOM_TOOL_LIMITS.maxTools} custom tools; this one declares ${tools.length}.`;
  }
  const seen = new Set<string>();
  let schemaBytes = 0;
  for (const [index, tool] of tools.entries()) {
    const label = tool.name === "" ? `custom tool ${index + 1}` : `custom tool '${tool.name}'`;
    if (tool.name.length > CUSTOM_TOOL_LIMITS.maxNameLength) {
      return `The name of ${label} is ${tool.name.length} characters; a custom tool's name is at most ${CUSTOM_TOOL_LIMITS.maxNameLength}.`;
    }
    if (!CUSTOM_TOOL_NAME_PATTERN.test(tool.name)) {
      return `The name of ${label} may hold only letters, digits, _ and -.`;
    }
    if (isReservedCustomToolName(tool.name)) {
      return tool.name.toLowerCase().startsWith(MCP_PREFIX)
        ? `The name of ${label} may not start with mcp__, which names an MCP server's tools.`
        : `The name of ${label} is a built-in tool's; choose another.`;
    }
    if (seen.has(tool.name)) return `Two custom tools are named '${tool.name}'; each name may appear once.`;
    seen.add(tool.name);
    if (tool.description.trim() === "") return `The description of ${label} is empty; the agent reads it to know when to call the tool.`;
    if (tool.description.length > CUSTOM_TOOL_LIMITS.maxDescriptionLength) {
      return `The description of ${label} is ${tool.description.length} characters; at most ${CUSTOM_TOOL_LIMITS.maxDescriptionLength}.`;
    }
    const schema = schemaProblem(tool.inputSchema);
    if (schema !== undefined) return `The input_schema of ${label} ${schema}.`;
    schemaBytes += new TextEncoder().encode(JSON.stringify(tool.inputSchema)).length;
  }
  if (schemaBytes > CUSTOM_TOOL_LIMITS.maxSchemaBytes) {
    return `The custom tools' input schemas hold ${schemaBytes} bytes in all; at most ${CUSTOM_TOOL_LIMITS.maxSchemaBytes}.`;
  }
  return undefined;
}

/** Why a schema cannot be a custom tool's input schema, as the end of a sentence; undefined when it can. */
function schemaProblem(schema: unknown): string | undefined {
  if (!isObject(schema)) return "must be a JSON Schema object";
  if (schema.type !== "object") return 'must describe an object ({"type": "object", ...})';
  const ref = unresolvedRef(schema, schema);
  if (ref !== undefined) return `cannot be read as a JSON Schema: its $ref ${JSON.stringify(ref)} names nothing in the schema (a custom tool's schema is self-contained)`;
  const pattern = badPattern(schema);
  if (pattern !== undefined) return `cannot be read as a JSON Schema: its pattern ${JSON.stringify(pattern)} is not a regular expression`;
  return undefined;
}

/**
 * The first `pattern` (or `patternProperties` key) in `node` the validator
 * could not compile, as it compiles them (`new RegExp(p, "u")`); undefined
 * when every one compiles. A schema is otherwise read only when a call
 * reaches the keyword, so a bad one would refuse every call instead of the
 * declaration.
 */
function badPattern(node: unknown): string | undefined {
  if (Array.isArray(node)) return node.map(badPattern).find((found) => found !== undefined);
  if (!isObject(node)) return undefined;
  const patterns = [...(typeof node.pattern === "string" ? [node.pattern] : []), ...(isObject(node.patternProperties) ? Object.keys(node.patternProperties) : [])];
  for (const pattern of patterns) {
    try {
      new RegExp(pattern, "u");
    } catch {
      return pattern;
    }
  }
  return Object.values(node).map(badPattern).find((found) => found !== undefined);
}

/**
 * Why a call's input does not match its custom tool's schema, as the
 * sentence the model reads (it names the tool and every mismatch, and says
 * the call did not run); undefined when it matches.
 */
export function customToolInputProblem(tool: Pick<CustomToolDeclaration, "name" | "inputSchema">, input: unknown): string | undefined {
  let result: ReturnType<Validator["validate"]>;
  try {
    result = timedValidate(new Validator(tool.inputSchema as Schema, "2020-12", false), input);
  } catch (err) {
    if (isScriptTimeout(err)) {
      return `The input could not be checked against ${tool.name}'s input schema in time (a pattern in the schema takes too long on this input); the call did not run.`;
    }
    return `The input could not be checked against ${tool.name}'s input schema (${String(err)}); the call did not run.`;
  }
  if (result.valid) return undefined;
  const listed = mismatchesOf(result.errors);
  return `The input does not match ${tool.name}'s input schema (${listed.join("; ")}); the call did not run. Call it again with input that matches.`;
}

/** The longest one input check may run, in milliseconds (the header). Real checks finish in well under one. */
export const CUSTOM_TOOL_CHECK_BUDGET_MS = 250;

/** The one context and script every timed check runs in, made on the first. */
let sandbox: { readonly context: Context & { validator?: Validator; input?: unknown }; readonly script: Script } | undefined;

/** One validation under the budget (the header); throws Node's timeout error when stopped there. */
function timedValidate(validator: Validator, input: unknown): ReturnType<Validator["validate"]> {
  sandbox ??= { context: createContext({}), script: new Script("validator.validate(input)") };
  sandbox.context.validator = validator;
  sandbox.context.input = input;
  try {
    return sandbox.script.runInContext(sandbox.context, { timeout: CUSTOM_TOOL_CHECK_BUDGET_MS }) as ReturnType<Validator["validate"]>;
  } finally {
    delete sandbox.context.validator;
    delete sandbox.context.input;
  }
}

/** Node's timeout error comes from the context's realm, so it is read by its code, not by `instanceof`. */
function isScriptTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}

/** The validator's keywords that only report that a nested one failed, which the nested error says better. */
const WRAPPER_KEYWORDS: ReadonlySet<string> = new Set(["properties", "items", "prefixItems", "allOf", "$ref", "false"]);

/** What `additionalProperties` reports for a property its schema does not take. */
const EXTRA_PROPERTY = /^Property "(.*)" does not match additional properties schema\.$/;

/**
 * Each mismatch once, where it is, in the model's words: wrapper errors
 * dropped, and a property the schema does not take reported only when
 * nothing more precise is said about it (the validator also reports a
 * declared property that failed its own rule as an extra one).
 */
function mismatchesOf(errors: readonly OutputUnit[]): string[] {
  const where = (location: string): string => (location === "#" ? "the input" : location.replace(/^#/, ""));
  const precise = errors.filter((error) => !WRAPPER_KEYWORDS.has(error.keyword) && error.keyword !== "additionalProperties");
  const said = new Set(precise.map((error) => error.instanceLocation));
  const extras = errors.flatMap((error) => {
    const name = error.keyword === "additionalProperties" ? EXTRA_PROPERTY.exec(error.error)?.[1] : undefined;
    if (name === undefined) return [];
    const location = `${error.instanceLocation}/${name}`;
    return said.has(location) ? [] : [`${where(location)}: not a property this tool takes`];
  });
  const listed = [...precise.map((error) => `${where(error.instanceLocation)}: ${error.error}`), ...extras];
  return (listed.length > 0 ? listed : errors.map((error) => error.error)).slice(0, 10);
}

/** The first `$ref` in `node` that is not a JSON pointer into `root` naming something there; undefined when every one is. */
function unresolvedRef(node: unknown, root: Record<string, unknown>): string | undefined {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = unresolvedRef(item, root);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isObject(node)) return undefined;
  const ref = node.$ref;
  if (ref !== undefined && (typeof ref !== "string" || !resolvesIn(root, ref))) return String(ref);
  for (const value of Object.values(node)) {
    const found = unresolvedRef(value, root);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Whether `ref` is `#` or a JSON pointer (`#/...`) naming a value in `root`,
 * through its own keys alone (an inherited `constructor` names nothing the
 * validator finds), its escapes read as a pointer's.
 */
function resolvesIn(root: Record<string, unknown>, ref: string): boolean {
  if (ref === "#") return true;
  if (!ref.startsWith("#/")) return false;
  let current: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = pointerKey(raw);
    if (key === undefined) return false;
    if (Array.isArray(current)) {
      // An array's step is an index it holds, never one of its own other keys (`length`).
      if (!ARRAY_INDEX.test(key) || Number(key) >= current.length) return false;
      current = current[Number(key)];
    } else if (isObject(current) && Object.hasOwn(current, key)) {
      current = current[key];
    } else {
      return false;
    }
  }
  return true;
}

/** A JSON pointer's array index: a non-negative integer with no leading zero. */
const ARRAY_INDEX = /^(0|[1-9][0-9]*)$/;

/** A pointer segment's key, its percent and tilde escapes undone; undefined for a malformed escape. */
function pointerKey(raw: string): string | undefined {
  try {
    return decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
