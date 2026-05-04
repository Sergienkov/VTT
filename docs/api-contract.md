# MVP API Contract

This document describes the backend shape needed for the current Expo MVP. It is intentionally small: one user role, simple shared tasks, ideas, comments, phone auth, basic offline support, and sync.

## Principles

- The mobile app owns optimistic local state and uses UUIDs for new offline records.
- The server owns authentication, canonical timestamps, participant visibility, and sync cursors.
- MVP conflict handling is last-write-wins by `updatedAt`.
- Records are soft-deleted with `deletedAt` so offline clients can receive removals.
- A task is visible to its creator and task participants only.

## Core Entities

### User

```ts
type User = {
  id: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};
```

### Task

```ts
type TaskStatus = 'active' | 'completed';

type Task = {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  assigneeId?: string;
  status: TaskStatus;
  focus: boolean;
  important: boolean;
  seenBy: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  participants: TaskParticipant[];
};

type TaskParticipant = {
  userId: string;
  role: 'owner' | 'participant';
  addedAt: string;
};
```

### Idea

```ts
type Idea = {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  convertedTaskId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

### Comment

```ts
type Comment = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
```

### Event

```ts
type Event = {
  id: string;
  userId: string;
  type: 'task_created' | 'task_updated' | 'deadline_soon';
  taskId?: string;
  readAt?: string;
  createdAt: string;
};
```

## Auth

### Start Phone Login

`POST /auth/phone/start`

```json
{
  "phone": "+79990000000"
}
```

Response:

```json
{
  "challengeId": "otp_123",
  "expiresAt": "2026-04-28T12:10:00.000Z"
}
```

### Verify Code

`POST /auth/phone/verify`

```json
{
  "challengeId": "otp_123",
  "code": "1234"
}
```

Response:

```json
{
  "accessToken": "jwt",
  "refreshToken": "refresh",
  "user": {
    "id": "user_1",
    "phone": "+79990000000",
    "name": "Я",
    "createdAt": "2026-04-28T12:00:00.000Z",
    "updatedAt": "2026-04-28T12:00:00.000Z"
  }
}
```

### Other Auth Endpoints

- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `PATCH /me`

## Tasks

### List Tasks

`GET /tasks?date=2026-04-28&scope=all&status=active&updatedSince=2026-04-28T00:00:00.000Z`

Supported `scope` values:

- `all`
- `personal`
- `shared`

Response:

```json
{
  "items": [],
  "syncCursor": "cursor_123"
}
```

### Create Task

`POST /tasks`

```json
{
  "id": "client_uuid_optional",
  "title": "Проверить подписи в корпоративной почте",
  "description": "Короткий контекст",
  "date": "2026-04-28",
  "time": "12:30",
  "durationMinutes": 30,
  "assigneeId": "user_1",
  "participantIds": ["user_2"],
  "focus": true,
  "important": false
}
```

### Read, Update, Delete

- `GET /tasks/:id`
- `PATCH /tasks/:id`
- `DELETE /tasks/:id`

Patch accepts the same editable fields as creation. Delete is a soft delete.

### Complete Or Reopen

- `POST /tasks/:id/complete`
- `POST /tasks/:id/reopen`

### Mark Seen

`POST /tasks/:id/seen`

Used for the red dot and simplified "accepted/viewed" flow in shared tasks.

### Share With Existing User

`POST /tasks/:id/share/user`

```json
{
  "userId": "user_2",
  "phone": "+79990000001",
  "name": "Анна"
}
```

At least one of `userId` or `phone` is required. In MVP this adds the user as a participant and makes the task visible in their shared task list.

### Create Public Share Link

`POST /tasks/:id/share-link`

Response:

```json
{
  "item": {},
  "share": {
    "token": "unique_token",
    "url": "https://veratt.ru/task/unique_token"
  }
}
```

### Claim Public Share After Login

`POST /task-shares/claim`

```json
{
  "token": "unique_token"
}
```

Adds the authenticated user as a participant so the task appears in `Общие → Мои задачи`.

## Public Shared Task

These endpoints do not require authentication and expose only the single task identified by the token.

- `GET /public/tasks/:token`
- `POST /public/tasks/:token/accept`
- `POST /public/tasks/:token/complete`

Public response:

```json
{
  "item": {
    "token": "unique_token",
    "shareUrl": "https://veratt.ru/task/unique_token",
    "title": "Проверить задачу",
    "description": "Короткий контекст",
    "date": "2026-05-04",
    "time": "18:00",
    "durationMinutes": 30,
    "status": "active",
    "acceptedAt": "2026-05-04T10:00:00.000Z",
    "completedAt": "2026-05-04T11:00:00.000Z",
    "updatedAt": "2026-05-04T11:00:00.000Z"
  }
}
```

### Comments

- `GET /tasks/:id/comments`
- `POST /tasks/:id/comments`
- `PATCH /comments/:id`
- `DELETE /comments/:id`

## Ideas

### List Ideas

`GET /ideas?updatedSince=2026-04-28T00:00:00.000Z`

### Create Idea

`POST /ideas`

```json
{
  "id": "client_uuid_optional",
  "title": "Переносная энергостанция в защитном кейсе",
  "description": "LiFePO4-батарея, инвертор и индикатор заряда"
}
```

### Read, Update, Delete

- `GET /ideas/:id`
- `PATCH /ideas/:id`
- `DELETE /ideas/:id`

### Convert Idea To Task

`POST /ideas/:id/convert`

```json
{
  "date": "2026-04-28",
  "time": null,
  "focus": false,
  "important": false
}
```

Response returns both the updated idea and the created task.

## Links

The MVP does not need teams, roles, or organizations. "Links" are just users who share at least one task.

- `GET /links`
- `POST /links/invite`
- `POST /links/accept`

The first MVP can simplify this further by allowing a shared task to be created by phone number. If the target user does not exist, the server stores a pending participant by phone.

## Events And Notifications

- `GET /events?unreadOnly=true`
- `POST /events/:id/read`
- `POST /device-tokens`
- `DELETE /device-tokens/:id`

Push notification types:

- new shared task
- deadline reminder

Local reminders can be scheduled on-device from task date/time after sync.

## Sync

### Pull Changes

`GET /sync?cursor=cursor_123`

Response:

```json
{
  "cursor": "cursor_124",
  "serverTime": "2026-04-28T12:00:00.000Z",
  "tasks": [],
  "ideas": [],
  "comments": [],
  "events": []
}
```

### Push Local Changes

`POST /sync/push`

```json
{
  "clientId": "device_uuid",
  "baseCursor": "cursor_123",
  "changes": [
    {
      "entity": "task",
      "op": "upsert",
      "clientMutationId": "mutation_uuid",
      "data": {}
    }
  ]
}
```

Response:

```json
{
  "accepted": ["mutation_uuid"],
  "rejected": [],
  "cursor": "cursor_124",
  "changes": {
    "tasks": [],
    "ideas": [],
    "comments": [],
    "events": []
  }
}
```

## Minimal Database Schema

```sql
users (
  id uuid primary key,
  phone text unique not null,
  name text,
  avatar_url text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

phone_otps (
  id uuid primary key,
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

sessions (
  id uuid primary key,
  user_id uuid references users(id),
  refresh_token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

tasks (
  id uuid primary key,
  owner_id uuid references users(id),
  title text not null,
  description text,
  task_date date not null,
  task_time time,
  duration_minutes int,
  assignee_id uuid references users(id),
  status text not null,
  focus boolean not null default false,
  important boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

task_participants (
  task_id uuid references tasks(id),
  user_id uuid references users(id),
  role text not null,
  seen_at timestamptz,
  added_at timestamptz not null,
  primary key (task_id, user_id)
);

comments (
  id uuid primary key,
  task_id uuid references tasks(id),
  author_id uuid references users(id),
  body text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

ideas (
  id uuid primary key,
  owner_id uuid references users(id),
  title text not null,
  description text,
  converted_task_id uuid references tasks(id),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz
);

events (
  id uuid primary key,
  user_id uuid references users(id),
  type text not null,
  task_id uuid references tasks(id),
  read_at timestamptz,
  created_at timestamptz not null
);

device_tokens (
  id uuid primary key,
  user_id uuid references users(id),
  platform text not null,
  token text not null,
  created_at timestamptz not null,
  deleted_at timestamptz
);
```

## MVP Implementation Order

1. Auth by phone with test OTP transport.
2. Tasks CRUD and participants.
3. Ideas CRUD and idea conversion.
4. Comments CRUD.
5. Pull/push sync with timestamps and soft deletes.
6. Device tokens and basic notifications.
