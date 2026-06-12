// Skill read path: the single RPC the get_skill tool and both skill resource
// templates (latest + versioned) delegate to.
// Go parity: mcp-server/internal/domains/skills/fetch.go.
//
// Skills are versioned: an empty version string requests the latest version; a
// tag name or SHA-256 hash requests a specific one.

import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { withClient } from "../client";
import { toProtoJson } from "../marshal";
import { rpcError } from "../rpcerr";

/**
 * Retrieve a skill by org, slug, and optional version, returning its protojson
 * representation. Pass an empty version string for the latest version.
 */
export async function fetchSkill(
  serverAddress: string,
  token: string,
  org: string,
  slug: string,
  version: string,
): Promise<string> {
  return withClient(SkillQueryController, serverAddress, token, async (client, callOptions) => {
    try {
      const skill = await client.getByReference(
        { org, kind: ApiResourceKind.skill, slug, version },
        callOptions,
      );
      return toProtoJson(SkillSchema, skill);
    } catch (err) {
      throw rpcError(err, `skill "${slug}" in org "${org}"`);
    }
  });
}
