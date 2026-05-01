import { describe, it, expect } from "vitest";
import {
  parsePrice,
  parseAutoPricing,
  parseModelPricingTable,
  matchPricingToModels,
  validate,
  generateTypeScript,
  extractMarkdownTables,
  stripMarkdownLink,
  type PricingRow,
  type ProxyModel,
  type GeneratedEntry,
} from "../update-pricing.js";

// ---------------------------------------------------------------------------
// Fixtures — markdown fragments that mirror the Cursor pricing page
// ---------------------------------------------------------------------------

const AUTO_TABLE_MD = `
### Auto pricing

| Token type | Price per 1M tokens |
| :--- | :--- |
| Input + Cache Write | $1.25 |
| Output | $6.00 |
| Cache Read | $0.25 |
`;

const MODEL_TABLE_MD = `
### Model pricing

| Model | Provider | Input | Cache write | Cache read | Output | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| [Claude 4.7 Opus](https://www.anthropic.com/claude/opus) | Anthropic | $5 | $6.25 | $0.5 | $25 | Requires Max Mode |
| Composer 2 | Cursor | $0.5 | - | $0.2 | $2.5 | - |
| [GPT-5.4 Mini](https://example.com) | OpenAI | $0.75 | - | $0.075 | $4.5 | Hidden by default |
`;

const COMBINED_MD = `# Models & Pricing

## Auto + Composer pool

${AUTO_TABLE_MD}

## API pool

${MODEL_TABLE_MD}
`;

// ---------------------------------------------------------------------------
// extractMarkdownTables
// ---------------------------------------------------------------------------

