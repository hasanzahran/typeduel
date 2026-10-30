import Fastify from 'fastify';
import { ErrorSchema } from '@typeduel/contracts';
import { healthRoutes } from './http/health.js';
export function buildApp(logLevel: string = 'silent') {
  const app = Fastify({
    logger:
      logLevel === 'silent'
        ? false
        : {
            level: logLevel,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers.x-typeduel-session-id',
            ],
            serializers: {
              req: (req) => ({
                method: req.method,
              }),
            },
          },
    bodyLimit: 16384,
  });
  healthRoutes(app);
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(
      ErrorSchema.parse({
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: request.id,
      }),
    ),
  );
  app.setErrorHandler((error, request, reply) => {
    const candidate =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? error.statusCode
        : undefined;
    const status =
      typeof candidate === 'number' && candidate >= 400 && candidate < 500
        ? candidate
        : 500;
    request.log.error({ requestId: request.id, status }, 'Request failed');
    return reply.code(status).send(
      ErrorSchema.parse({
        code: status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
        message: status >= 500 ? 'Something went wrong' : 'Invalid request',
        requestId: request.id,
      }),
    );
  });
  return app;
}
