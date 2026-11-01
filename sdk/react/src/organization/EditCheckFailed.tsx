"use client";

// What an organization settings panel says when it could not learn whether
// the person may edit it: the content stays read-only (an edit is offered
// only on the server's yes), and one line says so, with a way to ask again.

/** Props for {@link EditCheckFailed}. */
export interface EditCheckFailedProps {
  /** What the person would change, finishing "Could not check whether you may …" ("change these policies"). */
  readonly what: string;
  /** Asks the permission check again. */
  readonly onRetry: () => void;
}

/** The line a panel shows when its edit check failed, with Try again. */
export function EditCheckFailed({ what, onRetry }: EditCheckFailedProps) {
  return (
    <p className="stg:m-0 stg:text-2xs stg:text-muted-foreground" role="status">
      Could not check whether you may {what}.{" "}
      <button
        type="button"
        onClick={onRetry}
        className="stg:cursor-pointer stg:border-0 stg:bg-transparent stg:p-0 stg:text-2xs stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2"
      >
        Try again
      </button>
    </p>
  );
}
