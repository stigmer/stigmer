/**
 * A preload (`node --import`) that carries a Node process's HTTP/2
 * connections to a loopback address through the HTTP proxy its environment
 * names, as a CONNECT tunnel.
 *
 * Why it exists: `claude plugin eval` runs a coding agent's shell commands
 * inside an OS sandbox whose only way out is the run's own HTTP proxy
 * (HTTP_PROXY/HTTPS_PROXY, with loopback listed in NO_PROXY), and that proxy
 * admits a host only once the run grants it (`--allow-tools
 * "WebFetch(domain:127.0.0.1)"`). A direct connection to the question bank's
 * local Stigmer is refused (EPERM). Node's own proxy support
 * (NODE_USE_ENV_PROXY) covers `http` and `fetch`, not `node:http2`, and the
 * CLI speaks gRPC-web over HTTP/2 (sdk/typescript/src/node.ts,
 * createNodeTransport). The stage's `stigmer` shim loads this file, so the
 * CLI and the `stigmer mcp-server` it starts reach the stage through the
 * proxy; the product's code is untouched.
 *
 * Only a connection to a loopback host is tunnelled, only when a proxy is
 * named, and only when the caller has not supplied its own
 * `createConnection`. Everything else goes to `http2.connect` unchanged, so
 * outside a sandbox (no proxy in the environment) the preload does nothing.
 */

import http2 from "node:http2";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { Duplex } from "node:stream";

/** The proxy the environment names for HTTPS, then HTTP, or undefined. */
export function proxyFromEnv(env = process.env) {
  const raw = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy ?? "";
  if (raw === "") return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Whether `hostname` (as a URL gives it, IPv6 in brackets) is this machine's loopback. */
export function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\.\d+\.\d+\.\d+$/.test(hostname);
}

/** The CONNECT request for `target` (`host:port`), with the proxy's basic credentials when its URL carries them. */
export function connectRequest(target, proxy) {
  const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`];
  if (proxy.username !== "") {
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    lines.push(`Proxy-Authorization: Basic ${Buffer.from(credentials).toString("base64")}`);
  }
  return `${lines.join("\r\n")}\r\n\r\n`;
}

/**
 * A Duplex that is the tunnel: writes wait until the proxy has answered the
 * CONNECT with 200, the answer's head is never handed to the reader, and any
 * other answer destroys the stream with the proxy's status line.
 */
export function tunnel(proxy, target) {
  const socket = net.connect(Number(proxy.port || 80), proxy.hostname);
  let open = false;
  let head = Buffer.alloc(0);
  const pending = [];
  const stream = new Duplex({
    write(chunk, encoding, callback) {
      if (open) socket.write(chunk, encoding, callback);
      else pending.push([chunk, encoding, callback]);
    },
    read() {
      socket.resume();
    },
    final(callback) {
      socket.end(callback);
    },
    destroy(error, callback) {
      socket.destroy();
      callback(error);
    },
  });
  // Whether the tunnel keeps the process alive; connectThroughProxy ties it
  // to the session's own ref state.
  stream.ref = () => (socket.ref(), stream);
  stream.unref = () => (socket.unref(), stream);
  socket.on("connect", () => socket.write(connectRequest(target, proxy)));
  socket.on("data", (chunk) => {
    if (open) {
      if (!stream.push(chunk)) socket.pause();
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf("\r\n\r\n");
    if (end === -1) return;
    const status = head.subarray(0, head.indexOf("\r\n")).toString("latin1");
    if (!/^HTTP\/1\.[01] 200\b/.test(status)) {
      stream.destroy(new Error(`the proxy refused a tunnel to ${target}: ${status}`));
      return;
    }
    open = true;
    const rest = head.subarray(end + 4);
    if (rest.length > 0) stream.push(rest);
    for (const [chunk, encoding, callback] of pending.splice(0)) socket.write(chunk, encoding, callback);
  });
  socket.on("end", () => stream.push(null));
  socket.on("error", (error) => stream.destroy(error));
  return stream;
}

const proxy = proxyFromEnv();
if (proxy !== undefined) {
  const connect = http2.connect;
  http2.connect = function connectThroughProxy(authority, options, listener) {
    if (typeof options === "function") {
      listener = options;
      options = {};
    }
    const url = typeof authority === "string" ? new URL(authority) : authority;
    if (!isLoopback(url.hostname) || options?.createConnection !== undefined) return connect.call(this, authority, options, listener);
    const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
    const target = `${url.hostname}:${port}`;
    let carried;
    const session = connect.call(this, authority, { ...options, createConnection: () => (carried = tunnel(proxy, target)) }, listener);
    // HTTP/2 wraps a stream that is not a net.Socket in a socket of its own,
    // whose ref() and unref() never reach the tunnel's socket. An idle
    // session unrefs itself so the process can exit (the CLI's `auth
    // whoami` ends that way, and connect-node unrefs every idle session), so
    // the session's ref state is carried to the tunnel by hand.
    const { ref, unref } = session;
    session.ref = function refTunnel() {
      carried?.ref();
      return ref.call(this);
    };
    session.unref = function unrefTunnel() {
      carried?.unref();
      return unref.call(this);
    };
    return session;
  };
  syncBuiltinESMExports();
}
