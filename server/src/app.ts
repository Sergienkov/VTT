import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

import {
  ideaInputFromRecord,
  ideaPatchFromRecord,
  readRequiredString,
  readString,
  store,
  taskInputFromRecord,
  taskPatchFromRecord,
} from './store';
import type { SyncChange, TaskStatus, User } from './types';

type AppEnv = {
  Variables: {
    accessToken: string;
    user: User;
  };
};

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 500;

export const app = new Hono<AppEnv>();

app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.onError((error, c) => {
  if (error.message === 'invalid_json' || error.message.endsWith('_required')) {
    return jsonError(c, 400, error.message, 'Invalid request body.');
  }
  console.error(error);
  return jsonError(c, 500, 'internal_error', 'Unexpected server error.');
});

app.notFound((c) => jsonError(c, 404, 'not_found', 'Route not found.'));

app.get('/', (c) =>
  c.json({
    name: 'task-manager-api',
    runtime: 'bun',
    docs: '/health',
  }),
);

app.get('/health', (c) => c.json(store.health()));

app.post('/auth/phone/start', async (c) => {
  const body = await bodyRecord(c);
  const phone = readRequiredString(body, 'phone');
  const challenge = store.startPhoneChallenge(phone);
  const response: Record<string, string> = {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
  };
  if (process.env.NODE_ENV !== 'production') response.devCode = challenge.code;
  return c.json(response);
});

app.post('/auth/phone/verify', async (c) => {
  const body = await bodyRecord(c);
  const challengeId = readRequiredString(body, 'challengeId');
  const code = readRequiredString(body, 'code');
  const result = store.verifyPhoneChallenge(challengeId, code);
  if (!result) return jsonError(c, 401, 'invalid_code', 'Confirmation code is invalid or expired.');
  return c.json(authPayload(result.user, result.session));
});

app.post('/auth/refresh', async (c) => {
  const body = await bodyRecord(c);
  const refreshToken = readRequiredString(body, 'refreshToken');
  const result = store.refreshSession(refreshToken);
  if (!result) return jsonError(c, 401, 'invalid_refresh_token', 'Refresh token is invalid.');
  return c.json(authPayload(result.user, result.session));
});

const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') ?? c.req.header('authorization');
  const accessToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!accessToken) return jsonError(c, 401, 'unauthorized', 'Bearer token is required.');

  const session = store.getSessionByAccessToken(accessToken);
  if (!session) return jsonError(c, 401, 'invalid_token', 'Bearer token is invalid.');

  const user = store.getUser(session.userId);
  if (!user) return jsonError(c, 401, 'invalid_token', 'Session user does not exist.');

  c.set('accessToken', accessToken);
  c.set('user', user);
  await next();
};

app.post('/auth/logout', requireAuth, (c) => {
  store.revokeSession(c.get('accessToken'));
  return c.json({ ok: true });
});

const protectedRoutes = new Hono<AppEnv>();
protectedRoutes.use('*', requireAuth);

protectedRoutes.get('/me', (c) => c.json({ user: c.get('user') }));

protectedRoutes.patch('/me', async (c) => {
  const body = await bodyRecord(c);
  const user = store.updateUser(c.get('user').id, {
    name: readString(body, 'name'),
    avatarUrl: readString(body, 'avatarUrl'),
  });
  if (!user) return jsonError(c, 404, 'user_not_found', 'User not found.');
  return c.json({ user });
});

protectedRoutes.get('/tasks', (c) => {
  const user = c.get('user');
  const scope = parseScope(c.req.query('scope'));
  const status = parseTaskStatus(c.req.query('status'));
  const tasks = store.listTasksForUser(user.id, {
    date: c.req.query('date'),
    scope,
    status,
    updatedSince: c.req.query('updatedSince'),
  });
  return c.json({ items: tasks, syncCursor: new Date().toISOString() });
});

