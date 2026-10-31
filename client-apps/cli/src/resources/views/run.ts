// `get run <id>`: one turn of a conversation. The summary gives the agent
// that ran it, the session it belongs to, how it went, when it started and
// how long it took; then the message it was asked, why it stopped when it
// did not complete (the error and the stop cause), the tokens it used (never
// a price, as the run's exit summary), and the settings it ran with,
// resolved, model first (apis/ai/stigmer/agentic/run/v1/api.proto, RunStatus).

import { instant, obj, runSettingFields, str } from "../render.js";
import { located, type KindView } from "./view.js";
import { firstLines, phaseWord, runSpan, tokenUsage } from "./words.js";

export const runView: KindView = {
  title: (json, ctx) => {
    const metadata = obj(json, "metadata");
    return { name: str(metadata, "id"), ref: located(metadata, "", ctx) };
  },
  sections: (json, ctx) => {
    const spec = obj(json, "spec");
    const status = obj(json, "status");
    const message = firstLines(str(spec, "message"));
    const stopped = str(status, "phase") !== "RUN_COMPLETED";
    return [
      {
        fields: [
          ["Agent", str(status, "agent_id")],
          ["Session", str(spec, "session_id")],
          ["Status", phaseWord(json)],
          ["Started", instant(str(status, "started_at"))],
          ["Duration", runSpan(json, ctx.now)],
        ],
      },
      { title: "Message", lines: message.lines, more: message.more },
      {
        title: "Why it stopped",
        fields: stopped
          ? [
              ["Error", str(status, "error")],
              ["Stop cause", str(status, "stop_cause").replaceAll("_", " ")],
            ]
          : [],
      },
      { title: "Usage", fields: [["Tokens", tokenUsage(json)]] },
      { title: "Run settings", fields: runSettingFields(spec, status) },
    ];
  },
};
