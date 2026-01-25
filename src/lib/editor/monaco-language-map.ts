/**
 * Monaco Editor Language Mapping
 * 
 * Maps human-readable language names to Monaco editor language identifiers.
 * Supports case-insensitive lookup for common programming languages.
 * 
 * @module editor/monaco-language-map
 */

/**
 * Language mapping table from display names to Monaco identifiers.
 */
const LANGUAGE_MAP: Record<string, string> = {
  'typescript': 'typescript',
  'TypeScript': 'typescript',
  'javascript': 'javascript',
  'JavaScript': 'javascript',
  'python': 'python',
  'Python': 'python',
  'java': 'java',
  'Java': 'java',
  'c#': 'csharp',
  'C#': 'csharp',
  'csharp': 'csharp',
  'go': 'go',
  'Go': 'go',
  'rust': 'rust',
  'Rust': 'rust',
  'ruby': 'ruby',
  'Ruby': 'ruby',
  'php': 'php',
  'PHP': 'php',
  'html': 'html',
  'HTML': 'html',
  'css': 'css',
  'CSS': 'css',
  'json': 'json',
  'JSON': 'json',
  'sql': 'sql',
  'SQL': 'sql',
  'shell': 'shell',
  'bash': 'shell',
  'Bash': 'shell',
  'yaml': 'yaml',
  'YAML': 'yaml',
  'yml': 'yaml',
  'markdown': 'markdown',
  'Markdown': 'markdown',
  'md': 'markdown',
};

/**
 * Extension to Monaco language identifier mapping.
 */
const EXTENSION_MAP: Record<string, string> = {
  'ts': 'typescript',
  'tsx': 'typescript',
  'js': 'javascript',
  'jsx': 'javascript',
  'mjs': 'javascript',
  'cjs': 'javascript',
  'py': 'python',
  'java': 'java',
  'cs': 'csharp',
  'go': 'go',
  'rs': 'rust',
  'rb': 'ruby',
  'php': 'php',
  'html': 'html',
  'htm': 'html',
  'css': 'css',
  'scss': 'scss',
  'sass': 'sass',
  'less': 'less',
  'json': 'json',
  'sql': 'sql',
  'sh': 'shell',
  'bash': 'shell',
  'yaml': 'yaml',
  'yml': 'yaml',
  'md': 'markdown',
  'txt': 'plaintext',
};

/**
 * Display names for Monaco language identifiers.
 */
const DISPLAY_NAMES: Record<string, string> = {
  'typescript': 'TypeScript',
  'javascript': 'JavaScript',
  'python': 'Python',
  'java': 'Java',
  'csharp': 'C#',
  'go': 'Go',
  'rust': 'Rust',
  'ruby': 'Ruby',
  'php': 'PHP',
  'html': 'HTML',
  'css': 'CSS',
  'json': 'JSON',
  'sql': 'SQL',
  'shell': 'Shell',
  'yaml': 'YAML',
  'markdown': 'Markdown',
  'plaintext': 'Plain Text',
};

/**
 * Maps a challenge language name to Monaco editor language identifier.
 * 
 * @param language - Language name from challenge definition
 * @returns Monaco editor language identifier, defaults to 'plaintext'
 * 
 * @example
 * ```typescript
 * getMonacoLanguage('TypeScript') // 'typescript'
 * getMonacoLanguage('Python')     // 'python'
 * getMonacoLanguage('unknown')    // 'plaintext'
 * ```
 */
export function getMonacoLanguage(language: string): string {
  return LANGUAGE_MAP[language] ?? 'plaintext';
}

/**
 * Maps a file extension to Monaco editor language identifier.
 * 
 * @param extension - File extension (without the dot)
 * @returns Monaco editor language identifier, defaults to 'plaintext'
 * 
 * @example
 * ```typescript
 * getMonacoLanguageFromExtension('ts')  // 'typescript'
 * getMonacoLanguageFromExtension('py')  // 'python'
 * getMonacoLanguageFromExtension('xyz') // 'plaintext'
 * ```
 */
export function getMonacoLanguageFromExtension(extension: string): string {
  return EXTENSION_MAP[extension.toLowerCase()] ?? 'plaintext';
}

/**
 * Gets a display-friendly language name from a Monaco language identifier.
 * 
 * @param monacoLanguage - Monaco editor language identifier
 * @returns Human-readable language name
 * 
 * @example
 * ```typescript
 * getLanguageDisplayName('typescript') // 'TypeScript'
 * getLanguageDisplayName('csharp')     // 'C#'
 * getLanguageDisplayName('unknown')    // 'Unknown'
 * ```
 */
export function getLanguageDisplayName(monacoLanguage: string): string {
  return DISPLAY_NAMES[monacoLanguage] ?? monacoLanguage.charAt(0).toUpperCase() + monacoLanguage.slice(1);
}
