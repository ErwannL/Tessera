import { z } from 'zod';
import type { Config } from '../config.js';
import {
  cancelBody,
  createRequestBody,
  createResponse,
  errorResponse,
  eventsResponse,
  requestView,
  verifyBody,
  verifyResponse,
} from '../domain/schemas.js';

const json = (schema: z.ZodType, io: 'input' | 'output') => ({
  'application/json': { schema: z.toJSONSchema(schema, { io, unrepresentable: 'any' }) },
});

const reply = (description: string, schema: z.ZodType) => ({
  description,
  content: json(schema, 'output'),
});

const errors = (...codes: string[]) =>
  Object.fromEntries(codes.map((code) => [code, reply(`Error ${code}`, errorResponse)]));

const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

/** OpenAPI 3.1 document generated from the same Zod schemas that validate requests. */
export function buildOpenApi(config: Config) {
  const create = createRequestBody({
    min: config.MIN_EXPIRES_IN_SECONDS,
    max: config.MAX_EXPIRES_IN_SECONDS,
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tessera API',
      version: '1.0.0',
      description: 'Server-to-server API. Tessera records a technical validation trace.',
    },
    servers: [{ url: `${config.PUBLIC_URL}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' } },
    },
    paths: {
      '/requests': {
        post: {
          summary: 'Create an authorization request; the code is returned only here',
          parameters: [
            {
              name: 'Idempotency-Key',
              in: 'header',
              required: false,
              schema: { type: 'string', minLength: 1, maxLength: 128 },
            },
          ],
          requestBody: { required: true, content: json(create, 'input') },
          responses: {
            201: reply('Created', createResponse),
            200: reply('Idempotent replay (code is null)', createResponse),
            ...errors('400', '401', '409', '422', '429'),
          },
        },
      },
      '/requests/{id}': {
        get: {
          summary: 'Read a request (never its code)',
          parameters: [idParameter],
          responses: { 200: reply('Request', requestView), ...errors('401', '404') },
        },
      },
      '/requests/{id}/verify': {
        post: {
          summary: 'Verify the code of this request',
          parameters: [idParameter],
          requestBody: { required: true, content: json(verifyBody, 'input') },
          responses: {
            200: reply('Approved', verifyResponse),
            ...errors('400', '401', '404', '409', '410', '422', '423', '429'),
          },
        },
      },
      '/requests/{id}/cancel': {
        post: {
          summary: 'Cancel a pending request (idempotent)',
          parameters: [idParameter],
          requestBody: { required: false, content: json(cancelBody, 'input') },
          responses: {
            200: reply('Cancelled', requestView),
            ...errors('400', '401', '404', '409'),
          },
        },
      },
      '/requests/{id}/events': {
        get: {
          summary: 'Hash-chained history of a request',
          parameters: [idParameter],
          responses: { 200: reply('History', eventsResponse), ...errors('401', '404') },
        },
      },
    },
  };
}
