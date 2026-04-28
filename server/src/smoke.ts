import { app } from './app';

type JsonRecord = Record<string, unknown>;

const startResponse = await json(
  app.request('/auth/phone/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '+79990000000' }),
  }),
);

const challengeId = readString(startResponse, 'challengeId');
const devCode = readString(startResponse, 'devCode');

const authResponse = await json(
  app.request('/auth/phone/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, code: devCode }),
  }),
);

const accessToken = readString(authResponse, 'accessToken');

const health = await json(app.request('/health'));
assert(health.ok === true, 'health failed');

const tasks = await json(
  app.request('/tasks', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
);
assert(Array.isArray(tasks.items), 'tasks list failed');

const ideas = await json(
  app.request('/ideas', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
);
assert(Array.isArray(ideas.items), 'ideas list failed');

console.log('server smoke ok');

async function json(responseValue: Response | Promise<Response>) {
  const response = await responseValue;
  const payload = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`request failed ${response.status}: ${JSON.stringify(payload)}`);
  }
  if (!isRecord(payload)) throw new Error('response is not an object');
  return payload;
}

function readString(record: JsonRecord, key: string) {
  const value = record[key];
  if (typeof value !== 'string' || !value) throw new Error(`${key} missing`);
  return value;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
