/**
 * A person's side of an exposed Stigmer, for test/install/smoke-operator.mjs's
 * `exposed` profile and the stand-in browser it hands the CLI: everything
 * here speaks https to the public hostname, trusting the test's own CA.
 *
 *   - createBrowser: a cookie-keeping HTTPS client that walks the bundled
 *     sign-in's pages the way a person's browser does: it fills the login
 *     form, the forced password change, the registration form, the device
 *     code page and a consent page, and stops at the redirect a client
 *     asked for, or at a page with no form left.
 *   - the console's Authorization Code + PKCE sign-in, run by that browser
 *     with the console's own client and redirect, and its token exchange;
 *   - startSignedInProxy: a plain-http proxy on this host that adds a
 *     person's token and forwards to the front door, so the shared smoke
 *     helpers (stigmer-smoke.mjs) run unchanged as that person;
 *   - grpcHealth: the health check over native gRPC (HTTP/2 over TLS)
 *     through the front door, the protocol the CLI and the SDKs speak.
 *
 * node:* only: the install layer imports nothing else (test/README.md).
 */

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";

/** One request over https (or http), resolved as { status, headers, body }. */
export function request(url, { method = "GET", headers = {}, body, ca } = {}) {
  const target = new URL(url);
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, { method, headers, ...(ca === undefined ? {} : { ca }) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// `&amp;` last, so an escaped entity (`&amp;quot;`) decodes to its text, never twice.
const decode = (s) => s.replace(/&#x2F;/g, "/").replace(/&#47;/g, "/").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** The forms on a page: { id, action, hidden: {name: value}, buttons: [names] }. */
export function formsOf(html) {
  const forms = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1];
    const id = /\bid="([^"]*)"/i.exec(attrs)?.[1] ?? "";
    const action = /\baction="([^"]*)"/i.exec(attrs)?.[1];
    if (action === undefined) continue;
    const hidden = {};
    for (const input of m[2].matchAll(/<input\b([^>]*)>/gi)) {
      const a = input[1];
      if (!/type="hidden"/i.test(a)) continue;
      const name = /\bname="([^"]*)"/i.exec(a)?.[1];
      if (name !== undefined) hidden[name] = decode(/\bvalue="([^"]*)"/i.exec(a)?.[1] ?? "");
    }
    const buttons = [...m[2].matchAll(/<(?:input|button)\b[^>]*\bname="([^"]*)"/gi)].map((b) => b[1]);
    // A consent page's form carries no id; its Yes button names it.
    forms.push({ id: id === "" && buttons.includes("accept") ? "consent" : id, action: decode(action), hidden, buttons });
  }
  return forms;
}

