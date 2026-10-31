// `get routine`: what a routine runs and when. The agent it starts, its
// schedule in words with the time zone it keeps, the owner's switch
// (enabled) apart from the platform's latch (paused, and why), when it runs
// next and when it last ran; then the message each run starts from
// (apis/ai/stigmer/agentic/routine/v1/spec.proto, status.proto). Enabled and
// paused stay two lines, as `list routines` keeps them two columns: they
// have two different remedies.

import { instant, obj, str } from "../render.js";
import type { KindView } from "./view.js";
import { firstLines, refLabel, scheduleWords, yesNo } from "./words.js";

export const routineView: KindView = {
  sections: (json, ctx) => {
    const metadata = obj(json, "metadata");
    const spec = obj(json, "spec");
    const status = obj(json, "status");
    const invocation = obj(spec, "agent");
    const pausedReason = str(status, "paused_reason");
    const cron = typeof spec.cron === "string" ? spec.cron : undefined;
    const lastRun = instant(str(status, "last_fire_at"));
    const lastRunId = str(status, "last_run_id");
    const message = firstLines(str(invocation, "message"));
    return [
      {
        fields: [
          ["Agent", refLabel(obj(invocation, "agent_ref"), metadata, ctx)],
          ["Schedule", scheduleWords(cron, str(spec, "time_zone"))],
          ["Enabled", yesNo(spec, "enabled")],
          ["State", pausedReason === "" ? "active" : "paused"],
          ["Paused because", pausedReason],
          ["Next run", instant(str(status, "next_fire_at"))],
          ["Last run", lastRun !== undefined && lastRunId !== "" ? `${lastRun} (${lastRunId})` : lastRun],
        ],
      },
      { title: "Message", lines: message.lines, more: message.more },
    ];
  },
};
