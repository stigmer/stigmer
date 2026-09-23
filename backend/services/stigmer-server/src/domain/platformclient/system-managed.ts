/**
 * The one builder of a system-managed PlatformClient: the row an edition
 * creates for itself, never through the create chain, so the tokens it
 * signs on the platform's own behalf (a guest's, a schedule fire's) name a
 * client that exists. Stigmer Cloud keeps one per organization under
 * SYSTEM_SHARE_CLIENT_SLUG and persists it through its store driver.
 *
 * The domain already owns what such a client is — the create chain refuses
 * its reserved slug (RefuseReservedSlug) and every mutation refuses its
 * label (RefuseSystemManaged) — so the row is built here too, and the
 * rules that make it safe hold by construction:
 *   - it lives only under a reserved slug, which no user can create, so a
 *     user client can never be mistaken for one;
 *   - it carries the reserved `stigmer.ai/system-managed` label, so update,
 *     delete and rotate refuse it;
 *   - its credentials are real (a `client_id` unique like any other, a
 *     hash, a fingerprint), but the secret is discarded here: nobody ever
 *     authenticates as the platform's own client;
 *   - its id is spelled like every other (`pcl_` + ULID, generateId);
 *   - its audit names no actor, because no caller made it: the platform did.
 *
 * Who decides when one exists, and where it is stored, is the edition's:
 * this function writes nothing. It writes no authorization tuples either —
 * nothing authorizes against a system-managed client, and with none it
 * stays out of every list and reference read a person makes.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";

import {
  RESERVED_LABEL_TRUE,
  SYSTEM_MANAGED_LABEL,
} from "../../pipeline/apiresource-labels.js";
import {
  defaultVisibilityFor,
  getIdPrefix,
} from "../../pipeline/apiresource-meta.js";
import { generateId } from "../../pipeline/steps/defaults.js";
import {
  PLATFORM_CLIENT_KIND_NAME,
  RESERVED_PLATFORM_CLIENT_SLUGS,
} from "./constants.js";
import {
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  secretFingerprint,
} from "./credentials.js";

export interface SystemManagedPlatformClientInput {
  /** The owning organization. */
  readonly org: string;
  /** A reserved slug (RESERVED_PLATFORM_CLIENT_SLUGS); anything else throws. */
  readonly slug: string;
  /** The display name a console would show. */
  readonly name: string;
  /** The creation instant stamped on both audit slots; defaults to the wall clock. */
  readonly now?: Date;
}

/**
 * A new system-managed client, ready for a store's `save`. Throws on an
 * empty organization or a slug that is not reserved — an edition's
 * programming error, never a request's.
 */
export function newSystemManagedPlatformClient(
  input: SystemManagedPlatformClientInput,
): PlatformClient {
  if (input.org === "") {
    throw new Error("a system-managed platform client needs an organization");
  }
  if (!RESERVED_PLATFORM_CLIENT_SLUGS.has(input.slug)) {
    throw new Error(
      `'${input.slug}' is not a reserved platform-client slug; a system-managed client lives only under one (${[...RESERVED_PLATFORM_CLIENT_SLUGS].join(", ")})`,
    );
  }
  const secret = generateClientSecret();
  const created = timestampFromDate(input.now ?? new Date());
  const audit = create(ApiResourceAuditInfoSchema, {
    createdAt: created,
    updatedAt: created,
    event: "created",
  });
  return create(PlatformClientSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: PLATFORM_CLIENT_KIND_NAME,
    metadata: {
      id: generateId(getIdPrefix(ApiResourceKind.platform_client)),
      org: input.org,
      name: input.name,
      slug: input.slug,
      labels: { [SYSTEM_MANAGED_LABEL]: RESERVED_LABEL_TRUE },
      visibility: defaultVisibilityFor(ApiResourceKind.platform_client),
    },
    spec: {
      clientId: generateClientId(),
      clientSecretHash: hashClientSecret(secret),
      secretFingerprint: secretFingerprint(secret),
    },
    status: {
      audit: create(ApiResourceAuditSchema, {
        specAudit: audit,
        statusAudit: audit,
      }),
    },
  });
}
