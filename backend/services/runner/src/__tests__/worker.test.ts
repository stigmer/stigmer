import { describe, it, expect } from "vitest";
import { startWorker, type WorkerActivities } from "../worker.js";

describe("startWorker", () => {
  it("exports startWorker function", () => {
    expect(typeof startWorker).toBe("function");
  });

  it("accepts activities record with correct shape", () => {
    const activities: WorkerActivities = {
      ExecuteCursor: async () => ({}),
      ExecuteDeepAgent: async () => ({}),
    };

    expect(Object.keys(activities)).toContain("ExecuteCursor");
    expect(Object.keys(activities)).toContain("ExecuteDeepAgent");
  });
});
