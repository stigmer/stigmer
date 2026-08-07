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

  it("renders model input from the run_config block", () => {
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      run_config: { model_name: "claude-sonnet-4", max_cost_usd: 0.5 },
    });
    render(<AgentCallForm node={node} onFieldChange={vi.fn()} />);
    const input = screen.getByTestId("agent-call-model-input") as HTMLInputElement;
    expect(input.value).toBe("claude-sonnet-4");
    const budget = screen.getByTestId("agent-call-budget-input") as HTMLInputElement;
    expect(budget.value).toBe("0.5");
  });

  it("emits an undefined run_config when the last field is cleared", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      run_config: { max_cost_usd: 0.5 },
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    const budget = screen.getByTestId("agent-call-budget-input") as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "" } });

    // Empty means omit: a blank field must not persist a zero override.
    expect(onFieldChange).toHaveBeenCalledWith("run_config", undefined);
  });

  it("writes budget changes into run_config.max_cost_usd", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      run_config: { model_name: "claude-sonnet-4" },
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    const budget = screen.getByTestId("agent-call-budget-input") as HTMLInputElement;
    fireEvent.change(budget, { target: { value: "1.25" } });

    expect(onFieldChange).toHaveBeenCalledWith("run_config", {
      model_name: "claude-sonnet-4",
      max_cost_usd: 1.25,
    });
  });

  it("renders workspace entries and edits the git url in place", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      workspace_entries: [
        { name: "app", source: { git_repo: { url: "https://github.com/acme/app", branch: "main" } } },
      ],
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    const url = screen.getByTestId("agent-call-workspace-url-0") as HTMLInputElement;
    expect(url.value).toBe("https://github.com/acme/app");

    fireEvent.change(url, { target: { value: "https://github.com/acme/other" } });
    expect(onFieldChange).toHaveBeenCalledWith("workspace_entries", [
      { name: "app", source: { git_repo: { url: "https://github.com/acme/other", branch: "main" } } },
    ]);
  });

  it("adds a workspace entry row", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, { agent: "x", message: "y" });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    fireEvent.click(screen.getByTestId("agent-call-workspace-add"));
    expect(onFieldChange).toHaveBeenCalledWith("workspace_entries", [
      { source: { git_repo: { url: "" } } },
    ]);
  });

  it("emits undefined when the last workspace entry is removed", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      workspace_entries: [
        { source: { git_repo: { url: "https://github.com/acme/app" } } },
      ],
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    fireEvent.click(screen.getByLabelText("Remove workspace entry 1"));
    expect(onFieldChange).toHaveBeenCalledWith("workspace_entries", undefined);
  });

  it("edits environment references as org/slug rows with empty-org omitted", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      environment_refs: [{ slug: "shared-secrets" }],
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    const slug = screen.getByTestId("agent-call-envref-slug-0") as HTMLInputElement;
    expect(slug.value).toBe("shared-secrets");

    fireEvent.change(slug, { target: { value: "other-secrets" } });
    // Empty org stays omitted — an empty string must not become a stored
    // org override (relative refs resolve to the workflow's own org).
    expect(onFieldChange).toHaveBeenCalledWith("environment_refs", [
      { slug: "other-secrets" },
    ]);
  });

  it("adds and removes environment reference rows", () => {
    const onFieldChange = vi.fn();
    const node = makeNode(WorkflowTaskKind.agent_call, {
      agent: "x",
      message: "y",
      environment_refs: [{ slug: "a" }, { org: "acme", slug: "b" }],
    });
    render(<AgentCallForm node={node} onFieldChange={onFieldChange} />);

    fireEvent.click(screen.getByLabelText("Remove environment reference 1"));
    expect(onFieldChange).toHaveBeenCalledWith("environment_refs", [
      { org: "acme", slug: "b" },
    ]);
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
