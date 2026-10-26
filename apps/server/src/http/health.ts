import type { FastifyInstance } from 'fastify';
import { HealthSchema } from '@typeduel/contracts';
export function healthRoutes(app: FastifyInstance) {
  app.get('/health/live', () =>
    HealthSchema.parse({ status: 'ok', service: 'typeduel-api' }),
  );
}
