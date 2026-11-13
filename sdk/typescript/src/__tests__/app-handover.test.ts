// The handed-over code's text: what every stack's token route and the chat
// say, for a server that signs people in and for one that trusts every
// caller. The pins here are the promises a reader relies on when they paste
// it unread: their organization and agent are in it and cannot break out of
// their literals, the address reaches each SDK in the form that SDK takes
// (a gRPC target, plaintext only for http://), no key is ever written into
// it, and every route refuses when nobody is signed in. That the text
// compiles in its language is the docs snippet gate's
// (scripts/lib/docs-snippets/handover-snippets.mjs); that each route answers
// a real token is the SDK quickstart smoke's.

import { describe, expect, it } from "vitest";
import {
  APP_CHAT_COMPONENT,
  APP_DEV_USER_VARIABLE,
  APP_HANDOVER_STACKS,
  APP_TOKEN_ROUTE,
  buildAppHandover,
  type AppHandoverStack,
} from "../app-handover";

const CLOUD = { mode: "sign-in", baseUrl: "https://api.stigmer.ai", org: "acme", agent: "variance-reporter" } as const;
const STACKS: readonly AppHandoverStack[] = APP_HANDOVER_STACKS.map((s) => s.id);

function backend(stack: AppHandoverStack, overrides: Partial<Parameters<typeof buildAppHandover>[0]> = {}) {
  const { backend } = buildAppHandover({ ...CLOUD, stack, ...overrides });
  if (backend === undefined) throw new Error("no backend");
  return backend;
}

describe("buildAppHandover, sign-in", () => {
  it("offers five stacks, in the picker's order", () => {
    expect(APP_HANDOVER_STACKS.map((s) => s.name)).toEqual(["Next.js", "Node", "Python", "Go", "Java"]);
  });

  it.each([
    ["nextjs", "app/api/stigmer-token/route.ts", "typescript", "npm install @stigmer/client"],
    ["node", "server.ts", "typescript", "npm install @stigmer/client"],
    ["python", "stigmer_token.py", "python", "pip install stigmer-sdk"],
    ["go", "main.go", "go", "go get go.stigmer.ai/sdk"],
  ] as const)("names %s's file, language and install", (stack, file, language, install) => {
    const route = backend(stack);
    expect(route).toMatchObject({ file, language, install, installLanguage: "bash" });
  });

  it.each(STACKS)("%s's route serves the token route and mints for the organization", (stack) => {
    const { code } = backend(stack);
    expect(code).toContain(APP_TOKEN_ROUTE);
    expect(code).toMatch(/"acme"/);
    expect(code).toMatch(/accessToken/);
    expect(code).toMatch(/expiresAt/);
  });

  it.each(STACKS)("%s's route reads the key from STIGMER_API_KEY and never holds one", (stack) => {
    const { code } = backend(stack);
    expect(code).toContain("STIGMER_API_KEY");
    expect(code).not.toMatch(/stk_/);
  });

  it.each(STACKS)("%s's route signs in only STIGMER_DEV_USER until currentUser is replaced, and refuses nobody with 401", (stack) => {
    const { code } = backend(stack);
    expect(code).toMatch(/current_?[uU]ser/);
    expect(code).toContain(APP_DEV_USER_VARIABLE);
    expect(code).toMatch(/401|StatusUnauthorized/);
    expect(code).toContain("Nobody is signed in.");
  });

  it("the Next.js route is never prerendered", () => {
    expect(backend("nextjs").code).toContain('export const dynamic = "force-dynamic";');
  });

  it("the standard-library routes listen on PORT, 3001 when unset", () => {
    for (const stack of ["node", "python", "go", "java"] as const) {
      const { code } = backend(stack);
      expect(code).toContain("PORT");
      expect(code).toContain("3001");
    }
  });

  it("Go, Python and Java take the https address as host:443, over TLS", () => {
    expect(backend("go").code).toContain('stigmer.WithBaseURL("api.stigmer.ai:443"),\n\t)');
    expect(backend("go").code).not.toContain("WithInsecure");
    expect(backend("python").code).toContain('base_url="api.stigmer.ai:443")');
    expect(backend("java").code).toContain('.baseUrl("api.stigmer.ai:443")\n                .build()');
  });

  it("Go, Python and Java keep an explicit port, and are told plaintext for http://", () => {
    const local = { baseUrl: "http://localhost:7234" };
    expect(backend("go", local).code).toContain('stigmer.WithBaseURL("localhost:7234"),\n\t\tstigmer.WithInsecure(),\n\t)');
    expect(backend("python", local).code).toContain('base_url="localhost:7234", insecure=True)');
    expect(backend("java", local).code).toContain('.baseUrl("localhost:7234")\n                .insecure()\n                .build()');
    expect(backend("go", { baseUrl: "https://stigmer.example.com:8443" }).code).toContain('"stigmer.example.com:8443"');
    expect(backend("python", { baseUrl: "http://stigmer.internal" }).code).toContain('base_url="stigmer.internal:80", insecure=True');
  });

  it("the TypeScript routes and the chat take the address as a URL, without a trailing slash", () => {
    const { backend: route, chat } = buildAppHandover({ ...CLOUD, stack: "node", baseUrl: "https://api.stigmer.ai/" });
    expect(route?.code).toContain('baseUrl: "https://api.stigmer.ai",');
    expect(chat.code).toContain('baseUrl: "https://api.stigmer.ai",');
  });

  it("Java's dependency pins a release the server names, and otherwise takes the newest 0.x and says where to pin", () => {
    const pinned = backend("java", { sdkVersion: "0.1.3" });
    expect(pinned.installLanguage).toBe("xml");
    expect(pinned.install).toContain("<version>0.1.3</version>");
    expect(pinned.install).not.toContain("<!--");
    for (const sdkVersion of [undefined, "0.1.4-dev.20261112194101.g56c61b836fa0"]) {
      const open = backend("java", { sdkVersion });
      expect(open.install).toContain("<version>[0.1,1.0)</version>");
      expect(open.install).toContain("https://central.sonatype.com/artifact/ai.stigmer/stigmer-sdk");
    }
  });

  it("the chat fetches the token route through a token cache and names the agent", () => {
    const { chat } = buildAppHandover({ ...CLOUD, stack: "python" });
    expect(chat).toMatchObject({
      file: `${APP_CHAT_COMPONENT}.tsx`,
      language: "tsx",
      install: "npm install @stigmer/client @stigmer/react-sdk @stigmer/apis @bufbuild/protobuf",
    });
    expect(chat.code.startsWith('"use client";\n')).toBe(true);
    expect(chat.code).toContain(`const TOKEN_ROUTE = "${APP_TOKEN_ROUTE}";`);
    expect(chat.code).toContain("createTokenCache");
    expect(chat.code).toContain('<AgentChat agent={"acme/variance-reporter"} />');
    expect(chat.code).toContain(`export function ${APP_CHAT_COMPONENT}()`);
  });

  it("the chat is the same for every stack", () => {
    const chats = new Set(STACKS.map((stack) => buildAppHandover({ ...CLOUD, stack }).chat.code));
    expect(chats.size).toBe(1);
  });
});

