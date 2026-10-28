import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/tokens.generated.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['apps/mobile/app/*.tsx', 'apps/mobile/jest.setup.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        __DEV__: 'readonly',
        require: 'readonly',
        module: 'readonly',
      },
    },
  },
  {
    files: ['apps/mobile/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/server/**', '**/tools/word-*', '@typeduel/server'] },
      ],
    },
  },
);
