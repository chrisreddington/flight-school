---
applyTo: "**/*.{ts,tsx}"
description: TypeScript best practices for clean, maintainable, DRY code
---

# TypeScript Best Practices

Guidelines for writing clean, maintainable TypeScript code.

## Rules and Guidelines

### Naming Conventions

| Element | Style | Example |
|---------|-------|---------|
| **Files** | kebab-case | `app-state.ts`, `theme-switcher.ts` |
| **Test files** | kebab-case with `.test` suffix | `app-state.test.ts` |
| Variables/Functions | camelCase | `calculateTotal`, `userName` |
| Types/Interfaces | PascalCase | `UserProfile`, `ThemeConfig` |
| Constants | UPPER_SNAKE_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Private properties | camelCase (no `_` prefix) | `private value` |

#### File Naming

Use **kebab-case** for all TypeScript files:

```typescript
// ✅ Correct - kebab-case
app-state.ts
theme-switcher.ts
contribution-graph-countdown.ts
query-params.test.ts

// ❌ Avoid - other conventions
appState.ts          // camelCase
AppState.ts          // PascalCase
app_state.ts         // snake_case
```

**Why kebab-case?**
- Recommended by Angular (largest TypeScript framework)
- Case-insensitive filesystem safe (macOS, Windows)
- URL/path friendly
- Consistent with HTML/CSS naming conventions

Choose descriptive names - avoid single-letter variables except in trivial loops:

```typescript
// ❌ Avoid
const d = new Date();
const s = squares.find(x => x.id === id);

// ✅ Prefer
const currentDate = new Date();
const targetSquare = squares.find(square => square.id === targetId);
```

### Type System

#### Prefer Interfaces Over Type Aliases for Objects

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

#### Use `const` and `let`, Never `var`

```typescript
const immutableValue = 42;  // Use for values that don't change
let mutableValue = 0;       // Use when reassignment is needed
// Never use var
```

#### Use Type Inference When Obvious

```typescript
// ❌ Redundant type annotation
const name: string = 'example';
const items: string[] = ['a', 'b', 'c'];

// ✅ Let TypeScript infer obvious types
const name = 'example';
const items = ['a', 'b', 'c'];

// ✅ Add types for complex or non-obvious cases
const config: ThemeConfig = await loadConfig();
```

#### Use `unknown` Over `any`

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

### DRY Principles

#### Extract Magic Numbers to Named Constants

```typescript
// ❌ Magic numbers obscure intent
if (secondsRemaining <= 10) return 50;

// ✅ Named constants explain purpose
/** Tick interval in ms during final countdown seconds */
const FINAL_COUNTDOWN_TICK_INTERVAL_MS = 50;
const FINAL_COUNTDOWN_THRESHOLD_SECONDS = 10;

if (secondsRemaining <= FINAL_COUNTDOWN_THRESHOLD_SECONDS) {
  return FINAL_COUNTDOWN_TICK_INTERVAL_MS;
}
```

#### Create Generic Utility Functions

```typescript
// ❌ Repeated pattern
function getUserById(id: string) { return users.find(u => u.id === id); }
function getProductById(id: string) { return products.find(p => p.id === id); }

// ✅ Generic function
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find(item => item.id === id);
}
```

#### Single Responsibility Functions

Keep functions focused - split functions exceeding ~50 lines:

```typescript
// ❌ Function doing too much
function processUser(user: User) {
  // validate
  // transform
  // save
  // notify
  // log
}

// ✅ Break into focused functions
function validateUser(user: User): ValidationResult { ... }
function transformUser(user: User): TransformedUser { ... }
function saveUser(user: TransformedUser): Promise<void> { ... }
```

### Function Patterns

#### Entry Point Recipe Pattern

Public interface methods should read as high-level recipes, with semantic function names that reveal intent:

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

// ✅ CORRECT: Mount reads as setup sequence
mount(container: HTMLElement, context?: MountContext): void {
  setupRendererMount(state, container, context);
  startCountdownAmbient(state);
}

// ❌ WRONG: Implementation details in entry point
onCelebrating(options?: CelebrationOptions): void {
  if (this.abortController) this.abortController.abort();
  this.abortController = new AbortController();
  this.loopState.isActivityRunning = false;
  clearTimeout(this.loopState.activityTimeoutId);
  // ... 30 more lines of implementation
}
```

**Benefits:**
- Entry points are scannable and reveal intent
- Implementation details are encapsulated in focused functions
- Easier to test individual operations
- Changes to implementation don't affect entry point readability

#### Use Arrow Functions for Callbacks

```typescript
// ✅ Arrow functions for callbacks
items.map(item => item.value);
items.filter(item => item.active);

