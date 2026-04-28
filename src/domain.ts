export type TaskStatus = 'active' | 'completed';

export type User = {
  id: string;
  phone: string;
  name?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
};

export type Task = {
  id: string;
  title: string;
  description?: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  assignee?: string;
  linkedUser?: string;
  status: TaskStatus;
  focus: boolean;
  important: boolean;
  seen: boolean;
  comments: string[];
  createdAt: string;
  updatedAt: string;
};

export type Idea = {
  id: string;
  title: string;
  description?: string;
  convertedTaskId?: string;
  createdAt: string;
};

export type StoredState = {
  tasks: Task[];
  ideas: Idea[];
};

export type TaskDraft = {
  title: string;
  description: string;
  date: string;
  time: string;
  durationMinutes: string;
  assignee: string;
  linkedUser: string;
  focus: boolean;
  important: boolean;
};

export const TODAY = '2025-10-09';
