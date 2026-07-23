// Skill version-timeline path (SkillQueryController.listVersions). Each push
// creates an immutable version identified by the artifact's SHA-256 hash;
// entries carry hash, tag, push audit, and provenance (no artifact content, so
// no projection is needed — unlike the workflow timeline).

import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  type ListSkillVersionsInputSchema,
  ListSkillVersionsResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

export interface ListSkillVersionsArgs {
  readonly org: string;
  readonly slug: string;
  readonly pageSize?: number;
  readonly pageToken?: string;
}

/** List a skill's version history (newest first) as protojson. */
export async function listSkillVersions(
  serverAddress: string,
  token: string,
  args: ListSkillVersionsArgs,
): Promise<string> {
  return withClient(SkillQueryController, serverAddress, token, async (client, callOptions) => {
    const req: MessageInitShape<typeof ListSkillVersionsInputSchema> = {
      org: args.org,
      slug: args.slug,
      pageToken: args.pageToken ?? "",
    };
    // Forward page_size only when set, letting the server apply its default.
    if ((args.pageSize ?? 0) > 0) {
      req.pageSize = args.pageSize;
    }
    try {
      const resp = await client.listVersions(req, callOptions);
      return toProtoJson(ListSkillVersionsResponseSchema, resp);
    } catch (err) {
      throw rpcError(err, `versions of skill "${args.slug}" in org "${args.org}"`);
    }
  });
}
