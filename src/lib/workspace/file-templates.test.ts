/**
 * Tests for File Templates.
 *
 * Tests the file template generation for different programming languages.
 * These are pure functions that return template configurations.
 */

import { describe, it, expect } from 'vitest';
import {
  getFileTemplatesForLanguage,
  getFilePathFromTemplate,
  type FileTemplate,
} from './file-templates';

describe('File Templates', () => {
  // ===========================================================================
  // getFileTemplatesForLanguage() - TypeScript
  // ===========================================================================

  describe('getFileTemplatesForLanguage - TypeScript', () => {
    it('should return TypeScript templates', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      expect(templates.length).toBeGreaterThan(0);
      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New TypeScript file');
      expect(labels).toContain('New test file');
      expect(labels).toContain('New utils file');
      expect(labels).toContain('New config file');
    });

    it('should include common templates', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New README');
      expect(labels).toContain('New workflow');
    });

    it('should use .ts extension for TypeScript', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const tsFile = templates.find((t) => t.label === 'New TypeScript file');
      expect(tsFile?.filename).toBe('untitled.ts');
    });

    it('should use .test.ts for test files', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const testFile = templates.find((t) => t.label === 'New test file');
      expect(testFile?.filename).toBe('untitled.test.ts');
    });

    it('should suggest tsconfig.json for config', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('tsconfig.json');
    });

    it('should assign appropriate icons', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const mainFile = templates.find((t) => t.label === 'New TypeScript file');
      const testFile = templates.find((t) => t.label === 'New test file');
      const utilsFile = templates.find((t) => t.label === 'New utils file');
      const configFile = templates.find((t) => t.label === 'New config file');

      expect(mainFile?.icon).toBe('file-code');
      expect(testFile?.icon).toBe('beaker');
      expect(utilsFile?.icon).toBe('tools');
      expect(configFile?.icon).toBe('gear');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - JavaScript
  // ===========================================================================

  describe('getFileTemplatesForLanguage - JavaScript', () => {
    it('should return JavaScript templates', () => {
      const templates = getFileTemplatesForLanguage('JavaScript');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New JavaScript file');
      expect(labels).toContain('New test file');
    });

    it('should use .js extension', () => {
      const templates = getFileTemplatesForLanguage('JavaScript');

      const jsFile = templates.find((t) => t.label === 'New JavaScript file');
      expect(jsFile?.filename).toBe('untitled.js');
    });

    it('should suggest package.json for config', () => {
      const templates = getFileTemplatesForLanguage('JavaScript');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('package.json');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Python
  // ===========================================================================

  describe('getFileTemplatesForLanguage - Python', () => {
    it('should return Python templates', () => {
      const templates = getFileTemplatesForLanguage('Python');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New Python file');
      expect(labels).toContain('New test file');
    });

    it('should use .py extension', () => {
      const templates = getFileTemplatesForLanguage('Python');

      const pyFile = templates.find((t) => t.label === 'New Python file');
      expect(pyFile?.filename).toBe('untitled.py');
    });

    it('should use test_ prefix for test files', () => {
      const templates = getFileTemplatesForLanguage('Python');

      const testFile = templates.find((t) => t.label === 'New test file');
      expect(testFile?.filename).toBe('test_untitled.py');
    });

    it('should suggest requirements.txt for config', () => {
      const templates = getFileTemplatesForLanguage('Python');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('requirements.txt');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Go
  // ===========================================================================

  describe('getFileTemplatesForLanguage - Go', () => {
    it('should return Go templates', () => {
      const templates = getFileTemplatesForLanguage('Go');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New Go file');
      expect(labels).toContain('New test file');
    });

    it('should use .go extension', () => {
      const templates = getFileTemplatesForLanguage('Go');

      const goFile = templates.find((t) => t.label === 'New Go file');
      expect(goFile?.filename).toBe('untitled.go');
    });

    it('should use _test.go suffix for test files', () => {
      const templates = getFileTemplatesForLanguage('Go');

      const testFile = templates.find((t) => t.label === 'New test file');
      expect(testFile?.filename).toBe('untitled_test.go');
    });

    it('should suggest go.mod for module file', () => {
      const templates = getFileTemplatesForLanguage('Go');

      const moduleFile = templates.find((t) => t.label === 'New module file');
      expect(moduleFile?.filename).toBe('go.mod');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Rust
  // ===========================================================================

  describe('getFileTemplatesForLanguage - Rust', () => {
    it('should return Rust templates', () => {
      const templates = getFileTemplatesForLanguage('Rust');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New Rust file');
      expect(labels).toContain('New test file');
    });

    it('should use .rs extension', () => {
      const templates = getFileTemplatesForLanguage('Rust');

      const rsFile = templates.find((t) => t.label === 'New Rust file');
      expect(rsFile?.filename).toBe('untitled.rs');
    });

    it('should suggest Cargo.toml for config', () => {
      const templates = getFileTemplatesForLanguage('Rust');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('Cargo.toml');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Java
  // ===========================================================================

  describe('getFileTemplatesForLanguage - Java', () => {
    it('should return Java templates', () => {
      const templates = getFileTemplatesForLanguage('Java');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New Java file');
      expect(labels).toContain('New test file');
    });

    it('should use PascalCase for Java files', () => {
      const templates = getFileTemplatesForLanguage('Java');

      const javaFile = templates.find((t) => t.label === 'New Java file');
      expect(javaFile?.filename).toBe('Untitled.java');
    });

    it('should use Test suffix for test files', () => {
      const templates = getFileTemplatesForLanguage('Java');

      const testFile = templates.find((t) => t.label === 'New test file');
      expect(testFile?.filename).toBe('UntitledTest.java');
    });

    it('should suggest pom.xml for config', () => {
      const templates = getFileTemplatesForLanguage('Java');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('pom.xml');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - C#
  // ===========================================================================

  describe('getFileTemplatesForLanguage - C#', () => {
    it.each([
      ['C#'],
      ['c#'],
      ['CSharp'],
      ['csharp'],
    ])('should return C# templates for %s', (language) => {
      const templates = getFileTemplatesForLanguage(language);

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New C# file');
    });

    it('should use .cs extension', () => {
      const templates = getFileTemplatesForLanguage('C#');

      const csFile = templates.find((t) => t.label === 'New C# file');
      expect(csFile?.filename).toBe('Untitled.cs');
    });

    it('should use Tests suffix for test files', () => {
      const templates = getFileTemplatesForLanguage('C#');

      const testFile = templates.find((t) => t.label === 'New test file');
      expect(testFile?.filename).toBe('UntitledTests.cs');
    });

    it('should suggest .csproj for config', () => {
      const templates = getFileTemplatesForLanguage('C#');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('project.csproj');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Ruby
  // ===========================================================================

  describe('getFileTemplatesForLanguage - Ruby', () => {
    it('should return Ruby templates', () => {
      const templates = getFileTemplatesForLanguage('Ruby');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New Ruby file');
    });

    it('should use .rb extension', () => {
      const templates = getFileTemplatesForLanguage('Ruby');

      const rbFile = templates.find((t) => t.label === 'New Ruby file');
      expect(rbFile?.filename).toBe('untitled.rb');
    });

    it('should suggest Gemfile for config', () => {
      const templates = getFileTemplatesForLanguage('Ruby');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('Gemfile');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - PHP
  // ===========================================================================

  describe('getFileTemplatesForLanguage - PHP', () => {
    it('should return PHP templates', () => {
      const templates = getFileTemplatesForLanguage('PHP');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New PHP file');
    });

    it('should use .php extension', () => {
      const templates = getFileTemplatesForLanguage('PHP');

      const phpFile = templates.find((t) => t.label === 'New PHP file');
      expect(phpFile?.filename).toBe('untitled.php');
    });

    it('should suggest composer.json for config', () => {
      const templates = getFileTemplatesForLanguage('PHP');

      const configFile = templates.find((t) => t.label === 'New config file');
      expect(configFile?.filename).toBe('composer.json');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Unknown languages
  // ===========================================================================

  describe('getFileTemplatesForLanguage - unknown languages', () => {
    it('should return fallback templates for unknown language', () => {
      const templates = getFileTemplatesForLanguage('Brainfuck');

      expect(templates.length).toBeGreaterThan(0);
      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New file');
      expect(labels).toContain('New test file');
    });

    it('should use .txt extension for unknown language', () => {
      const templates = getFileTemplatesForLanguage('Unknown');

      const genericFile = templates.find((t) => t.label === 'New file');
      expect(genericFile?.filename).toBe('untitled.txt');
    });

    it('should still include common templates for unknown language', () => {
      const templates = getFileTemplatesForLanguage('Unknown');

      const labels = templates.map((t) => t.label);
      expect(labels).toContain('New README');
      expect(labels).toContain('New workflow');
    });
  });

  // ===========================================================================
  // getFileTemplatesForLanguage() - Case insensitivity
  // ===========================================================================

  describe('getFileTemplatesForLanguage - case insensitivity', () => {
    it.each([
      ['typescript', 'New TypeScript file'],
      ['TypeScript', 'New TypeScript file'],
      ['TYPESCRIPT', 'New TypeScript file'],
      ['python', 'New Python file'],
      ['Python', 'New Python file'],
      ['PYTHON', 'New Python file'],
      ['go', 'New Go file'],
      ['Go', 'New Go file'],
      ['GO', 'New Go file'],
    ])('should normalize %s and find %s', (language, expectedLabel) => {
      const templates = getFileTemplatesForLanguage(language);

      const labels = templates.map((t) => t.label);
      expect(labels).toContain(expectedLabel);
    });
  });

  // ===========================================================================
  // Common templates
  // ===========================================================================

  describe('common templates', () => {
    it('should include README in all language templates', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'Unknown'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        const readme = templates.find((t) => t.label === 'New README');
        expect(readme).toBeDefined();
        expect(readme?.filename).toBe('README.md');
      });
    });

    it('should include workflow in all language templates', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'Unknown'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        const workflow = templates.find((t) => t.label === 'New workflow');
        expect(workflow).toBeDefined();
        expect(workflow?.filename).toBe('ci.yml');
      });
    });

    it('should assign workflow icon to workflow template', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const workflow = templates.find((t) => t.label === 'New workflow');
      expect(workflow?.icon).toBe('workflow');
    });

    it('should set subdirectory for workflow template', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      const workflow = templates.find((t) => t.label === 'New workflow');
      expect(workflow?.subdirectory).toBe('.github/workflows');
    });
  });

  // ===========================================================================
  // getFilePathFromTemplate() tests
  // ===========================================================================

  describe('getFilePathFromTemplate', () => {
    it('should return filename when no subdirectory', () => {
      const template: FileTemplate = {
        label: 'Test',
        filename: 'solution.ts',
        icon: 'file-code',
      };

      const path = getFilePathFromTemplate(template);

      expect(path).toBe('solution.ts');
    });

    it('should combine subdirectory and filename', () => {
      const template: FileTemplate = {
        label: 'Workflow',
        filename: 'ci.yml',
        icon: 'workflow',
        subdirectory: '.github/workflows',
      };

      const path = getFilePathFromTemplate(template);

      expect(path).toBe('.github/workflows/ci.yml');
    });

    it('should handle nested subdirectories', () => {
      const template: FileTemplate = {
        label: 'Deep file',
        filename: 'config.json',
        icon: 'gear',
        subdirectory: 'src/config/nested',
      };

      const path = getFilePathFromTemplate(template);

      expect(path).toBe('src/config/nested/config.json');
    });

    it('should handle empty subdirectory as no subdirectory', () => {
      const template: FileTemplate = {
        label: 'Test',
        filename: 'file.txt',
        icon: 'file-code',
        subdirectory: '',
      };

      const path = getFilePathFromTemplate(template);

      expect(path).toBe('file.txt');
    });
  });

  // ===========================================================================
  // Template structure validation
  // ===========================================================================

  describe('template structure validation', () => {
    it('should return valid template objects', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      templates.forEach((template) => {
        expect(template).toHaveProperty('label');
        expect(template).toHaveProperty('filename');
        expect(template).toHaveProperty('icon');
        expect(typeof template.label).toBe('string');
        expect(typeof template.filename).toBe('string');
        expect(['file-code', 'beaker', 'tools', 'gear', 'workflow']).toContain(template.icon);
      });
    });

    it('should not have duplicate labels within same language', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        const labels = templates.map((t) => t.label);
        const uniqueLabels = new Set(labels);
        expect(labels.length).toBe(uniqueLabels.size);
      });
    });

    it('should not have empty filenames', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        templates.forEach((template) => {
          expect(template.filename.length).toBeGreaterThan(0);
        });
      });
    });

    it('should not have empty labels', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        templates.forEach((template) => {
          expect(template.label.length).toBeGreaterThan(0);
        });
      });
    });
  });

  // ===========================================================================
  // Template count validation
  // ===========================================================================

  describe('template count validation', () => {
    it('should return at least 4 templates for known languages', () => {
      const languages = ['TypeScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'Ruby', 'PHP'];

      languages.forEach((language) => {
        const templates = getFileTemplatesForLanguage(language);
        expect(templates.length).toBeGreaterThanOrEqual(4);
      });
    });

    it('should include language-specific + common templates', () => {
      const templates = getFileTemplatesForLanguage('TypeScript');

      // Should have TypeScript-specific (4) + common (2) = at least 6
      expect(templates.length).toBeGreaterThanOrEqual(6);
    });
  });
});