describe("buildAppHandover, local", () => {
  const local = buildAppHandover({ ...CLOUD, mode: "local", stack: "node", baseUrl: "http://localhost:7234" });

  it("hands over no backend: a server that trusts every caller mints nothing", () => {
    expect(local.backend).toBeUndefined();
  });

  it("the chat sends no token, to the local address, and says it is for development", () => {
    expect(local.chat.code).toContain("getAccessToken: () => null");
    expect(local.chat.code).toContain('baseUrl: "http://localhost:7234"');
    expect(local.chat.code).toContain("Development only.");
    expect(local.chat.code).not.toContain("createTokenCache");
    expect(local.chat.code).toContain('<AgentChat agent={"acme/variance-reporter"} />');
  });
});

describe("buildAppHandover, values written into code", () => {
  it.each(STACKS)("%s: an organization or agent holding quotes and backslashes stays inside its literal", (stack) => {
    const org = 'a"b\\c';
    const { backend: route, chat } = buildAppHandover({ ...CLOUD, stack, org, agent: 'x"y' });
    const literal = JSON.stringify(org);
    expect(route?.code).toContain(literal);
    expect(chat.code).toContain(`agent={${JSON.stringify('a"b\\c/x"y')}}`);
    // The raw value never appears unescaped.
    expect(route?.code).not.toContain(`"${org}"`);
  });

  it("refuses an address that is not absolute http or https", () => {
    expect(() => buildAppHandover({ ...CLOUD, stack: "node", baseUrl: "api.stigmer.ai" })).toThrow(/absolute address/);
    expect(() => buildAppHandover({ ...CLOUD, stack: "node", baseUrl: "ftp://api.stigmer.ai" })).toThrow(/http:\/\/ or https:\/\//);
  });
});
