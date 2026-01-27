---
name: typescript-patterns
description: TypeScript best practices and patterns. Use when editing .ts or .tsx files, reviewing TypeScript code, or asking about TypeScript conventions.
---

# TypeScript Patterns

Comprehensive TypeScript best practices for this project.

## When to Use This Skill

- Editing TypeScript files (`*.ts`, `*.tsx`)
- Code review for TypeScript changes
- Questions about TypeScript conventions
- Refactoring TypeScript code

## Naming Conventions

| Element | Style | Example |
|---------|-------|---------|
| **Files** | kebab-case | `app-state.ts`, `theme-switcher.ts` |
| **Test files** | kebab-case with `.test` | `app-state.test.ts` |
| Variables/Functions | camelCase | `calculateTotal`, `userName` |
| Types/Interfaces | PascalCase | `UserProfile`, `ThemeConfig` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Private properties | camelCase (no `_` prefix) | `private value` |

### File Naming

Use **kebab-case** for all TypeScript files:

```typescript
// ✅ Correct - kebab-case
app-state.ts
theme-switcher.ts
contribution-graph-countdown.ts

// ❌ Avoid
appState.ts          // camelCase
AppState.ts          // PascalCase
app_state.ts         // snake_case
```

**Why kebab-case?**
- Case-insensitive filesystem safe (macOS, Windows)
- URL/path friendly
- Consistent with HTML/CSS conventions

## Type System

### Prefer Interfaces Over Type Aliases for Objects

```typescript
// ✅ Prefer interfaces for object shapes
interface User {
  id: string;
  name: string;
}

// ⚠️ Use type aliases for unions, intersections, primitives
type Status = 'active' | 'inactive';
type ID = string | number;
```

### Use `const` and `let`, Never `var`

```typescript
const immutableValue = 42;  // Use for values that don't change
let mutableValue = 0;       // Use when reassignment is needed
// Never use var
```

### Use Type Inference When Obvious

```typescript
// ❌ Redundant type annotation
const name: string = 'example';

// ✅ Let TypeScript infer obvious types
const name = 'example';

// ✅ Add types for complex or non-obvious cases
const config: ThemeConfig = await loadConfig();
```

### Use `unknown` Over `any`

```typescript
// ❌ Avoid any - disables type checking
function process(data: any) { ... }

// ✅ Use unknown for truly unknown types
function process(data: unknown) {
  if (typeof data === 'string') {
    // Now TypeScript knows it's a string
  }
}
```

## DRY Principles

### Extract Magic Numbers to Named Constants

```typescript
// ❌ Magic numbers obscure intent
if (secondsRemaining <= 10) return 50;

// ✅ Named constants explain purpose
const FINAL_COUNTDOWN_TICK_INTERVAL_MS = 50;
const FINAL_COUNTDOWN_THRESHOLD_SECONDS = 10;

if (secondsRemaining <= FINAL_COUNTDOWN_THRESHOLD_SECONDS) {
  return FINAL_COUNTDOWN_TICK_INTERVAL_MS;
}
```

### Create Generic Utility Functions

```typescript
// ❌ Repeated pattern
function getUserById(id: string) { return users.find(u => u.id === id); }
function getProductById(id: string) { return products.find(p => p.id === id); }

// ✅ Generic function
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find(item => item.id === id);
}
```

### Single Responsibility Functions

Keep functions focused - split functions exceeding ~50 lines:

```typescript
// ❌ Function doing too much
function processUser(user: User) {
  // validate, transform, save, notify, log
}

// ✅ Break into focused functions
function validateUser(user: User): ValidationResult { ... }
function transformUser(user: User): TransformedUser { ... }
function saveUser(user: TransformedUser): Promise<void> { ... }
```

## Function Patterns

### Entry Point Recipe Pattern

Public interface methods should read as high-level recipes:

