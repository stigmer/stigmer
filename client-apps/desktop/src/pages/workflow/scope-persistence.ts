export type WorkflowScope = "org" | "all";

const SCOPE_KEY = "stigmer:workflows:scope";

export function readPersistedScope(): WorkflowScope {
  const stored = localStorage.getItem(SCOPE_KEY);
  return stored === "all" ? "all" : "org";
}

export function writePersistedScope(scope: WorkflowScope): void {
  localStorage.setItem(SCOPE_KEY, scope);
}
