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

// Reusable gameplay must not import the credential-entry/preview harness.
for (const dir of ['apps/mobile/src/audio', 'apps/mobile/src/features/match']) {
  for (const file of walk(dir)) {
    if (!/\.[jt]sx?$/.test(file) || /\.test\./.test(file)) continue;
    if (
      /(?:from\s*|require\s*\()\s*['"][^'"]*\/dev\//.test(
        readFileSync(file, 'utf8'),
      )
    )
      throw new Error('Development dependency in gameplay: ' + file);
  }
}
