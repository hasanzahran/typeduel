import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const files = walk('apps/mobile/dist');
if (!files.some((f) => /\.(js|hbc)$/.test(f)))
  throw new Error('No exported mobile bundles');
for (const file of files) {
  if (/\.(png|jpg|ttf|woff2?|ico)$/.test(file)) continue;
  const content = readFileSync(file).toString();
  for (const marker of [
    'TYPE_DUEL_M0_FIXTURE_SENTINEL',
    'Development preview · Mock data',
  ])
    if (content.includes(marker))
      throw new Error('Development fixture leaked: ' + file);
}
console.log('Production exports exclude development fixture markers.');