// ✅ Function declarations for named exports
export function calculateTotal(items: Item[]): number { ... }
```

#### Prefer Optional Parameters Over Unions with Undefined

```typescript
// ❌ Verbose
function greet(name: string | undefined) { ... }

// ✅ Use optional parameter
function greet(name?: string) { ... }
```

#### Use Object Destructuring for Multiple Parameters

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

### Error Handling

#### Throw Error Objects, Not Strings

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

#### Use Strict Equality

```typescript
// ❌ Loose equality causes unexpected coercion
if (value == null) { ... }
if (status == 'active') { ... }

// ✅ Use strict equality
if (value === null || value === undefined) { ... }
if (status === 'active') { ... }

// Exception: == null checks both null and undefined
if (value == null) { ... }  // OK for null/undefined check
```

### Exports

#### Use Named Exports

```typescript
// ❌ Default exports make refactoring harder
export default class UserService { ... }

// ✅ Named exports are more refactor-friendly
export class UserService { ... }
export function createUser() { ... }
export const USER_ROLES = ['admin', 'user'] as const;
```

#### Export Only What's Needed

```typescript
// ✅ Keep internal helpers private
function helperFunction() { ... }

// ✅ Only export the public API
export function publicFunction() {
  return helperFunction();
}
```

### Comments and Documentation

> **📌 SINGLE SOURCE OF TRUTH**: See [documentation.instructions.md](.github/instructions/documentation.instructions.md) for all TSDoc and inline comment standards including right-sizing rules, tag requirements, and comment prefixes.

### State Ownership: Orchestrator vs Component

When building components that receive lifecycle callbacks from an orchestrator (e.g., themes, UI managers):

**Orchestrator owns lifecycle state. Components own rendering state.**

```typescript
// ❌ Anti-pattern: Component mirrors orchestrator state
interface ComponentState {
  isAnimating: boolean;      // == orchestrator 'celebrating'
  isPostCelebration: boolean; // == orchestrator 'celebrated'
}

// ✅ Correct: Component has its own LOCAL rendering state
type AnimationPhase = 'idle' | 'animating' | 'complete';

interface ComponentState {
  animationPhase: AnimationPhase; // LOCAL rendering concern
}

// Orchestrator callback tells component WHEN to animate
onCelebrating(): void {
  this.state.animationPhase = 'animating';
  startAnimation();
}
```

**Key distinction**:
- Lifecycle = WHEN (orchestrator's job)
- Animation = HOW (component's job)

### Code Organization

#### Module Organization

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

**Co-locate tests with source files:**

> **📌 TEST FILE ORGANIZATION**: See [testing.instructions.md](testing.instructions.md) for the complete test organization guide including the hybrid E2E pattern.

```
// ✅ Tests alongside source
feature/
├── feature.ts
├── feature.test.ts
├── utils.ts
└── utils.test.ts

// ❌ Tests in separate folder
feature/
├── feature.ts
└── utils.ts
__tests__/
├── feature.test.ts
└── utils.test.ts
```

**Group related functionality in folders:**

```
// ✅ Organized by feature
src/
├── countdown/
│   ├── index.ts           # exports only
│   ├── countdown.ts
│   ├── countdown.test.ts
│   └── utils/
│       └── time-format.ts
├── timer/
│   ├── index.ts
│   └── timer.ts

// ❌ Flat structure
src/
├── countdown.ts
├── countdown-utils.ts
├── countdown-helpers.ts
├── timer.ts
├── timer-utils.ts
```

#### Import Order

1. External packages
2. Internal aliases (`@/`, `@core/`, `@themes/`)
3. Relative imports

```typescript
import { describe, it, expect } from 'vitest';
import type { ThemeController } from '@core/types';
import { createEmptyHandles } from '@themes/shared';
import { helperFunction } from './utils';
```

#### Prefer Path Aliases

```typescript
// ❌ Deep relative paths
import { something } from '../../../core/utils/time';

// ✅ Use path aliases
import { something } from '@core/time';
```

### Anti-Patterns to Avoid

```typescript
// ❌ Type assertions without validation
const data = response as UserData;

// ✅ Validate before asserting
if (isUserData(response)) {
  const data = response;
}

// ❌ Non-null assertion without explanation
element!.textContent = 'value';

