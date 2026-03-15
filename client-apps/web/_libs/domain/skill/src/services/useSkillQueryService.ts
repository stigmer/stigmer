"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createSkillQueryService,
  type SkillQueryService,
} from "./skill-query-service";

/**
 * Returns a {@link SkillQueryService} bound to the transport from
 * {@link StigmerTransportProvider}. The service instance is memoized
 * for the lifetime of the transport.
 */
export function useSkillQueryService(): SkillQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createSkillQueryService(transport), [transport]);
}
