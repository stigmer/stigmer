/** Catch kinks in closed outlines and stop detached dots drifting away from true circles. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MARK_PATHS } from "../geometry.js";

test("organic outlines meet with continuous tangents, including their closing joins", () => {
  for (const [index, path] of MARK_PATHS.slice(0, 4).entries()) {
    const commands = path.match(/[A-Za-z][^A-Za-z]*/g)!;
    assert.equal(commands[0][0], "M");
    assert.equal(commands.at(-1), "Z");
    const start = commands[0].slice(1).trim().split(/[ ,]+/).map(Number);
    const segments = commands.slice(1, -1).map((command) => {
      assert.equal(
        command[0],
        "C",
        `form ${index}: use smooth curves throughout`,
      );
      const coordinates = command.slice(1).trim().split(/[ ,]+/).map(Number);
      assert.equal(coordinates.length, 6);
      return coordinates;
    });
    assert.deepEqual(
      segments.at(-1)!.slice(4),
      start,
      `form ${index}: close without a straight seam`,
    );
    for (const [join, previous] of segments.entries()) {
      const next = segments[(join + 1) % segments.length];
      const incoming = [previous[4] - previous[2], previous[5] - previous[3]];
      const outgoing = [next[0] - previous[4], next[1] - previous[5]];
      const cosine =
        (incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) /
        (Math.hypot(...incoming) * Math.hypot(...outgoing));
      assert.ok(
        cosine > 0.99999,
        `form ${index}, join ${join}: visible tangent discontinuity (${cosine})`,
      );
    }
  }
});

test("each detached dot is a circle formed by two equal-radius semicircles", () => {
  for (const [index, path] of MARK_PATHS.slice(4).entries()) {
    const commands = path.match(/[A-Za-z][^A-Za-z]*/g)!;
    assert.deepEqual(
      commands.map((command) => command[0]),
      ["M", "A", "A", "Z"],
    );
    const start = commands[0].slice(1).trim().split(/[ ,]+/).map(Number);
    const arcs = commands
      .slice(1, 3)
      .map((command) => command.slice(1).trim().split(/[ ,]+/).map(Number));
    for (const arc of arcs) {
      assert.equal(arc.length, 7);
      assert.equal(arc[0], arc[1], `dot ${index}: circular, not elliptical`);
      assert.deepEqual(arc.slice(2, 5), [0, 1, 1]);
      assert.equal(arc[6], start[1]);
    }
    assert.equal(arcs[0][0], arcs[1][0]);
    assert.ok(Math.abs(start[0] - arcs[0][5] - 2 * arcs[0][0]) < 0.00001);
    assert.deepEqual(arcs[1].slice(5), start);
  }
});
