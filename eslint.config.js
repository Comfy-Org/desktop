import eslint from '@eslint/js';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Baseline include / exclude
  { files: ['**/*.{js,cjs,mjs,ts,mts}'] },
  { ignores: ['dist/**/*', 'jest.config.cjs', 'scripts/shims/**/*'] },

  // Baseline
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-empty-pattern': ['error', { allowObjectPatternsAsParameters: true }],
      'no-control-regex': 'off',

      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/prefer-readonly': 'warn',
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
      'unicorn/explicit-length-check': 'off',
      'unicorn/consistent-function-scoping': 'off',
      'unicorn/prefer-event-target': 'off',
      'unicorn/prefer-ternary': ['error', 'only-single-line'],
      'unicorn/no-nested-ternary': 'off',
    },
  },

  // Scripts
  {
    files: ['scripts/**/*'],
    rules: {
      'unicorn/no-process-exit': 'off',
    },
  },

  // Tests
  {
    files: ['tests/**/*'],
    rules: {
      'unicorn/prefer-module': 'off',
      'unicorn/no-useless-undefined': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // Forbid import of Electron's any-typed ipcMain / ipcRenderer.
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              importNames: ['ipcMain', 'ipcRenderer'],
              message: "Import strictIpcMain/strictIpcRenderer from '@/ipc/strictIpc' instead of Electron's IPC.",
            },
            {
              name: 'electron/main',
              importNames: ['ipcMain'],
              message: "Import strictIpcMain from '@/ipc/strictIpc' instead of Electron's IPC.",
            },
            {
              name: 'electron/renderer',
              importNames: ['ipcRenderer'],
              message: "Import strictIpcRenderer from '@/ipc/strictIpc' instead of Electron's IPC.",
            },
          ],
        },
      ],
    },
  },
  // Override restricted imports for strictIpc.ts.
  {
    files: ['src/infrastructure/ipcChannels.ts'],
    rules: { 'no-restricted-imports': 'off' },
  }
);
