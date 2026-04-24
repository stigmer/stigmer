import { useCallback, useState } from "react";
import { X } from "lucide-react";

interface StartRunnerDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onStart: (opts: {
    name?: string;
    endpoint?: string;
    token?: string;
  }) => void;
  readonly isStarting: boolean;
}

export function StartRunnerDialog({
  open,
  onClose,
  onStart,
  isStarting,
}: StartRunnerDialogProps) {
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      onStart({
        name: name.trim() || undefined,
        endpoint: endpoint.trim() || undefined,
        token: token.trim() || undefined,
      });
    },
    [name, endpoint, token, onStart],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Start Runner"
        className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            Start Runner
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-4 text-xs text-muted-foreground">
          Start a local agent runner on this machine. If no credentials are
          configured, the CLI will use its stored authentication from{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.65rem]">
            stigmer auth login
          </code>
          .
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <Field
            id="runner-name"
            label="Name"
            placeholder="my-macbook (default: hostname)"
            value={name}
            onChange={setName}
          />
          <Field
            id="runner-endpoint"
            label="Endpoint"
            placeholder="api.stigmer.ai:443 (default: from config)"
            value={endpoint}
            onChange={setEndpoint}
          />
          <Field
            id="runner-token"
            label="Token / API Key"
            placeholder="sk-... (default: from config)"
            value={token}
            onChange={setToken}
            type="password"
          />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isStarting}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {isStarting ? "Starting\u2026" : "Start"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        autoComplete="off"
      />
    </div>
  );
}
