import { describe, it, expect } from "vitest";
import { extractJsonFromText } from "../extract-json.js";

/**
 * Exact agent response from the production failure (truncated for test).
 * The agent returned prose + markdown-fenced JSON.
 */
const PRODUCTION_RESPONSE = `Now I have sufficient data to generate the cohort analysis report. Based on my analysis:

\`\`\`json
{
  "executive_summary": "DAU remains stable at 7,175 (+1.4% vs 7-day average). Critical attention needed for D3 drop-offs.",
  "dau": 7175,
  "dau_trend_pct": 1.38,
  "cohorts": [
    {
      "name": "D1 New Players",
      "size": 10,
      "retention_trend": "Low acquisition volume, needs investigation",
      "action_needed": true
    },
    {
      "name": "D3 Drop-offs",
      "size": 3589,
      "retention_trend": "High drop-off concentration in Cuba, Indonesia, India",
      "action_needed": true
    }
  ],
  "anomalies": [
    {
      "metric": "D1 New Acquisition",
      "severity": "warning",
      "description": "Only 10 new D1 players vs expected ~200-300"
    }
  ],
  "data_quality_notes": "Latest event_date: 2026-05-21 (3 days lag)."
}
\`\`\``;

describe("extractJsonFromText", () => {
  describe("Tier 1: direct JSON.parse", () => {
    it("parses pure JSON string", () => {
      const json = '{"name": "test", "value": 42}';
      const result = extractJsonFromText(json);
      expect(result).toEqual({ name: "test", value: 42 });
    });

    it("parses pure JSON array", () => {
      const json = '[1, 2, 3]';
      const result = extractJsonFromText(json);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe("Tier 1.5: code-fence extraction", () => {
    it("extracts JSON from ```json code fence", () => {
      const text = 'Here is the result:\n\n```json\n{"key": "value"}\n```\n\nDone.';
      const result = extractJsonFromText(text);
      expect(result).toEqual({ key: "value" });
    });

    it("extracts JSON from bare ``` code fence (no language tag)", () => {
      const text = 'Result:\n\n```\n{"answer": 42}\n```';
      const result = extractJsonFromText(text);
      expect(result).toEqual({ answer: 42 });
    });

    it("extracts the production failure response", () => {
      const result = extractJsonFromText(PRODUCTION_RESPONSE);
      expect(result).toBeDefined();
      expect(result).toHaveProperty("executive_summary");
      expect(result).toHaveProperty("dau", 7175);
      expect(result).toHaveProperty("cohorts");
      expect((result as Record<string, unknown>).cohorts).toHaveLength(2);
    });

    it("picks the valid JSON fence when multiple fences exist", () => {
      const text = `Here's the SQL query:

\`\`\`sql
SELECT * FROM users;
\`\`\`

And the result:

\`\`\`json
{"users": 42}
\`\`\``;
      const result = extractJsonFromText(text);
      expect(result).toEqual({ users: 42 });
    });

    it("handles code fence with trailing whitespace", () => {
      const text = '```json\n{"ok": true}\n```  \n';
      const result = extractJsonFromText(text);
      expect(result).toEqual({ ok: true });
    });
  });

  describe("Tier 1.75: heuristic brace extraction", () => {
    it("extracts JSON from prose without code fences", () => {
      const text = 'The analysis is complete. {"status": "done", "count": 5} That is the result.';
      const result = extractJsonFromText(text);
      expect(result).toEqual({ status: "done", count: 5 });
    });
  });

  describe("failure cases", () => {
    it("returns undefined for plain text with no JSON", () => {
      const result = extractJsonFromText("This is just regular text with no JSON content.");
      expect(result).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(extractJsonFromText("")).toBeUndefined();
    });

    it("returns undefined for malformed JSON in code fence", () => {
      const text = '```json\n{broken json\n```';
      const result = extractJsonFromText(text);
      expect(result).toBeUndefined();
    });
  });
});
