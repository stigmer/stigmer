import { useId, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useServer } from "./ServerProvider";

/**
 * "Use another server": the person types a Stigmer server's address. The
 * Rust host decides whether it may be used (`https`, or `http` on this
 * computer, src-tauri/src/server.rs) and says why not; once it is chosen the
 * app connects to it and asks it how to sign in.
 */
export function ChooseServer({ onCancel }: { onCancel?: () => void }) {
  const { choose } = useServer();
  const inputId = useId();
  const errorId = useId();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isChoosing, setIsChoosing] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsChoosing(true);
    setError(null);
    const refused = await choose(address);
    setIsChoosing(false);
    if (refused !== null) setError(refused);
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-3" noValidate>
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        Server address
      </label>
      <input
        id={inputId}
        type="url"
        inputMode="url"
        autoComplete="url"
        autoFocus
        spellCheck={false}
        placeholder="https://stigmer.example.com"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? errorId : undefined}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error !== null && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isChoosing || address.trim() === ""}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {isChoosing && <Loader2 className="size-4 animate-spin" />}
        Connect
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Back
        </button>
      )}
    </form>
  );
}
