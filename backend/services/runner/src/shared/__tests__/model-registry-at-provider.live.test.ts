/**
 * Live: every model id the runner would send a provider is one that provider
 * knows today. Costs no tokens: it reads each provider's model catalog.
 *
 * The registry's rows decide what id a turn sends (`resolveToApiModelId` in
 * `../model-registry.ts`: a native row's `apiModelId`, else its id; a Cursor
 * row's id as written). A provider retiring a model fails every user of that
 * row at their first message, while every test here stays green on the
 * fixture. This case reads the control plane's real registry
 * (`real-model-registry.ts`) and asks:
 *
 *  - Anthropic, one id at a time (`GET /v1/models/{id}`), for every native
 *    row. Six native ids are undated aliases; the per-id read is used because
 *    the list endpoint names dated models. If an alias is not resolved there,
 *    the failure names it, and the reading is a design question, not a retry.
 *  - Cursor's catalog for the key (`Cursor.models.list`, the call the harness
 *    makes at setup in `../../activities/execute-cursor/service-tier.ts`), for
 *    every Cursor row but the Auto pool.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; each provider's suite skips without its key
 * outside the lane (`src/__test-utils__/live-gate.ts`). A key is sent only in
 * a request header and never printed.
 */
import { Cursor } from "@cursor/sdk";
import { describe, expect, it } from "vitest";

import { liveSecret } from "../../__test-utils__/live-gate.js";
import { cursorCatalogRows, nativeRows, providerModelId, realModelRegistry } from "../../__test-utils__/real-model-registry.js";

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
/** The API version every Anthropic request names. */
const ANTHROPIC_VERSION = "2023-06-01";

const registry = realModelRegistry();

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("the registry's native ids at Anthropic", () => {
  it("every native row's provider id resolves at Anthropic", async () => {
    const key = liveSecret("ANTHROPIC_API_KEY") ?? "";
    const unknown: string[] = [];
    for (const row of nativeRows(registry)) {
      const id = providerModelId(row);
      const response = await fetch(`${ANTHROPIC_MODELS_URL}/${encodeURIComponent(id)}`, {
        headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Anthropic refused the key (${response.status}); the key is the problem, not the registry`);
      }
      if (!response.ok) unknown.push(`${row.id} -> ${id} (${response.status})`);
    }
    expect(unknown, "native rows whose provider id Anthropic does not know").toEqual([]);
  });
});

describe.skipIf(!liveSecret("CURSOR_API_KEY"))("the registry's Cursor ids in the key's catalog", () => {
  it("every Cursor row except the Auto pool is in Cursor.models.list", async () => {
    const catalog = new Set((await Cursor.models.list({ apiKey: liveSecret("CURSOR_API_KEY") ?? "" })).map((m) => m.id));
    const missing = cursorCatalogRows(registry)
      .map((row) => row.id)
      .filter((id) => !catalog.has(id));
    expect(missing, "Cursor rows the key's catalog does not list").toEqual([]);
  });
});
