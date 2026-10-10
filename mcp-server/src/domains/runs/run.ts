// Run start path for the run_agent tool.
//
// Mirrors the CLI's run stack (client-apps/cli/src/resources/run/create.ts):
// starting an agent is a single RunCommandController.create call
// whose target is either an existing session (by id alone: the session pins
// the agent it started on) or the session_spec of a new conversation naming
// the agent by reference. The server bootstraps that session, pins the
// agent's current version on it, and dispatches the message. For a new
// conversation the MCP layer first resolves the org/slug reference over the
// same transport (the two-step pattern the delete tools use), so a missing
// agent reads as the tool's own not-found error and an empty org on a
// single-organization server lands on the agent's real organization.
//
// A follow-up still names its agent: the tool reads the session first and
// refuses when `agent` is not the agent the session runs (a session on the
// built-in assistant runs none), so a caller naming the wrong agent learns
// it instead of silently running the session's. `org`, when given, must
// name that agent's organization: it is compared with the session's agent
// reference as given, and only when the text differs (a slug against the
// stored id) is the named agent resolved and its organization id compared.
//
// A run carries no keys of its own: its turns read the vaults its
// conversation uses. A new conversation names them on its session_spec: the
// caller's own My vault unless `include_my_vault` is false (the caller is a
// person on their own token, as a console chat ticks My vault), then the
// shared `vaults` in order, each a slug in `org` or an `org/slug`, named as
// `agent` names an agent. The server's reference rule refuses a vault that
// does not exist or that the caller may not use. A follow-up cannot change
// them: a conversation keeps the vaults it was started with, and changing
// them is a session update this tool does not offer, so it refuses rather
// than dropping them.
//
// A new conversation may also use plugins beside its agent's: `plugins` names
// each installed plugin as `vaults` names a vault, and the turns carry each
// one whole (its skills, agents, hooks and MCP servers). Like the vaults, they
// are chosen when the conversation starts, so a follow-up refuses them.
//
// The tool is deliberately asynchronous: it returns the created run (with
// its run_* ID) immediately and the run continues in the background.
// Observation happens through get_run polling — MCP tools are
// request/response, so there is no streaming path here by design.

