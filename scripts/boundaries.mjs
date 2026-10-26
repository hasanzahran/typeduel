import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
for (const file of [
  ...walk('apps/mobile/src'),
  ...walk('apps/mobile/app'),
  ...walk('packages/contracts/src'),
]) {
  if (!/\.[jt]sx?$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (
    /(?:from\s*|require\s*\()\s*['"][^'"]*(?:@typeduel\/server|\/server\/|word-audio|word-editorial)/.test(
      text,
    )
  )
    throw new Error('Server boundary violation: ' + file);
}
console.log('Mobile/public contract import boundaries passed.');
