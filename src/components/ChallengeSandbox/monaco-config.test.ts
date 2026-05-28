import { describe, expect, it, vi } from 'vitest';
import {
  MONACO_KEYBINDING_RUN,
  configureMonacoLanguageDefaults,
  getMonacoEditorOptions,
  getMonacoTheme,
} from './monaco-config';

describe('ChallengeSandbox Monaco config', () => {
  it('should use dark theme for dark Primer color modes', () => {
    expect(getMonacoTheme('dark')).toBe('vs-dark');
    expect(getMonacoTheme('night')).toBe('vs-dark');
    expect(getMonacoTheme('day')).toBe('vs');
  });

  it('should keep the run shortcut bound to Ctrl/Cmd+Enter', () => {
    expect(MONACO_KEYBINDING_RUN).toBe(2048 | 3);
  });

  it('should expose stable editor options used by the sandbox editor', () => {
    expect(getMonacoEditorOptions()).toMatchObject({
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      folding: true,
      foldingStrategy: 'auto',
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: 'line',
      scrollbar: {
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
    });
  });

  it('should configure TypeScript and JavaScript defaults for ES modules', () => {
    const defaults = () => ({
      getCompilerOptions: vi.fn(() => ({ existing: true })),
      setCompilerOptions: vi.fn(),
      setEagerModelSync: vi.fn(),
    });
    const typescriptDefaults = defaults();
    const javascriptDefaults = defaults();
    const monaco = {
      languages: {
        typescript: {
          ModuleKind: { ESNext: 'esnext' },
          ModuleResolutionKind: { NodeJs: 'node' },
          ScriptTarget: { ESNext: 'target-esnext' },
          typescriptDefaults,
          javascriptDefaults,
        },
      },
    };

    configureMonacoLanguageDefaults(monaco);

    expect(typescriptDefaults.setCompilerOptions).toHaveBeenCalledWith({
      existing: true,
      module: 'esnext',
      moduleResolution: 'node',
      target: 'target-esnext',
      esModuleInterop: true,
      strict: false,
    });
    expect(javascriptDefaults.setCompilerOptions).toHaveBeenCalledWith({
      existing: true,
      module: 'esnext',
      moduleResolution: 'node',
      target: 'target-esnext',
      esModuleInterop: true,
      strict: false,
    });
    expect(typescriptDefaults.setEagerModelSync).toHaveBeenCalledWith(true);
    expect(javascriptDefaults.setEagerModelSync).toHaveBeenCalledWith(true);
  });
});
