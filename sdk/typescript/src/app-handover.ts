/**
 * The code that puts an agent's chat in a builder's own app: one source for
 * the text every surface hands over (the console's agent page, and anything
 * else that writes a builder's token route and chat), so each says exactly
 * the same thing and a compiler can hold all of it (the docs snippet gate
 * compiles every stack's output as whole files).
 *
 * Two files, for a server that signs people in:
 *
 *   - a token route for the builder's backend, `GET /api/stigmer-token`,
 *     answering `{ accessToken, expiresAt }` (the shape `createTokenCache`
 *     takes), minted with an admin service account's key read from
 *     `STIGMER_API_KEY`; one per stack, on the stack's standard library
 *     (Node's `node:http`, Python's `http.server`, Go's `net/http`, the JDK's
 *     `com.sun.net.httpserver`), or a Next.js route handler. A standard
 *     library route is something every reader can compile and run as it
 *     stands, and its one minting call moves into any framework;
 *   - the chat for their React app, `<AgentChat>` behind `createTokenCache`.
 *
 * Who is signed in is the one thing Stigmer cannot know. Every route asks one
 * function, `currentUser`, which the builder replaces with their own sign-in.
 * Until then it answers the person named by `STIGMER_DEV_USER` while that is
 * set, and nobody otherwise, so a route pasted into production unchanged
 * refuses everyone rather than minting for whoever calls it.
 *
 * For a server that trusts every caller (`stigmer up`), only the chat, with
 * no token at all: there is no one to sign in, and the server refuses to
 * mint. That text says it is for development.
 *
 * The text carries no secret: the key is read from the environment, and the
 * functions here never take one. Every value written into code (the
 * organization, the agent, the address) is written as a string literal by
 * `JSON.stringify`, whose escapes are valid in all five languages, so no
 * value can break out of its literal. Framework-free and import-free, so the
 * plain-Node docs gate loads the built module as it stands.
 */

/** A backend the handover writes a token route for. */
export type AppHandoverStack = "nextjs" | "node" | "python" | "go" | "java";

/** The backends, in the order a picker offers them, with their names. */
export const APP_HANDOVER_STACKS: readonly { readonly id: AppHandoverStack; readonly name: string }[] = [
  { id: "nextjs", name: "Next.js" },
  { id: "node", name: "Node" },
  { id: "python", name: "Python" },
  { id: "go", name: "Go" },
  { id: "java", name: "Java" },
];

/**
 * Which server the code talks to: `"sign-in"`, one that signs its callers in
 * (Stigmer Cloud, or a self-hosted server with sign-in turned on), where a
 * backend mints each user's token; `"local"`, one that trusts every caller,
 * where the chat sends no token and there is no backend.
 */
export type AppHandoverMode = "sign-in" | "local";

/** The language a handed-over block is written in, for highlighting. */
export type AppHandoverLanguage = "bash" | "xml" | "typescript" | "tsx" | "python" | "go" | "java";

/** One file to add, and what to install for it. */
export interface AppHandoverFile {
  /** The install command (or, for Java, the Maven dependency). */
  readonly install: string;
  readonly installLanguage: "bash" | "xml";
  /** The file's path in the builder's project ("server.ts", "app/api/stigmer-token/route.ts"). */
  readonly file: string;
  readonly language: AppHandoverLanguage;
  /** The whole file. */
  readonly code: string;
}

/** What the handover gives a builder. */
export interface AppHandover {
  /** The token route, for a server that signs people in; absent for a local one. */
  readonly backend?: AppHandoverFile;
  /** The chat component for their React app. */
  readonly chat: AppHandoverFile;
}

/** What {@link buildAppHandover} writes the code for. */
export interface AppHandoverInput {
  readonly mode: AppHandoverMode;
  /** The backend, for the token route. The chat is the same for every stack. */
  readonly stack: AppHandoverStack;
  /** The Stigmer API's public address, `https://…` or `http://…`. */
  readonly baseUrl: string;
  /** The organization's slug. */
  readonly org: string;
  /** The agent's slug. */
  readonly agent: string;
  /**
   * A published release of the SDKs (`"0.1.3"`), named in Java's Maven
   * dependency. Without one, the dependency takes the newest 0.x release and
   * says where to find it to pin it.
   */
  readonly sdkVersion?: string;
}