describe("extractMarkdownTables", () => {
  it("finds all tables in a markdown string", () => {
    const tables = extractMarkdownTables(COMBINED_MD);
    expect(tables).toHaveLength(2);
  });

  it("lowercases header names", () => {
    const tables = extractMarkdownTables(AUTO_TABLE_MD);
    expect(tables[0].headers).toEqual(["token type", "price per 1m tokens"]);
  });

  it("returns empty for markdown without tables", () => {
    expect(extractMarkdownTables("# Just a heading\n\nSome text.")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stripMarkdownLink
// ---------------------------------------------------------------------------

describe("stripMarkdownLink", () => {
  it("extracts text from a markdown link", () => {
    expect(stripMarkdownLink("[Claude 4.7 Opus](https://example.com)")).toBe(
      "Claude 4.7 Opus",
    );
  });

  it("returns plain text unchanged", () => {
    expect(stripMarkdownLink("Composer 2")).toBe("Composer 2");
  });
});

// ---------------------------------------------------------------------------
// parsePrice
// ---------------------------------------------------------------------------

describe("parsePrice", () => {
  it("parses dollar amounts", () => {
    expect(parsePrice("$5")).toBe(5);
    expect(parsePrice("$0.25")).toBe(0.25);
    expect(parsePrice("$6.25")).toBe(6.25);
    expect(parsePrice("$17.5")).toBe(17.5);
  });

  it("treats dash as zero", () => {
    expect(parsePrice("-")).toBe(0);
  });

  it("treats empty string as zero", () => {
    expect(parsePrice("")).toBe(0);
  });

  it("handles whitespace", () => {
    expect(parsePrice("  $3.75  ")).toBe(3.75);
  });

  it("throws on non-numeric content", () => {
    expect(() => parsePrice("abc")).toThrow("Cannot parse price");
  });
});

// ---------------------------------------------------------------------------
// parseAutoPricing
// ---------------------------------------------------------------------------

describe("parseAutoPricing", () => {
  it("extracts Auto pool pricing from the token-type table", () => {
    const entry = parseAutoPricing(COMBINED_MD);

    expect(entry.model).toBe("default");
    expect(entry.displayName).toBe("Auto");
    expect(entry.inputPricePerMillion).toBe(1.25);
    expect(entry.outputPricePerMillion).toBe(6.0);
    expect(entry.cacheWritePricePerMillion).toBe(1.25);
    expect(entry.cacheReadPricePerMillion).toBe(0.25);
  });

  it("throws when Auto table is missing", () => {
    expect(() => parseAutoPricing("# No tables here")).toThrow(
      "Failed to parse Auto pricing",
    );
  });
});

// ---------------------------------------------------------------------------
// parseModelPricingTable
// ---------------------------------------------------------------------------

describe("parseModelPricingTable", () => {
  it("extracts all model rows from the pricing table", () => {
    const rows = parseModelPricingTable(COMBINED_MD);

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.displayName)).toEqual([
      "Claude 4.7 Opus",
      "Composer 2",
      "GPT-5.4 Mini",
    ]);
  });

  it("parses prices correctly for each row", () => {
    const rows = parseModelPricingTable(COMBINED_MD);

    const claude = rows.find((r) => r.displayName === "Claude 4.7 Opus")!;
    expect(claude.inputPricePerMillion).toBe(5);
    expect(claude.outputPricePerMillion).toBe(25);
    expect(claude.cacheWritePricePerMillion).toBe(6.25);
    expect(claude.cacheReadPricePerMillion).toBe(0.5);
    expect(claude.provider).toBe("Anthropic");

    const composer = rows.find((r) => r.displayName === "Composer 2")!;
    expect(composer.cacheWritePricePerMillion).toBe(0);
    expect(composer.cacheReadPricePerMillion).toBe(0.2);
  });

  it("strips markdown links from model names", () => {
    const rows = parseModelPricingTable(COMBINED_MD);
    expect(rows[0].displayName).toBe("Claude 4.7 Opus");
  });

  it("returns empty array when no model table exists", () => {
    const rows = parseModelPricingTable(AUTO_TABLE_MD);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchPricingToModels
// ---------------------------------------------------------------------------

describe("matchPricingToModels", () => {
  const pricingRows: PricingRow[] = [
    { displayName: "Claude 4.7 Opus", provider: "Anthropic", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
    { displayName: "Composer 2", provider: "Cursor", inputPricePerMillion: 0.5, outputPricePerMillion: 2.5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0.2 },
    { displayName: "Unknown Model", provider: "Mystery", inputPricePerMillion: 1, outputPricePerMillion: 5, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0 },
  ];

  const proxyModels: ProxyModel[] = [
    { id: "claude-opus-4-7", displayName: "Claude 4.7 Opus" },
    { id: "composer-2", displayName: "Composer 2" },
    { id: "gpt-5.5", displayName: "GPT-5.5" },
  ];

  it("matches pricing rows to proxy models by display name", () => {
    const { matched } = matchPricingToModels(pricingRows, proxyModels);

    expect(matched).toHaveLength(2);
    expect(matched[0].model).toBe("claude-opus-4-7");
    expect(matched[0].displayName).toBe("Claude 4.7 Opus");
    expect(matched[0].inputPricePerMillion).toBe(5);
    expect(matched[1].model).toBe("composer-2");
  });

  it("reports unmatched pricing rows", () => {
    const { unmatchedPricing } = matchPricingToModels(pricingRows, proxyModels);
    expect(unmatchedPricing).toEqual(["Unknown Model"]);
  });

  it("reports unmatched proxy models", () => {
    const { unmatchedModels } = matchPricingToModels(pricingRows, proxyModels);
    expect(unmatchedModels).toEqual(["GPT-5.5 (gpt-5.5)"]);
  });

  it("matches case-insensitively", () => {
    const rows: PricingRow[] = [
      { displayName: "claude 4.7 opus", provider: "Anthropic", inputPricePerMillion: 5, outputPricePerMillion: 25, cacheWritePricePerMillion: 6.25, cacheReadPricePerMillion: 0.5 },
    ];
    const { matched } = matchPricingToModels(rows, proxyModels);
    expect(matched).toHaveLength(1);
    expect(matched[0].model).toBe("claude-opus-4-7");
  });

  it("excludes unmatched pricing rows from output", () => {
    const { matched } = matchPricingToModels(pricingRows, proxyModels);
    const ids = matched.map((m) => m.model);
    expect(ids).not.toContain("unknown-model");
    expect(ids).not.toContain("Unknown Model");
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("validate", () => {
  const validEntry: GeneratedEntry = {
    model: "test",
    displayName: "Test",
    inputPricePerMillion: 1,
    outputPricePerMillion: 5,
    cacheWritePricePerMillion: 0,
    cacheReadPricePerMillion: 0.1,
  };

  it("passes for valid entries", () => {
    expect(() => validate([validEntry])).not.toThrow();
  });

  it("detects duplicate model IDs", () => {
    expect(() => validate([validEntry, validEntry])).toThrow("Duplicate");
  });

  it("detects zero output price", () => {
    expect(() =>
      validate([{ ...validEntry, outputPricePerMillion: 0 }]),
    ).toThrow("output price must be > 0");
  });

  it("detects negative prices", () => {
    expect(() =>
      validate([{ ...validEntry, inputPricePerMillion: -1 }]),
    ).toThrow("negative input price");
  });
});

// ---------------------------------------------------------------------------
// generateTypeScript
// ---------------------------------------------------------------------------

describe("generateTypeScript", () => {
  it("generates valid TypeScript with DO NOT EDIT header", () => {
    const entries: GeneratedEntry[] = [
      {
        model: "default",
        displayName: "Auto",
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 6,
        cacheWritePricePerMillion: 1.25,
        cacheReadPricePerMillion: 0.25,
      },
    ];
    const output = generateTypeScript(entries, "2026-05-01T00:00:00.000Z");

    expect(output).toContain("AUTO-GENERATED — do not edit by hand");
    expect(output).toContain("2026-05-01T00:00:00.000Z");
    expect(output).toContain("export interface CursorModelPricing");
    expect(output).toContain("export const PRICING_TABLE");
    expect(output).toContain('"default"');
    expect(output).toContain('"Auto"');
    expect(output).toContain("inputPricePerMillion: 1.25");
  });

  it("includes all entries in order", () => {
    const entries: GeneratedEntry[] = [
      { model: "a", displayName: "A", inputPricePerMillion: 1, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0 },
      { model: "b", displayName: "B", inputPricePerMillion: 3, outputPricePerMillion: 4, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0 },
    ];
    const output = generateTypeScript(entries, "now");

    const aIdx = output.indexOf('"a"');
    const bIdx = output.indexOf('"b"');
    expect(aIdx).toBeLessThan(bIdx);
  });
});
