import { loader } from '@monaco-editor/react';

interface MonacoCompilerDefaults {
  getCompilerOptions: () => Record<string, unknown>;
  setCompilerOptions: (options: Record<string, unknown>) => void;
  setEagerModelSync: (enabled: boolean) => void;
}

interface MonacoTypeScriptLanguage {
  ModuleKind: { ESNext: unknown };
  ModuleResolutionKind: { NodeJs: unknown };
  ScriptTarget: { ESNext: unknown };
  typescriptDefaults: MonacoCompilerDefaults;
  javascriptDefaults: MonacoCompilerDefaults;
}

interface MonacoLike {
  languages: {
    typescript: MonacoTypeScriptLanguage;
  };
}

const MONACO_KEYMOD_CTRL_CMD = 2048;
const MONACO_KEYCODE_ENTER = 3;

export const MONACO_KEYBINDING_RUN = MONACO_KEYMOD_CTRL_CMD | MONACO_KEYCODE_ENTER;

export function configureMonacoLanguageDefaults(monaco: MonacoLike): void {
  const compilerOptions = {
    module: monaco.languages.typescript.ModuleKind.ESNext,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    esModuleInterop: true,
    strict: false,
  };

  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    ...monaco.languages.typescript.typescriptDefaults.getCompilerOptions(),
    ...compilerOptions,
  });
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    ...monaco.languages.typescript.javascriptDefaults.getCompilerOptions(),
    ...compilerOptions,
  });
  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
}

export function initializeMonacoLanguageDefaults(): void {
  if (typeof window === 'undefined') return;

  loader
    .init()
    .then((monaco) => {
      configureMonacoLanguageDefaults(monaco);
    })
    .catch(() => {
      // beforeMount and onMount apply the same config when the editor initializes.
    });
}

export function getMonacoTheme(colorMode?: string): 'vs' | 'vs-dark' {
  return colorMode === 'night' || colorMode === 'dark' ? 'vs-dark' : 'vs';
}

export function getMonacoEditorOptions() {
  return {
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    padding: { top: 12, bottom: 12 },
    renderLineHighlight: 'line',
    scrollbar: {
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
    },
  } as const;
}
