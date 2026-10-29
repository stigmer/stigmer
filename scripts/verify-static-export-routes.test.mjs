import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildServerModel,
  enumerateRoutes,
  exportFileOf,
  headersOf,
  parseNginxConfig,
  representativeUrlOf,
  resolveRequest,
  verifyRoutes,
} from "./verify-static-export-routes.mjs";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The serving shape shipped by client-apps/web/nginx.conf (comments
 * stripped): the probe chain, trailing-slash canonicalization, the honest
 * not-found posture, and the cache headers — one server-level `no-cache`
 * every location without its own header inherits.
 */
const PROBE_CONFIG = `
server {
    listen 3000;
    root /usr/share/nginx/html;
    index index.html;

    error_page 404 /404.html;
    absolute_redirect off;

    add_header Cache-Control "no-cache";

    location ^~ /_next/static/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
    location = /config.json {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }
    location = /embed.js {
        add_header Cache-Control "public, max-age=300";
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
 * The config as it stood before the blank-page failure was fixed: a
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

/**
 * A miniature export set exercising every route shape the serving rules
 * must tell apart, including a literal-segment sibling
 * (/conversations/archived/[id]) of a two-placeholder route.
 */
const FILES = new Set([
  "/index.html",
  "/404.html",
  "/conversations.html",
  "/login.html",
  "/settings/billing.html",
  "/auth/github/callback.html",
  "/sessions/__placeholder__.html",
  "/chat/__placeholder__.html",
  "/conversations/__placeholder__/__placeholder__.html",
  "/conversations/archived/__placeholder__.html",
  "/library/skills/__placeholder__/__placeholder__.html",
]);

/**
 * The cache headers as they stood before every page was told to
 * revalidate: only /index.html said `no-cache`, so every other page and
 * its .txt payload went out with no Cache-Control, and a browser could
 * keep the previous deploy's console for hours. Kept as a fixture so the
 * revalidation rule provably fails on the config that had the bug.
 */
const PRE_REVALIDATION_CONFIG = PROBE_CONFIG.replace(
  `    add_header Cache-Control "no-cache";\n\n    location ^~`,
  `    location ^~`,
);

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
  // /conversations/archived/[id]: the literal candidate exists and wins.
  assert.equal(
    resolveProbe("/conversations/archived/chn_123"),
    "/conversations/archived/__placeholder__.html",
  );
  // /conversations/[channelId]/[key]: the literal candidate does not exist,
  // so the two-placeholder candidate serves — same URL shape, different
  // route.
  assert.equal(
    resolveProbe("/conversations/chn_01kz/919912850490"),
    "/conversations/__placeholder__/__placeholder__.html",
  );
});

test("conversation deep links resolve to the conversations placeholder", () => {
  assert.equal(
    resolveProbe("/conversations/chn_01kz/919912850490"),
    "/conversations/__placeholder__/__placeholder__.html",
  );
});

test("chat resolves through the general rule without a special-case block", () => {
  // A hosted chat link names only the channel, by its id: /chat/[channel] is a
  // one-placeholder route, served by the two-segment block like /sessions.
  assert.equal(
    resolveProbe("/chat/chn_01j9z3k8f2q4m6n7p8r9s0t1v2"),
    "/chat/__placeholder__.html",
  );
});

test("an old /chat/<org>/<slug> link no longer reaches a chat page", () => {
  // It falls to the three-segment block, whose candidates
  // (/chat/acme/__placeholder__.html, /chat/__placeholder__/__placeholder__.html)
  // no longer exist in the export, so it ends at the real not-found page —
  // never the chat page under another channel's id, never the blank shell.
  assert.equal(resolveProbe("/chat/acme/support-bot"), "/404.html");
});

test("four-segment library routes resolve to their placeholder pair", () => {
  assert.equal(
    resolveProbe("/library/skills/acme/web-search"),
    "/library/skills/__placeholder__/__placeholder__.html",
  );
});

test("existing files always win over placeholder candidates", () => {
  const files = new Set([...FILES, "/conversations/chn_01kz/9199.html"]);
  assert.equal(
    resolveRequest(probeModel, "/conversations/chn_01kz/9199", files),
    "/conversations/chn_01kz/9199.html",
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
    resolveProbe("/conversations/chn_01kz/919912850490/"),
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
// Response headers (nginx add_header inheritance, modelled)
// ---------------------------------------------------------------------------

test("parses quoted directive arguments as one argument each", () => {
  const [server] = parseNginxConfig(
    `server { add_header Cache-Control "public, max-age=300"; add_header X-A 'b c' always; }`,
  );
  assert.deepEqual(
    server.block.map((d) => d.args),
    [
      ["Cache-Control", "public, max-age=300"],
      ["X-A", "b c", "always"],
    ],
  );
});

test("a location with no add_header of its own inherits the server's", () => {
  assert.deepEqual(headersOf(probeModel, "/login", FILES), { "Cache-Control": "no-cache" });
  assert.deepEqual(headersOf(probeModel, "/sessions/ses_abc", FILES), {
    "Cache-Control": "no-cache",
  });
  assert.deepEqual(headersOf(probeModel, "/sessions/__placeholder__.txt", new Set([...FILES, "/sessions/__placeholder__.txt"])), {
    "Cache-Control": "no-cache",
  });
});

test("a location's own add_header replaces the server's, whatever its name", () => {
  const files = new Set([...FILES, "/_next/static/chunks/app.js"]);
  assert.deepEqual(headersOf(probeModel, "/_next/static/chunks/app.js", files), {
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  // nginx inherits by level, not by header name: one add_header in a
  // location drops every server-level one, Cache-Control included.
  const model = buildServerModel(
    parseNginxConfig(`server {
      add_header Cache-Control "no-cache";
      location / { add_header X-Frame-Options "DENY"; try_files $uri $uri.html =404; }
    }`),
  );
  assert.deepEqual(headersOf(model, "/login", FILES), { "X-Frame-Options": "DENY" });
});

test("headers come from the location that finally served the request", () => {
  // "/" enters `location /`, reaches the export root through `$uri/`, and
  // the index module redirects internally to /index.html, whose exact
  // location answers with its own header.
  const model = buildServerModel(
    parseNginxConfig(`server {
      index index.html;
      add_header X-Level "server";
      location = /index.html { add_header X-Level "index"; }
      location / { try_files $uri $uri.html $uri/ =404; }
    }`),
  );
  assert.deepEqual(headersOf(model, "/", FILES), { "X-Level": "index" });
  assert.deepEqual(headersOf(model, "/login", FILES), { "X-Level": "server" });
});

test("a redirect answers with its own location's headers, not its destination's", () => {
  // The 301 inherits the server's header under the shipped config.
  assert.deepEqual(headersOf(probeModel, "/login/", FILES), { "Cache-Control": "no-cache" });
  const model = buildServerModel(
    parseNginxConfig(`server {
      add_header X-Level "server";
      location ~ ^(.+)/$ { add_header X-Level "redirect"; return 301 $1; }
      location / { try_files $uri $uri.html =404; }
    }`),
  );
  assert.deepEqual(headersOf(model, "/login/", FILES), { "X-Level": "redirect" });
  // The document the browser ends up with is still the destination.
  assert.equal(resolveRequest(model, "/login/", FILES), "/login.html");
});

test("the not-found page answers 404, which only `always` headers reach", () => {
  assert.deepEqual(headersOf(probeModel, "/no-such-route", FILES), {});
  const model = buildServerModel(
    parseNginxConfig(`server {
      error_page 404 /404.html;
      add_header X-Always "yes" always;
      location / { try_files $uri $uri.html =404; }
    }`),
  );
  assert.deepEqual(headersOf(model, "/no-such-route", FILES), { "X-Always": "yes" });
});

test("refuses an unterminated quote", () => {
  assert.throws(
    () => parseNginxConfig(`server { add_header Cache-Control "no-cache; }`),
    /unterminated quote/,
  );
});

