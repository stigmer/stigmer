import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildServerModel,
  enumerateRoutes,
  exportFileOf,
  parseNginxConfig,
  representativeUrlOf,
  resolveRequest,
  verifyRoutes,
} from "./verify-static-export-routes.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The serving shape shipped by client-apps/web/nginx.conf (comments and
 * cache headers stripped — the resolver ignores both): the probe chain,
 * trailing-slash canonicalization, and the honest not-found posture.
 */
const PROBE_CONFIG = `
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    error_page 404 /404.html;
    absolute_redirect off;

    location ^~ /_next/static/ {
    }
    location = /index.html {
    }

    location ~ ^(.+)/$ {
        return 301 $1$is_args$args;
    }

    location ~ ^(.+)/([^/]+)/[^/]+$ {
        try_files $uri $uri.html $uri/
                  $1/$2/__placeholder__.html
                  $1/__placeholder__/__placeholder__.html
                  =404;
    }

    location ~ ^(.+)/[^/]+$ {
        try_files $uri $uri.html $uri/ $1/__placeholder__.html =404;
    }

    location / {
        try_files $uri $uri.html $uri/ =404;
    }
}
`;

/**
 * The config as it stood before channel-conversations F-12 was fixed: a
 * hand-written /chat special case plus a two-level block requiring two
 * static prefix segments. Kept as a fixture so the model provably
 * reproduces the historical blank-page failure — a model that cannot fail
 * on the bug this gate exists for would be decorative.
 */
const HISTORICAL_CONFIG = `
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    location ~ ^/chat/[^/]+/[^/]+$ {
        try_files $uri $uri.html /chat/__placeholder__/__placeholder__.html /index.html;
    }
    location ~ ^(.+/[^/]+)/[^/]+/[^/]+$ {
        try_files $uri $uri.html $uri/ $1/__placeholder__/__placeholder__.html /index.html;
    }
    location ~ ^(.+)/[^/]+$ {
        try_files $uri $uri.html $uri/ $1/__placeholder__.html /index.html;
    }
    location / {
        try_files $uri $uri.html $uri/ /index.html;
    }
}
`;

/** A miniature export set exercising every route shape the app has. */
const FILES = new Set([
  "/index.html",
  "/404.html",
  "/conversations.html",
  "/login.html",
  "/settings/billing.html",
  "/auth/github/callback.html",
  "/sessions/__placeholder__.html",
  "/chat/__placeholder__/__placeholder__.html",
  "/conversations/__placeholder__/__placeholder__.html",
  "/workflows/__placeholder__/__placeholder__.html",
  "/workflows/executions/__placeholder__.html",
  "/library/skills/__placeholder__/__placeholder__.html",
]);

const probeModel = buildServerModel(parseNginxConfig(PROBE_CONFIG));
const resolveProbe = (uri) => resolveRequest(probeModel, uri, FILES);

// ---------------------------------------------------------------------------
// Resolution semantics under the probe rule
// ---------------------------------------------------------------------------

test("static routes resolve to their own page before any placeholder", () => {
  assert.equal(resolveProbe("/"), "/index.html");
  assert.equal(resolveProbe("/login"), "/login.html");
  assert.equal(resolveProbe("/settings/billing"), "/settings/billing.html");
  assert.equal(resolveProbe("/auth/github/callback"), "/auth/github/callback.html");
});

test("one-dynamic-segment routes resolve via the two-segment block", () => {
  assert.equal(resolveProbe("/sessions/ses_abc"), "/sessions/__placeholder__.html");
});

test("the ambiguous three-segment pair disambiguates by filesystem probe", () => {
  // /workflows/executions/[id]: the literal candidate exists and wins.
  assert.equal(
    resolveProbe("/workflows/executions/wfe_123"),
    "/workflows/executions/__placeholder__.html",
  );
  // /workflows/[org]/[slug]: the literal candidate does not exist, so the
  // two-placeholder candidate serves — same URL shape, different route.
  assert.equal(
    resolveProbe("/workflows/acme/my-flow"),
    "/workflows/__placeholder__/__placeholder__.html",
  );
});

