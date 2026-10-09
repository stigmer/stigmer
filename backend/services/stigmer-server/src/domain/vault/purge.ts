/**
 * The vault's purge (domain/organization/purge/kind-purge.ts): every vault
 * of an organization being deleted, removed with its delete chain's tail
 * (delete.ts): the row, its grants, its sealed values' backing state and
 * its names.
 */
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { SecretService } from "../../encryption/encryption.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { newKindPurge } from "../organization/purge/kind-purge.js";
import type {
  KindPurge,
  KindPurgeDeps,
} from "../organization/purge/kind-purge.js";

import { vaultDeleteSteps } from "./delete.js";
import { vaultListIndex } from "./list-index.js";

type DeleteInput = typeof VaultCommandController.method.delete.input;

export interface VaultPurgeDeps extends KindPurgeDeps {
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  /** The composition's one secret facade. */
  readonly secretService: SecretService;
}

export function newVaultPurge(deps: VaultPurgeDeps): KindPurge {
  return newKindPurge(deps, {
    kind: ApiResourceKind.vault,
    schema: VaultSchema,
    input: VaultCommandController.method.delete.input,
    listIndex: vaultListIndex,
    steps: [...vaultDeleteSteps<DeleteInput>(deps)],
  });
}