/** The path every token route serves and the chat fetches. */
export const APP_TOKEN_ROUTE = "/api/stigmer-token";

/** The environment variable the routes read the service account's key from. */
export const APP_API_KEY_VARIABLE = "STIGMER_API_KEY";

/** The environment variable naming the person a route signs in until the builder's own sign-in replaces it. */
export const APP_DEV_USER_VARIABLE = "STIGMER_DEV_USER";

/** The chat component's name, as the builder mounts it: `<StigmerAgentChat />`. */
export const APP_CHAT_COMPONENT = "StigmerAgentChat";

/** The port a standard-library route listens on when `PORT` is unset. */
export const APP_TOKEN_ROUTE_PORT = 3001;

/**
 * The code that puts `org/agent`'s chat in a builder's app, for their stack.
 *
 * @throws {Error} when `baseUrl` is not an absolute `http://` or `https://` address
 *
 * @example
 * ```typescript
 * import { buildAppHandover } from "@stigmer/client";
 *
 * const { backend, chat } = buildAppHandover({
 *   mode: "sign-in",
 *   stack: "node",
 *   baseUrl: "https://api.stigmer.ai",
 *   org: "acme",
 *   agent: "variance-reporter",
 * });
 * // backend.file === "server.ts"; chat.file === "StigmerAgentChat.tsx"
 * ```
 */
export function buildAppHandover(input: AppHandoverInput): AppHandover {
  const server = serverOf(input.baseUrl);
  const code: Code = { org: lit(input.org), agentRef: lit(`${input.org}/${input.agent}`), server };
  if (input.mode === "local") return { chat: localChat(code) };
  return { backend: backendFor(input.stack, code, input.sdkVersion), chat: signInChat(code) };
}

/** What every file is written from, each value already a string literal. */
interface Code {
  readonly org: string;
  readonly agentRef: string;
  readonly server: Server;
}

/** The API's address as each SDK takes it. */
interface Server {
  /** The URL literal, for the TypeScript clients. */
  readonly url: string;
  /** The gRPC target literal (`host:port`), for Go, Python and Java. */
  readonly target: string;
  /** Whether the address is `http://`, which Go, Python and Java must be told. */
  readonly plaintext: boolean;
}

function serverOf(baseUrl: string): Server {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`buildAppHandover: baseUrl must be an absolute address, like https://api.stigmer.ai (got ${JSON.stringify(baseUrl)})`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`buildAppHandover: baseUrl must be http:// or https:// (got ${JSON.stringify(baseUrl)})`);
  }
  const plaintext = url.protocol === "http:";
  // The server answers gRPC and Connect on one port, so the target is the
  // address's own host and port; a URL leaves out a port its scheme implies.
  const port = url.port !== "" ? url.port : plaintext ? "80" : "443";
  const origin = `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  return { url: lit(origin), target: lit(`${url.hostname}:${port}`), plaintext };
}

/** A string literal for any of the five languages. */
function lit(value: string): string {
  return JSON.stringify(value);
}

function backendFor(stack: AppHandoverStack, code: Code, sdkVersion: string | undefined): AppHandoverFile {
  switch (stack) {
    case "nextjs":
      return { install: "npm install @stigmer/client", installLanguage: "bash", file: "app/api/stigmer-token/route.ts", language: "typescript", code: nextRoute(code) };
    case "node":
      return { install: "npm install @stigmer/client", installLanguage: "bash", file: "server.ts", language: "typescript", code: nodeRoute(code) };
    case "python":
      return { install: "pip install stigmer-sdk", installLanguage: "bash", file: "stigmer_token.py", language: "python", code: pythonRoute(code) };
    case "go":
      return { install: "go get go.stigmer.ai/sdk", installLanguage: "bash", file: "main.go", language: "go", code: goRoute(code) };
    case "java":
      return { install: mavenDependency(sdkVersion), installLanguage: "xml", file: "StigmerToken.java", language: "java", code: javaRoute(code) };
    default: {
      const unknown: never = stack;
      throw new Error(`buildAppHandover: unknown stack ${String(unknown)}`);
    }
  }
}

/** A version is pinned only when it is a plain release; anything else (a dev build) is not on Maven Central. */
const RELEASE = /^\d+\.\d+\.\d+$/;

function mavenDependency(sdkVersion: string | undefined): string {
  const pinned = sdkVersion !== undefined && RELEASE.test(sdkVersion);
  return [
    ...(pinned ? [] : ["<!-- The newest 0.x release. Pin the one you test with: https://central.sonatype.com/artifact/ai.stigmer/stigmer-sdk -->"]),
    "<dependency>",
    "  <groupId>ai.stigmer</groupId>",
    "  <artifactId>stigmer-sdk</artifactId>",
    `  <version>${pinned ? sdkVersion : "[0.1,1.0)"}</version>`,
    "</dependency>",
  ].join("\n");
}

const CURRENT_USER_NOTE = [
  "Replace this with your own sign-in: return the person this request is",
  "from, or nobody. Until then it signs in the email in STIGMER_DEV_USER",
  "while that is set, and nobody otherwise.",
];

const REFUSED = "Stigmer refused the token; the reason is in your server's log.";

function nodeRoute({ org, server }: Code): string {
  return `// Your backend's Stigmer token route. GET /api/stigmer-token answers the
