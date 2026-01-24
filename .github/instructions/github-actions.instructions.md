---
applyTo: ".github/workflows/**/*.{yml,yaml}"
description: GitHub Actions workflow development patterns and security recommended practices
---

# GitHub Actions Workflow Development

Guidelines for GitHub Actions workflows in this Vite/TypeScript project.

## Rules and Guidelines

### Project Commands

| Command | Purpose |
|---------|---------|
| `npm ci` | Install dependencies (CI) |
| `npm run build` | Build with TypeScript + Vite |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | E2E tests - fast mode (chromium, excludes @perf) |
| `npm run test:e2e:full` | E2E tests - complete suite (all browsers, includes @perf) |
| `npm run lint` | ESLint checking |
| `npm run validate:scripts` | Type-check and lint build scripts |

### Security Best Practices

#### Minimal Permissions

```yaml
# ✅ Minimal at workflow level
permissions:
  contents: read

# Increase per-job only when needed
jobs:
  deploy:
    permissions:
      contents: read
      deployments: write
```

#### SHA Pinning (CRITICAL)

**Always pin third-party actions to full commit SHA:**

```yaml
# ✅ Pin to commit SHA - immutable and secure
- uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8  # v6.0.1
```

**Before submitting workflow changes:**
1. **Research Latest Releases**: Use web search to find the latest stable release for each action (e.g., `https://github.com/actions/checkout/releases`).
2. **Get Commit SHA**: Retrieve the full 40-character commit SHA for that specific release.
3. **Include Version Comment**: Always include the version tag as a comment (e.g., `# v4.2.2`).

#### Environment Consistency

**Prefer configuration files over hardcoded versions:**
- Use `.node-version` or `.nvmrc` for Node.js versions.
- Reference these files in the workflow to ensure consistency between local development and CI.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: '.node-version'
```

#### Script Injection Prevention

```yaml
# ✅ Safe - environment variable
- name: Check PR title
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: |
    if [[ "$TITLE" =~ ^feat ]]; then
      echo "Valid feature PR"
    fi

# ❌ Unsafe - direct interpolation
- run: |
    if [[ "${{ github.event.pull_request.title }}" =~ ^feat ]]; then
```

#### Secrets Handling

```yaml
# ✅ Reference secrets properly
env:
  API_KEY: ${{ secrets.API_KEY }}

# Mask generated sensitive values
- run: |
    TOKEN=$(generate-token)
    echo "::add-mask::$TOKEN"
    echo "TOKEN=$TOKEN" >> $GITHUB_ENV
```

### Basic CI Workflow

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8  # v6.0.1
      
      - uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f  # v6.1.0
        with:
          node-version-file: '.node-version'
          cache: 'npm'
      
      - run: npm ci
      - run: npm run validate:scripts
      - run: npm run test
      - run: npm run build
      - run: npm run lint
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

### Caching

Use setup-node's built-in caching:
```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: '.node-version'
    cache: 'npm'
```

### Conditional Execution

```yaml
# Run only on main
- run: npm run deploy
  if: github.ref == 'refs/heads/main'

# Continue on error
- run: npm run optional-step
  continue-on-error: true

# Run even if previous failed
- run: npm run cleanup
  if: always()
```

### Verification Checklist (MANDATORY)

Before finalizing any workflow changes:

1. **Verify Each Action's Commit SHA:**
   - Use `mcp_github_get_latest_release` or `web_fetch` to find each action's latest release matching the version tag
   - Use `mcp_github_get_commit` or `web_fetch` to retrieve the correct 40-character commit SHA for that specific release tag
   - **Do NOT assume** the SHA in comments or existing workflows is correct
   - **Do NOT skip verification** even if the SHA looks "valid" - always cross-reference with GitHub

2. **Validate Action Existence:**
   - After updating SHAs, confirm the action exists at that commit by checking the release information
   - If `mcp_github_get_commit` or `web_fetch` fails or returns 404, the SHA is invalid

3. **Test YAML Syntax:**
   - Use `get_errors` on the updated workflow file to ensure no syntax errors
   - Verify the workflow passes GitHub's YAML validation

### Before Making Changes

1. Check existing `.github/workflows/` for patterns
2. Check `.github/dependabot.yml` exists before suggesting dependency automation
3. Verify action versions via releases pages using GitHub MCP tools (see Verification Checklist)
4. Consider CI time and complexity tradeoffs

### Keeping Instructions Up-to-Date

**IMPORTANT**: When making changes to workflow files that introduce new patterns, commands, or security practices, update this instruction file to reflect those changes.

#### Update This File When:
- Adding new project build/test commands
- Introducing new action patterns or security practices
- Changing the project's build toolchain
- Adding new workflow features that should be standard practice

---

## Examples

### SHA-Pinned Action

```yaml
# ✅ Pinned to full commit SHA with version comment
- uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8  # v6.0.1
```

### Safe Environment Variable Usage

```yaml
# ✅ Safe - PR title passed via environment variable
- name: Check PR title
  env:
    TITLE: ${{ github.event.pull_request.title }}
  run: |
    if [[ "$TITLE" =~ ^feat ]]; then
      echo "Valid feature PR"
    fi
```

### Node Version from File

```yaml
# ✅ Consistent Node version between local and CI
- uses: actions/setup-node@395ad3262231945c25e8478fd5baf05154b1d79f  # v6.1.0
  with:
    node-version-file: '.node-version'
    cache: 'npm'
```

---

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Using version tags (`v4`) | Tags can be moved/deleted; supply chain risk | Pin to full 40-char commit SHA |
| Hardcoded Node versions | Drift between local and CI; maintenance burden | Use `.node-version` file reference |
| Direct string interpolation | Script injection vulnerability | Use environment variables |
| Workflow-level `write` perms | Excessive access if job compromised | Minimal perms at workflow, increase per-job |
| Assuming SHA validity | Outdated SHAs break workflows | Verify SHA against latest release |
| Missing SHA verification | Workflow may fail with 404 | Use GitHub MCP tools to validate |
| Skipping YAML validation | Syntax errors break CI | Run `get_errors` before committing |

---

## References

### Related Instructions
- [testing.instructions.md](.github/instructions/testing.instructions.md) - Test commands for CI
- [typescript.instructions.md](.github/instructions/typescript.instructions.md) - TypeScript build commands

### External Documentation
- [GitHub Actions Documentation](https://docs.github.com/en/actions) - Official Actions docs
- [Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) - Security best practices
- [Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions) - YAML syntax reference
- [actions/checkout](https://github.com/actions/checkout) - Checkout action releases
- [actions/setup-node](https://github.com/actions/setup-node) - Node setup action releases
