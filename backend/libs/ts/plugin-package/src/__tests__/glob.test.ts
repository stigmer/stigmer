/**
 * Pins `globError`, the suite reader's check of a `file_exists` path,
 * over the shared table the server's matcher test also reads
 * (`GLOB_VALIDITY_TABLE`): every well-formed glob answers nothing, every
 * malformed one its sentence, and a hostile glob is answered quickly.
 */

import { describe, expect, it } from "vitest";

import { globError } from "../evals/glob.js";
import { GLOB_VALIDITY_TABLE } from "../testing.js";

describe("globError", () => {
  it.each(GLOB_VALIDITY_TABLE)("%j answers %j", (glob, error) => {
    expect(globError(glob)).toBe(error);
  });

  it("answers a long hostile glob at once", () => {
    const started = performance.now();
    expect(globError(`${"{a,".repeat(2000)}`)).toBe("braces are nested more than 16 deep");
    expect(globError("*".repeat(100_000))).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(50);
  });
});