// signed-in person's token, { accessToken, expiresAt }, which the chat in
// your app asks for. Run it with: npx tsx server.ts
import { createServer, type IncomingMessage } from "node:http";
import { createNodeClient } from "@stigmer/client/node";

const ORG = ${org};

// The service account's key, never sent to a browser.
const stigmer = createNodeClient({
  baseUrl: ${server.url},
  apiKey: process.env.STIGMER_API_KEY!,
});

interface User {
  id: string;
  email?: string;
  name?: string;
}

${CURRENT_USER_NOTE.map((l) => `// ${l}`).join("\n")}
function currentUser(req: IncomingMessage): User | null {
  const devUser = process.env.STIGMER_DEV_USER;
  return devUser ? { id: devUser, email: devUser } : null;
}

createServer(async (req, res) => {
  if (req.method !== "GET" || req.url !== "/api/stigmer-token") {
    res.writeHead(404).end();
    return;
  }
  const user = currentUser(req);
  if (!user) {
    res.writeHead(401, { "content-type": "text/plain" }).end("Nobody is signed in.");
    return;
  }
  try {
    const { accessToken, expiresAt } = await stigmer.tokens.mintUserToken({
      org: ORG,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accessToken, expiresAt: expiresAt.toISOString() }));
  } catch (err) {
    console.error(err);
    res.writeHead(502, { "content-type": "text/plain" }).end(${lit(REFUSED)});
  }
}).listen(Number(process.env.PORT ?? ${APP_TOKEN_ROUTE_PORT}));
`;
}

function nextRoute({ org, server }: Code): string {
  return `// Your app's Stigmer token route. GET /api/stigmer-token answers the
// signed-in person's token, { accessToken, expiresAt }, which the chat asks for.
import { createNodeClient } from "@stigmer/client/node";

// Every request mints for whoever is signed in: never prerender it.
export const dynamic = "force-dynamic";

const ORG = ${org};

// The service account's key, never sent to a browser.
const stigmer = createNodeClient({
  baseUrl: ${server.url},
  apiKey: process.env.STIGMER_API_KEY!,
});

interface User {
  id: string;
  email?: string;
  name?: string;
}

${CURRENT_USER_NOTE.map((l) => `// ${l}`).join("\n")}
async function currentUser(request: Request): Promise<User | null> {
  const devUser = process.env.STIGMER_DEV_USER;
  return devUser ? { id: devUser, email: devUser } : null;
}

