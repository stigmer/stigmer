---
name: Phase 7 Accessibility
overview: Implement WCAG 2.1 AA-compliant accessibility enhancements for the Stigmer website, including skip links, screen reader utilities, focus management, ARIA live regions, and comprehensive auditing.
todos:
  - id: sr-only-utils
    content: Add screen reader utility classes (.sr-only, .sr-only-focusable) to globals.css
    status: completed
  - id: skip-link
    content: Create SkipLink component and integrate into HomePage with main-content target
    status: completed
  - id: focus-return
    content: Implement focus return to trigger button when MobileMenu closes
    status: completed
  - id: aria-live
    content: Add ARIA live region for copy-to-clipboard feedback in CodeBlock
    status: completed
  - id: focus-indicators
    content: Enhance focus-visible styles on nav links in Header
    status: completed
  - id: a11y-audit
    content: Run Lighthouse accessibility audit and fix any issues (target >= 95)
    status: completed
isProject: false
---

# Phase 7: Accessibility - Production-Grade Implementation

## Current State Assessment

The Stigmer website has a **strong accessibility foundation** established in previous phases:

**Already Implemented:**

- Reduced motion support (CSS `@media (prefers-reduced-motion)` + Framer Motion `useReducedMotion`)
- Global focus-visible styles with proper outline
- ARIA attributes on Header, MobileMenu, and all sections
- Focus trap and keyboard navigation in MobileMenu
- Semantic HTML landmarks (`<header>`, `<nav>`, `<main>`, `<section>`, `<footer>`)
- Language attribute on `<html>`

**Gaps to Address:**


| Gap                   | Impact                                     | Priority |
| --------------------- | ------------------------------------------ | -------- |
| Skip link             | Keyboard users must tab through navigation | High     |
| Screen reader utility | Cannot hide visual-only content            | High     |
| Focus return          | Focus lost when MobileMenu closes          | High     |
| ARIA live regions     | Copy feedback not announced                | Medium   |
| Nav link focus states | Focus indicators not visible enough        | Medium   |
| Color contrast audit  | Must verify WCAG AA compliance             | Medium   |


---

## Implementation Details

### 1. Screen Reader Utility Class

Add `.sr-only` utility to [site/src/app/globals.css](site/src/app/globals.css):

```css
/* Screen reader only - visually hidden but accessible */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* Make sr-only visible on focus (for skip links) */
.sr-only-focusable:focus,
.sr-only-focusable:focus-within {
  position: static;
  width: auto;
  height: auto;
  padding: inherit;
  margin: inherit;
  overflow: visible;
  clip: auto;
  white-space: normal;
}
```

---

### 2. Skip Link Component

Create [site/src/components/ui/skip-link.tsx](site/src/components/ui/skip-link.tsx):

```typescript
/**
 * Skip link for keyboard navigation accessibility.
 * Allows users to bypass navigation and jump directly to main content.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={cn(
        "sr-only focus:not-sr-only",
        "fixed top-4 left-4 z-[100]",
        "px-4 py-2 rounded-md",
        "bg-primary text-primary-foreground font-medium",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      )}
    >
      Skip to main content
    </a>
  );
}
```

Integrate in [site/src/components/pages/HomePage.tsx](site/src/components/pages/HomePage.tsx):

- Add `<SkipLink />` as first child
- Add `id="main-content"` to `<main>` element

---

### 3. Focus Return Management

Update [site/src/components/layout/MobileMenu.tsx](site/src/components/layout/MobileMenu.tsx) to return focus to trigger button when menu closes:

**Current**: Focus moves to close button when opening, but is lost when closing.

**Solution**: Track the element that triggered the menu and restore focus on close.

```typescript
// In Header.tsx - pass trigger ref to MobileMenu
const triggerRef = React.useRef<HTMLButtonElement>(null);

<MobileMenu
  isOpen={mobileMenuOpen}
  onClose={() => setMobileMenuOpen(false)}
  triggerRef={triggerRef}
/>

// In MobileMenu.tsx - restore focus on close
React.useEffect(() => {
  if (!isOpen && triggerRef?.current) {
    triggerRef.current.focus();
  }
}, [isOpen, triggerRef]);
```

---

### 4. ARIA Live Regions for Dynamic Content

Update [site/src/components/sections/Quickstart.tsx](site/src/components/sections/Quickstart.tsx) `CodeBlock` component:

```typescript
function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);
  
  return (
    <div className="relative group ...">
      {/* Announce copy status to screen readers */}
      <div 
        role="status" 
        aria-live="polite" 
        aria-atomic="true" 
        className="sr-only"
      >
        {copied && "Code copied to clipboard"}
      </div>
      
      {/* ... existing code ... */}
    </div>
  );
}
```

---

### 5. Enhanced Focus Indicators

Update nav link focus states in [site/src/components/layout/Header.tsx](site/src/components/layout/Header.tsx):

```typescript
const baseClasses = cn(
  // ... existing classes ...
  // Add explicit focus-visible styles
  "focus-visible:outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  "rounded-sm" // For focus ring border radius
);
```

---

### 6. Color Contrast Verification

**Manual Audit Checklist:**

- Primary text (#f8fafc) on background (#0a0f1a): Ratio ~16:1 (passes AAA)
- Muted foreground on background: Verify >= 4.5:1 ratio
- Link colors: Verify >= 4.5:1 ratio
- Button text contrast: Verify for all variants

**Automated Check**: Run Lighthouse accessibility audit in Chrome DevTools.

---

## File Changes Summary


| File                                          | Action | Changes                                        |
| --------------------------------------------- | ------ | ---------------------------------------------- |
| `site/src/app/globals.css`                    | Modify | Add `.sr-only`, `.sr-only-focusable` utilities |
| `site/src/components/ui/skip-link.tsx`        | Create | Skip link component                            |
| `site/src/components/pages/HomePage.tsx`      | Modify | Add SkipLink, add `id="main-content"`          |
| `site/src/components/layout/Header.tsx`       | Modify | Add trigger ref, enhanced focus states         |
| `site/src/components/layout/MobileMenu.tsx`   | Modify | Add focus return on close                      |
| `site/src/components/sections/Quickstart.tsx` | Modify | Add ARIA live region for copy feedback         |


---

## Quality Gates

Before Phase 7 is complete:

1. **Keyboard Navigation Test**
  - Tab through entire page without mouse
  - Skip link appears on first Tab press
  - Skip link jumps to main content
  - All interactive elements reachable
  - Focus visible on all elements
2. **Screen Reader Test** (VoiceOver on macOS)
  - All content announced properly
  - Skip link announced
  - Copy feedback announced
  - No "animation-only" content missing announcements
3. **Reduced Motion Test**
  - Enable "Reduce motion" in System Preferences
  - Verify all animations disabled
  - Page fully functional without animations
4. **Lighthouse Audit**
  - Accessibility score >= 95
  - No critical accessibility issues
5. **WCAG 2.1 AA Compliance**
  - Color contrast ratios meet 4.5:1 for normal text
  - Focus indicators visible (3:1 contrast)
  - All interactive elements keyboard accessible

---

## Definition of Done

- Skip link functional and visually hidden until focused
- Screen reader utilities available (`.sr-only`)
- Focus returns to trigger when MobileMenu closes
- Copy-to-clipboard announces status to screen readers
- All nav links have visible focus indicators
- Lighthouse accessibility >= 95
- Zero critical accessibility issues
- Changelog entry created
- `next-task.md` updated with Phase 7 completion

