/**
 * GitHub Language Colors
 *
 * Color mappings for programming languages, sourced from GitHub Linguist.
 * Used consistently across profile stats and repository displays.
 *
 * @see https://github.com/github/linguist/blob/master/lib/linguist/languages.yml
 */

/**
 * Maps programming language names to their GitHub display colors.
 * Colors match GitHub's official language colors from Linguist.
 */
const LANGUAGE_COLORS: Readonly<Record<string, string>> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  'C#': '#178600',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Dockerfile: '#384d54',
  Markdown: '#083fa1',
  HCL: '#844FBA',
  Bicep: '#519aba',
} as const;

/** Default color for languages not in the mapping */
const DEFAULT_LANGUAGE_COLOR = '#6e7681';

/**
 * Get the color for a programming language.
 *
 * @param language - The language name
 * @returns The hex color code for the language
 */
export function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language] ?? DEFAULT_LANGUAGE_COLOR;
}
