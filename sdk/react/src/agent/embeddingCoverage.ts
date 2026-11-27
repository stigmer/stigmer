import type { Stigmer } from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { isUnimplemented } from "../internal/isUnimplemented.js";

/**
 * What the organization's embedding settings fill for an app user's run of
 * an agent, by name: the keys a vault of theirs holds, and the tool
 * addresses whose sign-in one holds. An app user cannot read those vaults,
 * so the server answers (`agent.checkEmbeddingCoverage`); it names no vault
 * and carries no value.
 */
export interface EmbeddingCoverageNames {
  readonly keys: ReadonlySet<string>;
  readonly signInAddresses: ReadonlySet<string>;
}

/** Nothing filled: any caller but an app user, or a server without the read. */
export const NO_EMBEDDING_COVERAGE: EmbeddingCoverageNames = Object.freeze({
  keys: new Set<string>(),
  signInAddresses: new Set<string>(),
});

/**
 * Asks the server what the embedding settings fill for a run of `agent`
 * in the organization `orgId`. A server that predates the read answers
 * UNIMPLEMENTED (a self-hosted server may lag the kit): nothing is counted
 * as filled, and the chat offers what its own reading finds missing, as it
 * did before the read existed. Any other failure is thrown to the caller.
 */
export async function embeddingCoverageOf(
  stigmer: Pick<Stigmer, "agent">,
  agent: Agent,
  orgId: string,
): Promise<EmbeddingCoverageNames> {
  try {
    const answer = await stigmer.agent.checkEmbeddingCoverage({
      agent: {
        kind: ApiResourceKind.agent,
        org: agent.metadata?.org ?? "",
        id: agent.metadata?.id ?? "",
      },
      org: orgId,
    });
    return { keys: new Set(answer.keys), signInAddresses: new Set(answer.signInAddresses) };
  } catch (err) {
    if (isUnimplemented(err)) return NO_EMBEDDING_COVERAGE;
    throw err;
  }
}
