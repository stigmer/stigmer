/**
 * Data fixtures for datastore-records-tour. `scenar pack` and `scenar render`
 * wrap every step of this tour in the exported `PreviewProviders`.
 *
 * The real `DatastoreDetailView` reads three RPCs: the resource
 * (`getByReference`), the caller-effective projection its write affordances
 * gate on (`describeDatastore`), and the records page (`findRecords`). All
 * three answer from settled fixtures in `../steps`. There are deliberately
 * NO write fixtures — a playback never inserts, updates, or deletes (the
 * legacy inline demo's stateful echoes existed for a reader-driven surface
 * this tour no longer is). Anything else falls through to the router's
 * `unimplemented` response, which the hooks degrade from.
 */
import { DatastoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/query_pb";
import { DatastoreRecordQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/record_query_pb";
import { createStigmerPreview } from "../../_shared/stigmer-preview";
import {
  buildDemoDatastore,
  buildDemoDescription,
  buildDemoRecordList,
} from "../steps";

export const PreviewProviders = createStigmerPreview((router) => {
  router.service(DatastoreQueryController, {
    getByReference: () => buildDemoDatastore(),
  });
  router.service(DatastoreRecordQueryController, {
    describeDatastore: () => buildDemoDescription(),
    findRecords: () => buildDemoRecordList(),
  });
});
