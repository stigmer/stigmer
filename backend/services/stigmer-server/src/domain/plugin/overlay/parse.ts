/**
 * Strict YAML → proto for the documents under a plugin's `ai.stigmer/`
 * folder: `agent.yaml`, `workflows/<name>.yaml`, `mcp-servers/<server>.yaml`.
 * The library (`@stigmer/plugin-package`) hands them over as bytes because
 * it is proto-free; this module is where they become resources.
 *
 * It is the server twin of the SDK's manifest parser
 * (sdk/typescript/src/manifest/parse.ts), which is the strictness contract
 * every `stigmer apply` document already meets and which the server cannot
 * import (the dependency direction runs the other way). The twin makes the
 * same core call — `fromJson(schema, value, { ignoreUnknownFields: false })`,
 * the call the workflow converter's unmarshal.ts makes too — so a document
 * the CLI accepts is one the server accepts, and a typo the CLI refuses is
 * refused here with the document's path in the sentence. Two rules are
 * stricter than the SDK's, on purpose: the document's `kind` must be the
 * one its location promises (an `agent.yaml` holding a Workflow is a
 * mistake, not a choice), and a `metadata.org` other than the installing
 * organization is refused rather than honoured with a warning, because an
 * overlay is materialised on the caller's behalf and must not reach across
 * organizations.
 *
 * Protovalidate is not run here: it runs where it always runs, in the
 * child's own chain when the resource is applied.
 *
 * Proven by __tests__/overlay-parse.test.ts against the documents the CLI
 * accepts and refuses.
 */
import { fromJson } from "@bufbuild/protobuf";
import type { DescMessage, JsonValue, MessageShape } from "@bufbuild/protobuf";
import { load as loadYaml } from "js-yaml";

import { metadataOf } from "../../../pipeline/steps/shapes.js";

/** One refusal, phrased for the author with the document's path. */
export class OverlayParseError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`overlay document '${path}': ${reason}`);
    this.name = "OverlayParseError";
  }
}

export interface OverlayExpectation<Desc extends DescMessage> {
  readonly schema: Desc;
  /** The YAML `kind` the location promises: "Agent", "Workflow", "McpServer". */
  readonly yamlKind: string;
  /** The organization the plugin is installed into; the document's must be empty or equal. */
  readonly org: string;
}

/** Parses one overlay document into its proto, strictly. */
export function parseOverlayDocument<Desc extends DescMessage>(
  path: string,
  bytes: Uint8Array,
  expectation: OverlayExpectation<Desc>,
): MessageShape<Desc> {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.trim() === "") {
    throw new OverlayParseError(path, "the document is empty");
  }

  let value: unknown;
  try {
    value = loadYaml(text);
  } catch (error) {
    throw new OverlayParseError(
      path,
      `invalid YAML: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new OverlayParseError(
      path,
      "expected a mapping document with apiVersion, kind, metadata, and spec",
    );
  }

  const kind = (value as Record<string, unknown>).kind;
  if (kind !== expectation.yamlKind) {
    throw new OverlayParseError(
      path,
      kind === undefined || kind === ""
        ? `missing the required 'kind' field (expected kind: ${expectation.yamlKind})`
        : `kind '${String(kind)}' is not the ${expectation.yamlKind} this location holds`,
    );
  }

  let message: MessageShape<Desc>;
  try {
    message = fromJson(expectation.schema, value as JsonValue, {
      ignoreUnknownFields: false,
    });
  } catch (error) {
    throw new OverlayParseError(
      path,
      `invalid ${expectation.yamlKind}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const metadata = metadataOf(message);
  if (
    metadata !== undefined &&
    metadata.org !== "" &&
    metadata.org !== expectation.org
  ) {
    throw new OverlayParseError(
      path,
      `metadata.org '${metadata.org}' is not the organization the plugin is installed into ('${expectation.org}')`,
    );
  }

  return message;
}
