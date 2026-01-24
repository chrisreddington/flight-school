---
description: Comprehensive tech debt analysis and prioritization
agent: Specialist - Code Quality
---

# Analyze Tech Debt

## Context

Comprehensive technical debt analysis using automated tools to identify unused code, circular dependencies, and maintenance burden.

## Task

Run all tech debt detection tools and provide actionable prioritization:

### 1. Run Automated Tools

```bash
npm run debt:check
```

This executes:
- **knip**: Unused files, exports, dependencies, types
- **ts-prune**: Unused TypeScript exports
- **depcheck**: Unused npm dependencies
- **madge**: Circular dependencies

### 2. Analyze Results

For each tool's output:

**Unused Code (knip, ts-prune)**:
- Filter test utilities, mock data, build configs (false positives)
- Identify truly unused code vs intentionally exported APIs
- Flag large files (>200 LOC) as higher priority

**Unused Dependencies (depcheck)**:
- Ignore dev-only deps that may not be detected (e.g., eslint configs)
- Check if deps are used in build scripts or config files
- Flag deps >1MB or with security vulnerabilities

**Circular Dependencies (madge)**:
- Map circular chains (A → B → C → A)
- Identify the "weakest link" to break (least coupled)
- Suggest refactor pattern: extract interface, dependency injection, or event-based

### 3. Prioritize

| Priority | Criteria | Action |
|----------|----------|--------|
| **P0** | Circular deps causing build issues | Fix immediately |
| **P1** | Unused files >200 LOC, unused deps >1MB | Remove in next sprint |
| **P2** | Unused exports, small unused files | Cleanup when touching nearby code |
| **P3** | Intentionally public APIs, test utilities | Document or add `@public` tag |

### 4. Create Action Plan

For each P0/P1 item:
1. **Item**: {file or dependency}
2. **Category**: {unused-file | unused-export | unused-dep | circular}
3. **Impact**: {size, build time, security risk}
4. **Effort**: {trivial | small | medium | large}
5. **Action**: {delete | refactor | extract | document}

## Expected Output

### Summary Stats
```
Tech Debt Analysis
==================
Unused files: N (X KB)
Unused exports: N
Unused dependencies: N (X MB)
Circular dependencies: N cycles

Estimated cleanup value: X KB code, Y MB deps
```

### Priority Matrix

| Priority | Count | Total Impact | Next Steps |
|----------|-------|--------------|------------|
| P0 | N | {size/risk} | Fix now |
| P1 | N | {size/risk} | Schedule for sprint |
| P2 | N | {size/risk} | Cleanup when convenient |

### Action Items

```markdown
## P0: Critical (Fix Now)
- [ ] Break circular dependency: src/moduleA ↔ src/moduleB
  - Effort: Medium
  - Impact: Blocks tree-shaking
  - Approach: Extract shared interface to src/interfaces/

## P1: High Priority (Next Sprint)
- [ ] Remove unused file: src/lib/legacy/old-api.ts (347 LOC)
  - Last modified: 6 months ago
  - No imports found
  - Action: Delete file, remove from index

- [ ] Remove unused dependency: unused-large-lib (2.3 MB)
  - Not imported anywhere
  - Last used: v0.2.0
  - Action: npm uninstall unused-large-lib

## P2: Medium Priority (Opportunistic Cleanup)
- [ ] Remove N unused exports in src/utils/
- [ ] Clean up N unused type definitions
```

### False Positives (Document)

List any findings that are intentional:
- Test utilities exported for reuse
- Public APIs not yet consumed
- Build-time only dependencies

## Automation

For CI/CD integration:
```yaml
# .github/workflows/tech-debt.yml
- name: Check tech debt
  run: npm run debt:check
  continue-on-error: true  # Don't fail builds, just report
```

Consider weekly automated reports or PR comments for visibility.
