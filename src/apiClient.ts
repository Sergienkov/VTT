import { AuthState, Idea, PublicSharedTask, StoredState, Task, TaskStatus, User } from './domain';

type ApiTaskParticipant = {
  userId: string;
  role: 'owner' | 'participant';
  seenAt?: string;
  addedAt: string;
};

type ApiTask = {
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
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  publicShareToken?: string;
  publicShareAcceptedAt?: string;
  publicShareCompletedAt?: string;
  participants: ApiTaskParticipant[];
};

type ApiPublicSharedTask = PublicSharedTask;

type ApiIdea = {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  convertedTaskId?: string;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string;
};

type ApiComment = {
  id: string;
  taskId: string;
  body: string;
  createdAt: string;
};

type ListResponse<T> = {
  items: T[];
  syncCursor?: string;
};

type ItemResponse<T> = {
  item: T;
};

type StartPhoneResponse = {
  challengeId: string;
  expiresAt: string;
  devCode?: string;
};

type AuthResponse = AuthState;

const DEFAULT_API_URL = 'http://localhost:8787';

const devUserIdsByName: Record<string, string> = {
  Анна: 'user_2',
  Алексей: 'user_3',
  Денис: 'user_4',
};

const devUserLabelsById: Record<string, string> = {
  user_2: 'Анна',
  user_3: 'Алексей',
  user_4: 'Денис',
};

export function getApiBaseUrl() {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  return (envUrl && envUrl.trim()) || DEFAULT_API_URL;
}

export async function startPhoneLogin(phone: string) {
  return apiRequest<StartPhoneResponse>('/auth/phone/start', {
    method: 'POST',
    body: { phone },
  });
}

export async function verifyPhoneLogin(challengeId: string, code: string) {
  return apiRequest<AuthResponse>('/auth/phone/verify', {
    method: 'POST',
    body: { challengeId, code },
  });
}

export async function loadRemoteState(auth: AuthState): Promise<StoredState> {
  const [tasksResponse, ideasResponse] = await Promise.all([
    apiRequest<ListResponse<ApiTask>>('/tasks', { auth }),
    apiRequest<ListResponse<ApiIdea>>('/ideas', { auth }),
  ]);
  const commentsByTask = await loadCommentsByTask(auth, tasksResponse.items);

  return {
    tasks: tasksResponse.items
      .filter((task) => !task.deletedAt)
      .map((task) => toAppTask(task, auth.user.id, commentsByTask[task.id] ?? [])),
    ideas: ideasResponse.items.filter((idea) => !idea.deletedAt).map(toAppIdea),
  };
}

export async function createRemoteTask(auth: AuthState, task: Task) {
  return apiRequest<ItemResponse<ApiTask>>('/tasks', {
    auth,
    method: 'POST',
    body: toTaskPayload(task),
  });
}

export async function updateRemoteTask(auth: AuthState, task: Task) {
  return apiRequest<ItemResponse<ApiTask>>(`/tasks/${encodeURIComponent(task.id)}`, {
    auth,
    method: 'PATCH',
    body: toTaskPayload(task),
  });
}

export async function deleteRemoteTask(auth: AuthState, taskId: string) {
  return apiRequest<ItemResponse<ApiTask>>(`/tasks/${encodeURIComponent(taskId)}`, {
    auth,
    method: 'DELETE',
  });
}

export async function setRemoteTaskStatus(auth: AuthState, taskId: string, status: TaskStatus) {
  const action = status === 'completed' ? 'complete' : 'reopen';
  return apiRequest<ItemResponse<ApiTask>>(`/tasks/${encodeURIComponent(taskId)}/${action}`, {
    auth,
    method: 'POST',
  });
}

export async function markRemoteTaskSeen(auth: AuthState, taskId: string) {
  return apiRequest<ItemResponse<ApiTask>>(`/tasks/${encodeURIComponent(taskId)}/seen`, {
    auth,
    method: 'POST',
  });
}

export async function shareRemoteTaskWithUser(
  auth: AuthState,
  taskId: string,
  input: { userId?: string; phone?: string; name?: string },
) {
  const response = await apiRequest<{ item: ApiTask; user: User }>(
    `/tasks/${encodeURIComponent(taskId)}/share/user`,
    {
      auth,
      method: 'POST',
      body: input,
    },
  );
  return {
    task: toAppTask(response.item, auth.user.id, []),
    user: response.user,
  };
}

export async function createRemoteTaskShareLink(auth: AuthState, taskId: string) {
  const response = await apiRequest<{
    item: ApiTask;
    share: { token: string; url: string };
  }>(`/tasks/${encodeURIComponent(taskId)}/share-link`, {
    auth,
    method: 'POST',
  });
  return {
    task: toAppTask(response.item, auth.user.id, []),
    token: response.share.token,
    url: response.share.url,
  };
}

