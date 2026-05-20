import { describe, it, expect } from "vitest";
import { WorkflowError } from "../errors.js";

describe("WorkflowError", () => {
  describe("construction", () => {
    it("creates an error with all CNCF fields", () => {
      const err = new WorkflowError({
        type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
        status: 400,
        title: "Validation failed",
        detail: "Field 'name' is required",
        instance: "wf-123",
      });

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(WorkflowError);
      expect(err.name).toBe("WorkflowError");
      expect(err.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/validation");
      expect(err.status).toBe(400);
      expect(err.title).toBe("Validation failed");
      expect(err.detail).toBe("Field 'name' is required");
      expect(err.instance).toBe("wf-123");
      expect(err.message).toBe("Validation failed");
    });

    it("defaults optional fields to empty strings", () => {
      const err = new WorkflowError({
        type: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
        status: 500,
      });

      expect(err.title).toBe("");
      expect(err.detail).toBe("");
      expect(err.instance).toBe("");
    });
  });

  describe("toJSON", () => {
    it("serializes to a plain object matching CNCF error shape", () => {
      const err = new WorkflowError({
        type: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout",
        status: 408,
        title: "Timeout",
        detail: "Operation timed out after 30s",
        instance: "exec-456",
      });

      const json = err.toJSON();

      expect(json).toEqual({
        type: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout",
        status: 408,
        title: "Timeout",
        detail: "Operation timed out after 30s",
        instance: "exec-456",
      });
    });
  });

  describe("fromUnknown", () => {
    it("passes through WorkflowError instances unchanged", () => {
      const original = new WorkflowError({
        type: "custom/error",
        status: 422,
        title: "Custom",
      });

      const wrapped = WorkflowError.fromUnknown(original);

      expect(wrapped).toBe(original);
    });

    it("wraps a standard Error with runtime type", () => {
      const err = new TypeError("Cannot read property 'x' of undefined");

      const wrapped = WorkflowError.fromUnknown(err);

      expect(wrapped.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/runtime");
      expect(wrapped.status).toBe(500);
      expect(wrapped.title).toBe("TypeError");
      expect(wrapped.detail).toBe("Cannot read property 'x' of undefined");
    });

    it("wraps a string error", () => {
      const wrapped = WorkflowError.fromUnknown("something went wrong");

      expect(wrapped.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/runtime");
      expect(wrapped.status).toBe(500);
      expect(wrapped.detail).toBe("something went wrong");
    });

    it("wraps a plain object with error-like fields", () => {
      const wrapped = WorkflowError.fromUnknown({
        type: "custom/http-error",
        status: 503,
        title: "Service Unavailable",
        detail: "Upstream timed out",
      });

      expect(wrapped.type).toBe("custom/http-error");
      expect(wrapped.status).toBe(503);
      expect(wrapped.title).toBe("Service Unavailable");
      expect(wrapped.detail).toBe("Upstream timed out");
    });

    it("wraps null/undefined with a generic runtime error", () => {
      const fromNull = WorkflowError.fromUnknown(null);
      expect(fromNull.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/runtime");
      expect(fromNull.status).toBe(500);

      const fromUndefined = WorkflowError.fromUnknown(undefined);
      expect(fromUndefined.status).toBe(500);
    });
  });

  describe("matches", () => {
    const validationError = new WorkflowError({
      type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
      status: 400,
    });

    it("matches when filter is undefined (catch-all)", () => {
      expect(WorkflowError.matches(validationError, undefined)).toBe(true);
    });

    it("matches when filter.with is undefined (catch-all)", () => {
      expect(WorkflowError.matches(validationError, {})).toBe(true);
    });

    it("matches when filter.with is empty (catch-all)", () => {
      expect(WorkflowError.matches(validationError, { with: {} })).toBe(true);
    });

    it("matches on exact type", () => {
      expect(WorkflowError.matches(validationError, {
        with: { type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation" },
      })).toBe(true);
    });

    it("rejects on mismatched type", () => {
      expect(WorkflowError.matches(validationError, {
        with: { type: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout" },
      })).toBe(false);
    });

    it("matches on exact status", () => {
      expect(WorkflowError.matches(validationError, {
        with: { status: 400 },
      })).toBe(true);
    });

    it("rejects on mismatched status", () => {
      expect(WorkflowError.matches(validationError, {
        with: { status: 500 },
      })).toBe(false);
    });

    it("requires ALL filter fields to match (AND semantics)", () => {
      expect(WorkflowError.matches(validationError, {
        with: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
          status: 400,
        },
      })).toBe(true);

      expect(WorkflowError.matches(validationError, {
        with: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
          status: 500,
        },
      })).toBe(false);
    });
  });
});
