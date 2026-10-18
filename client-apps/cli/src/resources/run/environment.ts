// The Environment a new conversation runs in, from
// `stigmer run --environment <ref>`.
//
// An Environment is the packages and the network access of the sandbox a
// conversation runs in. Naming one is the conversation's own choice, which
// wins over its agent's default and its organization's; naming none leaves
// those to apply. The reference resolves by the one rule every run flag
// naming resources shares (references.ts). Whether an Environment applies on
// the server at all is the server's to say: a conversation that runs on the
// person's own machine, or on a server that starts no sandboxes, is refused
// with the server's own sentence, so nothing is judged here.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Stigmer } from "@stigmer/client";
import { resolveRunReferences } from "./references.js";

/** The Environment reads an id lookup needs, injectable for tests. */
export type EnvironmentReader = Pick<Stigmer, "environment">;

/**
 * Resolve the `--environment` reference to the reference the conversation
 * stores, or undefined when the flag was not given. A malformed reference is
 * a usage error.
 */
export async function resolveRunEnvironment(
  client: EnvironmentReader,
  ref: string,
  org: string,
): Promise<ApiResourceReference | undefined> {
  if (ref === "") return undefined;
  const [resolved] = await resolveRunReferences(
    {
      flag: "--environment",
      noun: "environment",
      kind: ApiResourceKind.environment,
      get: (id) => client.environment.get(id),
    },
    [ref],
    org,
  );
  return resolved;
}
