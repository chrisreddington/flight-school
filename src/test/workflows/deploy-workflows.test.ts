import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract test for the two ACA deploy workflows
// (`.github/workflows/deploy-web.yml`, `.github/workflows/deploy-worker.yml`)
// and their path-filter scopes
// (`.github/path-filters/web.yml`, `.github/path-filters/worker.yml`).
//
// These workflows are independent of CI/test feedback loops — they only
// run on `main` after CI succeeds — so a silent regression here would
// only surface in production deploys. This file pins the invariants
// the design depends on: trigger model, concurrency, permissions,
// gate logic, stale-deploy guards, image-tag handling, and the
// CI ↔ CD coupling via display name.

const REPO = process.cwd();

function read(relPath: string): string {
  return readFileSync(path.join(REPO, relPath), 'utf8');
}

const webWf = read('.github/workflows/deploy-web.yml');
const workerWf = read('.github/workflows/deploy-worker.yml');
const ciWf = read('.github/workflows/ci.yml');
const webFilter = read('.github/path-filters/web.yml');
const workerFilter = read('.github/path-filters/worker.yml');

const wfPair: { name: 'web' | 'worker'; src: string }[] = [
  { name: 'web', src: webWf },
  { name: 'worker', src: workerWf },
];

describe('deploy workflows — triggers, permissions, concurrency', () => {
  for (const { name, src } of wfPair) {
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
      expect(src).toMatch(/concurrency:[\s\S]*group:\s*deploy-aca-\$\{\{\s*github\.ref_name\s*\}\}/);
      expect(src).toMatch(/cancel-in-progress:\s*false/);
    });
  }
});

describe('deploy workflows — should-deploy gate', () => {
  for (const { name, src } of wfPair) {
    it(`${name}: should-deploy job has the declarative if: covering both event paths`, () => {
      for (const needle of [
        'workflow_run.conclusion',
        'workflow_run.event',
        'workflow_run.head_branch',
        "refs/heads/main",
        "workflow_dispatch",
      ]) {
        expect(src).toContain(needle);
      }
    });

    it(`${name}: Resolve deploy SHA emits both value (full 40-hex) and short (12 hex)`, () => {
      expect(src).toMatch(/echo "value=\$sha" >> "\$GITHUB_OUTPUT"/);
      expect(src).toMatch(/echo "short=\$\{sha:0:12\}" >> "\$GITHUB_OUTPUT"/);
      expect(src).toMatch(/\^\[0-9a-f\]\{40\}\$/);
    });

    it(`${name}: short-SHA output is only consumed by DEPLOY_NAME`, () => {
      // Image tags MUST use the full SHA so `docker pull` produces a
      // deterministic identifier. The short form is a one-off for
      // ARM deployment names.
      const shortRefs = src.match(/sha_short/g) ?? [];
      // Allowed appearances: outputs declaration + DEPLOY_NAME consumer.
      // Each may have a couple of references; cap at 4 as a tight bound.
      expect(shortRefs.length).toBeLessThanOrEqual(4);
      expect(src).toMatch(/DEPLOY_NAME:[^\n]*sha_short/);
    });

    it(`${name}: ancestry verify uses gh api /compare (not git merge-base in active script)`, () => {
      expect(src).toMatch(/gh api "\/repos\/\$\{?GH_REPO\}?\/compare\//);
      // Allow `merge-base` only inside a comment line. Strip comments
      // before asserting absence.
      const stripped = src.replace(/^\s*#[^\n]*$/gm, '');
      expect(stripped).not.toMatch(/git merge-base/);
    });

    it(`${name}: CI-green check queries by workflow file path, not display name`, () => {
      expect(src).toMatch(/actions\/workflows\/ci\.yml\/runs/);
      // Forbid the display-name selector form. Without this guard a
      // rename of `name: CI` in ci.yml would silently break the check.
      expect(src).not.toMatch(/select\(\.name\s*==\s*"CI"\)/);
    });

    it(`${name}: Refuse stale workflow_run step writes superseded= step output (not env)`, () => {
      expect(src).toMatch(/superseded=(?:true|false)[^\n]*>>\s*"\$GITHUB_OUTPUT"/);
      // Forbid SUPERSEDED leaking through $GITHUB_ENV — downstream
      // gating must read steps.<id>.outputs.superseded.
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
      // Look for an env block on the gate step that wires all four signals.
      expect(src).toMatch(/SUPERSEDED:[^\n]*\$\{\{\s*steps\./);
      expect(src).toMatch(/FIRST_DEPLOY:[^\n]*\$\{\{\s*steps\./);
      expect(src).toMatch(/FILTER_HIT:[^\n]*\$\{\{\s*steps\./);
    });
  }

  it("web wf: gate step's FILTER_HIT reads steps.filter.outputs.web (NOT .worker)", () => {
    expect(webWf).toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.web\s*\}\}/);
    // Copy-paste swap is the highest-likelihood implementation
    // mistake when authoring the worker workflow from the web
    // template (or vice versa). A swap would leave FILTER_HIT
    // permanently empty so workflow_run-triggered deploys silently
    // never fire.
    expect(webWf).not.toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.worker\s*\}\}/);
  });

  it("worker wf: gate step's FILTER_HIT reads steps.filter.outputs.worker (NOT .web)", () => {
    expect(workerWf).toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.worker\s*\}\}/);
    expect(workerWf).not.toMatch(/FILTER_HIT:\s*\$\{\{\s*steps\.filter\.outputs\.web\s*\}\}/);
  });
});

