import globals from 'globals';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';

export default tseslint.config(
  // Baseline include / exclude
  { files: ['**/*.{js,cjs,mjs,ts,mts}'] },
  { ignores: ['dist/**/*', 'jest.config.cjs'] },

  // Baseline
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vite.*.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      'no-control-regex': 'off',

      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },

  // Baseline (except preload)
  {
    ignores: ['./src/preload.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Preload
  {
    files: ['./src/preload.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Unicorn
  eslintPluginUnicorn.configs['flat/recommended'],
  {
    rules: {
      // Enable
      'unicorn/better-regex': 'warn',
      // Disable
      'unicorn/prefer-string-slice': 'off',
      'unicorn/no-negated-condition': 'off',
      'unicorn/filename-case': 'off',
      'unicorn/no-null': 'off',
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/switch-case-braces': 'off',
    },
  },

  // Scripts
  {
    files: ['scripts/**/*'],
    rules: {
      'unicorn/no-process-exit': 'off',
    },
  }
);
