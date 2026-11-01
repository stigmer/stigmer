/**
 * The sandbox section's "reach" artifact: what the shown Environment lets
 * its sandbox reach, drawn from its typed fields in brand/sandbox.ts. A check
 * beside each listed host, one line for the package registries and code
 * hosts when the file's switch opens them, then every other website, refused
 * during the TLS handshake. Under it, who holds the model key.
 */
import {
  SANDBOX_ENVIRONMENT,
  SANDBOX_REACH,
} from "../../../../../brand/sandbox";

const ROW =
  "grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 border-b border-border py-2.5 items-baseline";

export function ReachList() {
  return (
    <div className="flex flex-col gap-5">
      <ul
        aria-label="What this Environment reaches"
        className="m-0 p-0 list-none border-t border-border"
      >
        {SANDBOX_ENVIRONMENT.allowedHosts.map((host) => (
          <li key={host} className={ROW}>
            <span aria-hidden="true" className="text-foreground">
              ✓
            </span>
            <code className="font-mono text-sm text-foreground break-all">
              {host}
            </code>
          </li>
        ))}
        {SANDBOX_ENVIRONMENT.allowPackageManagers ? (
          <li className={ROW}>
            <span aria-hidden="true" className="text-foreground">
              ✓
            </span>
            <span className="text-sm text-foreground">
              {SANDBOX_REACH.packageManagers}
            </span>
          </li>
        ) : null}
        <li className={ROW}>
          <span aria-hidden="true" className="text-subtle">
            ✕
          </span>
          <span className="text-sm text-muted-foreground">
            {SANDBOX_REACH.otherWebsites}
            <span className="sr-only">: </span>
            <span className="block font-mono text-xs text-subtle mt-0.5">
              {SANDBOX_REACH.refused}
            </span>
          </span>
        </li>
      </ul>
      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
        <strong className="font-semibold text-foreground">
          {SANDBOX_REACH.key[0]}
        </strong>{" "}
        {SANDBOX_REACH.key[1]}
      </p>
    </div>
  );
}
