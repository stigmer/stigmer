// `get session <id>`: a conversation as a person reads it. Its subject
// heads it; the summary gives its id, the agent it talks to, whether it is
// working, the Environment it runs in and which choice named it, and when it
// began; then its newest runs (turns), each with how it went, when it
// started and how long it took. The runs are the one thing a view reads
// beyond its resource: `listRunsBySession` (resources/session.ts), newest
// first.

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { BUILT_IN_ASSISTANT_NAME } from "@stigmer/client";
import { protoToJsonValue } from "../../output/index.js";
import { asObject, audited, instant, type JsonObject, obj, str } from "../render.js";
import { listRunsBySession } from "../session.js";
import { located, type KindView, type ViewContext } from "./view.js";
import { phaseWord, refLabel, runSpan } from "./words.js";

/** How many of a session's runs its view lists, the newest. */
export const SESSION_RUNS = 5;

// Which choice named the session's Environment (SessionStatus.environment_source).
const ENVIRONMENT_SOURCES: Readonly<Record<string, string>> = {
  ENVIRONMENT_SOURCE_SESSION: "named for this conversation",
  ENVIRONMENT_SOURCE_ROUTINE: "from its routine",
  ENVIRONMENT_SOURCE_AGENT: "from its agent",
  ENVIRONMENT_SOURCE_ORGANIZATION: "the organization's default",
};

export const sessionView: KindView = {
  title: (json, ctx) => {
    const metadata = obj(json, "metadata");
    const name = str(obj(json, "spec"), "subject") || str(metadata, "name") || str(metadata, "id");
    return { name, ref: located(metadata, str(metadata, "slug"), ctx) };
  },
  sections: (json, ctx) => {
    const metadata = obj(json, "metadata");
    const status = obj(json, "status");
    const runs = ctx.runs ?? [];
    const earlier = runs.length - SESSION_RUNS;
    return [
      {
        fields: [
          ["ID", str(metadata, "id")],
          ["Agent", agentOf(json, ctx)],
          ["State", str(status, "state")],
          ["Environment", environmentOf(status, metadata, ctx)],
          ["Created", instant(audited(json).created)],
        ],
      },
      {
        title: "Runs",
        rows: runs.slice(0, SESSION_RUNS).map((run) => runRow(run, ctx.now)),
        more: earlier > 0 ? `… ${earlier} earlier ${earlier === 1 ? "run" : "runs"}` : undefined,
      },
    ];
  },
  related: async (client, json) => {
    const runs = await listRunsBySession(client, str(obj(json, "metadata"), "id"));
    return { runs: runs.map((run) => asObject(protoToJsonValue(RunSchema, run))) };
  },
};

// The agent the session names, else the one it pinned by id, else the
// built-in assistant, as `list sessions` reads it.
function agentOf(json: JsonObject, ctx: ViewContext): string {
  const named = refLabel(obj(obj(json, "spec"), "agent_ref"), obj(json, "metadata"), ctx);
  return named || str(obj(json, "status"), "agent_id") || BUILT_IN_ASSISTANT_NAME;
}

function environmentOf(status: JsonObject, metadata: JsonObject, ctx: ViewContext): string {
  const environment = refLabel(obj(status, "environment"), metadata, ctx);
  const source = ENVIRONMENT_SOURCES[str(status, "environment_source")];
  return environment === "" || source === undefined ? environment : `${environment} (${source})`;
}

function runRow(run: JsonObject, now: number): string[] {
  return [
    str(obj(run, "metadata"), "id"),
    phaseWord(run),
    instant(str(obj(run, "status"), "started_at")) ?? "not started",
    runSpan(run, now) ?? "",
  ];
}
