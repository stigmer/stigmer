import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  SkillQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  SkillIdSchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(SkillQueryController, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Skill };

export async function getSkill(id: string): Promise<Skill> {
  const request = create(SkillIdSchema, { value: id });
  return client.get(request) as Promise<Skill>;
}
