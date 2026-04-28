export type TaskStatus = 'active' | 'completed';
export type ParticipantRole = 'owner' | 'participant';
export type EventType = 'task_created' | 'task_updated' | 'deadline_soon';

export type User = {
  id: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type PhoneChallenge = {
  id: string;
  phone: string;
  code: string;
  expiresAt: string;
  consumedAt?: string;
};

export type Session = {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  revokedAt?: string;
};

export type TaskParticipant = {
  userId: string;
  role: ParticipantRole;
  seenAt?: string;
  addedAt: string;
};

export type Task = {
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
  participants: TaskParticipant[];
};

export type Comment = {
  id: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type Idea = {
  id: string;
  ownerId: string;
  title: string;
  description?: string;
  convertedTaskId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type Event = {
  id: string;
  userId: string;
  type: EventType;
  taskId?: string;
  readAt?: string;
  createdAt: string;
};

export type DeviceToken = {
  id: string;
  userId: string;
  platform: 'ios' | 'android' | 'web';
  token: string;
  createdAt: string;
  deletedAt?: string;
};

export type SyncEntity = 'task' | 'idea' | 'comment' | 'event';
export type SyncOperation = 'upsert' | 'delete' | 'read';

export type SyncChange = {
  entity: SyncEntity;
  op: SyncOperation;
  clientMutationId: string;
  data: Record<string, unknown>;
};
