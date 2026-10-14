/**
 * The whole list-indexed surface, one explicit list (the search
 * registry's composition-root idiom, query/search/registry.ts; house rule:
 * no import side effects). The store is opened with it
 * (`StoreOpenOptions.listIndexes`), keeps a declared kind's facts on every
 * write, and refuses a read through a declaration it was not opened with,
 * so a lane that reads an index and this list cannot disagree silently.
 *
 * A kind joins when a lane needs to read one organization's or one
 * parent's rows without decoding the whole kind; the kinds here were
 * chosen on the hosted edition's row counts and sizes (2026-09-23: every
 * other org-scoped kind held under a hundred rows and a hundred kilobytes).
 * A kind also joins when a port read on every authorization check would
 * otherwise decode the whole kind: `iam_policy`, whose adapter reads a
 * person's rows by principal (measured 2026-09-24: about 4.6 microseconds
 * per row per read, 47 ms a check at ten thousand rows on sqlite). And a
 * kind joins when the execution create path reads it: `memory`, whose
 * recall reads one person's rows on every create in a memory-on
 * organization (stigmer#1405). And `organization` joins for its children:
 * the built-in evaluator reads a parent's children whenever a check walks
 * a blueprint shared with child organizations, and listChildOrgs pages
 * them (domain/organization/list-index.ts). And `score` joins for its
 * parents: a conversation's view reads one session's scores, and a run's
 * delete one run's (domain/score/list-index.ts). And `evaluator` joins for
 * its parent: the grading workflow reads one agent's evaluator for every
 * completed run that names an agent (domain/evaluator/list-index.ts).
 * And `plugin_eval` joins for its parent: a plugin's page lists its evals
 * newest first, and the plugin's delete reads them
 * (domain/plugin-eval/list-index.ts); `agent_eval` joins for its parent
 * the same way, an agent's page and its delete
 * (domain/agent-eval/list-index.ts). And `api_key` joins for its owner:
 * a person's key list, a service account's key list and an account's
 * delete read one owner's keys (domain/apikey/list-index.ts).
 *
 * Since every list pages (2026-10-14), every kind a list RPC reads joins:
 * `agent`, `skill` and `plugin` for their organization lists, and
 * `schedule`, `agent_channel` and `agent_share` for theirs and for one
 * agent's, and `oauth_app` and `channel_app` for their organization lists
 * (each domain's list-index.ts).
 */
import { agentListIndex } from "../domain/agent/list-index.js";
import { agentChannelListIndex } from "../domain/agentchannel/list-index.js";
import { agentShareListIndex } from "../domain/agentshare/list-index.js";
import { apiKeyListIndex } from "../domain/apikey/list-index.js";
import { channelAppListIndex } from "../domain/channelapp/list-index.js";
import { pluginListIndex } from "../domain/plugin/list-index.js";
import { scheduleListIndex } from "../domain/schedule/list-index.js";
import { skillListIndex } from "../domain/skill/list-index.js";
import { agentExecutionListIndex } from "../domain/run/list-index.js";
import { evaluatorListIndex } from "../domain/evaluator/list-index.js";
import { pluginEvalListIndex } from "../domain/plugin-eval/list-index.js";
import { agentEvalListIndex } from "../domain/agent-eval/list-index.js";
import { iamPolicyListIndex } from "../domain/iampolicy/list-index.js";
import { memoryListIndex } from "../domain/memory/list-index.js";
import { oauthAppListIndex } from "../domain/oauthapp/list-index.js";
import { organizationListIndex } from "../domain/organization/list-index.js";
import { scoreListIndex } from "../domain/score/list-index.js";
import { sessionListIndex } from "../domain/session/list-index.js";
import { vaultListIndex } from "../domain/vault/list-index.js";
import type { ListIndexDeclaration } from "../store/list-index.js";

export const LIST_INDEXES: ReadonlyArray<ListIndexDeclaration> = [
  agentExecutionListIndex,
  agentListIndex,
  agentChannelListIndex,
  agentShareListIndex,
  apiKeyListIndex,
  channelAppListIndex,
  oauthAppListIndex,
  pluginListIndex,
  scheduleListIndex,
  skillListIndex,
  evaluatorListIndex,
  pluginEvalListIndex,
  agentEvalListIndex,
  iamPolicyListIndex,
  memoryListIndex,
  organizationListIndex,
  scoreListIndex,
  sessionListIndex,
  vaultListIndex,
];
