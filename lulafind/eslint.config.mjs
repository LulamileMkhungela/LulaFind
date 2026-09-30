// @ts-check
/**
 * ESLint flat config.
 *
 * Kept deliberately small: the test suite, the browser drives and the
 * TypeScript compiler carry most of the quality work. Lint adds the
 * mistakes that survive a compile: unused variables, impossible
 * comparisons, `===` against `null ==`, and similar.
 *
 *   npm run lint
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['www/**', 'dist/**', 'android/**', 'ios/**', 'native/**', 'scripts/**', '**/*.d.ts']
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        projectService: false
      }
    },
    rules: {
      // The app passes `any` at deliberate seams (plugin errors, dynamic
      // imports, demo data). The tests and the drives cover the rest.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // `require` stays out of src; the dynamic imports are the real pattern.
      '@typescript-eslint/no-require-imports': 'error'
    }
  },
  {
    files: ['src/**/*.spec.ts', 'src/**/*.component.ts'],
    rules: {
      // Components embed their templates/styles as template strings; the
      // quotes inside them are content, not style mistakes.
      quotes: 'off'
    }
  }
);
