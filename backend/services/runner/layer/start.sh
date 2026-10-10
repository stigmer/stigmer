#!/bin/sh
# The runner layer's start command, /runner/bin/start in the image: every
# container driver, the attach waiter's image and the compose runner launch
# the runner through it (the server's src/sandbox/runner-launch.ts), as
#
#   /runner/bin/start /runner/dist/main.js
#
# It checks the base image the layer was added to, and the layer's release
# against the server's, then execs the layer's own Node (/runner/bin/node,
# beside this file) with its arguments unchanged: the same process, nothing
# left running.
#
# Why a shell script: the layer's Node is linked against glibc's dynamic
# loader. On a base without it (Alpine, which uses musl), exec of that Node
# fails in the kernel with "no such file or directory" for a file that is
# plainly there, before one line of JavaScript runs, so only something the
# base's own /bin/sh runs can say what is wrong. Everything here is a shell
# builtin, so the success path forks nothing.
#
# The base image contract, published in the self-hosting guide
# (docs/guides/self-hosting/runners.mdx, "Bring your own base image"; keep
# the two lists equal):
#
#   refused  - no glibc loader at the path the layer's Node names (the
#              runner cannot start at all); not uid 0 (the runner starts
#              the agent's side as its own user, stigmer-agent, and only
#              root can, and on Substrate the base image's USER decides who
#              it is); no /proc; any of bash, git, setpriv (util-linux: how
#              the runner drops to the agent user) and the text tools the
#              Cursor approval hook runs, missing from PATH (without them a
#              repository workspace, the agent user or every Cursor turn
#              breaks).
#   warned   - rg (the native agent's grep falls back to a substring
#              search): one feature degrades, so the runner starts.
#
# glibc's version is not checked: that needs a fork, and below 2.28 the
# loader refuses the Node itself with a message that names the version it
# wants (GLIBC_2.28 not found).
#
# NODE_OPTIONS and NODE_PATH are cleared for the runner and everything it
# starts, agents' commands included: a base image that loads an APM agent
# through NODE_OPTIONS=--require would otherwise load it into the runner.
# The server refuses both names in STIGMER_SANDBOX_RUNNER_ENV at boot, so an
# operator's own value is refused there rather than dropped here.
#
# The release pairing: a layer runs only under the server release it was
# built for, because the two share Temporal activities and payloads that
# change from release to release (stigmer/stigmer#1831). The release lane
# writes the layer's release to /runner/RELEASE (../RELEASE from here; empty
# for a development build), and a driver passes the server's release as
# STIGMER_SERVER_RELEASE, only when the server is a release. Neither side's
# version is parsed here: the server decides what is a release, and the
# lane does for the layer. Two releases that differ are refused; a release
# server over a layer that names no release (a development build, or a
# reviewed emergency build) is warned about and starts; a development
# server checks nothing. A v* tag's build also republishes its commit's
# main-<sha> and moves latest, so until the next build of main those name
# that release too, and are held to it.
#
# A refusal exits 78 (EX_CONFIG) with one line on stderr that lists every
# problem found, so a pod's last-state message carries all of it at once.
# The base image is checked first: a base that cannot run the layer is the
# deeper problem, whatever release the layer is.

GUIDE="https://stigmer.ai/docs/guides/self-hosting/runners#bring-your-own-base-image"

case "$0" in
  /*) ;;
  *)
    printf 'stigmer runner: start it by its absolute path (/runner/bin/start), not as %s\n' "$0" >&2
    exit 78
    ;;
esac

problems=""
add_problem() {
  if [ -n "$problems" ]; then
    problems="$problems; $1"
  else
    problems="$1"
  fi
}

# The interpreter the layer's Node names: amd64's or arm64's. A join pulls
# the layer and the base for one platform, so either one present is the
# right one.
if [ ! -e /lib64/ld-linux-x86-64.so.2 ] && [ ! -e /lib/ld-linux-aarch64.so.1 ]; then
  libc="no glibc dynamic loader (/lib64/ld-linux-x86-64.so.2 or /lib/ld-linux-aarch64.so.1)"
  for loader in /lib/ld-musl-*; do
    if [ -e "$loader" ]; then
      libc="$libc; it looks like a musl base such as Alpine"
    fi
    break
  done
  add_problem "$libc"
fi

uid=""
if [ -r /proc/self/status ]; then
  while read -r key _ effective _; do
    if [ "$key" = "Uid:" ]; then
      uid="$effective"
      break
    fi
  done </proc/self/status
  if [ "$uid" != "0" ]; then
    add_problem "running as uid ${uid:-unknown}, not root (on Substrate the base image's USER must be root)"
  fi
else
  add_problem "no /proc (cannot read /proc/self/status)"
fi

missing=""
for tool in bash git setpriv cat sed grep head cut awk tr base64 dirname; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing="${missing:+$missing, }$tool"
  fi
done
if [ -n "$missing" ]; then
  add_problem "missing from PATH: $missing"
fi

if [ -n "$problems" ]; then
  printf 'stigmer runner: this base image cannot run the runner layer: %s. The base image needs glibc 2.28 or newer, root, bash, git and standard text tools: %s\n' "$problems" "$GUIDE" >&2
  exit 78
fi

server_release="${STIGMER_SERVER_RELEASE-}"
if [ -n "$server_release" ]; then
  layer_release=""
  if [ -r "${0%/*}/../RELEASE" ]; then
    read -r layer_release <"${0%/*}/../RELEASE"
  fi
  if [ -z "$layer_release" ]; then
    printf 'stigmer runner: warning: this runner layer names no release, so it is not checked against the server, which is %s (%s)\n' "$server_release" "$GUIDE" >&2
  elif [ "$layer_release" != "$server_release" ]; then
    printf 'stigmer runner: this runner layer is from release %s, but the server is %s: use the runner layer of release %s (re-join your image at every server upgrade): %s\n' "$layer_release" "$server_release" "$server_release" "$GUIDE" >&2
    exit 78
  fi
fi

if ! command -v rg >/dev/null 2>&1; then
  printf 'stigmer runner: warning: rg is not on PATH, so the native agent'"'"'s grep falls back to a substring search (%s)\n' "$GUIDE" >&2
fi

unset NODE_OPTIONS NODE_PATH

# The runner reads this to know it runs in a container shape, where it
# starts the agent's side as the agent user (src/shared/agent-identity.ts).
export STIGMER_RUNNER_LAYER=1

exec "${0%/*}/node" "$@"
