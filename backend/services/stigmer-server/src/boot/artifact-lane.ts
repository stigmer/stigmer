/**
 * Where the artifact file server listens, and the URL local artifact
 * storage mints downloads under, on a server that was not told.
 *
 * The artifact download lane is a second loopback listener beside the
 * unified port (domain/artifact/file-server.ts), bound only when artifact
 * storage is local. `ARTIFACT_HTTP_PORT` and `ARTIFACT_LOCAL_SERVE_URL`
 * place it explicitly; unset, both follow the unified port, and this module
 * is the one place that says how.
 *
 * The port rules, in order: a configured port always wins (0 included — an
 * explicit ephemeral bind); a unified port of 0 (`GRPC_PORT=0`, and the
 * `portOverride: 0` test seam) is not known until listen, so the lane binds
 * ephemeral too; otherwise the lane takes the unified port + 1, the default
 * every install has always had. Deriving +1 from an ephemeral 0 gave port 1,
 * a privileged port, and a server that reported healthy with a dead download
 * lane (stigmer#1089). The caller passes the port the unified listener will
 * bind (`portOverride ?? grpcPort`), the input the OAuth redirect derivation
 * reads (boot/oauth-redirect-uri.ts).
 *
 * The serve URL: a configured value always wins; unset, it is the lane's own
 * origin on localhost, read from the port the lane actually bound. The
 * composition binds the lane before the unified port opens, so no request can
 * mint a URL before that port exists; a read before the bind is a
 * construction-order fault and throws rather than minting a URL for a port
 * nothing listens on.
 *
 * A lane that cannot bind fails the boot, beside the storage probe it
 * belongs with; artifactLaneBindError is the copy the operator reads, naming
 * the address, the cause and the setting that moves the lane.
 *
 * Proven by __tests__/artifact-lane.test.ts and the lane cases of
 * __tests__/compose.test.ts.
 */

export interface ArtifactLanePortInputs {
  /** `ARTIFACT_HTTP_PORT` as loaded; undefined when unset. */
  readonly configured: number | undefined;
  /** The port the unified listener binds; 0 means "not known until listen". */
  readonly unifiedPort: number;
}

/** The port the artifact file server binds; 0 asks the OS for an ephemeral one. */
export function resolveArtifactLanePort(
  inputs: ArtifactLanePortInputs,
): number {
  if (inputs.configured !== undefined) return inputs.configured;
  if (inputs.unifiedPort === 0) return 0;
  return inputs.unifiedPort + 1;
}

/**
 * The serve URL local artifact storage mints download URLs under: the
 * configured value as given, or a resolver over the lane's bound port.
 */
export function resolveArtifactServeUrl(
  configured: string,
  boundPort: () => number | undefined,
): string | (() => string) {
  if (configured !== "") return configured;
  return () => {
    const port = boundPort();
    if (port === undefined) {
      throw new Error(
        "artifact download URL requested before the artifact file server bound its port",
      );
    }
    return `http://localhost:${port}`;
  };
}

/**
 * The boot failure for a lane that could not bind: the address, the socket
 * error's code, and the setting that moves the lane — named as the value
 * that failed when the operator set it, as the default's escape hatch when
 * the port was derived.
 */
export function artifactLaneBindError(
  cause: unknown,
  host: string,
  port: number,
  configured: boolean,
): Error {
  const code =
    cause instanceof Error &&
    typeof (cause as NodeJS.ErrnoException).code === "string"
      ? ` (${(cause as NodeJS.ErrnoException).code})`
      : "";
  const remedy = configured
    ? `ARTIFACT_HTTP_PORT=${port} cannot be bound; set it to a free port`
    : "set ARTIFACT_HTTP_PORT to a free port (unset, the lane takes the unified port + 1)";
  return new Error(
    `the artifact file server could not bind '${host}:${port}'${code}: ${remedy}`,
    { cause },
  );
}
