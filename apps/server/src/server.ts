import { buildApp } from './app.js';
import { readEnvironment } from './config/env.js';
const env = readEnvironment();
const app = buildApp(env.LOG_LEVEL);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await app.close();
    clearTimeout(deadline);
  } catch {
    process.exitCode = 1;
  }
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch {
  app.log.error('Unable to start API');
  process.exitCode = 1;
}
