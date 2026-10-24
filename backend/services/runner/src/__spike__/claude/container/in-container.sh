#!/usr/bin/env bash
# Runs inside claude-probe as root, with --network none: questions 4 (the
# socket trace), 5 and 6, each probe as the agent user through setpriv with
# an environment built from nothing, as the agent host starts.
set -uo pipefail
RUNNER=/build/backend/services/runner
EV=/evidence
mkdir -p "$EV"
chmod 0777 "$EV"
AGENT_HOME=/tmp/agent-home
mkdir -p "$AGENT_HOME" && chown 10001:10001 "$AGENT_HOME"
chown -R 10001:10001 "$RUNNER/node_modules/.vite" 2>/dev/null || true
mkdir -p "$RUNNER/node_modules/.vite" "$RUNNER/node_modules/.vite-temp" && chown -R 10001:10001 "$RUNNER/node_modules/.vite" "$RUNNER/node_modules/.vite-temp"

{
  echo "uname: $(uname -a)"
  echo "node: $(node --version)"
  echo "ptrace_scope: $(cat /proc/sys/kernel/yama/ptrace_scope 2>/dev/null || echo 'no yama')"
  echo "network interfaces:"; cat /proc/net/dev
  echo "agent user: $(getent passwd stigmer-agent)"
} > "$EV/container-env.txt" 2>&1

as_agent() {
  setpriv --reuid=10001 --regid=10001 --init-groups -- \
    env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$AGENT_HOME" LANG=C.UTF-8 TMPDIR=/tmp \
      SPIKE_EVIDENCE_DIR="$EV" SPIKE_STARTS="${SPIKE_STARTS:-10}" "$@"
}

cd "$RUNNER"
VITEST="$RUNNER/node_modules/.bin/vitest"

PROBES="${PROBES:-q4 q5 q6}"
for probe in $PROBES; do
  case "$probe" in
    q4)
      echo "== q4 under strace (SPIKE_SCRUB=${SPIKE_SCRUB:-1}) ==" | tee -a "$EV/container-run.txt"
      strace -f -qq -e trace=execve,connect,sendto,sendmsg -o "$EV/q4-strace.raw.txt" \
        setpriv --reuid=10001 --regid=10001 --init-groups -- \
          env -i PATH=/usr/local/bin:/usr/bin:/bin HOME="$AGENT_HOME" LANG=C.UTF-8 TMPDIR=/tmp SPIKE_EVIDENCE_DIR="$EV" SPIKE_SCRUB="${SPIKE_SCRUB:-1}" \
          "$VITEST" run src/__spike__/claude/q4-proxy.spike.test.ts 2>&1 | tail -30 | tee -a "$EV/container-run.txt"
      ;;
    q5)
      echo "== q5 ==" | tee -a "$EV/container-run.txt"
      as_agent "$VITEST" run src/__spike__/claude/q5-env.spike.test.ts 2>&1 | tail -40 | tee -a "$EV/container-run.txt"
      ;;
    q6)
      echo "== q6 (SPIKE_SCRUB=${SPIKE_SCRUB:-1}) ==" | tee -a "$EV/container-run.txt"
      as_agent env SPIKE_SCRUB="${SPIKE_SCRUB:-1}" "$VITEST" run src/__spike__/claude/q6-start.spike.test.ts 2>&1 | tail -30 | tee -a "$EV/container-run.txt"
      ;;
  esac
done
echo "bwrap: $(command -v bwrap || echo absent)" >> "$EV/container-env.txt"
chmod -R a+r "$EV"
