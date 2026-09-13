#!/bin/sh
# The all-in-one image's entrypoint: say what this container is, refuse the
# two setups that cannot work, then hand the process over to the ONE command
# the image exists to run — `stigmer up --foreground`, the CLI's own local
# stack composition, in this process until SIGTERM. Nothing here supervises,
# resolves or configures anything; that is the CLI's job and it stays there.
#
# Any argument replaces the default command (`docker run … stigmer status`,
# `docker run … sh`), the postgres-image convention.
set -eu

STIGMER_VERSION="$(node -p "require(process.env.STIGMER_RUNTIMES_DIR + '/' + require('fs').readdirSync(process.env.STIGMER_RUNTIMES_DIR)[0] + '/node_modules/@stigmer/cli/package.json').version")"

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# The data volume must be writable by this (non-root) user. A named volume
# is initialized from the image and is; a bind-mounted host directory keeps
# the host's ownership and usually is not.
if [ ! -w "$HOME" ]; then
  cat >&2 <<EOF
error: $HOME is not writable by uid $(id -u) (the container's non-root user).

If you bind-mounted a host directory at $HOME, make it writable first:
  chown -R 1000:1000 <host-directory>
or use a named volume instead, which the image initializes correctly:
  docker run -v stigmer-data:/data …
EOF
  exit 1
fi

cat <<EOF

  Stigmer all-in-one ${STIGMER_VERSION}

  EVALUATION ONLY — NOT FOR PRODUCTION.
  One container runs the server, the console, a Temporal dev-server and a
  runner on SQLite. Temporal's dev-server is not built for durable history,
  there are no separate backups or scaling, and an upgrade kills in-flight
  runs. For a team, use Docker Compose: https://stigmer.ai/docs/guides/self-hosting/docker-compose

  Console:   http://localhost:7234   (no sign-in; keep this on localhost or a private network)
  Data:      $HOME  (the mounted volume — it holds everything, keys included)
  Stop:      docker stop -t 30 <container>   (graceful shutdown needs the extra seconds)
  Status:    docker exec <container> stigmer status

EOF

# Agents run only with an LLM credential. The stack starts without one so the
# console can be explored, but say so up front — a laptop's `stigmer up` is
# silent here and the first run fails instead. The words are `stigmer status`'s.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${CURSOR_API_KEY:-}" ] \
   && [ -z "${STIGMER_ANTHROPIC_BACKEND:-}" ] && [ -z "${STIGMER_OPENAI_BACKEND:-}" ]; then
  cat <<EOF
  WARNING: no LLM credential in the environment. Agents will not execute.
           Pass one:  docker run -e ANTHROPIC_API_KEY=sk-ant-... …

EOF
fi

exec stigmer up --foreground
