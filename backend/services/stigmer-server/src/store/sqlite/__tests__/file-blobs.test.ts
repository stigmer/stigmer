/**
 * Runs the File blob store contract (../../__tests__/file-blobs-contract.ts)
 * on the SQLite driver, one throwaway database file per case.
 */
import { describe } from "vitest";

import {
  FILE_BLOBS_CONTRACT_STORE_OPTIONS,
  describeFileBlobStoreContract,
} from "../../__tests__/file-blobs-contract.js";
import { tempStore } from "./support.js";

describe("sqlite file blob store contract", () => {
  describeFileBlobStoreContract(async () => {
    const temp = tempStore(FILE_BLOBS_CONTRACT_STORE_OPTIONS);
    return {
      store: temp.store,
      cleanup: () => temp.cleanup(),
    };
  });
});
