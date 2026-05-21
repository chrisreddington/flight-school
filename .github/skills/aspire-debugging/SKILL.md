---
name: aspire-debugging
description: Debug Flight School with Aspire Dashboard telemetry and Aspire MCP tools.
---

# Aspire debugging workflow

Use this skill when diagnosing runtime issues in Flight School API routes, GitHub API calls, or Copilot SDK sessions.

## Steps

1. Start the dashboard:

```bash
npm run dashboard
```

2. Start the app:

```bash
npm run dev
```

3. Start Aspire MCP in dashboard mode:

```bash
npm run aspire:mcp
```

4. Use Aspire telemetry tools:
- `list_resources` for service health
- `list_structured_logs` for error diagnostics
- `list_traces` for request timelines
- `list_trace_structured_logs` for trace-level logs

## Notes

- `dashboard` uses `--allow-anonymous`, so run it on local trusted machines only.
- Prefer trace inspection when debugging Copilot SDK latency (`sendAndWait`, streaming first token, tool calls).
- Prefer structured logs when validating GitHub API failures and rate-limit headers.