protectedRoutes.post('/tasks', async (c) => {
  const body = await bodyRecord(c);
  const task = store.createTask(c.get('user').id, taskInputFromRecord(body));
  return c.json({ item: task }, 201);
});

protectedRoutes.get('/tasks/:id', (c) => {
  const task = store.getTaskForUser(c.req.param('id'), c.get('user').id);
  if (!task) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: task });
});

protectedRoutes.patch('/tasks/:id', async (c) => {
  const body = await bodyRecord(c);
  const task = store.updateTask(c.get('user').id, c.req.param('id'), taskPatchFromRecord(body));
  if (!task) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: task });
});

protectedRoutes.delete('/tasks/:id', (c) => {
  const task = store.softDeleteTask(c.get('user').id, c.req.param('id'));
  if (!task) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: task });
});

protectedRoutes.post('/tasks/:id/complete', (c) => setTaskStatus(c, 'completed'));
protectedRoutes.post('/tasks/:id/reopen', (c) => setTaskStatus(c, 'active'));

protectedRoutes.post('/tasks/:id/seen', (c) => {
  const task = store.markTaskSeen(c.get('user').id, c.req.param('id'));
  if (!task) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: task });
});

protectedRoutes.get('/tasks/:id/comments', (c) => {
  const comments = store.listCommentsForTask(
    c.get('user').id,
    c.req.param('id'),
    c.req.query('updatedSince'),
  );
  if (!comments) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ items: comments });
});

protectedRoutes.post('/tasks/:id/comments', async (c) => {
  const body = await bodyRecord(c);
  const comment = store.createComment(
    c.get('user').id,
    c.req.param('id'),
    readRequiredString(body, 'body'),
    readString(body, 'id'),
  );
  if (!comment) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: comment }, 201);
});

protectedRoutes.patch('/comments/:id', async (c) => {
  const body = await bodyRecord(c);
  const comment = store.updateComment(
    c.get('user').id,
    c.req.param('id'),
    readRequiredString(body, 'body'),
  );
  if (!comment) return jsonError(c, 404, 'comment_not_found', 'Comment not found.');
  return c.json({ item: comment });
});

protectedRoutes.delete('/comments/:id', (c) => {
  const comment = store.softDeleteComment(c.get('user').id, c.req.param('id'));
  if (!comment) return jsonError(c, 404, 'comment_not_found', 'Comment not found.');
  return c.json({ item: comment });
});

protectedRoutes.get('/ideas', (c) => {
  const ideas = store.listIdeasForUser(c.get('user').id, c.req.query('updatedSince'));
  return c.json({ items: ideas, syncCursor: new Date().toISOString() });
});

protectedRoutes.post('/ideas', async (c) => {
  const body = await bodyRecord(c);
  const idea = store.createIdea(c.get('user').id, ideaInputFromRecord(body));
  return c.json({ item: idea }, 201);
});

protectedRoutes.get('/ideas/:id', (c) => {
  const idea = store.getIdeaForUser(c.get('user').id, c.req.param('id'));
  if (!idea) return jsonError(c, 404, 'idea_not_found', 'Idea not found.');
  return c.json({ item: idea });
});

protectedRoutes.patch('/ideas/:id', async (c) => {
  const body = await bodyRecord(c);
  const idea = store.updateIdea(c.get('user').id, c.req.param('id'), ideaPatchFromRecord(body));
  if (!idea) return jsonError(c, 404, 'idea_not_found', 'Idea not found.');
  return c.json({ item: idea });
});

protectedRoutes.delete('/ideas/:id', (c) => {
  const idea = store.softDeleteIdea(c.get('user').id, c.req.param('id'));
  if (!idea) return jsonError(c, 404, 'idea_not_found', 'Idea not found.');
  return c.json({ item: idea });
});