export async function claimRemoteTaskShare(auth: AuthState, token: string) {
  const response = await apiRequest<ItemResponse<ApiTask>>('/task-shares/claim', {
    auth,
    method: 'POST',
    body: { token },
  });
  return toAppTask(response.item, auth.user.id, []);
}

export async function loadPublicSharedTask(token: string) {
  const response = await apiRequest<ItemResponse<ApiPublicSharedTask>>(
    `/public/tasks/${encodeURIComponent(token)}`,
  );
  return response.item;
}

export async function acceptPublicSharedTask(token: string) {
  const response = await apiRequest<ItemResponse<ApiPublicSharedTask>>(
    `/public/tasks/${encodeURIComponent(token)}/accept`,
    { method: 'POST' },
  );
  return response.item;
}

export async function completePublicSharedTask(token: string) {
  const response = await apiRequest<ItemResponse<ApiPublicSharedTask>>(
    `/public/tasks/${encodeURIComponent(token)}/complete`,
    { method: 'POST' },
  );
  return response.item;
}

export async function createRemoteComment(auth: AuthState, taskId: string, body: string) {
  return apiRequest<ItemResponse<ApiComment>>(
    `/tasks/${encodeURIComponent(taskId)}/comments`,
    {
      auth,
      method: 'POST',
      body: { body },
    },
  );
}

export async function createRemoteIdea(auth: AuthState, idea: Idea) {
  return apiRequest<ItemResponse<ApiIdea>>('/ideas', {
    auth,
    method: 'POST',
    body: {
      id: idea.id,
      title: idea.title,
      description: idea.description,
    },
  });
}

export async function convertRemoteIdea(auth: AuthState, ideaId: string, date: string) {
  const response = await apiRequest<{ idea: ApiIdea; task: ApiTask }>(
    `/ideas/${encodeURIComponent(ideaId)}/convert`,
    {
      auth,
      method: 'POST',
      body: { date },
    },
  );

  return {
    idea: toAppIdea(response.idea),
    task: toAppTask(response.task, auth.user.id, []),
  };
}

export async function logoutRemote(auth: AuthState) {
  return apiRequest<{ ok: true }>('/auth/logout', {
    auth,
    method: 'POST',
  });
}

async function loadCommentsByTask(auth: AuthState, tasks: ApiTask[]) {
  const entries = await Promise.all(
    tasks.map(async (task) => {
      try {
        const response = await apiRequest<ListResponse<ApiComment>>(
          `/tasks/${encodeURIComponent(task.id)}/comments`,
          { auth },
        );
        return [task.id, response.items.map((comment) => comment.body)] as const;
      } catch {
        return [task.id, []] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<string, string[]>;
}

async function apiRequest<T>(
  path: string,
  options: {
    auth?: AuthState;
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
  } = {},
) {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.auth ? { Authorization: `Bearer ${options.auth.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string'
        ? payload.error.message
        : `API request failed: ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function toAppTask(task: ApiTask, currentUserId: string, comments: string[]): Task {
  const linkedParticipant = task.participants.find(
    (participant) => participant.userId !== currentUserId,
  );
  const currentParticipant = task.participants.find(
    (participant) => participant.userId === currentUserId,
  );

  return {
    id: task.id,
    title: task.title,
    description: task.description ?? '',
    date: task.date,
    time: task.time,
    durationMinutes: task.durationMinutes,
    assignee: task.assigneeId ? labelForUser(task.assigneeId) : undefined,
    linkedUser: linkedParticipant ? labelForUser(linkedParticipant.userId) : undefined,
    status: task.status,
    focus: task.focus,
    important: task.important,
    seen: Boolean(currentParticipant?.seenAt),
    comments,
    publicShareToken: task.publicShareToken,
    publicShareUrl: task.publicShareToken ? shareUrlForToken(task.publicShareToken) : undefined,
    publicShareAcceptedAt: task.publicShareAcceptedAt,
    publicShareCompletedAt: task.publicShareCompletedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function toAppIdea(idea: ApiIdea): Idea {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    convertedTaskId: idea.convertedTaskId,
    createdAt: idea.createdAt,
  };
}

function toTaskPayload(task: Task) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    date: task.date,
    time: task.time,
    durationMinutes: task.durationMinutes,
    assigneeId: task.assignee ? userIdForLabel(task.assignee) : undefined,
    participantIds: task.linkedUser ? [userIdForLabel(task.linkedUser)] : [],
    focus: task.focus,
    important: task.important,
    status: task.status,
  };
}

function userIdForLabel(label: string) {
  return devUserIdsByName[label] ?? label;
}

function labelForUser(userId: string) {
  return devUserLabelsById[userId] ?? userId;
}

function shareUrlForToken(token: string) {
  const apiBase = getApiBaseUrl();
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/task/${encodeURIComponent(token)}`;
  }
  return `${apiBase.replace(/\/api\/?$/, '')}/task/${encodeURIComponent(token)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
