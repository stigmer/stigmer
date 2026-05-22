import { describe, it, expect } from "vitest";
import { WorkflowStateImpl, createState } from "../state.js";

describe("WorkflowStateImpl", () => {
  describe("createState", () => {
    it("creates a state with empty defaults", () => {
      const state = createState();
      expect(state.context).toBeNull();
      expect(state.data).toEqual({});
      expect(state.env).toEqual({});
      expect(state.input).toBeNull();
      expect(state.output).toBeNull();
    });
  });

  describe("addData", () => {
    it("merges new keys into data", () => {
      const state = createState();
      state.addData({ foo: 1 });
      state.addData({ bar: 2 });
      expect(state.data).toEqual({ foo: 1, bar: 2 });
    });

    it("overwrites existing keys", () => {
      const state = createState();
      state.addData({ foo: 1 });
      state.addData({ foo: 99 });
      expect(state.data).toEqual({ foo: 99 });
    });

    it("handles nested objects", () => {
      const state = createState();
      state.addData({ nested: { a: 1, b: [2, 3] } });
      expect(state.data).toEqual({ nested: { a: 1, b: [2, 3] } });
    });
  });

  describe("getAsMap", () => {
    it("returns all five jq variable bindings", () => {
      const state = createState();
      state.context = { userId: 42 };
      state.data = { items: [1, 2, 3] };
      state.env = { API_KEY: "secret" };
      state.input = { trigger: "test" };
      state.output = { result: "done" };

      const map = state.getAsMap();

      expect(map.$context).toEqual({ userId: 42 });
      expect(map.$data).toEqual({ items: [1, 2, 3] });
      expect(map.$env).toEqual({ API_KEY: "secret" });
      expect(map.$input).toEqual({ trigger: "test" });
      expect(map.$output).toEqual({ result: "done" });
    });

    it("returns deep clones — mutations do not affect original", () => {
      const state = createState();
      state.data = { items: [1, 2, 3] };

      const map = state.getAsMap();
      (map.$data as Record<string, unknown>).items = [99];

      expect(state.data.items).toEqual([1, 2, 3]);
    });

    it("handles null context and output", () => {
      const state = createState();
      const map = state.getAsMap();

      expect(map.$context).toBeNull();
      expect(map.$output).toBeNull();
    });
  });

  describe("clone", () => {
    it("produces an independent copy", () => {
      const state = createState();
      state.context = { a: 1 };
      state.data = { b: 2 };
      state.env = { c: "3" };
      state.input = { d: 4 };
      state.output = { e: 5 };

      const cloned = state.clone();

      expect(cloned.context).toEqual({ a: 1 });
      expect(cloned.data).toEqual({ b: 2 });
      expect(cloned.env).toEqual({ c: "3" });
      expect(cloned.input).toEqual({ d: 4 });
      expect(cloned.output).toEqual({ e: 5 });
    });

    it("is a deep clone — mutations do not affect original", () => {
      const state = createState();
      state.data = { nested: { value: "original" } };

      const cloned = state.clone();
      (cloned.data.nested as Record<string, unknown>).value = "mutated";

      expect(
        (state.data.nested as Record<string, unknown>).value,
      ).toBe("original");
    });

    it("clone of empty state produces empty state", () => {
      const state = createState();
      const cloned = state.clone();

      expect(cloned.context).toBeNull();
      expect(cloned.data).toEqual({});
      expect(cloned.env).toEqual({});
      expect(cloned.input).toBeNull();
      expect(cloned.output).toBeNull();
    });

    it("is a separate instance", () => {
      const state = createState();
      const cloned = state.clone();
      expect(cloned).not.toBe(state);
      expect(cloned).toBeInstanceOf(WorkflowStateImpl);
    });
  });

  describe("clearOutput", () => {
    it("resets output to null", () => {
      const state = createState();
      state.output = { result: 42 };
      state.clearOutput();
      expect(state.output).toBeNull();
    });
  });

  describe("integration: task chain simulation", () => {
    it("accumulates data through sequential tasks", () => {
      const state = createState();
      state.input = { trigger: "start" };
      state.env = { MODE: "test" };

      // Task 1: set
      state.addData({ step1: { initialized: true } });
      state.output = { initialized: true };

      // Task 2: set
      state.addData({ step2: { processed: true } });
      state.output = { processed: true };

      expect(state.data).toEqual({
        step1: { initialized: true },
        step2: { processed: true },
      });
      expect(state.input).toEqual({ trigger: "start" });
    });

    it("export accumulates into context by task name", () => {
      const state = createState();
      state.context = {};

      // Task "fetchPost" exports to context
      const context = state.context as Record<string, unknown>;
      context.fetchPost = { userId: 1, id: 7 };
      state.context = context;

      // Task "fetchComments" exports to context
      const context2 = state.context as Record<string, unknown>;
      context2.fetchComments = [{ id: 1 }, { id: 2 }];
      state.context = context2;

      expect(state.context).toEqual({
        fetchPost: { userId: 1, id: 7 },
        fetchComments: [{ id: 1 }, { id: 2 }],
      });
    });
  });
});
