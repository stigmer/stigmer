/**
 * The addresses an organization's login app signs in to
 * (`OAuthAppSpec.addresses`): normalized by the vault's one address rule,
 * and each held by one app per organization through a name claim
 * (`OAUTH_APP_ADDRESS_NAME_KIND` in the store's `resourceNames`, the claim
 * a My vault and a vault's external id take), so a sign-in finds the app by
 * its address without listing the kind (domain/vault/login-app.ts).
 *
 * Create claims every address before the row is written; update claims the
 * addresses it adds before the write and lets go of the ones it drops after
 * it; delete and the organization purge let go of all of them. A claim
 * whose holder never stored the address (a write that died between the
 * claim and the row) is freed by the next app that claims the address once
 * it is a minute old, as a vault's names are; a younger one refuses, since
 * its write may still land.
 *
 * Proven by __tests__/addresses.test.ts and the OAuthApp conformance suite.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { InvalidAddressError, normalizeAddress } from "../vault/address.js";
import {
  OAUTH_APP_ADDRESS_NAME_KIND,
  findOrganizationApp,
  oauthAppAddressKey,
} from "../vault/login-app.js";

/** How old a claim whose holder never stored the address must be before another app may take it. */
const ABANDONED_CLAIM_AFTER_MS = 60 * 1000;

/** The context key the update chain keeps the addresses it drops under, for the release after the write. */
const DROPPED_ADDRESSES_KEY = "oauthapp.droppedAddresses";

/**
 * Normalizes every address on the new state, refusing one that is not an
 * address and two that normalize to the same one, with the rule in the
 * sentence and never the value.
 */
export function newNormalizeAddressesStep(): PipelineStep<typeof OAuthAppSchema> {
  return {
    name: "NormalizeAddresses",
    execute(ctx: RequestContext<typeof OAuthAppSchema>): void {
      const spec = ctx.newState.spec;
      if (spec === undefined) {
        return;
      }
      const normalized: string[] = [];
      for (const [index, address] of spec.addresses.entries()) {
        let value: string;
        try {
          value = normalizeAddress(address);
        } catch (error) {
          if (error instanceof InvalidAddressError) {
            throw invalidArgumentError(`spec.addresses[${index}]: ${error.message}`);
          }
          throw error;
        }
        if (normalized.includes(value)) {
          throw invalidArgumentError(
            `spec.addresses[${index}] is the same address as an earlier one once normalized: list each address once`,
          );
        }
        normalized.push(value);
      }
      spec.addresses = normalized;
    },
  };
}

/**
 * Claims the addresses the new state adds (all of them on create, those the
 * stored app lacks on update) before the row is written, refusing
 * ALREADY_EXISTS for an address another app of the organization holds. On
 * update, the dropped addresses are noted for the release after the write.
 */
export function newClaimAddressesStep(
  store: Store,
  mode: "create" | "update",
): PipelineStep<typeof OAuthAppSchema> {
  return {
    name: "ClaimAddresses",
    async execute(ctx: RequestContext<typeof OAuthAppSchema>): Promise<void> {
      const app = ctx.newState;
      const existing = mode === "update" ? (ctx.get(EXISTING_RESOURCE_KEY) as OAuthApp | undefined) : undefined;
      const before = existing?.spec?.addresses ?? [];
      const after = app.spec?.addresses ?? [];
      const added = after.filter((address) => !before.includes(address));
      ctx.set(DROPPED_ADDRESSES_KEY, before.filter((address) => !after.includes(address)));

      const org = app.metadata?.org ?? "";
      const id = app.metadata?.id ?? "";
      const claimed: string[] = [];
      for (const address of added) {
        if (!(await claimAddress(store, org, id, address))) {
          for (const done of claimed) {
            await store.resourceNames.releaseName(oauthAppAddressKey(org, done), id);
          }
          throw new ConnectError(
            `the address ${address} already belongs to another login app in this organization: remove it there first`,
            Code.AlreadyExists,
          );
        }
        claimed.push(address);
      }
    },
  };
}

/** Lets go of the addresses an update dropped, after the write. Best-effort: a claim left over is freed by the next app that claims it. */
export function newReleaseDroppedAddressesStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof OAuthAppSchema> {
  return {
    name: "ReleaseDroppedAddresses",
    async execute(ctx: RequestContext<typeof OAuthAppSchema>): Promise<void> {
      const dropped = (ctx.get(DROPPED_ADDRESSES_KEY) as readonly string[] | undefined) ?? [];
      const org = ctx.newState.metadata?.org ?? "";
      const id = ctx.newState.metadata?.id ?? "";
      for (const address of dropped) {
        try {
          await store.resourceNames.releaseName(oauthAppAddressKey(org, address), id);
        } catch (error) {
          logger.warn("an address a login app dropped could not be released", {
            oauthAppId: id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  };
}

/** Lets go of every address a deleted app held. Best-effort, after the row is gone. */
export function newReleaseAddressesStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "ReleaseAddresses",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const app = ctx.get(EXISTING_RESOURCE_KEY) as OAuthApp | undefined;
      const id = app?.metadata?.id ?? "";
      try {
        await store.resourceNames.release(OAUTH_APP_ADDRESS_NAME_KIND, app?.metadata?.org ?? "", id);
      } catch (error) {
        logger.warn("a deleted login app's addresses could not be released", {
          oauthAppId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/**
 * Claims one address for `id`, freeing an abandoned claim first: one whose
 * holder does not list the address and is a minute old.
 */
async function claimAddress(store: Store, org: string, id: string, address: string): Promise<boolean> {
  const key = oauthAppAddressKey(org, address);
  const now = new Date();
  const claim = await store.resourceNames.claim(key, id, now.toISOString());
  if (claim.claimed || claim.entry.id === id) {
    return true;
  }
  const young = now.getTime() - Date.parse(claim.entry.claimedAt) < ABANDONED_CLAIM_AFTER_MS;
  if (young || (await findOrganizationApp(store, org, address)) !== undefined) {
    return false;
  }
  await store.resourceNames.releaseName(key, claim.entry.id);
  return (await store.resourceNames.claim(key, id, now.toISOString())).claimed;
}
