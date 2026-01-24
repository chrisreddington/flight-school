---
description: Create or update GitHub Actions workflow
agent: Specialist - GitHub Actions
argument-hint: Workflow purpose (e.g., run tests on PR)
---

# Create/Update GitHub Actions Workflow

## Context

Use this prompt to create new or update existing GitHub Actions workflows. Follows security best practices including minimal permissions and SHA pinning.

## Task

`${input:action:Enter 'create' or 'update'}` workflow for: `${input:purpose:Describe the workflow purpose (e.g., 'run tests on PR', 'deploy to staging')}`

1. **Gather Requirements**:
   - Trigger events (push, PR, schedule, workflow_dispatch)
   - Required secrets and permissions
   - Target branches and environments

2. **Review Existing Patterns**:
   - Check `.github/workflows/` for established conventions
   - Reference `copilot-instructions.md` for project commands

3. **Apply Security Best Practices**:
   - Minimal `permissions` block
   - SHA-pinned action versions
   - No hardcoded secrets
   - Explicit environment declarations

4. **Create/Update Workflow**:
   - Write to `.github/workflows/{name}.yml`
   - Validate YAML syntax

## Expected Output

Workflow file at `.github/workflows/{name}.yml` with:
- Proper trigger configuration
- Security-compliant permissions
- SHA-pinned dependencies
- Clear job and step names
