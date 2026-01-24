---
description: Run accessibility audit on target component
agent: Specialist - Accessibility
argument-hint: File or component path (e.g., src/components/world-map.ts)
---

# Accessibility Audit

## Context

Use this prompt to audit a component or file for accessibility compliance. The audit covers semantic HTML, keyboard navigation, screen reader compatibility, color contrast, and motion preferences.

## Task

Audit `${input:targetPath:Enter file or component path (e.g., src/components/world-map.ts)}` for accessibility issues:

1. **Semantic Structure**: Verify proper heading hierarchy, landmarks, and element roles
2. **Keyboard Navigation**: Check focus order, focus visibility, and keyboard operability
3. **Screen Reader**: Validate accessible names, live regions, and ARIA usage
4. **Color & Contrast**: Ensure 4.5:1 text contrast, 3:1 UI component contrast
5. **Motion**: Confirm `prefers-reduced-motion` is respected for animations

## Expected Output

| Issue | Criterion | Severity | Location | Recommended Fix |
|-------|----------------|----------|----------|-----------------|
| {description} | {e.g., 2.4.7} | Critical/Major/Minor | {line or element} | {code fix} |

Summary with pass/fail status and priority order for fixes.
