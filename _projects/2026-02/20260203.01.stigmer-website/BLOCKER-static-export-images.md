# BLOCKER: Static Export Image Generation Issue

**Status**: 🚨 CRITICAL - MUST FIX BEFORE DEPLOY  
**Created**: 2026-02-03  
**Phase**: 4.2 → 4.2.1  

---

## Problem Summary

Dynamic image generation routes (favicon, OG images) don't work with GitHub Pages static export.

**Current State**:
- ✅ Image generation code works in development
- ✅ Build completes successfully
- ❌ Routes are marked as "Dynamic" (ƒ) - require server
- ❌ Static export (`out/`) does NOT contain PNG files
- ❌ Will cause 404 errors on GitHub Pages

---

## Technical Details

**Routes Affected**:
- `/icon` - Favicon (32×32)
- `/apple-icon` - iOS touch icon (180×180)
- `/opengraph-image` - Social media preview (1200×630)
- `/twitter-image` - Twitter card (1200×630)

**Root Cause**:
Next.js `ImageResponse` API requires Edge Runtime, which can't be statically exported. The `runtime = "edge"` + `dynamic = "force-static"` combination is incompatible.

**Build Evidence**:
```
Build Output:
├ ƒ /icon                     0 B    0 B  (Dynamic)
├ ƒ /opengraph-image          0 B    0 B  (Dynamic)
├ ƒ /twitter-image            0 B    0 B  (Dynamic)

Static Export (out/):
- index.html ✅ (with metadata pointing to image routes)
- logo.svg ✅ (133KB)
- icon*.png ❌ (missing)
- opengraph-image.png ❌ (missing)
```

**Impact on Deployment**:
When deployed to GitHub Pages:
1. Favicon shows default browser icon (not Stigmer "S")
2. Social shares show broken image placeholders
3. iOS "Add to Home Screen" shows broken icon
4. Professional appearance compromised

---

## Solution Options

### ✅ Option 1: Build-Time PNG Generation (RECOMMENDED)

**Approach**: Generate static PNG files at build time before Next.js export.

**Implementation**:
```bash
# Create script: scripts/generate-images.js
# Use Puppeteer or node-canvas to render images
# Save to public/ directory:
#   - public/favicon.ico (32×32)
#   - public/apple-touch-icon.png (180×180)
#   - public/og-image.png (1200×630)
#   - public/twitter-image.png (1200×630)

# Update package.json:
"scripts": {
  "generate-images": "node scripts/generate-images.js",
  "build": "npm run generate-images && next build"
}

# Update layout.tsx metadata to point to static files
```

**Pros**:
- ✅ Works perfectly with GitHub Pages
- ✅ No server required
- ✅ Optimal performance (static files)
- ✅ Maintains code-as-configuration

**Cons**:
- ⚠️ Requires build script (1-2 hours to create)
- ⚠️ Can't personalize OG images per page (static only)

**Time**: ~1-2 hours

---

### Option 2: Manual PNG Creation (QUICK FIX)

**Approach**: Create PNGs manually using design tools.

**Steps**:
1. Use Figma/Photoshop/Sketch to create:
   - 32×32 favicon with gradient "S" logo
   - 180×180 Apple touch icon
   - 1200×630 OG image with branding
2. Export as optimized PNGs
3. Save to `public/` directory
4. Update `layout.tsx` metadata to reference static files
5. Delete dynamic route files (`icon.tsx`, etc.)

**Pros**:
- ✅ Fastest solution (30 minutes)
- ✅ Full design control
- ✅ Works immediately

**Cons**:
- ⚠️ Manual process (not automated)
- ⚠️ Not scalable for per-page OG images
- ⚠️ Loses code-as-configuration benefit

**Time**: ~30 minutes

---

### Option 3: Deploy to Vercel/Cloudflare Pages (FUTURE)

**Approach**: Migrate from GitHub Pages to platform with Edge Function support.

