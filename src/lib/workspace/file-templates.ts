/**
 * File templates for different programming languages
 *
 * Provides language-specific file creation options for the Challenge Sandbox.
 * Supports main files, test files, utilities, and configuration files.
 *
 * @module workspace/file-templates
 */

// =============================================================================
// Types
// =============================================================================

/** A file template option shown in the "Add file" menu */
export interface FileTemplate {
  /** Display label for the menu item */
  label: string;
  /** Default filename to create (user can rename) */
  filename: string;
  /** Icon identifier (maps to Octicons) */
  icon: 'file-code' | 'beaker' | 'tools' | 'gear' | 'workflow';
  /** Optional: subdirectory path (e.g., '.github/workflows') */
  subdirectory?: string;
}

// =============================================================================
// Language-Specific Templates
// =============================================================================

const TypeScriptTemplates: FileTemplate[] = [
  { label: 'New TypeScript file', filename: 'untitled.ts', icon: 'file-code' },
  { label: 'New test file', filename: 'untitled.test.ts', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.ts', icon: 'tools' },
  { label: 'New config file', filename: 'tsconfig.json', icon: 'gear' },
];

const JavaScriptTemplates: FileTemplate[] = [
  { label: 'New JavaScript file', filename: 'untitled.js', icon: 'file-code' },
  { label: 'New test file', filename: 'untitled.test.js', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.js', icon: 'tools' },
  { label: 'New config file', filename: 'package.json', icon: 'gear' },
];

const PythonTemplates: FileTemplate[] = [
  { label: 'New Python file', filename: 'untitled.py', icon: 'file-code' },
  { label: 'New test file', filename: 'test_untitled.py', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.py', icon: 'tools' },
  { label: 'New config file', filename: 'requirements.txt', icon: 'gear' },
];

const GoTemplates: FileTemplate[] = [
  { label: 'New Go file', filename: 'untitled.go', icon: 'file-code' },
  { label: 'New test file', filename: 'untitled_test.go', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.go', icon: 'tools' },
  { label: 'New module file', filename: 'go.mod', icon: 'gear' },
];

const RustTemplates: FileTemplate[] = [
  { label: 'New Rust file', filename: 'untitled.rs', icon: 'file-code' },
  { label: 'New test file', filename: 'tests.rs', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.rs', icon: 'tools' },
  { label: 'New config file', filename: 'Cargo.toml', icon: 'gear' },
];

const JavaTemplates: FileTemplate[] = [
  { label: 'New Java file', filename: 'Untitled.java', icon: 'file-code' },
  { label: 'New test file', filename: 'UntitledTest.java', icon: 'beaker' },
  { label: 'New utils file', filename: 'Utils.java', icon: 'tools' },
  { label: 'New config file', filename: 'pom.xml', icon: 'gear' },
];

const CSharpTemplates: FileTemplate[] = [
  { label: 'New C# file', filename: 'Untitled.cs', icon: 'file-code' },
  { label: 'New test file', filename: 'UntitledTests.cs', icon: 'beaker' },
  { label: 'New utils file', filename: 'Utils.cs', icon: 'tools' },
  { label: 'New config file', filename: 'project.csproj', icon: 'gear' },
];

const RubyTemplates: FileTemplate[] = [
  { label: 'New Ruby file', filename: 'untitled.rb', icon: 'file-code' },
  { label: 'New test file', filename: 'untitled_test.rb', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.rb', icon: 'tools' },
  { label: 'New config file', filename: 'Gemfile', icon: 'gear' },
];

const PHPTemplates: FileTemplate[] = [
  { label: 'New PHP file', filename: 'untitled.php', icon: 'file-code' },
  { label: 'New test file', filename: 'UntitledTest.php', icon: 'beaker' },
  { label: 'New utils file', filename: 'utils.php', icon: 'tools' },
  { label: 'New config file', filename: 'composer.json', icon: 'gear' },
];

/** Common templates available for all languages */
const CommonTemplates: FileTemplate[] = [
  { label: 'New README', filename: 'README.md', icon: 'file-code' },
  { label: 'New workflow', filename: 'ci.yml', icon: 'workflow', subdirectory: '.github/workflows' },
];

// =============================================================================
// Public API
// =============================================================================

/**
 * Gets file templates for a specific programming language.
 *
 * @param language - Challenge language (case-insensitive)
 * @returns Array of file templates for that language, plus common templates
 *
 * @example
 * ```ts
 * const templates = getFileTemplatesForLanguage('Go');
 * // Returns: [Go-specific templates] + [Common templates]
 * ```
 */
export function getFileTemplatesForLanguage(language: string): FileTemplate[] {
  const normalizedLang = language.toLowerCase();

  const languageSpecific = (() => {
    switch (normalizedLang) {
      case 'typescript':
        return TypeScriptTemplates;
      case 'javascript':
        return JavaScriptTemplates;
      case 'python':
        return PythonTemplates;
      case 'go':
        return GoTemplates;
      case 'rust':
        return RustTemplates;
      case 'java':
        return JavaTemplates;
      case 'c#':
      case 'csharp':
        return CSharpTemplates;
      case 'ruby':
        return RubyTemplates;
      case 'php':
        return PHPTemplates;
      default:
        // Fallback: generic file options
        return [
          { label: 'New file', filename: 'untitled.txt', icon: 'file-code' as const },
          { label: 'New test file', filename: 'test.txt', icon: 'beaker' as const },
        ];
    }
  })();

  return [...languageSpecific, ...CommonTemplates];
}

/**
 * Builds the full file path including any subdirectory.
 *
 * @param template - The file template
 * @returns Full path (e.g., '.github/workflows/ci.yml' or 'utils.go')
 *
 * @example
 * ```ts
 * const path = getFilePathFromTemplate({ 
 *   filename: 'ci.yml', 
 *   subdirectory: '.github/workflows' 
 * });
 * // Returns: '.github/workflows/ci.yml'
 * ```
 */
export function getFilePathFromTemplate(template: FileTemplate): string {
  if (template.subdirectory) {
    return `${template.subdirectory}/${template.filename}`;
  }
  return template.filename;
}
