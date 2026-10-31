// The per-kind view registry for `get`, beside GET_BINDINGS: which kinds a
// person reads through a view designed for them, and which keep the generic
// field view (render.ts). A kind `get` serves is in exactly one of the two,
// which the registry sweep holds, so a new kind is a decision, not an
// accident. `renderGet` is the one door `get` prints through: json and yaml
// stay the whole resource as the server answered; the human view is the
// kind's own, drawn at the terminal's width (none when piped).
//
// `get`'s action imports this module lazily, as it does the rest of the
// resource layer, so `--help` never loads a view (CLI-08).

import type { DescMessage, Message } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { type OutputFormat, protoToJsonValue, shouldColorize, styler, terminalWidth } from "../../output/index.js";
import { asObject, type RenderFieldsOptions, renderResource } from "../render.js";
import { agentView } from "./agent.js";
import { environmentView } from "./environment.js";
import { organizationView } from "./organization.js";
import { routineView } from "./routine.js";
import { runView } from "./run.js";
import { sessionView } from "./session.js";
import { skillView } from "./skill.js";
import { type KindView, renderView } from "./view.js";

/** The kinds a person reads through a view designed for them. */
export const VIEWS: ReadonlyMap<ApiResourceKind, KindView> = new Map([
  [ApiResourceKind.agent, agentView],
  [ApiResourceKind.skill, skillView],
  [ApiResourceKind.session, sessionView],
  [ApiResourceKind.run, runView],
  [ApiResourceKind.organization, organizationView],
  [ApiResourceKind.routine, routineView],
  [ApiResourceKind.environment, environmentView],
]);

/**
 * The kinds `get` serves through the generic field view, each by decision:
 * a configuration read mostly as YAML (vault, channel, channel app, plugin,
 * eval, API key) or a record read by id from another command's output
 * (score, scoring rule, eval run, file).
 */
export const GENERIC_VIEW_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.vault,
  ApiResourceKind.channel,
  ApiResourceKind.channel_app,
  ApiResourceKind.plugin,
  ApiResourceKind.eval,
  ApiResourceKind.api_key,
  ApiResourceKind.score,
  ApiResourceKind.scoring_rule,
  ApiResourceKind.eval_run,
  ApiResourceKind.file,
]);


/**
 * What `get` prints for one resource of `kind`: the whole resource for json
 * and yaml; otherwise the kind's designed view, after reading what it reads
 * beside the resource, or the generic view for a kind without one.
 */
export async function renderGet(
  client: Stigmer,
  kind: ApiResourceKind,
  schema: DescMessage,
  message: Message,
  format: OutputFormat,
  options: RenderFieldsOptions = {},
): Promise<string> {
  const view = VIEWS.get(kind);
  if (view === undefined || format === "json" || format === "yaml") return renderResource(schema, message, format, options);
  const json = asObject(protoToJsonValue(schema, message));
  const related = view.related === undefined ? {} : await view.related(client, json);
  return renderView(view, json, {
    hideOrg: options.hideOrg === true,
    orgLabel: options.orgLabel,
    width: terminalWidth(),
    style: styler(shouldColorize(process.stdout)),
    now: Date.now(),
    ...related,
  });
}