export async function GET(request: Request): Promise<Response> {
  const user = await currentUser(request);
  if (!user) return new Response("Nobody is signed in.", { status: 401 });
  try {
    const { accessToken, expiresAt } = await stigmer.tokens.mintUserToken({
      org: ORG,
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
    });
    return Response.json({ accessToken, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error(err);
    return new Response(${lit(REFUSED)}, { status: 502 });
  }
}
`;
}

function pythonRoute({ org, server }: Code): string {
  const insecure = server.plaintext ? ", insecure=True" : "";
  return `"""Your backend's Stigmer token route.

GET /api/stigmer-token answers the signed-in person's token,
{ accessToken, expiresAt }, which the chat in your app asks for.
Run it with: python stigmer_token.py
"""

import json
import logging
import os
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from stigmer import StigmerClient

ORG = ${org}

# The service account's key, never sent to a browser.
client = StigmerClient(os.environ["STIGMER_API_KEY"], base_url=${server.target}${insecure})


@dataclass
class User:
    id: str
    email: str | None = None
    name: str | None = None


def current_user(request: BaseHTTPRequestHandler) -> User | None:
    """${CURRENT_USER_NOTE.join("\n    ")}
    """
    dev_user = os.environ.get("STIGMER_DEV_USER")
    return User(id=dev_user, email=dev_user) if dev_user else None


class TokenRoute(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path != "/api/stigmer-token":
            self.send_error(404)
            return
        user = current_user(self)
        if user is None:
            self.answer(401, "text/plain", b"Nobody is signed in.")
            return
        try:
            token = client.tokens.mint_user_token(
                org=ORG, user_id=user.id, user_email=user.email, user_name=user.name
            )
        except Exception:
            logging.exception("minting a Stigmer token")
            self.answer(502, "text/plain", ${lit(REFUSED)}.encode())
            return
        body = {"accessToken": token.access_token, "expiresAt": token.expires_at.isoformat()}
        self.answer(200, "application/json", json.dumps(body).encode())

    def answer(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "${APP_TOKEN_ROUTE_PORT}"))
    ThreadingHTTPServer(("", port), TokenRoute).serve_forever()
`;
}

function goRoute({ org, server }: Code): string {
  const insecure = server.plaintext ? ",\n\t\tstigmer.WithInsecure()," : ",";
  return `// Your backend's Stigmer token route. GET /api/stigmer-token answers the
// signed-in person's token, { accessToken, expiresAt }, which the chat in
// your app asks for. Run it with: go run .
package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	stigmer "go.stigmer.ai/sdk"
)

const org = ${org}

type user struct{ ID, Email, Name string }

${CURRENT_USER_NOTE.map((l) => `// ${l}`).join("\n")}
func currentUser(r *http.Request) *user {
	if devUser := os.Getenv("STIGMER_DEV_USER"); devUser != "" {
		return &user{ID: devUser, Email: devUser}
	}
	return nil
}

func main() {
	// The service account's key, never sent to a browser.
	client, err := stigmer.NewClient(
		stigmer.WithAPIKey(os.Getenv("STIGMER_API_KEY")),
		stigmer.WithBaseURL(${server.target})${insecure}
	)
	if err != nil {
		log.Fatal(err)
	}
	defer client.Close()

	http.HandleFunc("GET /api/stigmer-token", func(w http.ResponseWriter, r *http.Request) {
		u := currentUser(r)
		if u == nil {
			http.Error(w, "Nobody is signed in.", http.StatusUnauthorized)
			return
		}
		token, err := client.Tokens.MintUserToken(r.Context(), &stigmer.MintUserTokenInput{
			Org:       org,
			UserID:    u.ID,
			UserEmail: u.Email,
			UserName:  u.Name,
		})
		if err != nil {
			log.Print(err)
			http.Error(w, ${lit(REFUSED)}, http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"accessToken": token.AccessToken,
			"expiresAt":   token.ExpiresAt.Format(time.RFC3339),
		})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "${APP_TOKEN_ROUTE_PORT}"
	}
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
`;
}

function javaRoute({ org, server }: Code): string {
  const insecure = server.plaintext ? "\n                .insecure()" : "";
  return `// Your backend's Stigmer token route. GET /api/stigmer-token answers the
// signed-in person's token, { accessToken, expiresAt }, which the chat in
// your app asks for.
import ai.stigmer.sdk.MintUserTokenInput;
import ai.stigmer.sdk.MintUserTokenResult;
import ai.stigmer.sdk.StigmerClient;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

public class StigmerToken {
    static final String ORG = ${org};

    record User(String id, String email, String name) {}

${CURRENT_USER_NOTE.map((l) => `    // ${l}`).join("\n")}
    static User currentUser(HttpExchange exchange) {
        String devUser = System.getenv("STIGMER_DEV_USER");
        return devUser == null || devUser.isEmpty() ? null : new User(devUser, devUser, null);
    }

    public static void main(String[] args) throws IOException {
        // The service account's key, never sent to a browser.
        StigmerClient client = StigmerClient.builder(System.getenv("STIGMER_API_KEY"))
                .baseUrl(${server.target})${insecure}
                .build();

        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "${APP_TOKEN_ROUTE_PORT}"));
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/api/stigmer-token", exchange -> {
            if (!exchange.getRequestMethod().equals("GET") || !exchange.getRequestURI().getPath().equals("/api/stigmer-token")) {
                answer(exchange, 404, "text/plain", "Not found.");
                return;
            }
            User user = currentUser(exchange);
            if (user == null) {
                answer(exchange, 401, "text/plain", "Nobody is signed in.");
                return;
            }
            MintUserTokenResult token;
            try {
                token = client.tokens().mintUserToken(MintUserTokenInput.builder()
                        .org(ORG)
                        .userId(user.id())
                        .userEmail(user.email())
                        .userName(user.name())
                        .build());
            } catch (RuntimeException err) {
                err.printStackTrace();
                answer(exchange, 502, "text/plain", ${lit(REFUSED)});
                return;
            }
            // A token and an ISO 8601 instant hold no character JSON escapes.
            answer(exchange, 200, "application/json",
                    "{\\"accessToken\\":\\"" + token.accessToken() + "\\",\\"expiresAt\\":\\"" + token.expiresAt() + "\\"}");
        });
        server.start();
    }

    static void answer(HttpExchange exchange, int status, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", contentType);
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
`;
}

const CHAT_INSTALL = "npm install @stigmer/client @stigmer/react-sdk @stigmer/apis @bufbuild/protobuf";

function signInChat({ agentRef, server }: Code): AppHandoverFile {
  return {
    install: CHAT_INSTALL,
    installLanguage: "bash",
    file: `${APP_CHAT_COMPONENT}.tsx`,
    language: "tsx",
    code: `"use client";

// The agent's chat, for the person signed in to your app. Mount it as
// <StigmerAgentChat /> in a box with a height: it fills the box.
import { Stigmer, createTokenCache } from "@stigmer/client";
import { AgentChat, StigmerProvider } from "@stigmer/react-sdk/chat";
import "@stigmer/react-sdk/styles.css";

// Your backend's token route. A backend apart from this app is reached
// through this app's proxy, or by its full address.
const TOKEN_ROUTE = ${lit(APP_TOKEN_ROUTE)};

// Asks your backend for a token once, and again a minute before it expires.
// When your user signs out, call tokens.invalidate().
const tokens = createTokenCache(async () => {
  const res = await fetch(TOKEN_ROUTE);
  if (!res.ok) throw new Error(\`\${TOKEN_ROUTE} answered \${res.status}: \${await res.text()}\`);
  return res.json();
});

const stigmer = new Stigmer({
  baseUrl: ${server.url},
  getAccessToken: tokens.getAccessToken,
});

export function ${APP_CHAT_COMPONENT}() {
  return (
    <StigmerProvider client={stigmer}>
      <AgentChat agent={${agentRef}} />
    </StigmerProvider>
  );
}
`,
  };
}

function localChat({ agentRef, server }: Code): AppHandoverFile {
  return {
    install: CHAT_INSTALL,
    installLanguage: "bash",
    file: `${APP_CHAT_COMPONENT}.tsx`,
    language: "tsx",
    code: `"use client";

// Development only. This Stigmer runs on your computer and trusts every
// caller, so your app talks to it with no sign-in while you build. Going
// live needs a Stigmer that signs people in, and a token route.
//
// The agent's chat. Mount it as <StigmerAgentChat /> in a box with a
// height: it fills the box.
import { Stigmer } from "@stigmer/client";
import { AgentChat, StigmerProvider } from "@stigmer/react-sdk/chat";
import "@stigmer/react-sdk/styles.css";

const stigmer = new Stigmer({
  baseUrl: ${server.url},
  getAccessToken: () => null,
});

export function ${APP_CHAT_COMPONENT}() {
  return (
    <StigmerProvider client={stigmer}>
      <AgentChat agent={${agentRef}} />
    </StigmerProvider>
  );
}
`,
  };
}