import {
  createClient,
  type CallOptions,
  type Transport,
} from "@connectrpc/connect";
import { create as createMessage } from "@bufbuild/protobuf";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import {
  type RunSpec,
  RunSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  type ApiResourceReference,
  ApiResourceReferenceSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/** apiVersion stamped on created runs; mirrors the CLI's run stack. */
const API_VERSION = "agentic.stigmer.ai/v1";

export interface RunAgentArgs {
  readonly org: string;
  readonly agent: string;
  readonly message: string;
  readonly sessionId?: string;
  /** Shared vaults a new conversation uses, in order: a slug in `org`, or `org/slug`. */
  readonly vaults?: readonly string[];
  /** Whether a new conversation uses the caller's My vault first; unset means yes. */
  readonly includeMyVault?: boolean;
  /** Installed plugins a new conversation uses beside its agent's: a slug in `org`, or `org/slug`. */
  readonly plugins?: readonly string[];
}

/**
 * Start a run: a follow-up in an existing session sends the
 * session id alone, once the session is shown to run the named agent; a new
 * conversation resolves org/slug and names the agent by reference. Returns
 * the created run as protojson (small at creation time — status is
 * empty until the runner picks it up).
 */
export async function runAgent(
  serverAddress: string,
  token: string,
  args: RunAgentArgs,
): Promise<string> {
  const desc = `agent "${args.agent}" in org "${args.org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const sessionId = args.sessionId ?? "";
    let target: RunSpec["target"];
    if (sessionId !== "" && (args.vaults !== undefined || args.includeMyVault !== undefined)) {
      throw new Error(
        "a conversation keeps the vaults it was started with: omit session_id to start a new " +
          "conversation with these, or leave vaults and include_my_vault out of a follow-up.",
      );
    }
    if (sessionId !== "" && args.plugins !== undefined) {
      throw new Error(
        "a conversation keeps the plugins it was started with: omit session_id to start a new " +
          "conversation with these, or leave plugins out of a follow-up.",
      );
    }
    const vaults = (args.vaults ?? []).map((ref) => namedReference(ApiResourceKind.vault, "vaults", "vault", ref, args.org));
    const plugins = (args.plugins ?? []).map((ref) =>
      namedReference(ApiResourceKind.plugin, "plugins", "plugin", ref, args.org),
    );
    if (sessionId !== "") {
      await assertSessionRunsAgent(transport, callOptions, sessionId, args);
      target = { case: "sessionId", value: sessionId };
    } else {
      const query = createClient(AgentQueryController, transport);
      try {
        const agent = await query.getByReference(
          { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
          callOptions,
        );
        target = {
          case: "sessionSpec",
          value: createMessage(SessionSpecSchema, {
            agentRef: createMessage(ApiResourceReferenceSchema, {
              kind: ApiResourceKind.agent,
              org: agent.metadata?.org ?? "",
              slug: agent.metadata?.slug ?? "",
            }),
            vaults,
            includeMyVault: args.includeMyVault ?? true,
            plugins,
          }),
        };
      } catch (err) {
        throw rpcError(err, desc);
      }
    }

    const run = createMessage(RunSchema, {
      apiVersion: API_VERSION,
      kind: "Run",
      // `org` names the agent's organization. A follow-up in an existing
      // session belongs to the session's organization, which the server
      // fills in when none is sent (stigmer/stigmer#1580); sending the
      // agent's would refuse a session started with another org's agent.
      metadata: createMessage(ApiResourceMetadataSchema, {
        name: runName(),
        org: sessionId === "" ? args.org : "",
      }),
      spec: createMessage(RunSpecSchema, {
        // Empty message means "just run" — the CLI applies the same default.
        message: args.message === "" ? "execute" : args.message,
        target,
      }),
    });

    const command = createClient(RunCommandController, transport);
    try {
      const created = await command.create(run, callOptions);
      return toProtoJson(RunSchema, created);
    } catch (err) {
      throw rpcError(err, `run of ${desc}`);
    }
  });
}

/**
 * A vault or plugin named as `agent` names an agent: `org/slug`, or a slug in
 * `org` (empty `org` leaves the reference relative, which the server resolves
 * to the conversation's organization). An entry with an empty part (`acme/`,
 * `/x`) or more than one `/` is refused here, before anything starts.
 * `argument` and `noun` name the tool argument and what it lists, for the
 * refusal.
 */
function namedReference(
  kind: ApiResourceKind,
  argument: string,
  noun: string,
  ref: string,
  org: string,
): ApiResourceReference {
  const trimmed = ref.trim();
  if (trimmed === "") {
    throw new Error(`${argument}: an entry is empty; name each ${noun} by slug or org/slug.`);
  }
  const parts = trimmed.split("/");
  if (parts.length > 2 || parts.some((part) => part === "")) {
    throw new Error(`${argument}: "${trimmed}" is not a ${noun} name; name each ${noun} by slug or org/slug.`);
  }
  return createMessage(ApiResourceReferenceSchema, {
    kind,
    org: parts.length === 2 ? parts[0] : org,
    slug: parts.length === 2 ? parts[1] : trimmed,
  });
}

/**
 * Refuse a follow-up whose `agent` (and `org`, when given) is not the agent
 * the session runs (the module header). The named agent is resolved only
 * when `org` and the session's reference differ as text.
 */
async function assertSessionRunsAgent(
  transport: Transport,
  callOptions: CallOptions,
  sessionId: string,
  args: RunAgentArgs,
): Promise<void> {
  let session: Session;
  try {
    session = await createClient(SessionQueryController, transport).get(
      { value: sessionId },
      callOptions,
    );
  } catch (err) {
    throw rpcError(err, `session "${sessionId}"`);
  }
  const ref = session.spec?.agentRef;
  const sessionAgent = ref?.slug ?? "";
  const mismatch = () =>
    new Error(
      `session "${sessionId}" runs ` +
        (sessionAgent === ""
          ? "the built-in assistant"
          : `agent "${sessionAgent}" in org "${ref?.org ?? ""}"`) +
        `, not agent "${args.agent}"${args.org === "" ? "" : ` in org "${args.org}"`}. ` +
        "Name the session's agent, or omit session_id to start a new conversation.",
    );
  if (sessionAgent !== args.agent) {
    throw mismatch();
  }
  if (ref === undefined || args.org === "" || args.org === ref.org) {
    return;
  }
  let agentOrg: string;
  try {
    const agent = await createClient(
      AgentQueryController,
      transport,
    ).getByReference(
      { org: args.org, kind: ApiResourceKind.agent, slug: args.agent },
      callOptions,
    );
    agentOrg = agent.metadata?.org ?? "";
  } catch (err) {
    throw rpcError(err, `agent "${args.agent}" in org "${args.org}"`);
  }
  if (agentOrg !== ref.org) {
    throw mismatch();
  }
}

/**
 * Unique-enough placeholder name; the backend owns final identity. Mirrors the
 * CLI's default run name: `run-` and the Unix time in microseconds.
 */
export function runName(): string {
  return `run-${Date.now() * 1000}`;
}