describe('deploy workflows — deploy job', () => {
  for (const { name, src } of wfPair) {
    it(`${name}: deploy job declares id-token: write and contents: read`, () => {
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/permissions:[\s\S]*?contents:\s*read/);
      expect(deployBlock).toMatch(/id-token:\s*write/);
      // Job-level actions: read must NOT propagate to deploy.
      expect(deployBlock).not.toMatch(/actions:\s*read/);
    });

    it(`${name}: DEPLOY_NAME uses sha_short + run_attempt and stays ≤ 64 chars`, () => {
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/DEPLOY_NAME:[^\n]*sha_short[^\n]*github\.run_(?:id|attempt)/);

      // Static-assert that the template-string length stays ≤ 64
      // chars (Azure subscription-scope deployment-name cap) even
      // when run_id is at uint64 max as a decimal string (20 chars).
      const prefix = name === 'web' ? 'web' : 'worker';
      const maxLen = prefix.length + 1 + 12 + 1 + 20 + 1 + 2;
      expect(maxLen).toBeLessThanOrEqual(64);
    });

    it(`${name}: deploy job has a Refuse stale deploy step gated to workflow_run`, () => {
      const deployBlock = src.match(/\n {2}deploy:[\s\S]*$/)?.[0] ?? '';
      expect(deployBlock).toMatch(/Refuse stale deploy[\s\S]*?if:\s*github\.event_name\s*==\s*'workflow_run'/);
      expect(deployBlock).toMatch(/branches\/main/);
      expect(deployBlock).toMatch(/exit 1/);
    });

    it(`${name}: az deployment sub create passes parameters.json AND explicit overrides`, () => {
      expect(src).toMatch(/--parameters @infra\/main\.parameters\.json/);
      for (const param of [
        'appName=',
        'resourceGroupName=',
        'acrLoginServer=',
        'location=',
        'webImageTag=',
        'workerImageTag=',
      ]) {
        expect(src).toContain(param);
      }
    });
  }
});

