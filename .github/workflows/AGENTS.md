# GitHub Actions Workflow Development

> Nested AGENTS.md for `.github/workflows/` directory. These rules override the root AGENTS.md when working with workflow files.

## Project Commands

| Command | Purpose |
|---------|---------|
| `npm ci` | Install dependencies (CI) |
| `npm run build` | Build with TypeScript + Vite |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | E2E tests - fast mode (chromium, excludes @perf) |
| `npm run test:e2e:full` | E2E tests - complete suite (all browsers) |
| `npm run lint` | ESLint checking |
| `npm run validate:scripts` | Type-check and lint build scripts |

## Security Best Practices

### Minimal Permissions

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

### SHA Pinning (CRITICAL)

**Always pin third-party actions to full commit SHA:**

```yaml
# ✅ Pin to commit SHA - immutable and secure
- uses: actions/checkout@8e8c483db84b4bee98b60c0593521ed34d9990e8  # v6.0.1
```

**Before submitting workflow changes:**
1. Research latest releases for each action
2. Get full 40-character commit SHA for that release
3. Include version tag as comment (e.g., `# v4.2.2`)

### Environment Consistency

Use configuration files over hardcoded versions:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: '.node-version'
    cache: 'npm'
```

### Script Injection Prevention

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

### Secrets Handling

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

## Basic CI Workflow Template

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

## Caching

Use setup-node's built-in caching:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version-file: '.node-version'
    cache: 'npm'
```

## Conditional Execution

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

## Verification Checklist

Before finalizing workflow changes:

1. **Verify each action's commit SHA** against latest release
2. **Validate action existence** at that commit
3. **Test YAML syntax** - ensure no errors

## Anti-Patterns

| Anti-Pattern | Why It's Problematic | Better Approach |
|--------------|---------------------|-----------------|
| Using version tags (`v4`) | Tags can be moved; supply chain risk | Pin to full commit SHA |
| Hardcoded Node versions | Drift between local and CI | Use `.node-version` file |
| Direct string interpolation | Script injection vulnerability | Use environment variables |
| Workflow-level `write` perms | Excessive access | Minimal perms, increase per-job |

## References

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Security Hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)
- [Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
