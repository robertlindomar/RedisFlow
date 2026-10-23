import { defineConfig, globalIgnores } from 'eslint/config';
import regrasNext from 'eslint-config-next/core-web-vitals';
import regrasTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...regrasNext,
  ...regrasTypescript,
  globalIgnores(['.next/**', 'node_modules/**', 'next-env.d.ts']),
]);