/** A browser for the sign-in's pages; `ca` is the CA file's path. */
export function createBrowser({ caFile }) {
  const ca = readFileSync(caFile);
  const cookies = new Map();
  const send = async (url, { method = "GET", form } = {}) => {
    const headers = { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") };
    let body;
    if (form !== undefined) {
      body = new URLSearchParams(form).toString();
      headers["content-type"] = "application/x-www-form-urlencoded";
    }
    const res = await request(url, { method, headers, body, ca });
    for (const raw of [res.headers["set-cookie"] ?? []].flat()) {
      const [pair] = raw.split(";");
      const at = pair.indexOf("=");
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (value === "" || /max-age=0/i.test(raw)) cookies.delete(name);
      else cookies.set(name, value);
    }
    return res;
  };

  return {
    send,
    /**
     * Walk pages from `url`. `answers` fills the forms by id. Resolves
     * { redirect } at a redirect to `stopAt`, or { page } at a page with no
     * form `answers` knows, or at a form that came straight back (refused).
     */
    async walk(url, { answers, stopAt }) {
      let res = await send(url);
      let current = url;
      let submitted = "";
      for (let step = 0; step < 20; step++) {
        if (res.status >= 300 && res.status < 400) {
          const next = new URL(res.headers.location, current).toString();
          if (stopAt !== undefined && next.startsWith(stopAt)) return { redirect: next };
          current = next;
          res = await send(next);
          continue;
        }
        const form = formsOf(res.body).find((f) => answers[f.id] !== undefined);
        // A form that comes straight back after it was submitted is a
        // refusal (a wrong password, an address sign-up does not admit):
        // the page says why, so it ends the walk.
        if (form === undefined || form.id === submitted) return { page: res.body, status: res.status };
        submitted = form.id;
        const fields = { ...form.hidden, ...answers[form.id] };
        current = new URL(form.action, current).toString();
        res = await send(current, { method: "POST", form: fields });
      }
      throw new Error(`the sign-in pages did not end after 20 steps (last at ${current})`);
    },
  };
}

/** The answers a person gives the sign-in's forms. */
export function signInAnswers({ email, password, newPassword }) {
  return {
    "kc-form-login": { username: email, password, credentialId: "" },
    "kc-passwd-update-form": { "password-new": newPassword ?? password, "password-confirm": newPassword ?? password },
    "kc-oauth": { accept: "Yes" },
    consent: { accept: "Yes" },
    "kc-user-verify-device-user-code-form": {},
  };
}

/** PKCE for one authorization request. */
export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * The console's sign-in, as its own code runs it: an authorization request
 * with the console's client, its redirect and PKCE, the pages walked, then
 * the code exchanged. Resolves the token response.
 */
export async function consoleSignIn(browser, { issuer, publicUrl, clientId, audience, answers, caFile }) {
  const { verifier, challenge } = pkce();
  const redirect = `${publicUrl}/auth/callback`;
  const authorize = new URL(`${issuer}/protocol/openid-connect/auth`);
  for (const [k, v] of Object.entries({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid profile email offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(8).toString("hex"),
    audience,
  })) {
    authorize.searchParams.set(k, v);
  }
  const walked = await browser.walk(authorize.toString(), { answers, stopAt: redirect });
  if (walked.redirect === undefined) throw new Error(`the sign-in ended on a page, not the console's callback:\n${(walked.page ?? "").slice(0, 600)}`);
  return exchangeCode({ issuer, clientId, redirect, verifier, code: new URL(walked.redirect).searchParams.get("code"), caFile });
}

/** Exchange an authorization code. */
export async function exchangeCode({ issuer, clientId, redirect, verifier, code, caFile }) {
  if (!code) throw new Error("the callback carried no code");
  const res = await request(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier }).toString(),
    ca: readFileSync(caFile),
  });
  if (res.status !== 200) throw new Error(`the token exchange answered ${res.status}: ${res.body.slice(0, 300)}`);
  return JSON.parse(res.body);
}

/**
 * A plain-http proxy on this host that forwards to `target` (the front door)
 * with `token` as the bearer, so helpers written for an unsigned server run
 * as a person. Resolves { baseUrl, stop }.
 */
export async function startSignedInProxy({ target, token, caFile }) {
  const ca = readFileSync(caFile);
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      try {
        const headers = { authorization: `Bearer ${token}` };
        for (const name of ["content-type", "accept", "connect-protocol-version"]) {
          if (req.headers[name] !== undefined) headers[name] = req.headers[name];
        }
        const out = await request(`${target}${req.url}`, { method: req.method, headers, body: chunks.length > 0 ? Buffer.concat(chunks) : undefined, ca });
        res.writeHead(out.status, { "content-type": out.headers["content-type"] ?? "application/octet-stream" });
        res.end(out.body);
      } catch (error) {
        console.error(`front door proxy: ${req.method} ${req.url}: ${error instanceof Error ? error.message : String(error)}`);
        res.writeHead(502);
        res.end("bad gateway");
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((resolve) => server.close(resolve)) };
}

/**
 * grpc.health.v1.Health/Check over native gRPC through the front door.
 * Resolves the serving status number (1 is SERVING).
 */
export function grpcHealth({ origin, caFile }) {
  return new Promise((resolve, reject) => {
    const session = http2.connect(origin, { ca: readFileSync(caFile) });
    session.on("error", reject);
    const stream = session.request({
      ":method": "POST",
      ":path": "/grpc.health.v1.Health/Check",
      "content-type": "application/grpc",
      te: "trailers",
    });
    const chunks = [];
    let grpcStatus;
    stream.on("response", (headers) => {
      if (headers["grpc-status"] !== undefined) grpcStatus = headers["grpc-status"];
    });
    stream.on("trailers", (trailers) => {
      grpcStatus = trailers["grpc-status"];
    });
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      session.close();
      const body = Buffer.concat(chunks);
      if (String(grpcStatus) !== "0") return reject(new Error(`the health check answered grpc-status ${grpcStatus}`));
      // One length-prefixed message: field 1 (status) as a varint.
      const message = body.subarray(5);
      resolve(message.length >= 2 && message[0] === 0x08 ? message[1] : 0);
    });
    stream.on("error", reject);
    stream.end(Buffer.from([0, 0, 0, 0, 0]));
  });
}
