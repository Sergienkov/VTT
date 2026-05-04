import type {
  Comment,
  DeviceToken,
  Event,
  Idea,
  PhoneChallenge,
  PublicTask,
  Session,
  SyncChange,
  Task,
  TaskParticipant,
  TaskStatus,
  User,
} from './types';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type CreateTaskInput = {
  id?: string;
  title: string;
  description?: string;
  idealResult?: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  assigneeId?: string;
  participantIds?: string[];
  focus?: boolean;
  important?: boolean;
};

type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'id'>> & {
  status?: TaskStatus;
};

type CreateIdeaInput = {
  id?: string;
  title: string;
  description?: string;
};

type UpdateIdeaInput = Partial<CreateIdeaInput>;

type RejectedSyncChange = {
  clientMutationId: string;
  reason: string;
};

type StoreSnapshot = {
  version: 1;
  users: User[];
  phoneChallenges: PhoneChallenge[];
  sessions: Session[];
  tasks: Task[];
  comments: Comment[];
  ideas: Idea[];
  events: Event[];
  deviceTokens: DeviceToken[];
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const OTP_TTL_MS = 1000 * 60 * 10;

export class MemoryStore {
  private persistencePath?: string;
  private users = new Map<string, User>();
  private usersByPhone = new Map<string, string>();
  private phoneChallenges = new Map<string, PhoneChallenge>();
  private sessions = new Map<string, Session>();
  private tasks = new Map<string, Task>();
  private comments = new Map<string, Comment>();
  private ideas = new Map<string, Idea>();
  private events = new Map<string, Event>();
  private deviceTokens = new Map<string, DeviceToken>();

  constructor(options: { persistencePath?: string } = {}) {
    this.persistencePath = options.persistencePath;
    const restored = this.restore();
    if (!restored) {
      this.seed();
      this.persist();
    }
  }

  health() {
    return {
      ok: true,
      users: this.users.size,
      tasks: this.tasks.size,
      ideas: this.ideas.size,
      persistent: Boolean(this.persistencePath),
    };
  }

  findUserByPhone(phone: string) {
    const userId = this.usersByPhone.get(phone);
    return userId ? this.users.get(userId) ?? null : null;
  }

  startPhoneChallenge(phone: string) {
    const challenge: PhoneChallenge = {
      id: id('otp'),
      phone,
      code: process.env.DEV_AUTH_CODE ?? (process.env.NODE_ENV === 'production' ? randomOtp() : '1234'),
      expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    };
    this.phoneChallenges.set(challenge.id, challenge);
    this.persist();
    return challenge;
  }

  verifyPhoneChallenge(challengeId: string, code: string) {
    const challenge = this.phoneChallenges.get(challengeId);
    const now = nowIso();
    if (!challenge || challenge.consumedAt) return null;
    if (Date.parse(challenge.expiresAt) <= Date.now()) return null;
    if (challenge.code !== code) return null;

    challenge.consumedAt = now;
    this.phoneChallenges.set(challenge.id, challenge);

    const user = this.upsertUserByPhone(challenge.phone);
    const session = this.createSession(user.id);
    return { user, session };
  }

  refreshSession(refreshToken: string) {
    const session = [...this.sessions.values()].find(
      (item) => item.refreshToken === refreshToken && !item.revokedAt,
    );
    if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
    const user = this.users.get(session.userId);
    if (!user) return null;
    session.revokedAt = nowIso();
    this.sessions.set(session.accessToken, session);
    const nextSession = this.createSession(user.id);
    return { user, session: nextSession };
  }

  revokeSession(accessToken: string) {
    const session = this.sessions.get(accessToken);
    if (!session) return;
    session.revokedAt = nowIso();
    this.sessions.set(accessToken, session);
    this.persist();
  }

  getSessionByAccessToken(accessToken: string) {
    const session = this.sessions.get(accessToken);
    if (!session || session.revokedAt) return null;
    if (Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  }

  getUser(userId: string) {
    return this.users.get(userId) ?? null;
  }

  updateUser(userId: string, patch: { name?: string; avatarUrl?: string }) {
    const user = this.users.get(userId);
    if (!user) return null;
    const next: User = {
      ...user,
      name: patch.name ?? user.name,
      avatarUrl: patch.avatarUrl ?? user.avatarUrl,
      updatedAt: nowIso(),
    };
    this.users.set(userId, next);
    this.persist();
    return next;
  }

  listTasksForUser(
    userId: string,
    filters: {
      date?: string;
      scope?: 'all' | 'personal' | 'shared';
      status?: TaskStatus;
      updatedSince?: string;
      includeDeleted?: boolean;
    } = {},
  ) {
    return [...this.tasks.values()]
      .filter((task) => this.isTaskVisibleToUser(task, userId))
      .filter((task) => filters.includeDeleted || !task.deletedAt)
      .filter((task) => !filters.date || task.date === filters.date)
      .filter((task) => !filters.status || task.status === filters.status)
      .filter((task) => {
        if (!filters.scope || filters.scope === 'all') return true;
        const isShared = this.otherParticipants(task, userId).length > 0;
        return filters.scope === 'shared' ? isShared : !isShared;
      })
      .filter((task) => isAfterCursor(task.updatedAt, filters.updatedSince))
      .sort(compareTasks);
  }

  getTaskForUser(taskId: string, userId: string, includeDeleted = false) {
    const task = this.tasks.get(taskId);
    if (!task || !this.isTaskVisibleToUser(task, userId)) return null;
    if (task.deletedAt && !includeDeleted) return null;
    return task;
  }

  createTask(ownerId: string, input: CreateTaskInput) {
    const timestamp = nowIso();
    const participantIds = unique([ownerId, ...(input.participantIds ?? [])]);
    const participants: TaskParticipant[] = participantIds.map((userId) => ({
      userId,
      role: userId === ownerId ? 'owner' : 'participant',
      seenAt: userId === ownerId ? timestamp : undefined,
      addedAt: timestamp,
    }));
    const task: Task = {
      id: input.id ?? id('task'),
      ownerId,
      title: input.title,
      description: input.description,
      idealResult: input.idealResult,
      date: input.date,
      time: input.time,
      durationMinutes: input.durationMinutes,
      assigneeId: input.assigneeId,
      status: 'active',
      focus: input.focus ?? false,
      important: input.important ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
      participants,
    };
    this.tasks.set(task.id, task);
    this.emitTaskEvent(task, ownerId, 'task_created');
    this.persist();
    return task;
  }

  updateTask(userId: string, taskId: string, patch: UpdateTaskInput) {
    const task = this.getTaskForUser(taskId, userId);
    if (!task) return null;
    const timestamp = nowIso();
    const participants = patch.participantIds
      ? this.mergeParticipants(task, userId, patch.participantIds, timestamp)
      : task.participants;
    const next: Task = {
      ...task,
      title: patch.title ?? task.title,
      description: patch.description ?? task.description,
      idealResult: patch.idealResult ?? task.idealResult,
      date: patch.date ?? task.date,
      time: patch.time ?? task.time,
      durationMinutes: patch.durationMinutes ?? task.durationMinutes,
      assigneeId: patch.assigneeId ?? task.assigneeId,
      status: patch.status ?? task.status,
      focus: patch.focus ?? task.focus,
      important: patch.important ?? task.important,
      participants,
      updatedAt: timestamp,
    };
    this.tasks.set(taskId, next);
    this.emitTaskEvent(next, userId, 'task_updated');
    this.persist();
    return next;
  }

  softDeleteTask(userId: string, taskId: string) {
    const task = this.getTaskForUser(taskId, userId);
    if (!task) return null;
    const timestamp = nowIso();
    const next = { ...task, deletedAt: timestamp, updatedAt: timestamp };
    this.tasks.set(taskId, next);
    this.emitTaskEvent(next, userId, 'task_updated');
    this.persist();
    return next;
  }

  setTaskStatus(userId: string, taskId: string, status: TaskStatus) {
    return this.updateTask(userId, taskId, { status });
  }

  shareTaskWithUser(
    ownerId: string,
    taskId: string,
    input: { userId?: string; phone?: string; name?: string },
  ) {
    const task = this.getTaskForUser(taskId, ownerId);
    if (!task || task.ownerId !== ownerId) return null;

    const user =
      input.userId
        ? this.users.get(input.userId) ?? null
        : input.phone
          ? this.findUserByPhone(input.phone) ?? this.upsertUserByPhone(input.phone, input.name)
          : null;
    if (!user) return null;

    const timestamp = nowIso();
    const next = {
      ...task,
      assigneeId: task.assigneeId ?? user.id,
      participants: this.mergeParticipants(task, ownerId, [user.id], timestamp),
      updatedAt: timestamp,
    };
    this.tasks.set(taskId, next);
    this.emitTaskEvent(next, ownerId, 'task_created');
    this.persist();
    return { task: next, user };
  }

  createTaskPublicShare(ownerId: string, taskId: string) {
    const task = this.getTaskForUser(taskId, ownerId);
    if (!task || task.ownerId !== ownerId) return null;
    const timestamp = nowIso();
    const next = {
      ...task,
      publicShareToken: task.publicShareToken ?? publicToken(),
      updatedAt: timestamp,
    };
    this.tasks.set(taskId, next);
    this.persist();
    return next;
  }

  getPublicTask(tokenValue: string): PublicTask | null {
    const task = this.taskByPublicToken(tokenValue);
    if (!task || task.deletedAt) return null;
    return toPublicTask(task);
  }

  acceptPublicTask(tokenValue: string) {
    const task = this.taskByPublicToken(tokenValue);
    if (!task || task.deletedAt) return null;
    const timestamp = nowIso();
    const next = {
      ...task,
      publicShareAcceptedAt: task.publicShareAcceptedAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, next);
    this.emitTaskEvent(next, 'public_link', 'task_updated');
    this.persist();
    return toPublicTask(next);
  }

  completePublicTask(tokenValue: string) {
    const task = this.taskByPublicToken(tokenValue);
    if (!task || task.deletedAt) return null;
    const timestamp = nowIso();
    const next = {
      ...task,
      status: 'completed' as const,
      publicShareAcceptedAt: task.publicShareAcceptedAt ?? timestamp,
      publicShareCompletedAt: task.publicShareCompletedAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, next);
    this.emitTaskEvent(next, 'public_link', 'task_updated');
    this.persist();
    return toPublicTask(next);
  }

  claimPublicTask(userId: string, tokenValue: string) {
    const task = this.taskByPublicToken(tokenValue);
    if (!task || task.deletedAt) return null;
    const timestamp = nowIso();
    const next = {
      ...task,
      assigneeId: task.assigneeId ?? userId,
      publicShareAcceptedAt: task.publicShareAcceptedAt ?? timestamp,
      publicShareClaimedUserId: userId,
      participants: this.mergeParticipants(task, userId, [userId], timestamp),
      updatedAt: timestamp,
    };
    this.tasks.set(task.id, next);
    this.emitTaskEvent(next, userId, 'task_updated');
    this.persist();
    return next;
  }

  markTaskSeen(userId: string, taskId: string) {
    const task = this.getTaskForUser(taskId, userId);
    if (!task) return null;
    const timestamp = nowIso();
    const next: Task = {
      ...task,
      participants: task.participants.map((participant) =>
        participant.userId === userId ? { ...participant, seenAt: timestamp } : participant,
      ),
      updatedAt: timestamp,
    };
    this.tasks.set(taskId, next);
    this.persist();
    return next;
  }

  listCommentsForTask(userId: string, taskId: string, updatedSince?: string, includeDeleted = false) {
    const task = this.getTaskForUser(taskId, userId, includeDeleted);
    if (!task) return null;
    return [...this.comments.values()]
      .filter((comment) => comment.taskId === taskId)
      .filter((comment) => includeDeleted || !comment.deletedAt)
      .filter((comment) => isAfterCursor(comment.updatedAt, updatedSince))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  createComment(userId: string, taskId: string, body: string, commentId?: string) {
    const task = this.getTaskForUser(taskId, userId);
    if (!task) return null;
    const timestamp = nowIso();
    const comment: Comment = {
      id: commentId ?? id('comment'),
      taskId,
      authorId: userId,
      body,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.comments.set(comment.id, comment);
    this.emitTaskEvent(task, userId, 'task_updated');
    this.persist();
    return comment;
  }

  updateComment(userId: string, commentId: string, body: string) {
    const comment = this.comments.get(commentId);
    if (!comment || comment.deletedAt) return null;
    if (!this.getTaskForUser(comment.taskId, userId)) return null;
    const next = { ...comment, body, updatedAt: nowIso() };
    this.comments.set(commentId, next);
    this.persist();
    return next;
  }

  softDeleteComment(userId: string, commentId: string) {
    const comment = this.comments.get(commentId);
    if (!comment || comment.deletedAt) return null;
    if (!this.getTaskForUser(comment.taskId, userId)) return null;
    const timestamp = nowIso();
    const next = { ...comment, deletedAt: timestamp, updatedAt: timestamp };
    this.comments.set(commentId, next);
    this.persist();
    return next;
  }

  listIdeasForUser(userId: string, updatedSince?: string, includeDeleted = false) {
    return [...this.ideas.values()]
      .filter((idea) => idea.ownerId === userId)
      .filter((idea) => includeDeleted || !idea.deletedAt)
      .filter((idea) => isAfterCursor(idea.updatedAt, updatedSince))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getIdeaForUser(userId: string, ideaId: string, includeDeleted = false) {
    const idea = this.ideas.get(ideaId);
    if (!idea || idea.ownerId !== userId) return null;
    if (idea.deletedAt && !includeDeleted) return null;
    return idea;
  }

  createIdea(ownerId: string, input: CreateIdeaInput) {
    const timestamp = nowIso();
    const idea: Idea = {
      id: input.id ?? id('idea'),
      ownerId,
      title: input.title,
      description: input.description,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.ideas.set(idea.id, idea);
    this.persist();
    return idea;
  }

  updateIdea(userId: string, ideaId: string, patch: UpdateIdeaInput) {
    const idea = this.getIdeaForUser(userId, ideaId);
    if (!idea) return null;
    const next: Idea = {
      ...idea,
      title: patch.title ?? idea.title,
      description: patch.description ?? idea.description,
      updatedAt: nowIso(),
    };
    this.ideas.set(ideaId, next);
    this.persist();
    return next;
  }

  softDeleteIdea(userId: string, ideaId: string) {
    const idea = this.getIdeaForUser(userId, ideaId);
    if (!idea) return null;
    const timestamp = nowIso();
    const next = { ...idea, deletedAt: timestamp, updatedAt: timestamp };
    this.ideas.set(ideaId, next);
    this.persist();
    return next;
  }

  convertIdeaToTask(
    userId: string,
    ideaId: string,
    input: { date: string; time?: string; focus?: boolean; important?: boolean },
  ) {
    const idea = this.getIdeaForUser(userId, ideaId);
    if (!idea) return null;
    const existingTask = idea.convertedTaskId
      ? this.getTaskForUser(idea.convertedTaskId, userId)
      : null;
    if (existingTask) return { idea, task: existingTask };

    const task = this.createTask(userId, {
      title: idea.title,
      description: idea.description,
      date: input.date,
      time: input.time,
      focus: input.focus,
      important: input.important,
    });
    const nextIdea = { ...idea, convertedTaskId: task.id, updatedAt: nowIso() };
    this.ideas.set(ideaId, nextIdea);
    this.persist();
    return { idea: nextIdea, task };
  }

  listLinks(userId: string) {
    const sharedTasks = this.listTasksForUser(userId, { scope: 'shared' });
    const stats = new Map<
      string,
      { user: User; sharedTaskCount: number; unreadTaskCount: number }
    >();

    for (const task of sharedTasks) {
      for (const participant of this.otherParticipants(task, userId)) {
        const user = this.users.get(participant.userId);
        if (!user) continue;
        const current = stats.get(user.id) ?? {
          user,
          sharedTaskCount: 0,
          unreadTaskCount: 0,
        };
        current.sharedTaskCount += 1;
        if (!task.participants.find((item) => item.userId === userId)?.seenAt) {
          current.unreadTaskCount += 1;
        }
        stats.set(user.id, current);
      }
    }

    return [...stats.values()].sort((a, b) => a.user.name?.localeCompare(b.user.name ?? '') ?? 0);
  }

  inviteLink(phone: string, name?: string) {
    return this.upsertUserByPhone(phone, name);
  }

  listEvents(userId: string, unreadOnly = false) {
    return [...this.events.values()]
      .filter((event) => event.userId === userId)
      .filter((event) => !unreadOnly || !event.readAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markEventRead(userId: string, eventId: string) {
    const event = this.events.get(eventId);
    if (!event || event.userId !== userId) return null;
    const next = { ...event, readAt: nowIso() };
    this.events.set(eventId, next);
    this.persist();
    return next;
  }

  saveDeviceToken(userId: string, input: { platform: 'ios' | 'android' | 'web'; token: string }) {
    const timestamp = nowIso();
    const deviceToken: DeviceToken = {
      id: id('device'),
      userId,
      platform: input.platform,
      token: input.token,
      createdAt: timestamp,
    };
    this.deviceTokens.set(deviceToken.id, deviceToken);
    this.persist();
    return deviceToken;
  }

  deleteDeviceToken(userId: string, tokenId: string) {
    const token = this.deviceTokens.get(tokenId);
    if (!token || token.userId !== userId || token.deletedAt) return null;
    const next = { ...token, deletedAt: nowIso() };
    this.deviceTokens.set(tokenId, next);
    this.persist();
    return next;
  }

  pullSync(userId: string, cursor?: string) {
    const tasks = this.listTasksForUser(userId, {
      includeDeleted: true,
      updatedSince: cursor,
    });
    const ideas = this.listIdeasForUser(userId, cursor, true);
    const comments = [...this.comments.values()]
      .filter((comment) => Boolean(this.getTaskForUser(comment.taskId, userId, true)))
      .filter((comment) => isAfterCursor(comment.updatedAt, cursor));
    const events = this.listEvents(userId).filter((event) =>
      isAfterCursor(event.createdAt, cursor),
    );

    return {
      cursor: nowIso(),
      serverTime: nowIso(),
      tasks,
      ideas,
      comments,
      events,
    };
  }

  pushSync(userId: string, changes: SyncChange[]) {
    const accepted: string[] = [];
    const rejected: RejectedSyncChange[] = [];

    for (const change of changes) {
      try {
        const applied = this.applySyncChange(userId, change);
        if (applied) {
          accepted.push(change.clientMutationId);
        } else {
          rejected.push({
            clientMutationId: change.clientMutationId,
            reason: 'not_found_or_forbidden',
          });
        }
      } catch (error) {
        rejected.push({
          clientMutationId: change.clientMutationId,
          reason: error instanceof Error ? error.message : 'invalid_change',
        });
      }
    }

    const pulled = this.pullSync(userId);
    return {
      accepted,
      rejected,
      cursor: pulled.cursor,
      serverTime: pulled.serverTime,
      changes: {
        tasks: pulled.tasks,
        ideas: pulled.ideas,
        comments: pulled.comments,
        events: pulled.events,
      },
    };
  }

  private applySyncChange(userId: string, change: SyncChange) {
    if (change.entity === 'task') {
      if (change.op === 'delete') {
        const taskId = readString(change.data, 'id');
        return taskId ? this.softDeleteTask(userId, taskId) : null;
      }
      if (change.op === 'upsert') {
        const taskId = readString(change.data, 'id');
        const existing = taskId ? this.getTaskForUser(taskId, userId, true) : null;
        const input = taskInputFromRecord(change.data);
        return existing && taskId
          ? this.updateTask(userId, taskId, input)
          : this.createTask(userId, input);
      }
    }

    if (change.entity === 'idea') {
      if (change.op === 'delete') {
        const ideaId = readString(change.data, 'id');
        return ideaId ? this.softDeleteIdea(userId, ideaId) : null;
      }
      if (change.op === 'upsert') {
        const ideaId = readString(change.data, 'id');
        const existing = ideaId ? this.getIdeaForUser(userId, ideaId, true) : null;
        const input = ideaInputFromRecord(change.data);
        return existing && ideaId
          ? this.updateIdea(userId, ideaId, input)
          : this.createIdea(userId, input);
      }
    }

    if (change.entity === 'comment') {
      if (change.op === 'delete') {
        const commentId = readString(change.data, 'id');
        return commentId ? this.softDeleteComment(userId, commentId) : null;
      }
      if (change.op === 'upsert') {
        const commentId = readString(change.data, 'id');
        const taskId = readRequiredString(change.data, 'taskId');
        const body = readRequiredString(change.data, 'body');
        const existing = commentId ? this.comments.get(commentId) : null;
        return existing && commentId
          ? this.updateComment(userId, commentId, body)
          : this.createComment(userId, taskId, body, commentId);
      }
    }

    if (change.entity === 'event' && change.op === 'read') {
      const eventId = readString(change.data, 'id');
      return eventId ? this.markEventRead(userId, eventId) : null;
    }

    throw new Error('unsupported_change');
  }

  private restore() {
    if (!this.persistencePath || !existsSync(this.persistencePath)) return false;

    const snapshot = JSON.parse(readFileSync(this.persistencePath, 'utf8')) as StoreSnapshot;
    if (snapshot.version !== 1) {
      throw new Error(`unsupported_store_snapshot_version:${String(snapshot.version)}`);
    }

    this.users = mapById(snapshot.users);
    this.usersByPhone = new Map(snapshot.users.map((user) => [user.phone, user.id]));
    this.phoneChallenges = mapById(snapshot.phoneChallenges);
    this.sessions = new Map(snapshot.sessions.map((session) => [session.accessToken, session]));
    this.tasks = mapById(snapshot.tasks);
    this.comments = mapById(snapshot.comments);
    this.ideas = mapById(snapshot.ideas);
    this.events = mapById(snapshot.events);
    this.deviceTokens = mapById(snapshot.deviceTokens);
    return true;
  }

  private persist() {
    if (!this.persistencePath) return;

    const snapshot: StoreSnapshot = {
      version: 1,
      users: [...this.users.values()],
      phoneChallenges: [...this.phoneChallenges.values()],
      sessions: [...this.sessions.values()],
      tasks: [...this.tasks.values()],
      comments: [...this.comments.values()],
      ideas: [...this.ideas.values()],
      events: [...this.events.values()],
      deviceTokens: [...this.deviceTokens.values()],
    };

    mkdirSync(dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
    renameSync(tmpPath, this.persistencePath);
  }

  private createSession(userId: string) {
    const session: Session = {
      id: id('session'),
      userId,
      accessToken: token('access'),
      refreshToken: token('refresh'),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    this.sessions.set(session.accessToken, session);
    this.persist();
    return session;
  }

  private upsertUserByPhone(phone: string, name?: string) {
    const existingUserId = this.usersByPhone.get(phone);
    if (existingUserId) {
      const existingUser = this.users.get(existingUserId);
      if (!existingUser) throw new Error('user_index_corrupted');
      if (!name || existingUser.name) return existingUser;
      const next = { ...existingUser, name, updatedAt: nowIso() };
      this.users.set(existingUserId, next);
      this.persist();
      return next;
    }

    const timestamp = nowIso();
    const user: User = {
      id: id('user'),
      phone,
      name: name ?? phone,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.set(user.id, user);
    this.usersByPhone.set(phone, user.id);
    this.persist();
    return user;
  }

  private isTaskVisibleToUser(task: Task, userId: string) {
    return task.ownerId === userId || task.participants.some((item) => item.userId === userId);
  }

  private otherParticipants(task: Task, userId: string) {
    return task.participants.filter((participant) => participant.userId !== userId);
  }

  private mergeParticipants(task: Task, actorId: string, participantIds: string[], timestamp: string) {
    const nextIds = unique([task.ownerId, actorId, ...participantIds]);
    return nextIds.map((userId) => {
      const existing = task.participants.find((participant) => participant.userId === userId);
      if (existing) return existing;
      return {
        userId,
        role: userId === task.ownerId ? 'owner' : 'participant',
        addedAt: timestamp,
      } satisfies TaskParticipant;
    });
  }

  private taskByPublicToken(tokenValue: string) {
    return [...this.tasks.values()].find((task) => task.publicShareToken === tokenValue) ?? null;
  }

  private emitTaskEvent(task: Task, actorId: string, type: Event['type']) {
    const timestamp = nowIso();
    for (const participant of task.participants) {
      if (participant.userId === actorId) continue;
      const event: Event = {
        id: id('event'),
        userId: participant.userId,
        type,
        taskId: task.id,
        createdAt: timestamp,
      };
      this.events.set(event.id, event);
    }
  }

  private seed() {
    const today = dateKey();
    const timestamp = new Date().toISOString();
    const me: User = {
      id: 'user_1',
      phone: '+79990000000',
      name: 'Я',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const anna: User = {
      id: 'user_2',
      phone: '+79990000001',
      name: 'Анна',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const alexey: User = {
      id: 'user_3',
      phone: '+79990000002',
      name: 'Алексей',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const denis: User = {
      id: 'user_4',
      phone: '+79990000003',
      name: 'Денис',
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    for (const user of [me, anna, alexey, denis]) {
      this.users.set(user.id, user);
      this.usersByPhone.set(user.phone, user.id);
    }

    const seedTasks: Task[] = [
      this.seedTask({
        id: 'task_1',
        ownerId: me.id,
        title: 'Актуализировать статус по задачам Леухина',
        description: 'Сверить прогресс, коротко обновить статус и отметить блокеры на сегодня.',
        date: today,
        time: '18:00',
        durationMinutes: 30,
        participantIds: [anna.id],
        focus: true,
        important: true,
        timestamp,
      }),
      this.seedTask({
        id: 'task_2',
        ownerId: me.id,
        title: 'Подготовить информацию по ключницам в Ростокино и Крюково',
        description: 'Собрать актуальные данные по объектам.',
        date: today,
        important: true,
        timestamp,
      }),
      this.seedTask({
        id: 'task_3',
        ownerId: me.id,
        title: 'Проверить подписи в корпоративной почте',
        date: today,
        time: '12:30',
        durationMinutes: 30,
        focus: true,
        timestamp,
      }),
      this.seedTask({
        id: 'task_4',
        ownerId: alexey.id,
        title: 'Сверить статусы задач по прошлому спринту',
        date: today,
        time: '19:30',
        durationMinutes: 60,
        participantIds: [me.id],
        important: true,
        timestamp,
      }),
      this.seedTask({
        id: 'task_5',
        ownerId: denis.id,
        title: 'Проверить состояние транспортных кейсов',
        date: addDays(today, 33),
        time: '10:30',
        participantIds: [me.id],
        timestamp,
        seenByOwnerOnly: true,
      }),
    ];

    for (const task of seedTasks) {
      this.tasks.set(task.id, task);
    }

    const ideas: Idea[] = [
      {
        id: 'idea_1',
        ownerId: me.id,
        title: 'Переносная энергостанция в защитном кейсе',
        description: 'LiFePO4-батарея, инвертор и понятный индикатор заряда.',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'idea_2',
        ownerId: me.id,
        title: 'Диагностический модуль OBD-II с предиктивной аналитикой',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];

    for (const idea of ideas) {
      this.ideas.set(idea.id, idea);
    }
  }

  private seedTask(input: {
    id: string;
    ownerId: string;
    title: string;
    description?: string;
    idealResult?: string;
    date: string;
    time?: string;
    durationMinutes?: number;
    participantIds?: string[];
    focus?: boolean;
    important?: boolean;
    timestamp: string;
    seenByOwnerOnly?: boolean;
  }): Task {
    const participantIds = unique([input.ownerId, ...(input.participantIds ?? [])]);
    return {
      id: input.id,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      idealResult: input.idealResult,
      date: input.date,
      time: input.time,
      durationMinutes: input.durationMinutes,
      status: 'active',
      focus: input.focus ?? false,
      important: input.important ?? false,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      participants: participantIds.map((userId) => ({
        userId,
        role: userId === input.ownerId ? 'owner' : 'participant',
        seenAt: input.seenByOwnerOnly && userId !== input.ownerId ? undefined : input.timestamp,
        addedAt: input.timestamp,
      })),
    };
  }
}

export const store = new MemoryStore({ persistencePath: process.env.DATA_FILE || undefined });

export function taskInputFromRecord(record: Record<string, unknown>): CreateTaskInput {
  return {
    id: readString(record, 'id'),
    title: readRequiredString(record, 'title'),
    description: readString(record, 'description'),
    idealResult: readString(record, 'idealResult'),
    date: readRequiredString(record, 'date'),
    time: readString(record, 'time'),
    durationMinutes: readNumber(record, 'durationMinutes'),
    assigneeId: readString(record, 'assigneeId'),
    participantIds: readStringArray(record, 'participantIds'),
    focus: readBoolean(record, 'focus'),
    important: readBoolean(record, 'important'),
  };
}

export function taskPatchFromRecord(record: Record<string, unknown>): UpdateTaskInput {
  const status = readString(record, 'status');
  return {
    title: readString(record, 'title'),
    description: readString(record, 'description'),
    idealResult: readString(record, 'idealResult'),
    date: readString(record, 'date'),
    time: readString(record, 'time'),
    durationMinutes: readNumber(record, 'durationMinutes'),
    assigneeId: readString(record, 'assigneeId'),
    participantIds: readStringArray(record, 'participantIds'),
    status: status === 'active' || status === 'completed' ? status : undefined,
    focus: readBoolean(record, 'focus'),
    important: readBoolean(record, 'important'),
  };
}

export function ideaInputFromRecord(record: Record<string, unknown>): CreateIdeaInput {
  return {
    id: readString(record, 'id'),
    title: readRequiredString(record, 'title'),
    description: readString(record, 'description'),
  };
}

export function ideaPatchFromRecord(record: Record<string, unknown>): UpdateIdeaInput {
  return {
    title: readString(record, 'title'),
    description: readString(record, 'description'),
  };
}

export function readRequiredString(record: Record<string, unknown>, key: string) {
  const value = readString(record, key);
  if (!value) throw new Error(`${key}_required`);
  return value;
}

export function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
}

function compareTasks(a: Task, b: Task) {
  const priorityDelta = Number(b.focus || b.important) - Number(a.focus || a.important);
  if (priorityDelta !== 0) return priorityDelta;
  const dateDelta = a.date.localeCompare(b.date);
  if (dateDelta !== 0) return dateDelta;
  return (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
}

function isAfterCursor(value: string, cursor?: string) {
  if (!cursor) return true;
  return Date.parse(value) > Date.parse(cursor);
}

function unique(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function mapById<T extends { id: string }>(items: T[]) {
  return new Map(items.map((item) => [item.id, item]));
}

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function token(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}_${crypto.randomUUID()}`;
}

function publicToken() {
  return crypto.randomUUID().replaceAll('-', '');
}

function toPublicTask(task: Task): PublicTask {
  return {
    token: task.publicShareToken ?? '',
    title: task.title,
    description: task.description,
    idealResult: task.idealResult,
    date: task.date,
    time: task.time,
    durationMinutes: task.durationMinutes,
    status: task.status,
    acceptedAt: task.publicShareAcceptedAt,
    completedAt: task.publicShareCompletedAt,
    updatedAt: task.updatedAt,
  };
}

function randomOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function nowIso() {
  return new Date().toISOString();
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
