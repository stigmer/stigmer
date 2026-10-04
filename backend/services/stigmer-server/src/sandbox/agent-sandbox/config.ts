/**
 * The agent-sandbox driver's own settings (STIGMER_SANDBOX_AGENT_SANDBOX_*),
 * read only when the driver is selected: an unselected driver reads nothing
 * (provisioner.ts, "factories, not instances"). The settings every driver
 * shares (the endpoints a sandbox dials, the runner image, the namespace,
 * the runner lists) stay on SandboxDriverConfig; what is here is how long an
 * idle session keeps its pod.
 *
 * An idle session's Sandbox is suspended after SUSPEND_AFTER_SECONDS: its
 * pod goes and its workspace claim stays, and its next message starts a
 * pod again over the same files (sweep.ts). The sweep looks every
 * SWEEP_INTERVAL_SECONDS, so a sandbox sleeps between the window and the
 * window plus one interval after its session's last activity.
 *
 * The defaults are those the substrate driver measured and chose (an idle
 * session stores at 5.5 minutes, on a 30-second sweep: substrate/config.ts),
 * so a session sleeps on the same schedule whichever driver runs it. A wake
 * here is a pod start over a kept claim, measured on kind in the range the
 * substrate driver's wake from storage measured (this driver's M2 record).
 * A cluster that pulls a large runner image on a cold node wakes slower, and
 * its operator lengthens the window.
 */

const PREFIX = "STIGMER_SANDBOX_AGENT_SANDBOX_";

export interface AgentSandboxDriverSettings {
  /** How long a session may stay idle before its Sandbox is suspended. */
  readonly suspendAfterSeconds: number;
  /** How often the idle sweep looks. */
  readonly sweepIntervalSeconds: number;
}

export function newAgentSandboxSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): AgentSandboxDriverSettings {
  const seconds = (name: string, fallback: number): number => {
    const raw = (env[PREFIX + name] ?? "").trim();
    if (raw === "") return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `${PREFIX}${name} must be a positive whole number of seconds; got ${raw}`,
      );
    }
    return value;
  };
  const settings = {
    suspendAfterSeconds: seconds("SUSPEND_AFTER_SECONDS", 330),
    sweepIntervalSeconds: seconds("SWEEP_INTERVAL_SECONDS", 30),
  };
  if (settings.sweepIntervalSeconds > settings.suspendAfterSeconds) {
    throw new Error(
      `${PREFIX}SWEEP_INTERVAL_SECONDS (${settings.sweepIntervalSeconds}) must not exceed ${PREFIX}SUSPEND_AFTER_SECONDS (${settings.suspendAfterSeconds}): a sandbox would sleep a whole interval late`,
    );
  }
  return settings;
}
