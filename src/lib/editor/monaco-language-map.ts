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
