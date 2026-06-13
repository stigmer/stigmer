// Skill delete path: resolve org/slug → id, then delete (removing the skill and
// all its versions), both over a single shared transport.
// Go parity: mcp-server/internal/domains/skills/delete.go.

import { createClient } from "@connectrpc/connect";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillCommandController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/command_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withTransport } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

/**
 * Delete a skill and all its versions by org and slug, returning the deleted
 * skill as protojson.
 */
export async function deleteSkill(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
): Promise<string> {
  const desc = `skill "${slug}" in org "${org}"`;
  return withTransport(serverAddress, token, async (transport, callOptions) => {
    const query = createClient(SkillQueryController, transport);
    let id: string;
    try {
      const skill = await query.getByReference({ org, kind: ApiResourceKind.skill, slug }, callOptions);
      id = skill.metadata?.id ?? "";
    } catch (err) {
      throw rpcError(err, desc);
    }

    const command = createClient(SkillCommandController, transport);
    try {
      const deleted = await command.delete({ value: id }, callOptions);
      return toProtoJson(SkillSchema, deleted);
    } catch (err) {
      throw rpcError(err, desc);
    }
  });
}
