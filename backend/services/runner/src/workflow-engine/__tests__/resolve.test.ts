import { describe, it, expect } from "vitest";
import {
  collectExpressions,
  substituteResults,
  resolveConfigExpressions,
  resolveEmbeddedExpressions,
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

// ─────────────────────────────────────────────────────────────────────
// Embedded Expression Resolution (Phase 2)
// ─────────────────────────────────────────────────────────────────────

describe("resolveEmbeddedExpressions", () => {
  const stateVars = {
    $context: { task: { name: "Alice", count: 3 } },
    $env: { REGION: "us-east" },
    $data: {},
    $input: null,
    $output: null,
  };

  it("interpolates embedded expressions in a flat object", async () => {
    const obj: Record<string, unknown> = {
      message: "Hello ${ $context.task.name }, found ${ $context.task.count } items.",
      static: "no expressions here",
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect(obj.message).toBe("Hello Alice, found 3 items.");
    expect(obj.static).toBe("no expressions here");
  });

  it("interpolates in nested objects", async () => {
    const obj: Record<string, unknown> = {
      body: {
        greeting: "Welcome ${ $context.task.name }!",
        count: 42,
      },
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect((obj.body as Record<string, unknown>).greeting).toBe("Welcome Alice!");
    expect((obj.body as Record<string, unknown>).count).toBe(42);
  });

  it("interpolates in arrays", async () => {
    const obj: Record<string, unknown> = {
      items: ["Item: ${ $context.task.name }", "static", "Region: ${ $env.REGION }"],
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect((obj.items as string[])[0]).toBe("Item: Alice");
    expect((obj.items as string[])[1]).toBe("static");
    expect((obj.items as string[])[2]).toBe("Region: us-east");
  });

  it("skips strict expressions (already resolved in Phase 1)", async () => {
    const obj: Record<string, unknown> = {
      strictField: "${ $context.task.name }",
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect(obj.strictField).toBe("${ $context.task.name }");
  });

  it("is a no-op when no embedded expressions exist", async () => {
    const obj: Record<string, unknown> = {
      plain: "hello",
      number: 42,
      nested: { key: "value" },
    };
    const original = JSON.stringify(obj);

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect(JSON.stringify(obj)).toBe(original);
  });

  it("converts null expression results to empty string", async () => {
    const obj: Record<string, unknown> = {
      message: "Value: ${ $env.MISSING_KEY }",
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect(obj.message).toBe("Value: ");
  });

  it("interpolates in objects nested within arrays", async () => {
    const obj: Record<string, unknown> = {
      steps: [
        { label: "Step: ${ $context.task.name }", count: "${ $context.task.count } total" },
        { label: "static" },
      ],
    };

    await resolveEmbeddedExpressions(obj, null, stateVars, evaluateExpressionBatch);

    expect((obj.steps as any[])[0].label).toBe("Step: Alice");
    expect((obj.steps as any[])[0].count).toBe("3 total");
    expect((obj.steps as any[])[1].label).toBe("static");
  });
});

// ─────────────────────────────────────────────────────────────────────
// resolveConfigExpressions — mixed strict + embedded
// ─────────────────────────────────────────────────────────────────────

describe("resolveConfigExpressions — embedded expression support", () => {
  it("resolves mixed strict and embedded expressions", async () => {
    const config = {
      agent: "${ $context.agentSlug }",
      message: "Hello ${ $context.userName }, your order ${ $context.orderId } is ready.",
      static: "unchanged",
    };

    const state = createState();
    state.context = { agentSlug: "reviewer", userName: "Alice", orderId: 42 };

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.agent).toBe("reviewer");
    expect(result.message).toBe("Hello Alice, your order 42 is ready.");
    expect(result.static).toBe("unchanged");
  });

  it("resolves embedded $env expressions in agent message", async () => {
    const config = {
      agent: "analyst",
      message: "Generate report.\nDate: ${ $env.NOTIFICATION_DATE }\nSource: database",
    };

    const state = createState();
    state.env = { NOTIFICATION_DATE: "2026-05-23" };

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.message).toBe("Generate report.\nDate: 2026-05-23\nSource: database");
    expect(result.message).not.toContain("${ ");
  });

  it("handles optional env vars (null → empty string in embedded)", async () => {
    const config = {
      message: "Date: ${ $env.OPTIONAL_DATE }",
    };

    const state = createState();
    state.env = {};

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.message).toBe("Date: ");
  });

  it("does not mutate the original config", async () => {
    const config = {
      message: "Hello ${ $context.name }!",
    };
    const frozen = { ...config };

    const state = createState();
    state.context = { name: "Alice" };

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.message).toBe("Hello Alice!");
    expect(frozen.message).toBe("Hello ${ $context.name }!");
  });

  it("does not re-interpolate Phase 1 results that contain expression-like syntax", async () => {
    const config = {
      template: "${ $context.userTemplate }",
      static: "Hello ${ $context.name }!",
    };

    const state = createState();
    state.context = {
      userTemplate: "Dangerous ${ $env.SECRET } content",
      name: "Alice",
    };
    state.env = { SECRET: "leaked-value" };

    const result = await resolveConfigExpressions(
      config,
      null,
      state,
      evaluateExpressionBatch,
    );

    expect(result.template).toBe("Dangerous ${ $env.SECRET } content");
    expect(result.static).toBe("Hello Alice!");
  });
});
