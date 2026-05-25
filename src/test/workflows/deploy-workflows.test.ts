import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract test for the three ACA deploy workflows
// (`.github/workflows/deploy-web.yml`,
//  `.github/workflows/deploy-worker.yml`,
//  `.github/workflows/deploy-infra.yml`).
//
// These workflows only run on `main` after CI succeeds, so a silent
// regression here would only surface in production deploys. This
// file pins the invariants the design depends on: trigger model,
// concurrency, permissions, gate logic, stale-deploy guards,
// image-tag handling, the CI ↔ CD coupling via display name, and
// the split of responsibility between image rollouts (web/worker
// workflows) and Bicep applies (infra workflow).

const REPO = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(REPO, relPath), 'utf8');
}

const webWf = read('.github/workflows/deploy-web.yml');
const workerWf = read('.github/workflows/deploy-worker.yml');
const infraWf = read('.github/workflows/deploy-infra.yml');
const ciWf = read('.github/workflows/ci.yml');

const appWorkflows: { name: 'web' | 'worker'; src: string }[] = [
  { name: 'web', src: webWf },
  { name: 'worker', src: workerWf },
];
const allWorkflows: { name: 'web' | 'worker' | 'infra'; src: string }[] = [
  ...appWorkflows,
  { name: 'infra', src: infraWf },
];

describe('deploy workflows — triggers, permissions, concurrency', () => {
  for (const { name, src } of allWorkflows) {
    it(`${name}: triggers on workflow_run after CI succeeds on main`, () => {
      expect(src).toMatch(/on:[\s\S]*workflow_run:[\s\S]*workflows:\s*\[CI\]/);
      expect(src).toMatch(/types:\s*\[completed\]/);
      expect(src).toMatch(/branches:\s*\[main\]/);
    });

    it(`${name}: requires explicit SHA input on workflow_dispatch`, () => {
      expect(src).toMatch(/workflow_dispatch:[\s\S]*inputs:[\s\S]*sha:[\s\S]*required:\s*true/);
    });

    it(`${name}: declares workflow-level permissions: contents: read`, () => {
      const wfLevel = src.match(/^permissions:\s*\n\s+([\s\S]*?)\n[a-z]/m);
      expect(wfLevel).not.toBeNull();
      expect(wfLevel![1].trim()).toBe('contents: read');
    });

    it(`${name}: shares the deploy-aca-<ref_name> concurrency group with cancel-in-progress: false`, () => {
      // The shared concurrency group serialises web/worker/infra
      // rollouts. Without it, an infra apply could read each app's
      // current image tag, then a parallel app rollout could change
      // the running image, and the infra apply would roll it back.
      expect(src).toMatch(/concurrency:[\s\S]*group:\s*deploy-aca-\$\{\{\s*github\.ref_name\s*\}\}/);
      expect(src).toMatch(/cancel-in-progress:\s*false/);
    });
  }
});

