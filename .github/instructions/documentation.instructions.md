---
applyTo: "**/*.{ts,tsx}"
description: TSDoc and code documentation standards for TypeScript - SINGLE SOURCE OF TRUTH
---

# Documentation Standards

> **📌 SINGLE SOURCE OF TRUTH**: This file defines ALL TSDoc and inline comment standards for this project. Other instruction files and agents MUST reference this file rather than duplicating these rules.

Guidelines for TSDoc comments, inline documentation, and code documentation in TypeScript files.

## Rules and Guidelines

### Core Principle: Proportionality

**TSDoc length must be proportional to function complexity.** Documentation should illuminate, not overwhelm. A 20-line comment on a 4-line function is always wrong.

### Right-Sizing Rules (CRITICAL)

| Function Size | TSDoc Budget | Prose Limit | @example | @remarks |
|---------------|--------------|-------------|----------|----------|
| **≤10 LOC** | Summary + required tags only | ≤3 lines | Only if non-obvious | Rarely needed |
| **11-30 LOC** | Summary + all applicable tags | ≤6 lines | One concise example max | If complex logic |
| **>30 LOC** | Full documentation as needed | As needed | Include for public APIs | Yes, if explaining algorithm |

**Hard Rule:** TSDoc line count MUST NOT exceed function body line count.

### TSDoc Tags Reference

| Tag | When to Include | Skip When |
|-----|-----------------|-----------|
| `@param` | **Always** for all parameters | Parameter name is self-documenting AND ≤10 LOC function |
| `@returns` | Non-void functions | Return type is obvious (e.g., `getName(): string`) |
| `@throws` | Function can throw | Function never throws |
| `@example` | Complex or non-obvious APIs | Simple ≤10 LOC functions with obvious usage |
| `@see` | Related code/docs exist | No meaningful cross-references |
| `@remarks` | Complex logic, algorithms, edge cases | Simple functions; don't narrate obvious code |
| `@internal` | Private utilities exported for testing | Public API |
| `@public` | Theme developer APIs | Public API is obvious from context |
| `@deprecated` | Being phased out | Active code (always include migration path) |

### When to Use Lightweight Documentation

**Use single-line TSDoc or inline `//` comments for:**
- Private/internal helpers (not exported)
- Self-documenting code (`getUserById(id: string)` needs minimal docs)
- Simple getters/setters
- Obvious type aliases (`type UserId = string`)
- Utility functions under 10 LOC with clear names

```typescript
// ✅ CORRECT: Single-line TSDoc for simple function
/** Checks if profiling is enabled (requires __PROFILING__ and DEV mode). @internal */
export function isProfilingEnabled(flag?: boolean): boolean {
  return flag ?? (typeof __PROFILING__ !== 'undefined' && __PROFILING__);
}

// ✅ CORRECT: Inline comment for private helper
// NOTE: Returns null if element not found (caller must handle)
function findElement(id: string): HTMLElement | null {
  return document.getElementById(id);
}
```

### TSDoc Quality Checklist

Before submitting TSDoc, verify:
- [ ] **Proportional**: TSDoc lines ≤ function body lines
- [ ] **No duplication**: Don't restate what the code already says
- [ ] **Intent over mechanics**: Explain WHY, not WHAT
- [ ] **Accurate**: @param names match actual parameters
- [ ] **Examples compile**: Run `npx tsc --noEmit` to verify

### Right-Sizing: Before and After Example

```typescript
// ❌ WRONG: 13-line TSDoc for 5-line function (ratio inversion)
/**
 * Checks if profiling should be enabled.
 *
 * @remarks
 * Profiling is enabled when ALL conditions are met:
 * 1. `__PROFILING__` global is defined and true
 * 2. `import.meta.env.DEV` is true (development mode)
 *
 * @param profilingFlag - Override for __PROFILING__ (for testing)
 * @param devFlag - Override for import.meta.env.DEV (for testing)
 * @returns True if profiling should be enabled
 *
 * @internal Exported for testing the profiling gate logic
 */
export function isProfilingEnabled(profilingFlag?: boolean, devFlag?: boolean): boolean {
  const profiling = profilingFlag ?? (typeof __PROFILING__ !== 'undefined' && __PROFILING__ === true);
  const dev = devFlag ?? import.meta.env?.DEV === true;
  return profiling && dev;
}

// ✅ CORRECT: 1-line TSDoc for 5-line function (proportional)
/** Checks if profiling is enabled (requires __PROFILING__ and DEV mode). @internal */
export function isProfilingEnabled(profilingFlag?: boolean, devFlag?: boolean): boolean {
  const profiling = profilingFlag ?? (typeof __PROFILING__ !== 'undefined' && __PROFILING__ === true);
  const dev = devFlag ?? import.meta.env?.DEV === true;
  return profiling && dev;
}
```