// ✅ Guard or explain
const element = container.querySelector('.target');
if (!element) throw new Error('Required element not found');
element.textContent = 'value';

// ❌ Modifying function parameters
function process(items: Item[]) {
  items.push(newItem);  // Mutates input!
}

// ✅ Return new values
function process(items: Item[]): Item[] {
  return [...items, newItem];
}
```

### Scientific/Mathematical Code

When implementing formulas from physics, astronomy, or geometry:

- **Document formulas and units** - Include formula derivation and unit types (degrees/radians)
- **Distinguish similar quantities** - Use names with units suffix (`altitudeRad`, `latDeg`)
- **Convert units explicitly** - `latDeg = latRad * (180 / Math.PI)`
- **Document sign conventions** - Geographic code often has sign pitfalls (antipode flips sign)

See [testing.instructions.md](.github/instructions/testing.instructions.md) for testing scientific code.

---

## Examples

### Descriptive Naming

```typescript
// ✅ Self-documenting variable names
const currentDate = new Date();
const targetSquare = squares.find(square => square.id === targetId);
```

### Named Constants

```typescript
// ✅ Magic numbers extracted to named constants
const FINAL_COUNTDOWN_TICK_INTERVAL_MS = 50;
if (secondsRemaining <= 10) return FINAL_COUNTDOWN_TICK_INTERVAL_MS;
```

### Generic Utility Function

```typescript
// ✅ Reusable function instead of duplicated code
function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find(item => item.id === id);
}
```

---

## Validation After Code Changes (REQUIRED)

After making code changes, **ALWAYS** run validation before considering work complete:

```bash
# Quick validation (minimum)
npx tsc --noEmit && npm run lint

# Full validation (without E2E tests if there are no UI changes)
npx tsc --noEmit && npm run lint && npm run test && npm run build

# Full validation with E2E tests for UI changes
npx tsc --noEmit && npm run lint && npm run test && npm run build && npm run test:e2e
```

### When to Run E2E Tests
- **UI changes**: Run `npm run test:e2e` for affected spec file
- **Theme changes**: Run `npm run test:e2e -- --grep "theme"`
- **Countdown logic**: Run `npm run test:e2e -- --grep "countdown"`

### Validation Workflow
1. **After edit**: Run `npx tsc --noEmit` (catches type errors immediately)
2. **Before commit**: Run full validation suite
3. **On failure**: Fix issue, re-run validation
4. **Max 2 self-fix attempts**: Then escalate or ask for help

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Using `any` type | Disables type checking; hides bugs | Use `unknown` with type guards |
| Using `var` | Hoisting issues; unexpected scope | Use `const` or `let` |
| Default exports | Harder to refactor; inconsistent imports | Use named exports |
| Magic numbers | Obscures intent; hard to maintain | Extract to named constants |
| Non-null assertion (`!`) | Runtime error if assumption wrong | Guard with conditionals or throw |
| Type assertion without check | Bypasses type safety | Validate with type guards first |
| Mutating function params | Unexpected side effects; hard to debug | Return new values |
| Deep relative imports | Fragile paths; hard to refactor | Use path aliases (`@core/`) |
| Single-letter variables | Unreadable; hard to search | Use descriptive names |
| Confusing similar quantities | Bugs in scientific/math code | Use names with units suffix |
| Skipping validation | Broken builds slip through | Run `npx tsc --noEmit` after every edit |
| Implementation in index.ts | Hard to test; violates SRP | Move to dedicated files, export from index |
| Tests separate from source | Hard to find; often forgotten | Co-locate `foo.test.ts` with `foo.ts` |
| Flat file structure | Hard to navigate; poor cohesion | Group related files in folders |
| Ignoring existing patterns | Inconsistent codebase | Match conventions of surrounding code |

---

## References

### Related Instructions
- [documentation.instructions.md](.github/instructions/documentation.instructions.md) - TSDoc and code documentation standards
- [testing.instructions.md](.github/instructions/testing.instructions.md) - Testing best practices
- [themes.instructions.md](.github/instructions/themes.instructions.md) - Theme development patterns
- [pwa.instructions.md](.github/instructions/pwa.instructions.md) - PWA development patterns
- [perf-analysis.instructions.md](.github/instructions/perf-analysis.instructions.md) - Performance guidelines

### External Documentation
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/) - Official TypeScript documentation
- [TSDoc](https://tsdoc.org/) - Documentation comment standard
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/) - Advanced TypeScript patterns
- [Angular Style Guide](https://angular.io/guide/styleguide) - File naming conventions