describe('deploy workflows — should-deploy gate', () => {
  for (const { name, src } of allWorkflows) {
    it(`${name}: should-deploy job has the declarative if: covering both event paths`, () => {
      for (const needle of [
        'workflow_run.conclusion',
        'workflow_run.event',
        'workflow_run.head_branch',
        'refs/heads/main',
        'workflow_dispatch',
      ]) {
        expect(src).toContain(needle);
      }
    });

    it(`${name}: Resolve deploy SHA emits a 40-hex value output`, () => {
      expect(src).toMatch(/echo "value=\$sha" >> "\$GITHUB_OUTPUT"/);
      expect(src).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    });

    it(`${name}: ancestry verify uses gh api /compare (not git merge-base)`, () => {
      expect(src).toMatch(/gh api "\/repos\/\$\{?GH_REPO\}?\/compare\//);
      const stripped = src.replace(/^\s*#[^\n]*$/gm, '');
      expect(stripped).not.toMatch(/git merge-base/);
    });

    it(`${name}: CI-green check queries by workflow file path, not display name`, () => {
      expect(src).toMatch(/actions\/workflows\/ci\.yml\/runs/);
      expect(src).not.toMatch(/select\(\.name\s*==\s*"CI"\)/);
    });

    it(`${name}: Refuse stale workflow_run step writes superseded= as a step output`, () => {
      expect(src).toMatch(/superseded=(?:true|false)[^\n]*>>\s*"\$GITHUB_OUTPUT"/);
      expect(src).not.toMatch(/superseded=[^\n]*>>\s*"\$GITHUB_ENV"/);
    });

    it(`${name}: filter-base step uses ci.yml runs, per_page=100, id-bound, and cat-file assert`, () => {
      expect(src).toMatch(/actions\/workflows\/ci\.yml\/runs\?[^"\n]*per_page=100/);
      expect(src).toMatch(/select\(\.id\s*<\s*\$CURRENT_RUN_ID\)/);
      expect(src).toMatch(/git cat-file -e/);
      expect(src).toMatch(/first_deploy=true/);
    });

    it(`${name}: checkout in should-deploy uses fetch-depth: 0`, () => {
      const shouldDeployBlock = src.match(/should-deploy:[\s\S]*?(?=\n  [a-z][a-z-]*:\s*\n)/m)?.[0] ?? '';
      expect(shouldDeployBlock).toMatch(/actions\/checkout@[0-9a-f]{40}[\s\S]*?fetch-depth:\s*0/);
    });

    it(`${name}: gate step considers superseded + first_deploy + filter hit + dispatch`, () => {
      expect(src).toMatch(/SUPERSEDED:[^\n]*\$\{\{\s*steps\./);
      expect(src).toMatch(/FIRST_DEPLOY:[^\n]*\$\{\{\s*steps\./);
      expect(src).toMatch(/FILTER_HIT:[^\n]*\$\{\{\s*steps\./);
    });
  }

  // FILTER_HIT must read its own workflow's filter output. A
  // copy-paste swap (web reading worker's output, or any other
  // mis-wiring) would leave the gate permanently empty so
  // workflow_run-triggered deploys never fire.
  it("web wf: gate's FILTER_HIT reads steps.filter.outputs.web", () => {
    expect(webWf).toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.web\s*\}\}/);
    expect(webWf).not.toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.(worker|infra)\s*\}\}/);
  });

  it("worker wf: gate's FILTER_HIT reads steps.filter.outputs.worker", () => {
    expect(workerWf).toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.worker\s*\}\}/);
    expect(workerWf).not.toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.(web|infra)\s*\}\}/);
  });

  it("infra wf: gate's FILTER_HIT reads steps.filter.outputs.infra", () => {
    expect(infraWf).toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.infra\s*\}\}/);
    expect(infraWf).not.toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.(web|worker)\s*\}\}/);
  });
});

describe('deploy workflows — deploy job permissions and stale guard', () => {
  for (const { name, src } of allWorkflows) {
    it(`${name}: deploy job declares id-token: write and contents: read`, () => {
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/permissions:[\s\S]*?contents:\s*read/);
      expect(deployBlock).toMatch(/id-token:\s*write/);
      // Job-level actions: read must NOT propagate to deploy.
      expect(deployBlock).not.toMatch(/actions:\s*read/);
    });

    it(`${name}: deploy job has a Refuse stale deploy step gated to workflow_run`, () => {
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/Refuse stale deploy[\s\S]*?if:\s*github\.event_name\s*==\s*'workflow_run'/);
      expect(deployBlock).toMatch(/branches\/main/);
      expect(deployBlock).toMatch(/exit 1/);
    });
  }
});