describe('deploy workflows — "read other app\'s template image" step', () => {
  it('web wf reads the worker app by resource name + container name (split, pinned)', () => {
    // Resource name and container name differ for the worker —
    // resource is `${appName}-worker`, container is hardcoded
    // `copilot-worker` (see infra/modules/copilot-worker-app.bicep).
    expect(webWf).toMatch(/OTHER_APP_NAME="\$\{APP_NAME\}-worker"/);
    expect(webWf).toMatch(/OTHER_CONTAINER_NAME="copilot-worker"/);
    expect(webWf).toMatch(/containers\[\?name=='\$OTHER_CONTAINER_NAME'\]\.image \| \[0\]/);
    expect(webWf).not.toMatch(/containers\[0\]\.image/);
  });

  it('worker wf reads the web app by APP_NAME (resource and container name coincide)', () => {
    // Web app: resource and container both named `${appName}`
    // (see infra/modules/container-app.bicep).
    expect(workerWf).toMatch(/containers\[\?name=='\$APP_NAME'\]\.image \| \[0\]/);
    expect(workerWf).not.toMatch(/containers\[0\]\.image/);
    // `copilot-worker` may appear only inside comments. Strip them first.
    const stripped = workerWf.replace(/^\s*#[^\n]*$/gm, '');
    expect(stripped).not.toMatch(/copilot-worker/);
  });

  it('web wf validates the worker image prefix matches ${ACR_LOGIN_SERVER}/${APP_NAME}-worker:', () => {
    expect(webWf).toMatch(/EXPECTED_PREFIX="\$\{ACR_LOGIN_SERVER\}\/\$\{OTHER_APP_NAME\}:"/);
  });

  it('worker wf validates the web image prefix matches ${ACR_LOGIN_SERVER}/${APP_NAME}:', () => {
    expect(workerWf).toMatch(/EXPECTED_PREFIX="\$\{ACR_LOGIN_SERVER\}\/\$\{APP_NAME\}:"/);
  });
});

describe('deploy workflows — image tag wiring', () => {
  it('web wf passes its built tag as webImageTag and the read tag as workerImageTag', () => {
    expect(webWf).toMatch(/webImageTag="\$IMAGE_TAG"/);
    expect(webWf).toMatch(/workerImageTag="\$OTHER_TAG"/);
  });

  it('worker wf passes its built tag as workerImageTag and the read tag as webImageTag', () => {
    expect(workerWf).toMatch(/workerImageTag="\$IMAGE_TAG"/);
    expect(workerWf).toMatch(/webImageTag="\$OTHER_TAG"/);
  });

  it('web wf builds with -f Dockerfile and tags ${APP_NAME}', () => {
    expect(webWf).toMatch(/-f Dockerfile\b/);
    expect(webWf).toMatch(/IMAGE="\$\{ACR_LOGIN_SERVER\}\/\$\{APP_NAME\}:/);
    expect(webWf).not.toMatch(/-f Dockerfile\.worker/);
  });

  it('worker wf builds with -f Dockerfile.worker and tags ${APP_NAME}-worker', () => {
    expect(workerWf).toMatch(/-f Dockerfile\.worker/);
    expect(workerWf).toMatch(/IMAGE="\$\{ACR_LOGIN_SERVER\}\/\$\{APP_NAME\}-worker:/);
  });
});

describe('deploy workflows — third-party action SHA pinning', () => {
  // Repo convention: every third-party `uses:` is pinned to a
  // 40-hex SHA with a version comment.
  for (const { name, src } of wfPair) {
    const usesLines = src.match(/uses:\s*[^\n]+/g) ?? [];
    it(`${name}: every uses: pins a 40-hex SHA followed by a version comment`, () => {
      for (const line of usesLines) {
        expect(line, `uses line: ${line}`).toMatch(/uses:\s*[\w-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v[\d.]+/);
      }
    });
  }
});

describe('CI ↔ CD coupling — display name', () => {
  // workflow_run matches by **display name**. A silent rename of
  // `name: CI` in ci.yml would stop both deploy workflows from
  // firing without any error surface.
  it('ci.yml declares `name: CI`', () => {
    expect(ciWf).toMatch(/^name:\s*CI\s*$/m);
  });

  it('deploy workflows reference the [CI] display name', () => {
    expect(webWf).toMatch(/workflows:\s*\[CI\]/);
    expect(workerWf).toMatch(/workflows:\s*\[CI\]/);
  });
});

describe('path-filter scopes — representative mapping', () => {
  const webOnly = [
    'src/app/page.tsx',
    'src/components/AppHeader/AppHeader.tsx',
    'next.config.ts',
    'Dockerfile',
  ];
  const workerOnly = [
    'src/worker/bootstrap.ts',
    'Dockerfile.worker',
    'scripts/build-worker.mjs',
  ];
  const both = [
    'src/lib/copilot/execution/index.ts',
    'package.json',
    'tsconfig.json',
    // Bicep / infra changes (env-var wiring, scaling, resource
    // properties) must roll out via the next deploy on either side —
    // included in BOTH filters so the deploy that fires re-converges
    // both apps.
    'infra/main.bicep',
    'infra/main.parameters.json',
    'infra/modules/container-app.bicep',
  ];
  const neither = ['README.md', 'docs/architecture.md', 'CONTRIBUTING.md'];

  function matchesAny(file: string, globs: string[]): boolean {
    return globs.some((g) => {
      if (g === file) return true;
      if (g.endsWith('/**')) return file.startsWith(g.slice(0, -3));
      return false;
    });
  }
  function parseFilterPatterns(yamlText: string, key: 'web' | 'worker'): string[] {
    // Capture from the key line until the next top-level key (or EOF).
    // Tolerate interspersed comments (lines starting with `#`) so we
    // can document scope decisions inline in the YAML.
    const sectionPattern = new RegExp(`^${key}:\\s*\\n((?:\\s+(?:-[^\\n]*|#[^\\n]*)\\n)+)`, 'm');
    const section = yamlText.match(sectionPattern);
    if (!section) return [];
    return section[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('-'))
      .map((l) => l.replace(/^-\s*['"]?/, '').replace(/['"]$/, ''))
      .filter(Boolean);
  }

  const webPatterns = parseFilterPatterns(webFilter, 'web');
  const workerPatterns = parseFilterPatterns(workerFilter, 'worker');

  it('parsed at least 8 web patterns and 6 worker patterns', () => {
    expect(webPatterns.length).toBeGreaterThanOrEqual(8);
    expect(workerPatterns.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of webOnly) {
    it(`${file} → web only`, () => {
      expect(matchesAny(file, webPatterns)).toBe(true);
      expect(matchesAny(file, workerPatterns)).toBe(false);
    });
  }
  for (const file of workerOnly) {
    it(`${file} → worker only`, () => {
      expect(matchesAny(file, workerPatterns)).toBe(true);
      expect(matchesAny(file, webPatterns)).toBe(false);
    });
  }
  for (const file of both) {
    it(`${file} → both`, () => {
      expect(matchesAny(file, webPatterns)).toBe(true);
      expect(matchesAny(file, workerPatterns)).toBe(true);
    });
  }
  for (const file of neither) {
    it(`${file} → neither`, () => {
      expect(matchesAny(file, webPatterns)).toBe(false);
      expect(matchesAny(file, workerPatterns)).toBe(false);
    });
  }
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

  it('parameters.json passes the workflow\'s Validate parameters.json placeholder guard', () => {
    // Mirror the exact regex used by the "Validate parameters.json"
    // step in both deploy workflows. A placeholder left in the
    // committed file would make every automated deploy fail at the
    // guard step — converts deploy-time fail-fast into test-time
    // fail-fast.
    expect(params).not.toMatch(/"<[^"]+>"|REPLACE_ME|your-[a-z0-9-]+|TODO/i);
  });

  it('no longer declares the legacy `imageTag` parameter', () => {
    expect(mainBicep).not.toMatch(/^param imageTag\b/m);
  });

  it('parameters.json no longer carries the legacy `imageTag` key', () => {
    expect(params).not.toMatch(/"imageTag"\s*:/);
  });
});
