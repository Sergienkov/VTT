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
  idealResult?: string;
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
  publicShareToken?: string;
  publicShareUrl?: string;
  publicShareAcceptedAt?: string;
  publicShareCompletedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicSharedTask = {
  token: string;
  shareUrl: string;
  title: string;
  description?: string;
  idealResult?: string;
  date: string;
  time?: string;
  durationMinutes?: number;
  status: TaskStatus;
  acceptedAt?: string;
  completedAt?: string;
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

export type PendingMutation =
  | {
      id: string;
      type: 'createTask' | 'updateTask';
      task: Task;
      createdAt: string;
    }
  | {
      id: string;
      type: 'deleteTask';
      taskId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: 'setTaskStatus';
      taskId: string;
      status: TaskStatus;
      createdAt: string;
    }
  | {
      id: string;
      type: 'markTaskSeen';
      taskId: string;
      createdAt: string;
    }
  | {
      id: string;
      type: 'createComment';
      taskId: string;
      body: string;
      createdAt: string;
    }
  | {
      id: string;
      type: 'createIdea';
      idea: Idea;
      createdAt: string;
    }
  | {
      id: string;
      type: 'convertIdea';
      ideaId: string;
      date: string;
      createdAt: string;
    };

export type TaskDraft = {
  title: string;
  description: string;
  idealResult: string;
  date: string;
  time: string;
  durationMinutes: string;
  assignee: string;
  linkedUser: string;
  focus: boolean;
  important: boolean;
};

export const TODAY = formatDateKey();
export const TOMORROW = addDays(TODAY, 1);

export function formatDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return formatDateKey(date);
}