### TSDoc Code Fences and Inline Tags

When documenting code examples or inline types in TSDoc comments:

```typescript
// ✅ Correct - code fence at start of line (after whitespace/asterisk only)
/**
 * Example usage:
 * ```typescript
 * const result = getValue();
 * ```
 */

// ✅ Better - escape braces that look like tags
/**
 * @example
 * ```typescript
 * const obj = \{ key: 'value' \};
 * ```
 */
```

**Key Rules:**
1. Code fence opening backticks must appear at line start (after `*` and whitespace)
2. Escape braces `{` and `}` with backslashes when they might be confused with TSDoc inline tags
3. Only use TSDoc tags defined in ESLint configuration
4. Prefer plain text documentation over complex TSDoc markup when appropriate

### Inline Comments Standards

**Principle:** Code tells you HOW, comments tell you WHY.

**Use Standard Prefixes:**

| Prefix | Use Case | Example |
|--------|----------|---------|
| `// PERF:` | Performance optimization rationale | `// PERF: O(1) lookup via pre-computed map` |
| `// NOTE:` | Important context or design decision | `// NOTE: Use max() for browser compat` |
| `// CRITICAL:` | Must not be removed/changed carelessly | `// CRITICAL: Stop loop before grid rebuild` |
| `// TODO:` | Incomplete work (prefer with issue ref) | `// TODO(#123): Add caching` |
| `// FIXME:` | Known bug or limitation | `// FIXME: Race condition on fast resize` |

**Style Rules:**
- Use multiple single-line comments (`//`), not block comments (`/* */`)
- Place comments BEFORE the code they describe, not after
- Reference accessibility criteria with descriptive explanations

### Comments to AVOID (Anti-Patterns)

```typescript
// ❌ Duplicates the code
i = i + 1;  // Add one to i

// ❌ Obvious comments on self-documenting code
const bestNode = findBestNode(nodes);  // Find the best node

// ❌ Comments after closing braces
} // end of function

// ❌ End-of-line comments (hard to maintain)
const total = subtotal * 1.08;  // Calculate total with tax

// ❌ Commented-out code (use version control)
// const oldImplementation = doSomething();
```

### Comments to ADD (Best Practices)

```typescript
// ✅ Explain non-obvious reasoning
// Binary search was slower than Boyer-Moore for our data sets

// ✅ Document edge cases and workarounds
// NOTE: JSONTokener.nextValue() may return a value equals() to null

// ✅ Reference external sources
// Formula related to human vision perception
// via https://stackoverflow.com/a/46018816/2219998

// ✅ Explain algorithm/formula derivations
// At equator solar noon: altitude = 90° - |declination|
const declination = sign * (90 - altitude);
```

---

## Examples

### Complete TSDoc Example

```typescript
/**
 * Calculates the remaining time until the target date.
 * 
 * @remarks
 * This is the canonical source for time calculations. All countdown logic
 * should use this function to ensure consistency across themes.
 * 
 * @param targetDate - The countdown target date
 * @param currentDate - Optional current date (defaults to now)
 * @returns Time remaining in days, hours, minutes, seconds, and total milliseconds
 * 
 * @example
 * ```typescript
 * const remaining = calculateTimeRemaining(new Date('2025-12-31'));
 * console.log(`${remaining.days} days remaining`);
 * ```
 * 
 * @throws {Error} If targetDate is invalid or in the past
 * @see {@link formatTimeRemaining} for display formatting
 * @public
 */
export function calculateTimeRemaining(
  targetDate: Date,
  currentDate?: Date
): TimeRemaining {
  // implementation
}
```

### Inline Comment Example

```typescript
// ✅ Explain WHY, not WHAT
// PERF: Using className assignment instead of classList avoids layout thrashing
element.className = 'active';

// CRITICAL: Guard against race condition during resize
if (state.isResizing) return;
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| **Ratio inversion** (doc > code) | Overwhelms code, hard to maintain | Apply right-sizing rules strictly |
| Missing `@param` tags | Unclear function signature | Document every parameter |
| Placeholder docs ("TODO", "TBD") | Incomplete documentation | Write complete descriptions |
| End-of-line comments | Hard to maintain | Place comments above code |
| Commented-out code | Clutters codebase | Use version control |
| Duplicate-the-code comments | Adds no value | Explain WHY, not WHAT |
| Missing `@throws` | Unexpected exceptions | Document all thrown errors |
| Stale `@param` names | Misleads developers | Keep in sync with actual signature |
| Narrating obvious code | Noise, wastes reader time | Focus on intent and edge cases |

---

## References

### Related Instructions
- [typescript.instructions.md](.github/instructions/typescript.instructions.md) - TypeScript coding standards

### External Documentation
- [TSDoc](https://tsdoc.org/) - Documentation comment standard
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/) - Official documentation
