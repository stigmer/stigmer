# Task T03: Phase 4.2 - Brand Assets Excellence

**Status**: PLAN  
**Created**: 2026-02-03  
**Phase**: 4.2 - Brand Assets  
**Priority**: CRITICAL - Foundation for global platform presence

---

## Executive Summary

Phase 4.2 transforms our visual identity from placeholder to world-class. This is NOT about "adding a favicon"—this is about creating a cohesive brand system that works flawlessly across every device, browser, platform, and social network where Stigmer will be discovered.

**Quality Standard**: Every asset must be:
- ✅ Technically perfect (formats, sizes, optimization)
- ✅ Visually consistent (color, spacing, typography)
- ✅ Accessible (contrast, alt text, semantic HTML)
- ✅ Performant (optimized file sizes, lazy loading)
- ✅ Future-proof (responsive, scalable, maintainable)

**Scope**: 5 critical deliverables that establish Stigmer's visual foundation for years to come.

---

## Current State Analysis

### ✅ Assets We Have
- `/site/public/logo.svg` - Official Stigmer logo (136KB - NEEDS AUDIT)
- `StigmerLogo.tsx` component with size variants (sm/md/lg)
- Brand colors defined in `globals.css` (primary blue #3b82f6, accent purple #8b5cf6)
- Clean typography (Geist Sans + Geist Mono)

### ❌ Critical Gaps Identified
1. **Favicon System**: No favicon.ico, no icon.tsx, no multi-size support
2. **Social Media**: No Open Graph image, no Twitter cards
3. **Mobile Icons**: No apple-touch-icon.png, no PWA manifest icons
4. **Metadata**: Outdated (still references old Phase 3 messaging)
5. **Logo Optimization**: 136KB SVG needs analysis and potential optimization
6. **Dark Mode**: No verification that logo works in light/dark contexts

### 🚨 Technical Debt from Phase 3
The `layout.tsx` metadata is outdated and doesn't reflect Phase 4.1's "Agents as Microservices" positioning:

**OLD (Phase 3)**:
```
title: "Stigmer — AI-Powered Workflow Automation"
description: "Build, run, and scale AI-powered workflows..."
```

**SHOULD BE (Phase 4.1)**:
```
title: "Stigmer — Agents as Microservices"  
description: "Build agents in YAML or Go SDKs. Deploy once. Call from everywhere via gRPC..."
```

This creates **brand inconsistency** between the page content (Phase 4.1) and metadata (Phase 3). Every social share, Google result, and browser tab is showing the wrong message.

---

## Phase 4.2 Deliverables

### Deliverable 1: Favicon System 🎯
**Purpose**: Perfect favicon across all browsers, devices, and contexts.

**Technical Requirements**:
1. **Dynamic Favicon Generation** (`icon.tsx`)
   - Use Next.js 15 App Router icon convention
   - Generate from logo.svg programmatically
   - Support multiple sizes: 16×16, 32×32, 96×96, 192×192
   - Optimize for both light and dark browser themes
   - Return proper ImageResponse with correct MIME types

2. **Fallback Icons** (static files)
   - `/public/favicon.ico` - 32×32 ICO format for legacy browsers
   - `/public/apple-touch-icon.png` - 180×180 PNG for iOS
   - `/public/icon-192.png` - 192×192 for Android/Chrome
   - `/public/icon-512.png` - 512×512 for high-DPI displays

3. **Web App Manifest** (`site.webmanifest`)
   - JSON manifest with icons array
   - Support for installable PWA (future-proofing)
   - Proper theme colors matching brand
   - Short name and full name

**Quality Gates**:
- ✅ Test in Chrome, Safari, Firefox, Edge
- ✅ Test on iOS Safari, Android Chrome
- ✅ Verify in dark mode and light mode
- ✅ Check DevTools for no 404s or warnings
- ✅ Validate file sizes (<10KB per icon)
- ✅ Confirm sharp rendering at all sizes

---

### Deliverable 2: Open Graph & Social Media 🎯
**Purpose**: Stunning social shares on Twitter, LinkedIn, Slack, Discord.

**Technical Requirements**:
1. **OG Image Generation** (`opengraph-image.tsx`)
   - Dynamic 1200×630 OG image using Next.js ImageResponse
   - Stigmer logo prominently displayed
   - "Agents as Microservices" headline
   - Gradient background matching brand (blue → purple)
   - Clean, professional design (not cluttered)
   - Readable on mobile previews (large text)

2. **Twitter Card Support**
   - Same 1200×630 image (summary_large_image format)
   - Optimized for Twitter's preview cropping
   - Test with Twitter Card Validator

3. **Updated Metadata** (`layout.tsx`)
   - Sync ALL metadata with Phase 4.1 messaging
   - Use constants from `SITE_CONFIG` (single source of truth)
   - Proper structured data (JSON-LD for rich results)
   - Canonical URLs for SEO

**Content Requirements** (from `SITE_CONFIG`):
```typescript
title: "Stigmer — Agents as Microservices"
tagline: "Agents as Microservices"
description: "Build agents in YAML or Go SDKs. Deploy once. Call from everywhere via gRPC. Update agents independently—all consumers benefit instantly. Stigmer handles sandboxing, orchestration, and MCP connections."
```

**Quality Gates**:
- ✅ Preview in Twitter Card Validator
- ✅ Preview in LinkedIn Post Inspector
- ✅ Preview in Facebook Sharing Debugger
- ✅ Test actual shares in Slack, Discord
- ✅ Verify image loads quickly (<200KB)
- ✅ Confirm text is readable at thumbnail size
- ✅ Check metadata with Google Rich Results Test

---

### Deliverable 3: Logo Audit & Optimization 🎯
**Purpose**: Ensure logo.svg is production-ready and performant.

**Analysis Required**:
1. **File Size Audit**
   - Current: 136KB (suspiciously large for SVG)
   - Expected: <10KB for clean vector logo
   - Action: Analyze SVG markup, remove unnecessary data
   - Tools: SVGO optimization, manual review

2. **Visual Quality Check**
   - Test at 16px (favicon size) - is it recognizable?
   - Test at 40px (header size) - is it crisp?
   - Test at 96px (hero size) - is it sharp?
   - Test in dark mode - does it have sufficient contrast?
   - Test in light mode - would it work if we add light theme later?

3. **Accessibility Audit**
   - Does SVG have proper title/desc elements?
   - Is there fallback for screen readers?
   - Does it meet WCAG 2.1 AA contrast requirements?
   - Are colors distinguishable for colorblind users?

**Optimization Actions**:
- Remove metadata, comments, editor-specific data
- Simplify paths if possible (without quality loss)
- Ensure viewBox is properly set
- Compress with SVGO (--multipass for max optimization)
- Consider creating PNG fallbacks for very old browsers

**Quality Gates**:
- ✅ File size <10KB (or justify why larger)
- ✅ Renders perfectly at all tested sizes
- ✅ Works in light and dark modes
- ✅ Passes WCAG AA contrast checks
- ✅ No console errors/warnings when loaded
- ✅ Loads in <50ms (imperceptible)

---

### Deliverable 4: Comprehensive Metadata Overhaul 🎯
**Purpose**: Every meta tag tells the Phase 4.1 story accurately.

**Scope**: Complete rewrite of `layout.tsx` metadata to match Phase 4.1.

**Changes Required**:

1. **Page Title** (Browser Tab)
   ```diff
   - default: "Stigmer — AI-Powered Workflow Automation"
   + default: "Stigmer — Agents as Microservices"
   ```

2. **Meta Description** (Google Results, Social Shares)
   ```diff
   - "Build, run, and scale AI-powered workflows with Stigmer..."
   + "Build agents in YAML or Go SDKs. Deploy once. Call from everywhere via gRPC. Update agents independently—all consumers benefit instantly. Stigmer handles sandboxing, orchestration, and MCP connections."
   ```

3. **Keywords** (SEO Signals)
   ```diff
   - ["AI workflows", "workflow automation", "LLM orchestration"]
   + ["AI agents", "microservices", "gRPC", "agent platform", "YAML agents", "Go SDK", "agent orchestration", "MCP", "open source agents"]
   ```

4. **Open Graph**
   - Update all OG tags to Phase 4.1 messaging
   - Add og:image pointing to generated OG image
   - Ensure og:url is absolute (https://stigmer.ai)
   - Add og:type = "website"

5. **Twitter Card**
   - Update to summary_large_image
   - Sync title/description with OG
   - Point to same image as OG

6. **Structured Data** (NEW)
   - Add JSON-LD for Organization
   - Add JSON-LD for SoftwareApplication
   - Include sameAs links (GitHub)
   - Proper license info (Apache 2.0)

**Quality Gates**:
- ✅ No hardcoded strings (all from SITE_CONFIG)
- ✅ Passes Google Rich Results Test
- ✅ No duplicate meta tags
- ✅ All URLs are absolute (not relative)
- ✅ Validates against Open Graph protocol
- ✅ Meta description 150-160 characters (SEO best practice)
- ✅ Title <60 characters (fits in Google results)

---

### Deliverable 5: Visual Testing & QA 🎯
**Purpose**: Zero visual regressions. Pixel-perfect everywhere.

**Test Matrix**:

| Context | Device | Browser | Size | Dark Mode | Test |
|---------|--------|---------|------|-----------|------|
| Desktop | Mac | Chrome | 1920×1080 | ✅ | Logo, Favicon |
| Desktop | Mac | Safari | 1920×1080 | ✅ | Logo, Favicon |
| Desktop | Mac | Firefox | 1920×1080 | ✅ | Logo, Favicon |
| Mobile | iPhone | Safari | 390×844 | ✅ | Logo, Touch Icon |
| Mobile | Android | Chrome | 412×915 | ✅ | Logo, Favicon |
| Tablet | iPad | Safari | 1024×768 | ✅ | Logo |
| Social | Twitter | Preview | 1200×630 | N/A | OG Image |
| Social | LinkedIn | Preview | 1200×630 | N/A | OG Image |
| Social | Slack | Unfurl | 1200×630 | N/A | OG Image |

**Manual Checks**:
1. **Favicon Rendering**
   - Open site in browser
   - Check tab for favicon
   - Bookmark page, check bookmark bar icon
   - Switch to dark mode, verify favicon adapts

2. **Logo Consistency**
   - Compare logo in Header vs Hero vs Footer
   - Verify sizes match design intent
   - Check spacing/padding around logo
   - Test hover states (if applicable)

3. **Mobile Touch Icons**
   - iOS: Add to Home Screen, check icon
   - Android: Add to Home Screen, check icon
   - Verify icon isn't stretched/pixelated

4. **Social Previews**
   - Share https://stigmer.ai on Twitter (use Card Validator first)
   - Share on LinkedIn (use Post Inspector first)
   - Share in Slack channel (check unfurl)
   - Verify image loads, text is correct

**Automated Checks**:
- Lighthouse audit (Performance, Accessibility, Best Practices, SEO)
- Next.js build warnings (check for image optimization warnings)
- Console errors (none should appear)
- Network tab (verify all assets load with 200 status)

**Quality Gates**:
- ✅ Lighthouse scores: 95+ on all metrics
- ✅ Zero console errors or warnings
- ✅ All images return 200 (no 404s)
- ✅ Favicon visible in all tested browsers
- ✅ OG image previews correctly in all social validators
- ✅ Touch icons look crisp on actual mobile devices
- ✅ Logo legible at smallest size (16px)

---

## Implementation Plan

### Phase A: Logo Analysis & Optimization (30 min)
**Goal**: Ensure logo.svg is production-ready.

**Steps**:
1. ✅ Analyze current logo.svg (size, structure, embedded data)
2. ✅ Identify optimization opportunities (SVGO, path simplification)
3. ✅ Test rendering at critical sizes (16px, 40px, 96px)
4. ✅ Verify dark mode compatibility
5. ✅ Optimize if needed (target <10KB)
6. ✅ Document any decisions (if we keep it large, explain why)

**Validation**:
- Logo renders perfectly at all sizes
- File size is optimized (or justified)
- Dark mode works flawlessly

---

### Phase B: Favicon System (45 min)
**Goal**: Complete favicon coverage across all platforms.

**Steps**:
1. ✅ Create `icon.tsx` for dynamic favicon generation
   - Multiple sizes (16, 32, 96, 192)
   - Use ImageResponse API
   - Optimize for dark/light modes
2. ✅ Generate static fallbacks
   - favicon.ico (32×32)
   - apple-touch-icon.png (180×180)
   - icon-192.png, icon-512.png
3. ✅ Create `site.webmanifest`
   - Icons array with all sizes
   - Theme colors from brand palette
   - Proper metadata
4. ✅ Update `layout.tsx` icons configuration
   - Point to icon.tsx (primary)
   - Fallback to favicon.ico
   - Apple touch icon reference

**Validation**:
- Test in Chrome, Safari, Firefox, Edge
- Test on iOS and Android
- Verify dark mode switching
- Check DevTools Network tab (no 404s)
- Confirm file sizes are reasonable

---

### Phase C: Open Graph Images (45 min)
**Goal**: Stunning social media previews.

**Steps**:
1. ✅ Create `opengraph-image.tsx`
   - 1200×630 canvas
   - Stigmer logo (optimized version)
   - "Agents as Microservices" headline
   - Brand gradient background
   - Clean, professional design
2. ✅ Test with social validators
   - Twitter Card Validator
   - LinkedIn Post Inspector
   - Facebook Sharing Debugger
3. ✅ Optimize image size
   - Target <200KB
   - Balance quality vs file size
4. ✅ Create twitter-image.tsx (if different from OG)
   - Or reuse same image

**Validation**:
- Image previews correctly in all validators
- Text is readable at thumbnail size
- Image loads quickly (<200KB)
- Design matches Stigmer brand

---

### Phase D: Metadata Overhaul (30 min)
**Goal**: Every meta tag reflects Phase 4.1 messaging.

**Steps**:
1. ✅ Update `layout.tsx` metadata
   - Import SITE_CONFIG for single source of truth
   - Rewrite title, description, keywords
   - Update Open Graph tags
   - Update Twitter Card tags
2. ✅ Add structured data (JSON-LD)
   - Organization schema
   - SoftwareApplication schema
   - sameAs links
3. ✅ Verify all URLs are absolute
4. ✅ Ensure no hardcoded strings

**Validation**:
- Google Rich Results Test passes
- Open Graph Validator passes
- Twitter Card Validator passes
- All metadata uses SITE_CONFIG

---

### Phase E: Visual QA & Testing (45 min)
**Goal**: Pixel-perfect everywhere.

**Steps**:
1. ✅ Desktop browser testing
   - Chrome, Safari, Firefox, Edge
   - Check favicon, logo, layout
   - Test dark mode
2. ✅ Mobile device testing
   - iOS Safari (real device or simulator)
   - Android Chrome (real device or emulator)
   - Check touch icons
3. ✅ Social preview testing
   - Share URL in Twitter Card Validator
   - Share URL in LinkedIn Post Inspector
   - Share in Slack (real channel)
4. ✅ Lighthouse audit
   - Run on deployed site
   - Target 95+ on all metrics
5. ✅ Manual QA checklist
   - Logo legible at all sizes
   - Favicon visible in all contexts
   - No console errors
   - All assets load with 200 status

**Validation**:
- All tests pass
- No visual regressions
- Lighthouse scores 95+
- Zero console errors

---

### Phase F: Documentation & Changelog (20 min)
**Goal**: Document what we built and why.

**Steps**:
1. ✅ Create comprehensive changelog entry
   - List all assets created
   - Explain metadata changes
   - Document logo optimization decisions
   - Include before/after comparisons
2. ✅ Update project README if needed
   - Note brand assets are production-ready
3. ✅ Document any future work identified
   - Light mode logo variant (if needed)
   - Additional OG images for specific pages (docs, features)
   - PWA enhancements (if pursuing)

**Validation**:
- Changelog is thorough and accurate
- Future work is clearly documented

---

## Success Criteria

Phase 4.2 is complete when ALL of the following are true:

### Technical Excellence ✅
- [ ] Favicon system works in Chrome, Safari, Firefox, Edge, iOS, Android
- [ ] Logo.svg is optimized and <10KB (or justified if larger)
- [ ] OG image generates dynamically and previews correctly
- [ ] All metadata reflects Phase 4.1 messaging
- [ ] Zero console errors or warnings
- [ ] Zero 404s for any asset
- [ ] Lighthouse scores 95+ on all metrics
- [ ] Build completes with no warnings

### Visual Excellence ✅
- [ ] Logo is legible at 16px (smallest size)
- [ ] Logo is crisp at all sizes (16px to 96px)
- [ ] Favicon is recognizable in browser tabs
- [ ] Touch icons look professional on mobile home screens
- [ ] OG image is stunning in social previews
- [ ] Dark mode works flawlessly

### Brand Consistency ✅
- [ ] All metadata uses SITE_CONFIG (single source of truth)
- [ ] Title, tagline, description match Phase 4.1 everywhere
- [ ] Keywords reflect "Agents as Microservices" positioning
- [ ] Social previews tell the correct story
- [ ] No Phase 3 messaging remains anywhere

### Performance ✅
- [ ] Logo.svg loads in <50ms
- [ ] Favicon loads instantly (cached)
- [ ] OG image is <200KB
- [ ] All touch icons are optimized
- [ ] No layout shift on logo load (Next.js Image)

### Future-Proof ✅
- [ ] System scales to light mode (if we add later)
- [ ] PWA-ready (manifest in place)
- [ ] Supports high-DPI displays (2x, 3x)
- [ ] Accessible (WCAG AA compliance)
- [ ] Maintainable (no hardcoded values)

---

## Risk Assessment

### 🔴 High Risk: Logo File Size
**Issue**: Current logo.svg is 136KB (very large for vector).  
**Impact**: Slow page loads, poor Core Web Vitals.  
**Mitigation**: 
- Analyze SVG markup carefully
- Optimize with SVGO (aggressive settings)
- If optimization fails, explain why size is necessary
- Consider creating simplified version for small sizes

### 🟡 Medium Risk: Social Image Rendering
**Issue**: Dynamic OG images can be tricky (fonts, layout, caching).  
**Impact**: Broken previews in social shares = poor first impression.  
**Mitigation**:
- Test thoroughly with actual validators
- Use simple design (logo + headline + gradient)
- Verify caching behavior
- Have static fallback if dynamic fails

### 🟢 Low Risk: Browser Compatibility
**Issue**: Favicon formats vary across browsers/devices.  
**Impact**: Missing icons in some contexts (unprofessional).  
**Mitigation**:
- Provide multiple formats (ICO, PNG, SVG via icon.tsx)
- Test on all major browsers and devices
- Follow Next.js best practices (well-documented)

---

## Quality Checklist

Before marking Phase 4.2 complete, verify EVERY item:

### Assets Created
- [ ] `src/app/icon.tsx` - Dynamic favicon generator
- [ ] `src/app/opengraph-image.tsx` - OG image generator
- [ ] `src/app/twitter-image.tsx` - Twitter card (or reuse OG)
- [ ] `public/favicon.ico` - 32×32 ICO for legacy browsers
- [ ] `public/apple-touch-icon.png` - 180×180 PNG for iOS
- [ ] `public/icon-192.png` - 192×192 for Android
- [ ] `public/icon-512.png` - 512×512 for high-DPI
- [ ] `public/site.webmanifest` - PWA manifest with icons
- [ ] `public/logo.svg` - Optimized (or original if justified)

### Code Changes
- [ ] `layout.tsx` - Metadata completely rewritten for Phase 4.1
- [ ] `layout.tsx` - All strings from SITE_CONFIG (no hardcoding)
- [ ] `layout.tsx` - Structured data (JSON-LD) added
- [ ] `constants.ts` - No changes needed (already has correct values)

### Testing Completed
- [ ] Chrome desktop (favicon, logo, dark mode)
- [ ] Safari desktop (favicon, logo, dark mode)
- [ ] Firefox desktop (favicon, logo, dark mode)
- [ ] Edge desktop (favicon, logo, dark mode)
- [ ] iOS Safari (touch icon, logo, rendering)
- [ ] Android Chrome (touch icon, logo, rendering)
- [ ] Twitter Card Validator (OG image preview)
- [ ] LinkedIn Post Inspector (OG image preview)
- [ ] Facebook Sharing Debugger (OG image preview)
- [ ] Slack unfurl (actual test in channel)
- [ ] Lighthouse audit (95+ on all metrics)
- [ ] DevTools console (zero errors/warnings)
- [ ] DevTools Network (all assets 200 status)

### Documentation
- [ ] Changelog entry created
- [ ] Logo optimization decisions documented
- [ ] Any future work identified and documented
- [ ] This plan moved to `_completed/` with status updated

---

## Appendix: Technical References

### Next.js Icon Convention
- File: `app/icon.tsx` or `app/icon.png`
- Export: `ImageResponse` or static file
- Sizes: Multiple via route params or static files
- Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons

### Open Graph Image
- File: `app/opengraph-image.tsx`
- Size: 1200×630 (recommended by all platforms)
- Format: PNG or JPEG (PNG for better quality)
- Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image

### Web App Manifest
- File: `public/site.webmanifest`
- Format: JSON
- Fields: name, short_name, icons[], theme_color, background_color
- Docs: https://developer.mozilla.org/en-US/docs/Web/Manifest

### SVGO Optimization
- Tool: https://github.com/svg/svgo
- Command: `npx svgo --multipass input.svg -o output.svg`
- Flags: `--multipass` for aggressive optimization
- Caution: Always verify visual output after optimization

### Social Validators
- Twitter: https://cards-dev.twitter.com/validator
- LinkedIn: https://www.linkedin.com/post-inspector/
- Facebook: https://developers.facebook.com/tools/debug/
- Google Rich Results: https://search.google.com/test/rich-results

---

## Execution Mindset

This is NOT "add some icons and move on."

This is establishing the **visual foundation** of Stigmer for the next 5-10 years. Every developer who googles "agent platform," every VC who shares our link on Twitter, every engineer who bookmarks our site—they will see these assets FIRST.

**We get ONE chance to make a first impression.**

Let's make it world-class.

---

**Next**: After approval, execute Phases A-F sequentially with full quality validation at each step.