test("refuses unmodelled add_header forms", () => {
  for (const directive of [
    `add_header Cache-Control;`,
    `add_header Cache-Control "no-cache" sometimes;`,
    `add_header X-Path $uri;`,
    `add_header X-A "1"; add_header X-A "2";`,
  ]) {
    assert.throws(
      () => buildServerModel(parseNginxConfig(`server { ${directive} }`)),
      /does not model.*add_header/s,
      directive,
    );
    assert.throws(
      () => buildServerModel(parseNginxConfig(`server { location / { ${directive} } }`)),
      /does not model.*add_header/s,
      directive,
    );
  }
});

// ---------------------------------------------------------------------------
// The historical failure, reproduced by the model
// ---------------------------------------------------------------------------

test("the pre-fix config produces the blank page for conversations", () => {
  const historical = buildServerModel(parseNginxConfig(HISTORICAL_CONFIG));
  // It falls into the one-level block, whose candidate embeds the real
  // channel id where a literal __placeholder__ must be, and misses.
  assert.equal(
    resolveRequest(historical, "/conversations/chn_01kz/9199", FILES),
    "/index.html",
  );
  // While /chat only worked because of its special case (the export then
  // held the two-placeholder /chat/[org]/[slug] page).
  assert.equal(
    resolveRequest(
      historical,
      "/chat/acme/bot",
      new Set([...FILES, "/chat/__placeholder__/__placeholder__.html"]),
    ),
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
    ["conversations", "archived", "[id]"],
    ["sessions", "[id]"],
    ["chat", "[channel]"],
  ]);
  try {
    const routes = enumerateRoutes(dir);
    assert.deepEqual(verifyRoutes(routes, probeModel), []);

    // The historical config carried all three defects this gate now
    // asserts against: the guessed-shape blank page, unknown
    // URLs serving the shell, and trailing-slash URLs falling through.
    const historical = buildServerModel(parseNginxConfig(HISTORICAL_CONFIG));
    const failures = verifyRoutes(routes, historical);
    assert.equal(failures.length, 4);
    const joined = failures.join("\n");
    assert.match(joined, /conversations\/\[channelId\]\/\[key\]/);
    assert.match(joined, /blank-page failure/);
    assert.match(joined, /not-found posture/);
    assert.match(joined, /trailing-slash posture/);
    assert.match(joined, /revalidation posture/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyRoutes fails a page or payload that would not revalidate, naming the route and its location", () => {
  const dir = makeAppDir([[], ["conversations"], ["sessions", "[id]"]]);
  try {
    const routes = enumerateRoutes(dir);
    const failures = verifyRoutes(
      routes,
      buildServerModel(parseNginxConfig(PRE_REVALIDATION_CONFIG)),
    );
    assert.equal(failures.length, 1);
    const [failure] = failures;
    assert.match(failure, /revalidation posture/);
    // The page by its URL and its payload by its export path, each with
    // the location that served it. The root document revalidates through
    // its own exact location; its .txt payload does not.
    assert.match(failure, /\/conversations \("\/conversations", served by location \/\)/);
    assert.match(failure, /"\/sessions\/__placeholder__\.txt", served by location ~ \^\(\.\+\)\/\[\^\/\]\+\$/);
    assert.match(failure, /"\/index\.txt"/);
    assert.doesNotMatch(failure, /\("\/",/);
    assert.match(failure, /add_header Cache-Control "no-cache";/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyRoutes fails a Cache-Control that is present but lets the browser reuse the page", () => {
  const dir = makeAppDir([[], ["conversations"]]);
  try {
    const cached = PROBE_CONFIG.replace(
      `add_header Cache-Control "no-cache";\n\n    location ^~`,
      `add_header Cache-Control "public, max-age=3600";\n\n    location ^~`,
    );
    const failures = verifyRoutes(
      enumerateRoutes(dir),
      buildServerModel(parseNginxConfig(cached)),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /revalidation posture/);
    assert.match(failures[0], /\("\/conversations", served by location \/\): Cache-Control "public, max-age=3600"/);
    // `no-store` revalidates too, and directive case does not matter.
    const stored = PROBE_CONFIG.replace(
      `add_header Cache-Control "no-cache";\n\n    location ^~`,
      `add_header Cache-Control "private, No-Store";\n\n    location ^~`,
    );
    assert.deepEqual(
      verifyRoutes(enumerateRoutes(dir), buildServerModel(parseNginxConfig(stored))),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyRoutes reports a payload whose resolution fails under the revalidation posture", () => {
  const dir = makeAppDir([["conversations"]]);
  try {
    // A payload that redirects to itself never reaches a response.
    const looping = PROBE_CONFIG.replace(
      `    location / {`,
      `    location ~ \\.txt$ {\n        return 301 $uri;\n    }\n\n    location / {`,
    );
    const failures = verifyRoutes(
      enumerateRoutes(dir),
      buildServerModel(parseNginxConfig(looping)),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /"\/conversations\.txt"\): resolution error — internal redirect loop/);
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