```typescript
// ✅ CORRECT: Entry point reads like a recipe
onCelebrating(options?: CelebrationOptions): void {
  const signal = prepareCelebration(state);
  
  if (shouldEnableAnimations(state.getAnimationState)) {
    executeAnimatedCelebration(state, message, signal);
  } else {
    showCompletionMessageWithAmbient(state, message);
  }
}

// ❌ WRONG: Implementation details in entry point
onCelebrating(options?: CelebrationOptions): void {
  if (this.abortController) this.abortController.abort();
  this.abortController = new AbortController();
  // ... 30 more lines of implementation
}
```

### Use Object Destructuring for Multiple Parameters

```typescript
// ❌ Many positional parameters
function createUser(name: string, age: number, email: string, role: string) { ... }

// ✅ Options object with destructuring
interface CreateUserOptions {
  name: string;
  age: number;
  email?: string;
  role?: string;
}
function createUser({ name, age, email = '', role = 'user' }: CreateUserOptions) { ... }
```

## Error Handling

### Throw Error Objects, Not Strings

```typescript
// ❌ Strings don't include stack traces
throw 'Something went wrong';

// ✅ Use Error objects
throw new Error('Something went wrong');

// ✅ Use custom errors for specific cases
class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```

### Use Strict Equality

```typescript
// ❌ Loose equality causes unexpected coercion
if (value == null) { ... }

// ✅ Use strict equality
if (value === null || value === undefined) { ... }

// Exception: == null checks both null and undefined
if (value == null) { ... }  // OK for null/undefined check
```

## Exports

### Use Named Exports

```typescript
// ❌ Default exports make refactoring harder
export default class UserService { ... }

// ✅ Named exports are more refactor-friendly
export class UserService { ... }
export function createUser() { ... }
export const USER_ROLES = ['admin', 'user'] as const;
```

## Code Organization

### Module Organization

**Entry points (`index.ts`) should export only, not implement:**

```typescript
// ✅ Clean entry point - exports only
export { MyFeatureConfig } from './config';
export { createMyFeature } from './feature';
export { myFeatureUtils } from './utils';

// ❌ Implementation in entry point - hard to test
export function createMyFeature() {
  // 100+ lines of implementation...
}
```

### Import Order

1. External packages
2. Internal aliases (`@/`, `@core/`, `@themes/`)
3. Relative imports

```typescript
import { describe, it, expect } from 'vitest';
import type { ThemeController } from '@core/types';
import { createEmptyHandles } from '@themes/shared';
import { helperFunction } from './utils';
```

### Prefer Path Aliases

```typescript
// ❌ Deep relative paths
import { something } from '../../../core/utils/time';

// ✅ Use path aliases
import { something } from '@core/time';
```

## State Ownership: Orchestrator vs Component

**Orchestrator owns lifecycle state. Components own rendering state.**

```typescript
// ❌ Anti-pattern: Component mirrors orchestrator state
interface ComponentState {
  isAnimating: boolean;      // == orchestrator 'celebrating'
}

// ✅ Correct: Component has its own LOCAL rendering state
type AnimationPhase = 'idle' | 'animating' | 'complete';

interface ComponentState {
  animationPhase: AnimationPhase; // LOCAL rendering concern
}
```

## Validation After Code Changes (REQUIRED)

```bash
# Quick validation (minimum)
npx tsc --noEmit && npm run lint

# Full validation
npx tsc --noEmit && npm run lint && npm run test && npm run build
```

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Using `any` type | Disables type checking | Use `unknown` with type guards |
| Using `var` | Hoisting issues | Use `const` or `let` |
| Default exports | Harder to refactor | Use named exports |
| Magic numbers | Obscures intent | Extract to named constants |
| Non-null assertion (`!`) | Runtime error risk | Guard with conditionals |
| Type assertion without check | Bypasses type safety | Validate with type guards |
| Mutating function params | Unexpected side effects | Return new values |
| Deep relative imports | Fragile paths | Use path aliases |
| Implementation in index.ts | Hard to test | Move to dedicated files |

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [TSDoc](https://tsdoc.org/)
