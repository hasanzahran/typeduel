import { readFileSync, writeFileSync } from 'node:fs';
const source = JSON.parse(
  readFileSync(new URL('../docs/design/tokens.json', import.meta.url), 'utf8'),
);
const target = new URL(
  '../apps/mobile/src/theme/tokens.generated.ts',
  import.meta.url,
);
const text =
  '// Generated from docs/design/tokens.json. Run pnpm tokens:generate.\nexport const tokens = ' +
  JSON.stringify(source, null, 2) +
  ' as const;\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== text)
    throw new Error('Design tokens drifted. Run pnpm tokens:generate.');
} else writeFileSync(target, text);
