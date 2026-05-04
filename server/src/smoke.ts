import { app } from './app';
import { MemoryStore } from './store';
import { rmSync } from 'node:fs';

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

const createdTask = await json(
  app.request('/tasks', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Shared link smoke task',
      description: 'Check public share flow',
      date: '2026-05-04',
    }),
  }),
);
const createdTaskItem = readRecord(createdTask, 'item');
const sharedTaskId = readString(createdTaskItem, 'id');

const shareResponse = await json(
  app.request(`/tasks/${encodeURIComponent(sharedTaskId)}/share-link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
);
const share = readRecord(shareResponse, 'share');
const shareToken = readString(share, 'token');

const publicTask = await json(app.request(`/public/tasks/${encodeURIComponent(shareToken)}`));
assert(readRecord(publicTask, 'item').title === 'Shared link smoke task', 'public task failed');

const acceptedTask = await json(
  app.request(`/public/tasks/${encodeURIComponent(shareToken)}/accept`, {
    method: 'POST',
  }),
);
assert(typeof readRecord(acceptedTask, 'item').acceptedAt === 'string', 'public accept failed');

const completedTask = await json(
  app.request(`/public/tasks/${encodeURIComponent(shareToken)}/complete`, {
    method: 'POST',
  }),
);
assert(readRecord(completedTask, 'item').status === 'completed', 'public complete failed');

const authorTask = await json(
  app.request(`/tasks/${encodeURIComponent(sharedTaskId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
);
assert(readRecord(authorTask, 'item').status === 'completed', 'author sync failed');

const ideas = await json(
  app.request('/ideas', {
    headers: { Authorization: `Bearer ${accessToken}` },
  }),
);
assert(Array.isArray(ideas.items), 'ideas list failed');

const dataFile = `/tmp/task-manager-store-${crypto.randomUUID()}.json`;
const firstStore = new MemoryStore({ persistencePath: dataFile });
firstStore.createTask('user_1', {
  title: 'Persistent smoke task',
  date: '2026-04-28',
});
const secondStore = new MemoryStore({ persistencePath: dataFile });
const persistedTasks = secondStore.listTasksForUser('user_1');
assert(
  persistedTasks.some((task) => task.title === 'Persistent smoke task'),
  'persistent store failed',
);
rmSync(dataFile, { force: true });

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

function readRecord(record: JsonRecord, key: string) {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`${key} missing`);
  return value;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
