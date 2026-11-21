// `get agent`: what an agent is made of, as a person reads it. Its
// description and when it last changed; the start of its instructions; the
// skills, MCP servers, tools, subagents and plugins it works with; whether
// its conversations have a computer, the Environment they run in and the
// values it declares; the
// settings a run starts from. Everything comes from the agent itself
// (apis/ai/stigmer/agentic/agent/v1/spec.proto); `-o yaml` prints it whole.

import type { JsonValue } from "@bufbuild/protobuf";
import { asObject, audited, instant, type JsonObject, obj, runSettingFields, str } from "../render.js";
import type { KindView } from "./view.js";
import { firstLines, objects, refLabel, refLabels, strings } from "./words.js";

export const agentView: KindView = {
  sections: (json, ctx) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const { created, updated } = audited(json);
    const instructions = firstLines(str(spec, "instructions"));
    return [
      { fields: [["Description", str(spec, "description")], ["Updated", instant(updated || created)]] },
      { title: "Instructions", lines: instructions.lines, more: instructions.more },
      { title: "Skills", lines: refLabels(spec.skill_refs, metadata, ctx) },
      { title: "MCP servers", rows: objects(spec.mcp_servers).map((server) => [str(server, "name"), str(server, "url")]) },
      {
        title: "Tools",
        fields: [
          ["Allowed", strings(spec.tools).join(", ")],
          ["Disallowed", strings(spec.disallowed_tools).join(", ")],
        ],
      },
      { title: "Subagents", lines: refLabels(spec.subagents, metadata, ctx) },
      { title: "Plugins", lines: refLabels(spec.plugins, metadata, ctx) },
      {
        title: "Environment",
        fields: [
          ["Computer", computerWord(spec.computer)],
          ["Sandbox", refLabel(obj(spec, "environment_ref"), metadata, ctx)],
          ["Values", declaredValues(spec.env)],
        ],
      },
      { title: "Run settings", fields: runSettingFields(spec, {}) },
    ];
  },
};

// Whether the agent's conversations have a computer, as the agent records
// it. Only COMPUTER_NONE means none (session/v1/enum.proto, Computer); an
// agent saved before the setting records nothing, and the row is left out
// as every view leaves out what a resource does not carry.
function computerWord(computer: JsonValue | undefined): string | undefined {
  switch (computer) {
    case "COMPUTER_NONE":
      return "no";
    case "COMPUTER_REQUIRED":
      return "yes";
    default:
      return undefined;
  }
}

// The values an agent declares, by name, each marked secret or optional
// where it is ("GITHUB_TOKEN (secret), REGION (optional)"). A plain value's
// content is the agent's own setting, and `-o yaml` shows it.
function declaredValues(env: JsonValue | undefined): string {
  const declarations: JsonObject = asObject(env);
  return Object.keys(declarations)
    .sort()
    .map((name) => {
      const declaration = asObject(declarations[name]);
      const marks = [declaration.is_secret === true ? "secret" : "", declaration.optional === true ? "optional" : ""].filter(
        (mark) => mark !== "",
      );
      return marks.length === 0 ? name : `${name} (${marks.join(", ")})`;
    })
    .join(", ");
}
