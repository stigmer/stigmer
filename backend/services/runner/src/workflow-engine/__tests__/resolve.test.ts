import { describe, it, expect } from "vitest";
import {
  collectExpressions,
  substituteResults,
  resolveConfigExpressions,
  isRuntimePlaceholder,
  resolveRuntimePlaceholders,
  resolveObjectPlaceholders,
} from "../resolve.js";
import { evaluateExpressionBatch } from "../expression.js";
import { createState } from "../state.js";

describe("collectExpressions", () => {
  it("collects top-level expressions", () => {
    const result = collectExpressions({
      name: "${ .firstName }",
      age: 30,
      active: true,
    });
    expect(result).toEqual({ name: ".firstName" });
  });

  it("collects nested expressions", () => {
    const result = collectExpressions({
      body: {
        title: "${ $context.title }",
        userId: "${ $context.userId }",
        plain: "not-an-expression",
      },
    });
    expect(result).toEqual({
      "body.title": "$context.title",
      "body.userId": "$context.userId",
    });
  });

  it("collects expressions in arrays", () => {
    const result = collectExpressions({
      items: ["${ .a }", "static", "${ .b }"],
    });
    expect(result).toEqual({
      "items[0]": ".a",
      "items[2]": ".b",
    });
  });

  it("returns empty map for no expressions", () => {
    const result = collectExpressions({ x: 1, y: "plain", z: true });
    expect(result).toEqual({});
  });

  it("ignores non-strict expressions (no space after ${)", () => {
    const result = collectExpressions({
      secret: "${.secrets.KEY}",
      valid: "${ .value }",
    });
    expect(result).toEqual({ valid: ".value" });
  });
});

describe("substituteResults", () => {
  it("substitutes top-level results", () => {
    const obj = { name: "${ .firstName }", age: 30 };
    const result = substituteResults(obj, { name: "Alice" });
    expect(result).toEqual({ name: "Alice", age: 30 });
  });

  it("substitutes nested results", () => {
    const obj = { body: { title: "${ $context.title }" } };
    const result = substituteResults(obj, { "body.title": "Hello" });
    expect(result).toEqual({ body: { title: "Hello" } });
  });

  it("substitutes array element results", () => {
    const obj = { items: ["${ .a }", "static"] };
    const result = substituteResults(obj, { "items[0]": 42 });
    expect(result).toEqual({ items: [42, "static"] });
  });
});

describe("resolveConfigExpressions", () => {
  it("resolves all expressions in a config object", async () => {
    const config = {
      method: "POST",
      endpoint: { uri: "https://example.com" },
      body: {
        userId: "${ $context.userId }",
        title: "Static Title",
      },
    };

    const state = createState();
    state.context = { userId: 42 };

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result).toEqual({
      method: "POST",
      endpoint: { uri: "https://example.com" },
      body: { userId: 42, title: "Static Title" },
    });
  });

  it("returns config unchanged when no expressions present", async () => {
    const config = { method: "GET", endpoint: "https://example.com" };
    const state = createState();

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result).toEqual(config);
  });

  it("does not mutate the original config", async () => {
    const config = { value: "${ 1 + 2 }" };
    const frozen = Object.freeze({ ...config });
    const state = createState();

    const result = await resolveConfigExpressions(
      { ...frozen },
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.value).toBe(3);
    expect(frozen.value).toBe("${ 1 + 2 }");
  });
});

describe("isRuntimePlaceholder", () => {
  it("detects ${.secrets.KEY} pattern", () => {
    expect(isRuntimePlaceholder("${.secrets.API_KEY}")).toBe(true);
  });

  it("detects ${.env_vars.KEY} pattern", () => {
    expect(isRuntimePlaceholder("${.env_vars.DB_HOST}")).toBe(true);
  });

  it("does not match jq expressions ${ ... }", () => {
    expect(isRuntimePlaceholder("${ $context.field }")).toBe(false);
  });

  it("detects placeholders embedded in larger strings", () => {
    expect(isRuntimePlaceholder("Bearer ${.secrets.TOKEN}")).toBe(true);
  });
});

describe("resolveRuntimePlaceholders", () => {
  it("resolves secrets placeholders", () => {
    const result = resolveRuntimePlaceholders(
      "Bearer ${.secrets.TOKEN}",
      { TOKEN: "abc123" },
    );
    expect(result).toBe("Bearer abc123");
  });

  it("resolves env_vars placeholders", () => {
    const result = resolveRuntimePlaceholders(
      "https://${.env_vars.HOST}/api",
      { HOST: "api.example.com" },
    );
    expect(result).toBe("https://api.example.com/api");
  });

  it("replaces missing keys with empty string", () => {
    const result = resolveRuntimePlaceholders(
      "key=${.secrets.MISSING}",
      {},
    );
    expect(result).toBe("key=");
  });

  it("resolves multiple placeholders in one string", () => {
    const result = resolveRuntimePlaceholders(
      "${.secrets.USER}:${.secrets.PASS}",
      { USER: "admin", PASS: "secret" },
    );
    expect(result).toBe("admin:secret");
  });
});

describe("resolveObjectPlaceholders", () => {
  it("resolves placeholders in nested objects", () => {
    const result = resolveObjectPlaceholders(
      {
        headers: { Authorization: "Bearer ${.secrets.TOKEN}" },
        body: { user: "static", key: "${.secrets.API_KEY}" },
      },
      { TOKEN: "tok123", API_KEY: "key456" },
    );

    expect(result).toEqual({
      headers: { Authorization: "Bearer tok123" },
      body: { user: "static", key: "key456" },
    });
  });

  it("resolves placeholders in arrays", () => {
    const result = resolveObjectPlaceholders(
      ["${.secrets.A}", "static", "${.secrets.B}"],
      { A: "x", B: "y" },
    );
    expect(result).toEqual(["x", "static", "y"]);
  });

  it("passes non-string primitives through unchanged", () => {
    expect(resolveObjectPlaceholders(42, {})).toBe(42);
    expect(resolveObjectPlaceholders(true, {})).toBe(true);
    expect(resolveObjectPlaceholders(null, {})).toBe(null);
  });
});
