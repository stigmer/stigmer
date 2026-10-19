/**
 * The update-path inventory: for every kind whose update refuses a path,
 * the paths its update_mask may not name and who writes them instead,
 * gathered from the declaration beside each update chain (the chain
 * passes it to BuildUpdateState, pipeline/steps/update-mask.ts). A kind
 * with no entry refuses no path of its own.
 *
 * docs/update-paths.md is this table in words, one row per served update,
 * held equal by __tests__/update-paths-inventory.test.ts, which also holds
 * every spec field the contract marks `computed` to its kind's entry: a
 * field the server computes is never an update's to write.
 */
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { RefusedUpdatePath } from "../pipeline/steps/update-mask.js";
import { API_KEY_REFUSED_UPDATE_PATHS } from "./apikey/controller.js";
import { FILE_REFUSED_UPDATE_PATHS } from "./file/steps.js";
import { ORGANIZATION_REFUSED_UPDATE_PATHS } from "./organization/controller.js";
import { VAULT_REFUSED_UPDATE_PATHS } from "./vault/controller.js";

/** Every kind whose update refuses a path, with those paths. */
export const REFUSED_UPDATE_PATHS_BY_KIND: ReadonlyMap<
  ApiResourceKind,
  ReadonlyArray<RefusedUpdatePath>
> = new Map([
  [ApiResourceKind.api_key, API_KEY_REFUSED_UPDATE_PATHS],
  [ApiResourceKind.file, FILE_REFUSED_UPDATE_PATHS],
  [ApiResourceKind.organization, ORGANIZATION_REFUSED_UPDATE_PATHS],
  [ApiResourceKind.vault, VAULT_REFUSED_UPDATE_PATHS],
]);
