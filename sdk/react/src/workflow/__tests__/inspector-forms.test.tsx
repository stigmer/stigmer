import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { JsonObject } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowGraphNode } from "../workflow-graph-model";
import { AgentCallForm } from "../inspector/forms/AgentCallForm";
import { HttpCallForm } from "../inspector/forms/HttpCallForm";

afterEach(cleanup);

function makeNode(kind: WorkflowTaskKind, config: Record<string, unknown>): WorkflowGraphNode {
  return {
    id: "test_task",
    taskName: "test_task",
    kind,
    category: "ai",
    config: config as JsonObject,
    position: { x: 0, y: 0 },
  };
}

describe("AgentCallForm", () => {
  it("renders agent input field", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, { agent: "my-agent" });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    const input = screen.getByTestId("agent-call-agent-input") as HTMLInputElement;
    expect(input.value).toBe("my-agent");
  });

  it("renders message textarea", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, { message: "Hello world" });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    const textarea = screen.getByTestId("agent-call-message-input") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Hello world");
  });

  it("renders model input from nested config", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      config: { model: "claude-sonnet-4", timeout: 120 },
    });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    const input = screen.getByTestId("agent-call-model-input") as HTMLInputElement;
    expect(input.value).toBe("claude-sonnet-4");
  });

  it("shows structured output section when output is present", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      output: { schema: { type: "object" }, on_invalid: "ON_INVALID_RETRY", max_retries: 2 },
    });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    expect(screen.getByText("On invalid")).toBeTruthy();
    expect(screen.getByText("Max retries")).toBeTruthy();
  });

  it("calls onFieldChange when agent input changes", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, { agent: "old" });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    const input = screen.getByTestId("agent-call-agent-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "new-agent" } });
    expect(onFieldChange).toHaveBeenCalledWith("agent", "new-agent");
  });

  it("renders harness radio buttons", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, { agent: "x", message: "y", harness: "cursor" });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    expect(screen.getByText("Native")).toBeTruthy();
    expect(screen.getByText("Cursor")).toBeTruthy();
  });
});

describe("HttpCallForm", () => {
  it("renders method dropdown and URL input", () => {
    const node = makeNode(WorkflowTaskKind.http_call, {
      method: "POST",
      endpoint: { uri: "https://api.example.com" },
    });
    render(<HttpCallForm node={node} onFieldChange={vi.fn()} />);

    const select = screen.getByTestId("http-call-method-select") as HTMLSelectElement;
    expect(select.value).toBe("POST");

    const urlInput = screen.getByTestId("http-call-url-input") as HTMLInputElement;
    expect(urlInput.value).toBe("https://api.example.com");
  });

  it("shows body editor for POST method", () => {
    const node = makeNode(WorkflowTaskKind.http_call, {
      method: "POST",
      endpoint: { uri: "https://api.example.com" },
    });
    render(<HttpCallForm node={node} onFieldChange={vi.fn()} />);
    expect(screen.getByTestId("http-call-body-input")).toBeTruthy();
  });

  it("hides body editor for GET method", () => {
    const node = makeNode(WorkflowTaskKind.http_call, {
      method: "GET",
      endpoint: { uri: "https://api.example.com" },
    });
    render(<HttpCallForm node={node} onFieldChange={vi.fn()} />);
    expect(screen.queryByTestId("http-call-body-input")).toBeNull();
  });

  it("renders Add header button", () => {
    const node = makeNode(WorkflowTaskKind.http_call, {
      method: "GET",
      endpoint: { uri: "https://api.example.com" },
    });
    render(<HttpCallForm node={node} onFieldChange={vi.fn()} />);
    expect(screen.getByText("+ Add header")).toBeTruthy();
  });

  it("calls onFieldChange when method changes", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.http_call, {
      method: "GET",
      endpoint: { uri: "https://api.example.com" },
    });
    render(<HttpCallForm node={node} onFieldChange={onFieldChange} />);

    const select = screen.getByTestId("http-call-method-select") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "PUT" } });
    expect(onFieldChange).toHaveBeenCalledWith("method", "PUT");
  });
});