protectedRoutes.post('/ideas/:id/convert', async (c) => {
  const body = await optionalBodyRecord(c);
  const result = store.convertIdeaToTask(c.get('user').id, c.req.param('id'), {
    date: readString(body, 'date') ?? todayDate(),
    time: readString(body, 'time'),
    focus: body.focus === true,
    important: body.important === true,
  });
  if (!result) return jsonError(c, 404, 'idea_not_found', 'Idea not found.');
  return c.json(result, 201);
});

protectedRoutes.get('/links', (c) => c.json({ items: store.listLinks(c.get('user').id) }));

protectedRoutes.post('/links/invite', async (c) => {
  const body = await bodyRecord(c);
  const user = store.inviteLink(readRequiredString(body, 'phone'), readString(body, 'name'));
  return c.json({ user }, 201);
});

protectedRoutes.post('/links/accept', async (c) => {
  const body = await optionalBodyRecord(c);
  const phone = readString(body, 'phone');
  const user = phone ? store.inviteLink(phone, readString(body, 'name')) : c.get('user');
  return c.json({ ok: true, user });
});

protectedRoutes.get('/events', (c) => {
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  return c.json({ items: store.listEvents(c.get('user').id, unreadOnly) });
});

protectedRoutes.post('/events/:id/read', (c) => {
  const event = store.markEventRead(c.get('user').id, c.req.param('id'));
  if (!event) return jsonError(c, 404, 'event_not_found', 'Event not found.');
  return c.json({ item: event });
});

protectedRoutes.post('/device-tokens', async (c) => {
  const body = await bodyRecord(c);
  const platform = readRequiredString(body, 'platform');
  if (platform !== 'ios' && platform !== 'android' && platform !== 'web') {
    return jsonError(c, 400, 'invalid_platform', 'Platform must be ios, android, or web.');
  }
  const deviceToken = store.saveDeviceToken(c.get('user').id, {
    platform,
    token: readRequiredString(body, 'token'),
  });
  return c.json({ item: deviceToken }, 201);
});

protectedRoutes.delete('/device-tokens/:id', (c) => {
  const deviceToken = store.deleteDeviceToken(c.get('user').id, c.req.param('id'));
  if (!deviceToken) return jsonError(c, 404, 'device_token_not_found', 'Device token not found.');
  return c.json({ item: deviceToken });
});

protectedRoutes.get('/sync', (c) => c.json(store.pullSync(c.get('user').id, c.req.query('cursor'))));

protectedRoutes.post('/sync/push', async (c) => {
  const body = await bodyRecord(c);
  const changes = body.changes;
  if (!Array.isArray(changes)) {
    return jsonError(c, 400, 'changes_required', 'Changes must be an array.');
  }
  return c.json(store.pushSync(c.get('user').id, changes as SyncChange[]));
});

app.route('/', protectedRoutes);

async function bodyRecord(c: Context) {
  const body = await optionalBodyRecord(c);
  if (!Object.keys(body).length) throw new Error('invalid_json');
  return body;
}

async function optionalBodyRecord(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.includes('application/json')) return {};
  try {
    const body = (await c.req.json()) as unknown;
    return isRecord(body) ? body : {};
  } catch {
    throw new Error('invalid_json');
  }
}

function setTaskStatus(c: Context<AppEnv>, status: TaskStatus) {
  const taskId = c.req.param('id');
  if (!taskId) return jsonError(c, 400, 'task_id_required', 'Task id is required.');
  const task = store.setTaskStatus(c.get('user').id, taskId, status);
  if (!task) return jsonError(c, 404, 'task_not_found', 'Task not found.');
  return c.json({ item: task });
}

function authPayload(user: User, session: { accessToken: string; refreshToken: string; expiresAt: string }) {
  return {
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
    user,
  };
}

function jsonError(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

function parseScope(scope?: string) {
  return scope === 'personal' || scope === 'shared' || scope === 'all' ? scope : undefined;
}

function parseTaskStatus(status?: string) {
  return status === 'active' || status === 'completed' ? status : undefined;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
