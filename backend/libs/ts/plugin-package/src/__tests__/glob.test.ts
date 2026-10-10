/**
 * Pins `globError`, the suite reader's check of a `file_exists` path,
 * over the shared table the server's matcher test also reads
 * (`GLOB_VALIDITY_TABLE`): every well-formed glob answers nothing, every
 * malformed one its sentence (a glob too long or of too many tokens
 * included), and a hostile glob is answered quickly.
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
    expect(globError(`${"{a,".repeat(300)}`)).toBe("braces are nested more than 16 deep");
    expect(globError("*".repeat(1024))).toBeUndefined();
    expect(globError("*".repeat(100_000))).toBe("it is longer than 1024 characters");
    expect(performance.now() - started).toBeLessThan(50);
  });

  it("refuses a 900 KB glob of ** segments behind six brace groups at once", () => {
    const glob = `${"{a,b}".repeat(6)}${"**/".repeat(300_000)}x`;
    const started = performance.now();
    expect(globError(glob)).toBe("it is longer than 1024 characters");
    expect(performance.now() - started).toBeLessThan(50);
  });
});
