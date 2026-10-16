/**
 * The update RPCs' wire shape, Update<Kind>Input (the resource, named by
 * its metadata.id, and an update_mask), unwrapped for the chain that runs
 * on the resource: the chain's RequestContext is typed on the resource, so
 * every step keeps its type, and the mask rides UPDATE_MASK_KEY for
 * BuildUpdateState. The chain's Authorize step reads the annotation
 * (`resource.metadata.id`) against the wire request itself.
 *
 * Apply's update arm is an update that names every updatable path: a
 * manifest is a whole desired state (Kubernetes keeps apply and patch
 * apart), so it reaches the update chain as `everyPathUpdate`.
 */
import { create } from "@bufbuild/protobuf";
import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import type { FieldMask } from "@bufbuild/protobuf/wkt";
import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { RequestContext } from "../request-context.js";
import { EVERY_UPDATABLE_PATH, UPDATE_MASK_KEY } from "./update-mask.js";

/** The two fields every Update<Kind>Input carries. */
export interface UpdateRequestShape<Desc extends DescMessage> {
  readonly resource?: MessageShape<Desc>;
  readonly updateMask?: FieldMask;
}

/** An update chain's context: the request's resource (empty when absent) with its mask. */
export function updateContext<Desc extends DescMessage>(
  schema: Desc,
  request: UpdateRequestShape<Desc>,
  callerIdentity: CallerIdentity,
  kind: ApiResourceKind,
): RequestContext<Desc> {
  const ctx = new RequestContext(
    schema,
    request.resource ?? create(schema),
    callerIdentity,
    kind,
  );
  ctx.set(UPDATE_MASK_KEY, [...(request.updateMask?.paths ?? [])]);
  return ctx;
}

/** Apply's update arm as an update request: `resource` with every updatable path. */
export function everyPathUpdate<InputDesc extends DescMessage>(
  inputSchema: InputDesc,
  resource: Message,
): MessageShape<InputDesc> {
  const init = {
    resource,
    updateMask: create(FieldMaskSchema, { paths: [EVERY_UPDATABLE_PATH] }),
  } as unknown as MessageInitShape<InputDesc>;
  return create(inputSchema, init);
}

type Message = MessageShape<DescMessage>;