test("conversation deep links resolve to the conversations placeholder (F-12)", () => {
  assert.equal(
    resolveProbe("/conversations/ach_01kz/919912850490"),
    "/conversations/__placeholder__/__placeholder__.html",
  );
});

test("chat resolves through the general rule without a special-case block", () => {
  assert.equal(
    resolveProbe("/chat/acme/support-bot"),
    "/chat/__placeholder__/__placeholder__.html",
  );
});

test("four-segment library routes resolve to their placeholder pair", () => {
  assert.equal(
    resolveProbe("/library/skills/acme/web-search"),
    "/library/skills/__placeholder__/__placeholder__.html",
  );
});

test("existing files always win over placeholder candidates", () => {
  const files = new Set([...FILES, "/workflows/acme/my-flow.html"]);
  assert.equal(
    resolveRequest(probeModel, "/workflows/acme/my-flow", files),
    "/workflows/acme/my-flow.html",
  );
});

test("unknown URLs serve the real 404 page, never the blank app shell", () => {
  assert.equal(resolveProbe("/no-such-route"), "/404.html");
  assert.equal(resolveProbe("/no/such-route"), "/404.html");
  assert.equal(resolveProbe("/no/such/route/anywhere"), "/404.html");
});

test("trailing-slash URLs canonicalize to the same document (301 followed)", () => {
  assert.equal(resolveProbe("/login/"), "/login.html");
  assert.equal(resolveProbe("/settings/billing/"), "/settings/billing.html");
  assert.equal(
    resolveProbe("/conversations/ach_01kz/919912850490/"),
    "/conversations/__placeholder__/__placeholder__.html",
  );
  // The root has no slashless twin and must keep serving the shell.
  assert.equal(resolveProbe("/"), "/index.html");
});

test("^~ prefix locations win over regex blocks (asset serving)", () => {
  const files = new Set([...FILES, "/_next/static/chunks/app.js"]);
  assert.equal(
    resolveRequest(probeModel, "/_next/static/chunks/app.js", files),
    "/_next/static/chunks/app.js",
  );
});

// ---------------------------------------------------------------------------
// The historical failure, reproduced by the model
// ---------------------------------------------------------------------------

test("the pre-fix config produces the F-12 blank page for conversations and workflows", () => {
  const historical = buildServerModel(parseNginxConfig(HISTORICAL_CONFIG));
  // Both fall into the one-level block, whose candidate embeds the real
  // channel id / org where a literal __placeholder__ must be, and miss.
  assert.equal(
    resolveRequest(historical, "/conversations/ach_01kz/9199", FILES),
    "/index.html",
  );
  assert.equal(
    resolveRequest(historical, "/workflows/acme/my-flow", FILES),
    "/index.html",
  );
  // While /chat only worked because of its special case.
  assert.equal(
    resolveRequest(historical, "/chat/acme/bot", FILES),
    "/chat/__placeholder__/__placeholder__.html",
  );
});

// ---------------------------------------------------------------------------
// Refusal on unmodelled config — the property that keeps the gate honest
// ---------------------------------------------------------------------------

test("refuses unmodelled server directives", () => {
  assert.throws(
    () => buildServerModel(parseNginxConfig(`server { rewrite ^/a$ /b; }`)),
    /does not model.*rewrite/s,
  );
});

test("refuses unmodelled location directives", () => {
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(`server { location / { rewrite ^/a$ /b last; } }`),
      ),
    /does not model.*rewrite/s,
  );
});

test("models redirect returns but refuses non-redirect return forms", () => {
  const model = buildServerModel(
    parseNginxConfig(`server { location ~ ^(.+)/$ { return 301 $1; } }`),
  );
  assert.equal(model.locations[0].redirect.code, 301);
  // A bare status return has no target document to follow.
  assert.throws(
    () => buildServerModel(parseNginxConfig(`server { location / { return 404; } }`)),
    /does not model.*return form/s,
  );
  // try_files + return in one location has subtle evaluation order.
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(
          `server { location / { try_files $uri =404; return 301 /x; } }`,
        ),
      ),
    /does not model.*both try_files and return/s,
  );
});

