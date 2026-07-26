/**
 * Fixtures for the API key setup tour.
 *
 * The only RPC the tour's real components call is
 * `ApiKeyQueryController.findAll`, via `ApiKeyListPanel` in the idle and
 * creating beats — and the answer is a fresh account's: no keys. The
 * empty list is tour-constant, so the router owns it (scenar-cloud
 * DD-002/DD-006); everything that varies per step (form seed, revealed
 * key) arrives through props. Nothing else fetches — the form and alert
 * are prop-driven and inert.
 */
import { create } from "@bufbuild/protobuf";
import { ApiKeysSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(ApiKeyQueryController, {
    findAll: () => create(ApiKeysSchema, { entries: [] }),
  });
});
