---
applyTo: "**/*.{ts,tsx}"
description: Consistent iconography for core concepts across the application
---

# Iconography Standards

Guidelines for consistent icon usage across Flight School's core concepts.

## Core Concept Icons

**Use these canonical icons for each concept throughout the application:**

| Concept | Icon | Usage Context |
|---------|------|---------------|
| **Skills** | `MortarBoardIcon` | Profile navigation, skill pages, learning context |
| **Habits** | `FlameIcon` | Habit tracking, streaks, consistency features |
| **Challenges** | `CodeIcon` | Coding challenges, sandbox, practice exercises |
| **Goals** | `CheckIcon` | Daily goals, achievements, milestones |
| **Learning Topics** | `BookIcon` | Topics to explore, concepts, best practices |
| **Chat Threads** | `CopilotIcon` | AI chat, learning conversations, assistant |
| **Workspaces** | `RepoIcon` | File management, repositories, code context |

## Icon Import Pattern

```typescript
import {
  MortarBoardIcon,  // Skills
  FlameIcon,        // Habits
  CodeIcon,         // Challenges
  CheckIcon,        // Goals
  BookIcon,         // Learning Topics
  CopilotIcon,      // Chat Threads
  RepoIcon,         // Workspaces
} from '@primer/octicons-react';
```

## Subtheme Icons

These secondary icons complement core concepts but don't represent primary types:

| Context | Icon | Usage |
|---------|------|-------|
| **Difficulty** | `FlameIcon` | Challenge/topic difficulty badges |
| **Tips/Advice** | `LightBulbIcon` | Pro tips, hints, suggestions |
| **Status: Success** | `CheckCircleIcon` | Completion status, success states |
| **Status: Skipped** | `SkipIcon` | Skipped items, dismissed content |
| **Brand: App Logo** | `RocketIcon` | Flight School branding, app identity |
| **History/Timeline** | `HistoryIcon` | Past activity, learning history |

## Anti-Patterns

| ❌ Avoid | ✅ Use Instead | Reason |
|---------|---------------|--------|
| `FlameIcon` for Challenges | `CodeIcon` | Flame is for Habits (streaks) |
| `RocketIcon` for Goals | `CheckIcon` | Rocket is app branding |
| `RocketIcon` for Habits | `FlameIcon` | Habits are about consistency (fire/streak) |
| `CheckCircleIcon` for Goals | `CheckIcon` | CheckCircle is for success status |
| `ZapIcon` for type indicators | Core concept icon | Zap is for "Daily Focus" section branding |
| Multiple icons for same concept | Single canonical icon | Consistency aids recognition |

## Usage Examples

### Correct Usage

```tsx
// ✅ Challenge tab with correct icon
<UnderlinePanels.Tab>
  <CodeIcon size={16} /> Challenge
</UnderlinePanels.Tab>

// ✅ Goal card with correct icon
<Label size="small" variant="accent">
  <CheckIcon size={12} /> Goal
</Label>

// ✅ Habits section with correct icon
<Heading as="h3">
  <FlameIcon size={20} /> Active Habits
</Heading>

// ✅ Success status (completed item)
<Label variant="success">
  <CheckCircleIcon size={12} /> Completed
</Label>
```

### Incorrect Usage

```tsx
// ❌ Wrong icon for Challenge
<UnderlinePanels.Tab>
  <FlameIcon size={16} /> Challenge  {/* Should be CodeIcon */}
</UnderlinePanels.Tab>

// ❌ Wrong icon for Goal
<button className={styles.filterBtn}>
  <RocketIcon size={12} /> Goals  {/* Should be CheckIcon */}
</button>

// ❌ Wrong icon for Goal label
<Label size="small" variant="accent">
  <CheckCircleIcon size={12} /> Goal  {/* Should be CheckIcon */}
</Label>
```

## Size Guidelines

Use consistent sizes for icon contexts:

| Context | Size | Example |
|---------|------|---------|
| **Section headers** | `20px` | Page titles, major sections |
| **Tab navigation** | `16px` | UnderlinePanels tabs |
| **Labels/badges** | `12px` | Small inline labels |
| **Buttons** | `14-16px` | Filter buttons, action buttons |
| **Cards** | `14px` | Card type indicators |

## Special Cases

### Difficulty Badges
Difficulty uses `FlameIcon` regardless of the item type:
```tsx
<DifficultyBadge difficulty="advanced" showIcon /> {/* Uses FlameIcon */}
```

### App Branding
Flight School logo uses `RocketIcon`:
```tsx
<Link href="/" className={styles.logoLink}>
  <RocketIcon size={28} />
  <Heading>Flight School</Heading>
</Link>
```

### Success vs Goals
- **Goals** (the item type): Use `CheckIcon`
- **Success status** (completed state): Use `CheckCircleIcon`

```tsx
// ✅ Goal type indicator
<Label><CheckIcon size={12} /> Goal</Label>

// ✅ Success status indicator
<Label variant="success"><CheckCircleIcon size={12} /> Completed</Label>
```

---

## Validation Checklist

Before committing icon changes:
- [ ] Core concept uses canonical icon from table above
- [ ] No duplicate icon meanings (same icon for different concepts)
- [ ] Size is appropriate for context
- [ ] Icon import is from `@primer/octicons-react`
- [ ] Consistent with existing usage in same component

## References

- [Primer Octicons](https://primer.style/foundations/icons) - Icon library documentation
- [primer-react.instructions.md](.github/instructions/primer-react.instructions.md) - Primer React usage
