# Fix Invite Page Blank Screen

**Date**: May 19, 2026

## Summary

Fixed a blank screen on the invite acceptance page (`/invite/<token>`) caused by a mismatched `generateStaticParams` placeholder value. The invite route used `"_"` while all other dynamic routes and the nginx fallback config expected `"__placeholder__"`, causing nginx to serve the wrong HTML shell.

## Problem Statement

Users clicking invitation links (e.g. `https://app.stigmer.ai/invite/7Gg8fjJfRt47XPaYt5GVfx`) saw a blank dark screen instead of the invitation acceptance UI.

### Pain Points

- Invite links were completely non-functional in production
- New users invited to organizations could not join
- No error message was shown — just a blank screen, making debugging difficult

## Solution

Changed the `generateStaticParams` return value in the invite page from `{ token: "_" }` to `{ token: "__placeholder__" }`, aligning with the convention used by every other dynamic route in the web app.

## Implementation Details

The web app uses Next.js `output: "export"` to produce a static site served by nginx. Each dynamic route (e.g. `/sessions/[id]`, `/runners/[id]`) exports a `generateStaticParams` function that returns a placeholder value so Next.js generates an HTML shell file. Nginx's `try_files` directive falls back to `$1/__placeholder__.html` for any unrecognized dynamic segment.

The invite route (`/invite/[token]/page.tsx`) was the only route returning `{ token: "_" }` instead of `{ token: "__placeholder__" }`. This produced `out/invite/_.html` instead of `out/invite/__placeholder__.html`. When nginx received a request for `/invite/<real-token>`, it couldn't find `__placeholder__.html`, fell through to the root `index.html`, and served the wrong JS chunks — resulting in a blank page.

**File changed**: `client-apps/web/src/app/invite/[token]/page.tsx`

## Benefits

- Invitation links work correctly in production
- New users can accept invitations and join organizations
- Consistent placeholder convention across all dynamic routes

## Impact

- **Users**: Anyone receiving an invitation link can now accept it
- **Ops**: Requires a rebuild and redeploy of the web app container

---

**Status**: ✅ Production Ready
