# Wrong Assumption: Node.js 23 works with Next.js 15.3.9

## The Assumption

Node.js 23 (the version active via nvm) would work fine for building the Next.js site with Fumadocs.

## What Actually Happened

Node.js 23 causes the `next build` webpack worker to silently crash. The process exits with code 0, prints "Creating an optimized production build ..." but never shows "Compiled successfully" or generates static output. The `.next/trace` file shows compilation starts (modules are being built, JS is being minified) but the worker dies mid-way.

## Impact

- Wasted ~30 minutes debugging what appeared to be a fumadocs or Next.js config issue
- The silent exit (code 0) made it particularly hard to diagnose — no error messages, no stack traces

## Correct Approach

Always use Node.js 20 LTS for Next.js builds. Node 23 is an odd-numbered non-LTS release and is not officially supported by Next.js.

## Prevention

- Add `.nvmrc` with `20` to `site/` directory
- Add `engines` field to `site/package.json`
- Document Node.js version requirement in `site/Makefile` or README
