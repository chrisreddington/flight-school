/**
 * Workspace Templates
 *
 * Generates initial workspace files based on challenge type.
 * Provides language-appropriate starter files and optional test files.
 *
 * @example
 * ```typescript
 * import { getWorkspaceTemplate } from '@/lib/workspace';
 *
 * const files = getWorkspaceTemplate(challenge);
 * // Returns array of WorkspaceFile for the challenge
 * ```
 */

import type { ChallengeDef } from '@/lib/copilot/types';
import { now, nowMs } from '@/lib/utils/date-utils';
import type { WorkspaceFile } from './types';

// =============================================================================
// Language Configuration
// =============================================================================

/** File extension mapping for programming languages */
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  java: 'java',
  csharp: 'cs',
  'c#': 'cs',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  scala: 'scala',
  html: 'html',
  css: 'css',
  sql: 'sql',
  shell: 'sh',
  bash: 'sh',
};

/** Test file patterns for different languages */
const TEST_FILE_PATTERNS: Record<string, { suffix: string; template: string }> = {
  typescript: {
    suffix: '.test.ts',
    template: `import { describe, it, expect } from 'vitest';
// import { solution } from './solution';

describe('Solution', () => {
  it('should pass basic test', () => {
    // Add your tests here
    expect(true).toBe(true);
  });
});
`,
  },
  javascript: {
    suffix: '.test.js',
    template: `import { describe, it, expect } from 'vitest';
// import { solution } from './solution';

describe('Solution', () => {
  it('should pass basic test', () => {
    // Add your tests here
    expect(true).toBe(true);
  });
});
`,
  },
  python: {
    suffix: '_test.py',
    template: `import unittest
# from solution import solution

class TestSolution(unittest.TestCase):
    def test_basic(self):
        # Add your tests here
        self.assertTrue(True)

if __name__ == '__main__':
    unittest.main()
`,
  },
  java: {
    suffix: 'Test.java',
    template: `import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SolutionTest {
    @Test
    void testBasic() {
        // Add your tests here
        assertTrue(true);
    }
}
`,
  },
  go: {
    suffix: '_test.go',
    template: `package main

import "testing"

func TestSolution(t *testing.T) {
    // Add your tests here
    if false {
        t.Error("Test failed")
    }
}
`,
  },
  rust: {
    suffix: '_test.rs',
    template: `#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        // Add your tests here
        assert!(true);
    }
}
`,
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

/** Gets the file extension for a programming language (internal). */
function getLanguageExtension(language: string): string {
  const normalized = language.toLowerCase();
  return LANGUAGE_EXTENSIONS[normalized] ?? 'txt';
}

/**
 * Generates a unique file ID.
 */
function generateFileId(): string {
  return `file-${nowMs()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Checks if a challenge description suggests test-driven development.
 *
 * @param description - Challenge description text
 * @returns True if TDD-related keywords are found
 */
function isTddChallenge(description: string): boolean {
  const tddKeywords = [
    'test',
    'tdd',
    'test-driven',
    'unit test',
    'testing',
    'write tests',
    'test case',
  ];
  const lowerDescription = description.toLowerCase();
  return tddKeywords.some((keyword) => lowerDescription.includes(keyword));
}

// =============================================================================
// Template Generation
// =============================================================================

/**
 * Generates starter code for a challenge.
 *
 * @param challenge - Challenge definition
 * @returns Starter code string
 */
function generateStarterCode(challenge: ChallengeDef): string {
  const extension = getLanguageExtension(challenge.language);
  
  // Language-specific starters
  const starters: Record<string, string> = {
    ts: `// ${challenge.title}
// ${challenge.description.split('\n')[0]}

export function solution() {
  // Your code here
}
`,
    js: `// ${challenge.title}
// ${challenge.description.split('\n')[0]}

export function solution() {
  // Your code here
}
`,
    py: `# ${challenge.title}
# ${challenge.description.split('\n')[0]}

def solution():
    # Your code here
    pass
`,
    java: `// ${challenge.title}
// ${challenge.description.split('\n')[0]}

public class Solution {
    public static void main(String[] args) {
        // Your code here
    }
}
`,
    go: `// ${challenge.title}
// ${challenge.description.split('\n')[0]}

package main

func solution() {
    // Your code here
}
`,
    rs: `// ${challenge.title}
// ${challenge.description.split('\n')[0]}

fn solution() {
    // Your code here
}
`,
  };

  return starters[extension] ?? `// ${challenge.title}\n// Your code here\n`;
}

/**
 * Generates workspace files for a challenge.
 *
 * Creates a main solution file and optionally a test file if the challenge
 * description suggests test-driven development.
 *
 * @param challenge - Challenge definition
 * @returns Array of workspace files
 *
 * @example
 * ```typescript
 * const challenge = {
 *   title: 'Reverse String',
 *   description: 'Write a function that reverses a string',
 *   language: 'TypeScript',
 *   difficulty: 'beginner',
 * };
 *
 * const files = getWorkspaceTemplate(challenge);
 * // Returns: [{ name: 'solution.ts', content: '...', ... }]
 * ```
 */
export function getWorkspaceTemplate(challenge: ChallengeDef): WorkspaceFile[] {
  const extension = getLanguageExtension(challenge.language);
  const normalizedLang = challenge.language.toLowerCase();
  const timestamp = now();
  const files: WorkspaceFile[] = [];

  // Main solution file
  const mainFile: WorkspaceFile = {
    id: generateFileId(),
    name: `solution.${extension}`,
    content: generateStarterCode(challenge),
    language: normalizedLang,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  files.push(mainFile);

  // Add test file if challenge mentions testing
  if (isTddChallenge(challenge.description)) {
    const testPattern = TEST_FILE_PATTERNS[normalizedLang];
    if (testPattern) {
      const testFile: WorkspaceFile = {
        id: generateFileId(),
        name: `solution${testPattern.suffix}`,
        content: testPattern.template,
        language: normalizedLang,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      files.push(testFile);
    }
  }

  return files;
}

/**
 * Creates a new empty file with defaults.
 *
 * @param name - File name (with extension)
 * @param language - Programming language
 * @returns New workspace file
 */
export function createEmptyFile(name: string, language: string): WorkspaceFile {
  const timestamp = now();
  return {
    id: generateFileId(),
    name,
    content: '',
    language: language.toLowerCase(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
