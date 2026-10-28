import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { readEnvironment } from '../src/config/env.js';
import { HealthSchema, ErrorSchema } from '@typeduel/contracts';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function create() {
  const app = buildApp();
  apps.push(app);
  return app;
}
describe('M0 API', () => {
  it('serves the shared liveness contract', async () => {
    const response = await create().inject('/health/live');
    expect(response.statusCode).toBe(200);
    expect(HealthSchema.parse(response.json()).status).toBe('ok');
  });
  it('does not claim database readiness or multiplayer', async () => {
    for (const url of ['/health/ready', '/v1/rooms']) {
      const response = await create().inject(url);
      expect(response.statusCode).toBe(404);
      expect(ErrorSchema.parse(response.json()).code).toBe('NOT_FOUND');
    }
  });
  it('sanitizes internal failures', async () => {
    const app = create();
    app.get('/failure', () => {
      throw new Error('private diagnostic');
    });
    const response = await app.inject('/failure');
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private diagnostic');
    expect(ErrorSchema.parse(response.json()).requestId).toBeTruthy();
  });
  it('rejects invalid environment configuration', () => {
    for (const PORT of ['0', '65536', 'oops'])
      expect(() => readEnvironment({ PORT })).toThrow(
        'Invalid server configuration',
      );
    expect(readEnvironment({}).PORT).toBe(3000);
  });
});