test("refuses unmodelled try_files variables and code fallbacks", () => {
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(`server { location / { try_files $document_root$uri /a; } }`),
      ),
    /does not model.*\$document_root/s,
  );
  // Only a FINAL =404 is modelled: other codes, and codes mid-list
  // (which nginx would treat as file candidates), are refused.
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(`server { location / { try_files $uri =403; } }`),
      ),
    /does not model.*=403/s,
  );
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(`server { location / { try_files =404 $uri; } }`),
      ),
    /does not model.*=404/s,
  );
});

test("refuses unmodelled error_page forms", () => {
  assert.throws(
    () =>
      buildServerModel(
        parseNginxConfig(`server { error_page 500 502 /50x.html; }`),
      ),
    /does not model.*error_page/s,
  );
});

test("refuses unmodelled location modifiers", () => {
  assert.throws(
    () => buildServerModel(parseNginxConfig(`server { location ~* ^/a$ { } }`)),
    /does not model.*~\*/s,
  );
});

// ---------------------------------------------------------------------------
// Route enumeration and the end-to-end verdict
// ---------------------------------------------------------------------------

function makeAppDir(structure) {
  const dir = mkdtempSync(join(tmpdir(), "verify-routes-"));
  for (const route of structure) {
    const full = join(dir, ...route);
    mkdirSync(full, { recursive: true });
    writeFileSync(join(full, "page.tsx"), "export default function P() {}\n");
  }
  return dir;
}

test("enumerates static and dynamic routes with export files and probe URLs", () => {
  const dir = makeAppDir([[], ["login"], ["conversations", "[channelId]", "[key]"]]);
  try {
    const routes = enumerateRoutes(dir);
    assert.deepEqual(
      routes.map((r) => [r.url, exportFileOf(r), representativeUrlOf(r)]),
      [
        ["/", "/index.html", "/"],
        [
          "/conversations/[channelId]/[key]",
          "/conversations/__placeholder__/__placeholder__.html",
          "/conversations/zz-channelid/zz-key",
        ],
        ["/login", "/login.html", "/login"],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses catch-all segments and route groups", () => {
  for (const shape of [["docs", "[...slug]"], ["(marketing)", "about"]]) {
    const dir = makeAppDir([shape]);
    try {
      assert.throws(() => enumerateRoutes(dir), /unmodelled route construct/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("verifyRoutes passes the probe config and fails the historical one, naming the route", () => {
  const dir = makeAppDir([
    [],
    ["conversations"],
    ["conversations", "[channelId]", "[key]"],
    ["workflows", "executions", "[id]"],
    ["sessions", "[id]"],
  ]);
  try {
    const routes = enumerateRoutes(dir);
    assert.deepEqual(verifyRoutes(routes, probeModel), []);

    // The historical config carried all three defects this gate now
    // asserts against: the guessed-shape blank page (F-12), unknown
    // URLs serving the shell, and trailing-slash URLs falling through.
    const historical = buildServerModel(parseNginxConfig(HISTORICAL_CONFIG));
    const failures = verifyRoutes(routes, historical);
    assert.equal(failures.length, 3);
    const joined = failures.join("\n");
    assert.match(joined, /conversations\/\[channelId\]\/\[key\]/);
    assert.match(joined, /blank-page failure/);
    assert.match(joined, /not-found posture/);
    assert.match(joined, /trailing-slash posture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fails a route that exceeds the dynamic-segment budget with the remedy", () => {
  const dir = makeAppDir([["a", "[x]", "[y]", "[z]"]]);
  try {
    const failures = verifyRoutes(enumerateRoutes(dir), probeModel);
    assert.equal(failures.length >= 1, true);
    assert.match(failures[0], /more than 2 dynamic segments/);
    assert.match(failures[0], /MAX_DYNAMIC_SEGMENTS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