describe('app workflows — image-update rollout (no Bicep apply)', () => {
  for (const { name, src } of appWorkflows) {
    it(`${name}: rollout uses az containerapp update --image (image-based pattern)`, () => {
      expect(src).toMatch(/az containerapp update[\s\S]*?--image/);
    });

    it(`${name}: deploy job has no \`az deployment sub create\` call`, () => {
      // Bicep applies belong to deploy-infra.yml only. An app
      // workflow that runs `az deployment sub create` would defeat
      // the whole point of separating image rollouts from infra
      // reconciliation. Strip comments so a doc-only reference
      // doesn't false-fail.
      const stripped = src.replace(/^\s*#[^\n]*$/gm, '');
      expect(stripped).not.toMatch(/az deployment sub create/);
    });

    it(`${name}: deploy job does not pass webImageTag or workerImageTag (Bicep-only inputs)`, () => {
      const stripped = src.replace(/^\s*#[^\n]*$/gm, '');
      expect(stripped).not.toMatch(/webImageTag=/);
      expect(stripped).not.toMatch(/workerImageTag=/);
    });

    it(`${name}: deploy job verifies new revision health post-update`, () => {
      // `az containerapp update` returns 0 once ARM accepts the
      // request. Without a readiness poll, a failed revision keeps
      // the previous revision routed and the workflow reports
      // green — exactly the silent-fail mode we are guarding against.
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/properties\.latestRevisionName/);
      expect(deployBlock).toMatch(/provisioningState/);
      expect(deployBlock).toMatch(/runningState/);
      expect(deployBlock).toMatch(/Provisioned/);
      expect(deployBlock).toMatch(/Running/);
      expect(deployBlock).toMatch(/Failed\|Canceled/);
    });
  }

  it('web wf builds with -f Dockerfile and tags ${APP_NAME}', () => {
    expect(webWf).toMatch(/-f Dockerfile\b/);
    expect(webWf).toMatch(/IMAGE="\$\{ACR_LOGIN_SERVER\}\/\$\{APP_NAME\}:/);
    expect(webWf).not.toMatch(/-f Dockerfile\.worker/);
  });

  it('worker wf builds with -f Dockerfile.worker and tags ${APP_NAME}-worker', () => {
    expect(workerWf).toMatch(/-f Dockerfile\.worker/);
    expect(workerWf).toMatch(/IMAGE="\$\{ACR_LOGIN_SERVER\}\/\$\{APP_NAME\}-worker:/);
  });

  it('web wf targets Container App resource $APP_NAME', () => {
    expect(webWf).toMatch(/az containerapp update[\s\S]*?--name "\$APP_NAME"/);
  });

  it('worker wf targets Container App resource ${APP_NAME}-worker', () => {
    expect(workerWf).toMatch(/az containerapp update[\s\S]*?--name "\$\{APP_NAME\}-worker"/);
  });
});

describe('infra workflow — Bicep apply with live-state tag preservation', () => {
  it('runs az deployment sub create against infra/main.bicep', () => {
    expect(infraWf).toMatch(/az deployment sub create/);
    expect(infraWf).toMatch(/--template-file infra\/main\.bicep/);
  });

  it('passes the full Bicep parameter set (placeholder-validated + explicit overrides)', () => {
    expect(infraWf).toMatch(/--parameters @infra\/main\.parameters\.json/);
    for (const param of [
      'appName=',
      'resourceGroupName=',
      'acrLoginServer=',
      'location=',
      'webImageTag=',
      'workerImageTag=',
    ]) {
      expect(infraWf).toContain(param);
    }
  });

  it('validates infra/main.parameters.json before any Azure call', () => {
    // The validator must reject placeholder values AND the legacy
    // `imageTag` key — either indicates a stale rollback SHA from
    // before the web/worker tag split.
    expect(infraWf).toMatch(/Validate parameters\.json/);
    expect(infraWf).toMatch(/grep -iE '"<\[\^"\]\+>"\|REPLACE_ME\|your-\[a-z0-9-\]\+\|TODO'/);
    expect(infraWf).toMatch(/grep -E '"imageTag"/);
  });

  it("reads each app's current template image to preserve tags on apply", () => {
    // Web Container App: resource and container both named `${appName}`.
    // Worker Container App: resource `${appName}-worker`, container `copilot-worker`.
    expect(infraWf).toMatch(/properties\.template\.containers\[\?name=='\$container_name'\]/);
    expect(infraWf).toMatch(/copilot-worker/);
    expect(infraWf).toMatch(/\$\{APP_NAME\}-worker/);
  });

  it('exposes bootstrap inputs for greenfield deploys (no Container Apps yet)', () => {
    // A first-ever deploy has no Container Apps to read tags from.
    // The operator dispatches the workflow with explicit
    // webImageTag and workerImageTag inputs (see
    // docs/deployment-aca.md). Both inputs are optional so the
    // steady-state workflow_run path keeps reading live state.
    expect(infraWf).toMatch(/webImageTag:[\s\S]*?required:\s*false/);
    expect(infraWf).toMatch(/workerImageTag:[\s\S]*?required:\s*false/);
  });

  it('validates resolved image refs match the expected ACR repo prefix', () => {
    // Guards against an operator manually pushing a foreign image
    // (different ACR, different repo) under one of the app names.
    expect(infraWf).toMatch(/expected_prefix=/);
    expect(infraWf).toMatch(/\$\{ACR_LOGIN_SERVER\}\/\$\{resource_name\}:/);
  });

  it('DEPLOY_NAME uses sha_short + run_id + run_attempt and stays ≤ 64 chars', () => {
    const deployBlock = infraWf.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
    expect(deployBlock).toMatch(/DEPLOY_NAME:[^\n]*sha_short[^\n]*github\.run_(?:id|attempt)/);
    // `infra` (5) + 3× `-` (3) + sha_short (12) + run_id (≤20) +
    // run_attempt (≤2) = 42 max.
    const maxLen = 'infra'.length + 3 + 12 + 20 + 2;
    expect(maxLen).toBeLessThanOrEqual(64);
  });

  it('exposes sha_short as a should-deploy output (only consumed by DEPLOY_NAME)', () => {
    expect(infraWf).toMatch(/echo "short=\$\{sha:0:12\}" >> "\$GITHUB_OUTPUT"/);
    const shortRefs = infraWf.match(/sha_short/g) ?? [];
    expect(shortRefs.length).toBeLessThanOrEqual(4);
    expect(infraWf).toMatch(/DEPLOY_NAME:[^\n]*sha_short/);
  });

  it('cancels in-flight ARM deployment on runner cancellation', () => {
    expect(infraWf).toMatch(/if:\s*cancelled\(\)/);
    expect(infraWf).toMatch(/az deployment sub cancel/);
  });
});

describe('deploy workflows — third-party action SHA pinning', () => {
  // Repo convention: every third-party `uses:` is pinned to a
  // 40-hex SHA with a version comment.
  for (const { name, src } of allWorkflows) {
    const usesLines = src.match(/uses:\s*[^\n]+/g) ?? [];
    it(`${name}: every uses: pins a 40-hex SHA followed by a version comment`, () => {
      for (const line of usesLines) {
        expect(line, `uses line: ${line}`).toMatch(/uses:\s*[\w-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v[\d.]+/);
      }
    });
  }
});

describe('CI ↔ CD coupling — display name', () => {
  // workflow_run matches by display name. A silent rename of
  // `name: CI` in ci.yml would stop all three deploy workflows
  // from firing without any error surface.
  it('ci.yml declares `name: CI`', () => {
    expect(ciWf).toMatch(/^name:\s*CI\s*$/m);
  });

  it('all deploy workflows reference the [CI] display name', () => {
    for (const { src } of allWorkflows) {
      expect(src).toMatch(/workflows:\s*\[CI\]/);
    }
  });
});

describe('CI — lint-gaps job', () => {
  // Catches gaps that eslint/tsc can't see: workflow YAML correctness
  // (with embedded shellcheck) and markdown. The job runs in parallel
  // with build-and-test; both must report green for a PR to merge.
  const lintGapsBlock = (() => {
    const start = ciWf.search(/^ {2}lint-gaps:\s*$/m);
    if (start < 0) return null;
    const rest = ciWf.slice(start + 1);
    const nextJob = rest.search(/^ {2}\S/m);
    return nextJob < 0 ? ciWf.slice(start) : ciWf.slice(start, start + 1 + nextJob);
  })();

  it('declares the lint-gaps job', () => {
    expect(lintGapsBlock).not.toBeNull();
  });

  it('lint-gaps has no `needs:` (parallel with build-and-test)', () => {
    expect(lintGapsBlock).not.toBeNull();
    expect(lintGapsBlock!).not.toMatch(/^\s+needs:/m);
  });

  it('pins actionlint and markdownlint actions by 40-hex SHA + version comment', () => {
    expect(lintGapsBlock).not.toBeNull();
    const pinned = /uses:\s*[\w-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v[\d.]+/;
    expect(lintGapsBlock!).toMatch(/reviewdog\/action-actionlint@[0-9a-f]{40}\s+#\s*v[\d.]+/);
    expect(lintGapsBlock!).toMatch(/DavidAnson\/markdownlint-cli2-action@[0-9a-f]{40}\s+#\s*v[\d.]+/);
    const usesLines = lintGapsBlock!.match(/uses:[^\n]*/g) ?? [];
    for (const line of usesLines) {
      expect(line).toMatch(pinned);
    }
  });

  it('runs markdownlint with `if: always()` so both linters report on every run', () => {
    expect(lintGapsBlock).not.toBeNull();
    expect(lintGapsBlock!).toMatch(/if:\s*always\(\)[\s\S]+DavidAnson\/markdownlint-cli2-action/);
  });
});

describe('CI — HUSKY=0 on install steps', () => {
  // Husky v9 runs `prepare` on `npm ci`, which would no-op in CI but
  // can still touch the working tree. Pinning HUSKY=0 keeps install
  // deterministic and prevents accidental hook installation on runners.
  const ciNpmInstallers = [
    { name: 'ci.yml build-and-test', src: ciWf },
    { name: 'deploy-web.yml', src: webWf },
    { name: 'deploy-worker.yml', src: workerWf },
  ];
  for (const { name, src } of ciNpmInstallers) {
    it(`${name}: install step disables husky via HUSKY=0`, () => {
      expect(src).toMatch(/HUSKY:\s*['"]?0['"]?/);
    });
  }
});

describe('path-filter scopes — inline filters parsed from each workflow', () => {
  function parseInlineFilter(yamlText: string, key: 'web' | 'worker' | 'infra'): string[] {
    // The inline filters live in a `filters: |` block of dorny/paths-filter.
    // Capture the `<key>:` sub-list inside that block.
    const filtersBlock = yamlText.match(/filters:\s*\|\s*\n([\s\S]+?)(?:\n {0,8}\S|$)/);
    if (!filtersBlock) return [];
    const section = filtersBlock[1].match(new RegExp(`^\\s+${key}:\\s*\\n((?:\\s+(?:-[^\\n]*|#[^\\n]*)\\n?)+)`, 'm'));
    if (!section) return [];
    return section[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
      .map((l) => l.replace(/^-\s*['"]?/, '').replace(/['"]$/, ''))
      .filter(Boolean);
  }

  const webPatterns = parseInlineFilter(webWf, 'web');
  const workerPatterns = parseInlineFilter(workerWf, 'worker');
  const infraPatterns = parseInlineFilter(infraWf, 'infra');

  it('parsed at least 8 web, 6 worker, and 3 infra patterns', () => {
    expect(webPatterns.length).toBeGreaterThanOrEqual(8);
    expect(workerPatterns.length).toBeGreaterThanOrEqual(6);
    expect(infraPatterns.length).toBeGreaterThanOrEqual(3);
  });

  it('each workflow file is in its own filter (self-trigger on workflow change)', () => {
    expect(webPatterns).toContain('.github/workflows/deploy-web.yml');
    expect(workerPatterns).toContain('.github/workflows/deploy-worker.yml');
    expect(infraPatterns).toContain('.github/workflows/deploy-infra.yml');
  });

  it('infra filter scopes to Bicep template + parameters only', () => {
    expect(infraPatterns).toContain('infra/main.bicep');
    expect(infraPatterns).toContain('infra/main.parameters.json');
    expect(infraPatterns.some((p) => p === 'infra/modules/**')).toBe(true);
  });

  function matchesAny(file: string, globs: string[]): boolean {
    return globs.some((g) => {
      if (g === file) return true;
      if (g.endsWith('/**')) return file.startsWith(g.slice(0, -3));
      return false;
    });
  }

  const cases: { file: string; web: boolean; worker: boolean; infra: boolean }[] = [
    // Web-only sources.
    { file: 'src/app/page.tsx', web: true, worker: false, infra: false },
    { file: 'src/components/AppHeader/AppHeader.tsx', web: true, worker: false, infra: false },
    { file: 'src/middleware.ts', web: true, worker: false, infra: false },
    { file: 'next.config.ts', web: true, worker: false, infra: false },
    { file: 'Dockerfile', web: true, worker: false, infra: false },
    // Worker-only sources.
    { file: 'src/worker/bootstrap.ts', web: false, worker: true, infra: false },
    { file: 'Dockerfile.worker', web: false, worker: true, infra: false },
    // Shared libs that intersect both image surfaces.
    { file: 'src/lib/copilot/execution/index.ts', web: true, worker: true, infra: false },
    { file: 'package.json', web: true, worker: true, infra: false },
    { file: 'package-lock.json', web: true, worker: true, infra: false },
    // Infra-only.
    { file: 'infra/main.bicep', web: false, worker: false, infra: true },
    { file: 'infra/main.parameters.json', web: false, worker: false, infra: true },
    { file: 'infra/modules/container-app.bicep', web: false, worker: false, infra: true },
    // Non-deployable paths.
    { file: 'README.md', web: false, worker: false, infra: false },
    { file: 'docs/architecture.md', web: false, worker: false, infra: false },
    { file: 'docs/deployment-aca.md', web: false, worker: false, infra: false },
    { file: 'infra/README.md', web: false, worker: false, infra: false },
    { file: 'CONTRIBUTING.md', web: false, worker: false, infra: false },
  ];

  for (const c of cases) {
    it(`${c.file} → web=${c.web} worker=${c.worker} infra=${c.infra}`, () => {
      expect(matchesAny(c.file, webPatterns)).toBe(c.web);
      expect(matchesAny(c.file, workerPatterns)).toBe(c.worker);
      expect(matchesAny(c.file, infraPatterns)).toBe(c.infra);
    });
  }
});

describe('legacy path-filters directory removed', () => {
  it('.github/path-filters/ no longer exists', () => {
    // Inline filters live in each workflow's `dorny/paths-filter`
    // block. The old external-file pattern is gone.
    expect(existsSync(path.join(REPO, '.github/path-filters'))).toBe(false);
  });
});

describe('Bicep param model', () => {
  const mainBicep = read('infra/main.bicep');
  const params = read('infra/main.parameters.json');

  it('declares both webImageTag and workerImageTag as required (no default)', () => {
    expect(mainBicep).toMatch(/param webImageTag string\s*$/m);
    expect(mainBicep).toMatch(/param workerImageTag string\s*$/m);
    // Neither tag may carry a default — operators must pass them
    // explicitly so production never silently rolls out a stale tag.
    expect(mainBicep).not.toMatch(/param webImageTag string\s*=/);
    expect(mainBicep).not.toMatch(/param workerImageTag string\s*=/);
  });

  it('parameters.json carries no placeholder values', () => {
    // Mirrors the validator in deploy-infra.yml; a placeholder
    // would make every automated deploy fail at the guard step.
    expect(params).not.toMatch(/"<[^"]+>"|REPLACE_ME|your-[a-z0-9-]+|TODO/i);
  });

  it('no longer declares the legacy `imageTag` parameter', () => {
    expect(mainBicep).not.toMatch(/^param imageTag\b/m);
  });

  it('parameters.json no longer carries the legacy `imageTag` key', () => {
    expect(params).not.toMatch(/"imageTag"\s*:/);
  });
});
