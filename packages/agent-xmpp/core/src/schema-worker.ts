import { parentPort } from 'node:worker_threads';

import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import { isXep0082DateTime } from '@agent-xmpp/protocol';

interface ValidationRequest {
  id: number;
  schemaHash: string;
  schema: Record<string, unknown>;
  value: unknown;
}

interface ValidationResponse {
  id: number;
  errors?: string[];
  failure?: string;
}

const ajv = new Ajv2020({
  strict: true,
  allErrors: true,
  validateSchema: true,
  unicodeRegExp: true,
  ownProperties: true,
});
ajv.addFormat('uri', {
  type: 'string',
  validate(value: string): boolean {
    try {
      return new URL(value).protocol.length > 1;
    } catch {
      return false;
    }
  },
});
ajv.addFormat('date-time', isXep0082DateTime);

const validators = new Map<string, ValidateFunction>();

parentPort?.on('message', (request: ValidationRequest) => {
  const response: ValidationResponse = { id: request.id };
  try {
    let validate = validators.get(request.schemaHash);
    if (!validate) {
      validate = ajv.compile(request.schema);
      validators.set(request.schemaHash, validate);
    }
    response.errors = validate(request.value) ? [] : (validate.errors ?? []).map(formatError);
  } catch (error) {
    response.failure = error instanceof Error ? error.message : String(error);
  }
  parentPort?.postMessage(response);
});

function formatError(error: ErrorObject): string {
  return `${error.instancePath || '$'} ${error.message ?? error.keyword}`;
}