**Steps**:
1. Create Vercel/Cloudflare Pages account
2. Connect GitHub repository
3. Configure deployment
4. Update DNS (stigmer.ai)
5. Keep current image generation code as-is

**Pros**:
- ✅ Dynamic image generation works natively
- ✅ Can personalize OG images per page
- ✅ Better performance (Edge CDN)
- ✅ No code changes needed

**Cons**:
- ⚠️ Requires migration from GitHub Pages
- ⚠️ More complex infrastructure
- ⚠️ May require paid plan for team/production

**Time**: ~1 hour setup + DNS propagation

---

## Files Affected

**Dynamic Route Files** (will need changes):
- `site/src/app/icon.tsx`
- `site/src/app/apple-icon.tsx`
- `site/src/app/opengraph-image.tsx`
- `site/src/app/twitter-image.tsx`

**Metadata File** (will need updates):
- `site/src/app/layout.tsx` (change image URLs to static files)

**Web Manifest** (will need updates):
- `site/public/site.webmanifest` (change icon URLs)

---

## Recommended Action Plan

**For Next Session**:

1. **Decide on solution** (recommend Option 1 for production-ready approach, or Option 2 for quick deploy)

2. **If Option 1 (Build-Time Generation)**:
   - Create `scripts/generate-images.js`
   - Use Puppeteer headless browser or node-canvas
   - Replicate current design (gradient S logo, OG image layout)
   - Generate all 4 image sizes
   - Update package.json scripts
   - Update layout.tsx metadata
   - Delete dynamic route files
   - Test build and export
   - Verify images in `out/` directory

3. **If Option 2 (Manual)**:
   - Create PNGs in Figma using current design specs
   - Export optimized PNGs
   - Save to `public/`
   - Update layout.tsx
   - Delete dynamic routes
   - Test build

4. **Verify Fix**:
   ```bash
   npm run build
   ls -lh out/*.png  # Should show favicon, apple-touch-icon, og-image, twitter-image
   open out/index.html  # Check metadata references
   ```

---

## Design Specifications (for manual creation)

### Favicon (32×32)
- Gradient background: `linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)`
- White "S" text: 20px, font-weight 700, system-ui
- Border radius: 20%

### Apple Touch Icon (180×180)
- Same gradient background
- White "S" text: 100px, font-weight 700
- No border radius (Apple adds it)

### OG Image (1200×630)
- Dark background: `linear-gradient(135deg, #0a0f1a 0%, #1a1f2e 100%)`
- Logo: 140×140 gradient box with "S" (80px)
- Brand: "Stigmer" (72px, white, bold)
- Tagline: "Agents as Microservices" (42px, #94a3b8)
- Value prop: "Build agents in YAML or Go. Deploy once. Call from everywhere via gRPC." (28px, #cbd5e1)
- Badges: "Open Source", "gRPC APIs", "YAML + SDK" (20px, colored borders)

---

## Success Criteria

Fix is complete when:
- [ ] Static PNG files exist in `out/` after build
- [ ] Favicon loads on local static server (no 404)
- [ ] OG image URL in HTML points to static file
- [ ] Social media validators show correct preview
- [ ] Build completes with no dynamic image routes
- [ ] Total image file size <500KB (all 4 images combined)

---

## Current Workaround

**For Testing**: Deploy current build to see content/metadata, but know that:
- Favicons will 404 (users see default browser icon)
- Social shares will show broken images
- Professional appearance will be compromised

**This is acceptable for internal testing but NOT for production launch.**

---

## References

- **Changelog**: `_changelog/2026-02/2026-02-03-brand-assets-phase-4-2.md`
- **Phase Plan**: `tasks/T03_0_brand_assets_plan.md`
- **Next.js Static Export Docs**: https://nextjs.org/docs/app/building-your-application/deploying/static-exports

---

**Priority**: CRITICAL  
**Blocking**: Production deployment to GitHub Pages  
**Estimated Fix Time**: 30 minutes (Option 2) or 1-2 hours (Option 1)
