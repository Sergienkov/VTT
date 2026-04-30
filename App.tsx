import { StatusBar } from 'expo-status-bar';
import {
  Bell,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  Lightbulb,
  Menu,
  Mic,
  Plus,
  Search,
  Send,
  Star,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createRemoteComment,
  createRemoteIdea,
  createRemoteTask,
  convertRemoteIdea,
  deleteRemoteTask,
  loadRemoteState,
  logoutRemote,
  markRemoteTaskSeen,
  setRemoteTaskStatus,
  startPhoneLogin,
  updateRemoteTask,
  verifyPhoneLogin,
} from './src/apiClient';
import { clearAuthState, loadAuthState, saveAuthState } from './src/authRepository';
import {
  addDays,
  AuthState,
  Idea,
  PendingMutation,
  Task,
  TaskDraft,
  TaskStatus,
  TODAY,
  TOMORROW,
} from './src/domain';
import { loadLocalState, saveLocalState } from './src/localTaskRepository';
import { seedIdeas, seedTasks } from './src/seedData';
import { loadPendingMutations, savePendingMutations } from './src/syncQueueRepository';

type TabKey = 'day' | 'all' | 'links' | 'ideas';
type ViewMode = TabKey | 'timeline' | 'detail';
type PendingMutationInput =
  | { type: 'createTask' | 'updateTask'; task: Task }
  | { type: 'deleteTask'; taskId: string }
  | { type: 'setTaskStatus'; taskId: string; status: TaskStatus }
  | { type: 'markTaskSeen'; taskId: string }
  | { type: 'createComment'; taskId: string; body: string }
  | { type: 'createIdea'; idea: Idea }
  | { type: 'convertIdea'; ideaId: string; date: string };
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
};
type PwaAction = {
  label: string;
  status: string;
  tone: 'install' | 'update';
  onPress: () => void;
};
type ActionMenuItem = {
  label: string;
  icon: typeof Plus;
  destructive?: boolean;
  onPress: () => void;
};
type DayTaskListKey = 'focus' | 'tasks' | 'completed';
type HeaderTool = 'timeline' | 'search';
type SharedTabKey = 'others' | 'mine';
type CardAction = {
  icon: typeof Plus;
  label: string;
  destructive?: boolean;
  onPress: () => void;
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof Sun }> = [
  { key: 'day', label: 'День', icon: Sun },
  { key: 'all', label: 'Все задачи', icon: CheckSquare },
  { key: 'links', label: 'Общие', icon: Users },
  { key: 'ideas', label: 'Идеи', icon: Lightbulb },
];

const dateShortcuts = [
  { label: 'Сегодня', value: TODAY },
  { label: 'Завтра', value: TOMORROW },
  { label: '+2 дня', value: addDays(TODAY, 2) },
];

const colors = {
  bg: '#f4f4f4',
  card: '#ffffff',
  text: '#050505',
  muted: '#8f8f8f',
  line: '#dddddd',
  nav: '#eeeeee',
  green: '#18b51a',
  red: '#c7343d',
  orange: '#ffb72f',
  blue: '#3778ff',
};

export default function App() {
  const [view, setView] = useState<ViewMode>('day');
  const [lastTab, setLastTab] = useState<TabKey>('day');
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const [ideas, setIdeas] = useState<Idea[]>(seedIdeas);
  const [query, setQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState(seedTasks[0].id);
  const [taskEditor, setTaskEditor] = useState<{
    visible: boolean;
    taskId?: string;
    initialTitle?: string;
    initialDraft?: Partial<TaskDraft>;
  }>({ visible: false });
  const [ideaEditorVisible, setIdeaEditorVisible] = useState(false);
  const [createMenuVisible, setCreateMenuVisible] = useState(false);
  const [allSearchVisible, setAllSearchVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Локальные данные');
  const [pendingMutations, setPendingMutations] = useState<PendingMutation[]>([]);
  const [online, setOnline] = useState(getInitialOnline);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [pwaInstalled, setPwaInstalled] = useState(isStandalonePwa);
  const [updateReady, setUpdateReady] = useState(false);
  const [pwaInstallHelpVisible, setPwaInstallHelpVisible] = useState(false);
  const queueFlushRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([loadLocalState(), loadAuthState(), loadPendingMutations()])
      .then(([parsed, savedAuth, savedQueue]) => {
        if (!mounted) return;
        if (Array.isArray(parsed?.tasks)) setTasks(parsed.tasks);
        if (Array.isArray(parsed?.ideas)) setIdeas(parsed.ideas);
        if (parsed?.tasks?.[0]?.id) setSelectedTaskId(parsed.tasks[0].id);
        setPendingMutations(savedQueue);
        if (savedAuth) {
          setAuth(savedAuth);
          setSyncStatus('Подключение к API');
          loadRemoteState(savedAuth)
            .then((remoteState) => {
              if (!mounted) return;
              setTasks(remoteState.tasks);
              setIdeas(remoteState.ideas);
              if (remoteState.tasks[0]?.id) setSelectedTaskId(remoteState.tasks[0].id);
              setSyncStatus('API подключен');
            })
            .catch(() => {
              if (mounted) setSyncStatus('Офлайн: локальные данные');
            });
        }
      })
      .catch(() => {
        // Seed data is already in state. Backend sync will own conflicts later.
      })
      .finally(() => {
        if (mounted) setHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveLocalState({ tasks, ideas }).catch(() => {
      // Local persistence failure should not block task work in the UI.
    });
  }, [hydrated, ideas, tasks]);

  useEffect(() => {
    if (!hydrated) return;
    savePendingMutations(pendingMutations).catch(() => {
      // A failed queue write should not block local task edits.
    });
  }, [hydrated, pendingMutations]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;
    const updateOnlineState = () => setOnline(getInitialOnline());
    window.addEventListener('online', updateOnlineState);
    window.addEventListener('offline', updateOnlineState);
    return () => {
      window.removeEventListener('online', updateOnlineState);
      window.removeEventListener('offline', updateOnlineState);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!isStandalonePwa()) {
        setInstallPrompt(event as BeforeInstallPromptEvent);
      }
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setPwaInstalled(true);
    };
    const handleUpdateReady = () => setUpdateReady(true);

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('vtt:pwa-update-ready', handleUpdateReady);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('vtt:pwa-update-ready', handleUpdateReady);
    };
  }, []);

  const activeTab = view === 'timeline' || view === 'detail' ? lastTab : view;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const unreadCount = tasks.filter((task) => !task.seen && task.status === 'active').length;
  const displayedSyncStatus = formatSyncStatus(syncStatus, pendingMutations.length, online);
  const pwaAction = useMemo(
    () =>
      getPwaAction({
        installPrompt,
        pwaInstalled,
        updateReady,
        iosInstallAvailable: isIosWeb() && !pwaInstalled,
        onInstall: () => {
          const prompt = installPrompt;
          if (!prompt) return;
          prompt
            .prompt()
            .catch(() => undefined)
            .finally(() => {
              prompt.userChoice
                .catch(() => undefined)
                .finally(() => setInstallPrompt(null));
            });
        },
        onUpdate: () => {
          setSyncStatus('Обновление');
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.dispatchEvent(new Event('vtt:pwa-apply-update'));
          }
        },
        onIosInstallHelp: () => setPwaInstallHelpVisible(true),
      }),
    [installPrompt, pwaInstalled, updateReady],
  );

  const activeTasks = useMemo(
    () => sortTasks(tasks.filter((task) => task.status === 'active')),
    [tasks],
  );

  const completedTasks = useMemo(
    () => sortTasks(tasks.filter((task) => task.status === 'completed')),
    [tasks],
  );

  const dayTasks = useMemo(
    () => orderDayTasks(tasks.filter((task) => task.status === 'active' && task.date === TODAY)),
    [tasks],
  );

  const dayFocusTasks = dayTasks.filter((task) => task.focus);
  const completedDayTasks = useMemo(
    () => sortTasks(tasks.filter((task) => task.status === 'completed' && task.date === TODAY)),
    [tasks],
  );

  const filteredTasks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return activeTasks.filter((task) => {
      const matchesQuery = !trimmed || task.title.toLowerCase().includes(trimmed);
      return matchesQuery;
    });
  }, [activeTasks, query]);

  const filteredCompletedTasks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return completedTasks.filter((task) => !trimmed || task.title.toLowerCase().includes(trimmed));
  }, [completedTasks, query]);

  const linkedTasks = tasks.filter((task) => Boolean(task.linkedUser));

  const refreshFromApi = (session: AuthState) => {
    setSyncStatus('Синхронизация');
    loadRemoteState(session)
      .then((remoteState) => {
        setTasks(remoteState.tasks);
        setIdeas(remoteState.ideas);
        if (remoteState.tasks[0]?.id) setSelectedTaskId(remoteState.tasks[0].id);
        setSyncStatus('API подключен');
      })
      .catch(() => setSyncStatus('Офлайн: локальные данные'));
  };

  const enqueueMutation = (mutation: PendingMutation) => {
    setPendingMutations((current) => [...current, mutation]);
    setSyncStatus('Офлайн: изменения сохранены локально');
  };

  const runQueuedRemoteMutation = (
    operation: (session: AuthState) => Promise<unknown>,
    mutation: PendingMutation,
  ) => {
    if (!auth || localOnly) return;
    if (!online) {
      enqueueMutation(mutation);
      return;
    }
    operation(auth)
      .then(() => setSyncStatus('API подключен'))
      .catch(() => enqueueMutation(mutation));
  };

  const persistTaskUpdate = (task: Task) => {
    runQueuedRemoteMutation(
      (session) => updateRemoteTask(session, task),
      createPendingMutation({ type: 'updateTask', task }),
    );
  };

  const patchTask = (
    taskId: string,
    patch: Partial<Task>,
    order?: { list: DayTaskListKey; beforeTaskId?: string },
  ) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextTask = { ...task, ...patch, updatedAt: new Date().toISOString() };
    setTasks((current) => {
      const updated = current.map((item) => (item.id === taskId ? nextTask : item));
      return order ? reorderTaskForDay(updated, taskId, order) : updated;
    });
    persistTaskUpdate(nextTask);
  };

  useEffect(() => {
    if (!hydrated || !auth || localOnly || !online || !pendingMutations.length) return undefined;
    if (queueFlushRef.current) return undefined;

    let cancelled = false;
    const queued = pendingMutations;
    queueFlushRef.current = true;
    setSyncStatus(`Синхронизация (${queued.length})`);

    flushPendingMutations(auth, queued)
      .then((remaining) => {
        if (cancelled) return;
        if (remaining.length) {
          if (remaining.length !== queued.length) {
            setPendingMutations(remaining);
          }
          setSyncStatus('Офлайн: изменения сохранены локально');
          return;
        }
        setPendingMutations([]);
        setSyncStatus('API подключен');
        refreshFromApi(auth);
      })
      .catch(() => {
        if (!cancelled) setSyncStatus('Офлайн: изменения сохранены локально');
      })
      .finally(() => {
        queueFlushRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, [auth, hydrated, localOnly, online, pendingMutations]);

  const handleAuthenticated = (session: AuthState) => {
    setAuth(session);
    setLocalOnly(false);
    saveAuthState(session).catch(() => {
      // Auth can still be kept in memory for the current session.
    });
    refreshFromApi(session);
  };

  const handleLocalMode = () => {
    setLocalOnly(true);
    setSyncStatus('Локальный режим');
  };

  const handleLogout = () => {
    const currentAuth = auth;
    setAuth(null);
    setLocalOnly(false);
    setSyncStatus('Локальные данные');
    clearAuthState().catch(() => {
      // Local auth cleanup is best-effort.
    });
    if (currentAuth) {
      logoutRemote(currentAuth).catch(() => {
        // Token may already be invalid or API may be offline.
      });
    }
  };

  const openTab = (tab: TabKey) => {
    setLastTab(tab);
    setView(tab);
  };

  const markTaskSeen = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, seen: true } : task)),
    );
    runQueuedRemoteMutation(
      (session) => markRemoteTaskSeen(session, taskId),
      createPendingMutation({ type: 'markTaskSeen', taskId }),
    );
  };

  const openTask = (taskId: string) => {
    markTaskSeen(taskId);
    setView('detail');
  };

  const saveTask = (draft: TaskDraft, taskId?: string) => {
    const now = new Date().toISOString();
    const isEdit = Boolean(taskId);
    const nextTask: Task = {
      id: taskId ?? `task-${Date.now()}`,
      title: draft.title.trim(),
      description: draft.description.trim(),
      date: draft.date.trim() || TODAY,
      time: draft.time.trim() || undefined,
      durationMinutes: parseOptionalInt(draft.durationMinutes),
      assignee: draft.assignee.trim() || undefined,
      linkedUser: draft.linkedUser.trim() || undefined,
      status: taskId
        ? tasks.find((task) => task.id === taskId)?.status ?? 'active'
        : 'active',
      focus: draft.focus,
      important: draft.important,
      seen: true,
      comments: taskId
        ? tasks.find((task) => task.id === taskId)?.comments ?? []
        : [],
      createdAt: taskId
        ? tasks.find((task) => task.id === taskId)?.createdAt ?? now
        : now,
      updatedAt: now,
    };

    setTasks((current) =>
      taskId
        ? current.map((task) => (task.id === taskId ? nextTask : task))
        : [nextTask, ...current],
    );
    setSelectedTaskId(nextTask.id);
    setTaskEditor({ visible: false });
    runQueuedRemoteMutation(
      (session) =>
        isEdit ? updateRemoteTask(session, nextTask) : createRemoteTask(session, nextTask),
      createPendingMutation({ type: isEdit ? 'updateTask' : 'createTask', task: nextTask }),
    );
  };

  const toggleTask = (taskId: string) => {
    const currentTask = tasks.find((task) => task.id === taskId);
    const nextStatus: TaskStatus = currentTask?.status === 'active' ? 'completed' : 'active';
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: nextStatus,
              updatedAt: new Date().toISOString(),
            }
          : task,
      ),
    );
    runQueuedRemoteMutation(
      (session) => setRemoteTaskStatus(session, taskId, nextStatus),
      createPendingMutation({ type: 'setTaskStatus', taskId, status: nextStatus }),
    );
  };

  const addComment = (taskId: string, comment: string) => {
    const trimmed = comment.trim();
    if (!trimmed) return;
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId
          ? {
              ...task,
              comments: [...task.comments, trimmed],
              updatedAt: new Date().toISOString(),
            }
          : task,
      ),
    );
    runQueuedRemoteMutation(
      (session) => createRemoteComment(session, taskId, trimmed),
      createPendingMutation({ type: 'createComment', taskId, body: trimmed }),
    );
  };

  const setTaskFocus = (taskId: string, focus: boolean, beforeTaskId?: string) => {
    patchTask(taskId, { focus }, { list: focus ? 'focus' : 'tasks', beforeTaskId });
  };

  const reorderFocusTask = (taskId: string, beforeTaskId?: string) => {
    setTasks((current) => reorderTaskForDay(current, taskId, { list: 'focus', beforeTaskId }));
  };

  const makeTaskShared = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    patchTask(taskId, {
      linkedUser: task.linkedUser || 'Анна',
      assignee: task.assignee || task.linkedUser || 'Анна',
      seen: true,
    });
  };

  const markTaskImportant = (taskId: string) => {
    patchTask(taskId, { important: true });
  };

  const moveTaskToIdea = (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const idea: Idea = {
      id: `idea-${Date.now()}`,
      title: task.title,
      description: task.description,
      createdAt: new Date().toISOString(),
    };
    setIdeas((current) => [idea, ...current]);
    setTasks((current) => current.filter((item) => item.id !== taskId));
    runQueuedRemoteMutation(
      (session) => createRemoteIdea(session, idea),
      createPendingMutation({ type: 'createIdea', idea }),
    );
    runQueuedRemoteMutation(
      (session) => deleteRemoteTask(session, taskId),
      createPendingMutation({ type: 'deleteTask', taskId }),
    );
  };

  const deleteTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    runQueuedRemoteMutation(
      (session) => deleteRemoteTask(session, taskId),
      createPendingMutation({ type: 'deleteTask', taskId }),
    );
  };

  const saveIdea = (title: string, description: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const idea: Idea = {
      id: `idea-${Date.now()}`,
      title: trimmed,
      description: description.trim(),
      createdAt: new Date().toISOString(),
    };
    setIdeas((current) => [idea, ...current]);
    setIdeaEditorVisible(false);
    runQueuedRemoteMutation(
      (session) => createRemoteIdea(session, idea),
      createPendingMutation({ type: 'createIdea', idea }),
    );
  };

  const convertIdeaToTask = (idea: Idea) => {
    const taskId = `task-${Date.now()}`;
    const now = new Date().toISOString();
    const optimisticTask: Task = {
      id: taskId,
      title: idea.title,
      description: idea.description,
      date: TODAY,
      status: 'active',
      focus: false,
      important: false,
      seen: true,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };

    setTasks((current) => [optimisticTask, ...current]);
    setIdeas((current) =>
      current.map((item) =>
        item.id === idea.id ? { ...item, convertedTaskId: taskId } : item,
      ),
    );
    setSelectedTaskId(taskId);
    setLastTab('all');
    setView('detail');

    const pendingConvert = createPendingMutation({
      type: 'convertIdea',
      ideaId: idea.id,
      date: TODAY,
    });
    if (!auth || localOnly) return;
    if (!online) {
      enqueueMutation(pendingConvert);
      return;
    }
    setSyncStatus('Синхронизация');
    convertRemoteIdea(auth, idea.id, TODAY)
      .then((remote) => {
        setTasks((current) => [
          remote.task,
          ...current.filter((task) => task.id !== taskId && task.id !== remote.task.id),
        ]);
        setIdeas((current) =>
          current.map((item) => (item.id === remote.idea.id ? remote.idea : item)),
        );
        setSelectedTaskId(remote.task.id);
        setSyncStatus('API подключен');
      })
      .catch(() => enqueueMutation(pendingConvert));
  };

  if (hydrated && !auth && !localOnly) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.shell}>
          <StatusBar style="dark" />
          <AuthScreen
            status={displayedSyncStatus}
            pwaAction={pwaAction}
            onAuthenticated={handleAuthenticated}
            onLocalMode={handleLocalMode}
          />
          <PwaInstallHelpModal
            visible={pwaInstallHelpVisible}
            onClose={() => setPwaInstallHelpVisible(false)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.shell}>
        <StatusBar style="dark" />
        {view === 'timeline' ? (
          <TimelineScreen tasks={dayTasks} onBack={() => setView('day')} />
        ) : view === 'detail' && selectedTask ? (
          <DetailScreen
            task={selectedTask}
            onBack={() => setView(lastTab)}
            onEdit={() => setTaskEditor({ visible: true, taskId: selectedTask.id })}
            onToggle={() => toggleTask(selectedTask.id)}
            onComment={(comment) => addComment(selectedTask.id, comment)}
          />
        ) : (
          <>
            <Header
              title={getHeaderTitle(view, tasks.length)}
              subtitle={view === 'day' ? formatLongDate(TODAY) : displayedSyncStatus}
              centered={view === 'day'}
              unreadCount={unreadCount}
              sessionLabel={displayedSyncStatus}
              pwaAction={pwaAction}
              tool={view === 'day' ? 'timeline' : view === 'all' ? 'search' : undefined}
              toolActive={view === 'all' && (allSearchVisible || Boolean(query.trim()))}
              onToolPress={() => {
                if (view === 'day') {
                  setView('timeline');
                  return;
                }
                if (view === 'all') {
                  setAllSearchVisible((current) => !current);
                }
              }}
              onCreate={() => setCreateMenuVisible(true)}
              onLogout={auth ? handleLogout : undefined}
            />
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.content}
            >
              {view === 'day' && (
                <DayScreen
                  tasks={dayTasks}
                  focusTasks={dayFocusTasks}
                  completedTasks={completedDayTasks}
                  onTaskPress={markTaskSeen}
                  onToggle={toggleTask}
                  onSetFocus={setTaskFocus}
                  onReorderFocus={reorderFocusTask}
                  onMakeShared={makeTaskShared}
                  onMoveToIdea={moveTaskToIdea}
                  onDelete={deleteTask}
                />
              )}
              {view === 'all' && (
                <AllTasksScreen
                  query={query}
                  onQueryChange={setQuery}
                  searchVisible={allSearchVisible}
                  tasks={filteredTasks}
                  completedTasks={filteredCompletedTasks}
                  onTaskPress={markTaskSeen}
                  onToggle={toggleTask}
                  onMakeImportant={markTaskImportant}
                  onMakeShared={makeTaskShared}
                  onMoveToIdea={moveTaskToIdea}
                  onDelete={deleteTask}
                />
              )}
              {view === 'links' && (
                <LinksScreen
                  tasks={linkedTasks}
                  onCreateShared={(draft) => saveTask(draft)}
                  onTaskPress={markTaskSeen}
                  onToggle={toggleTask}
                  onMakeImportant={markTaskImportant}
                  onMoveToIdea={moveTaskToIdea}
                  onDelete={deleteTask}
                />
              )}
              {view === 'ideas' && (
                <IdeasScreen
                  ideas={ideas}
                  onCreate={() => setIdeaEditorVisible(true)}
                  onConvert={convertIdeaToTask}
                />
              )}
            </ScrollView>
          </>
        )}
        <BottomNav active={activeTab as TabKey} onChange={openTab} />
        <TaskEditorModal
          visible={taskEditor.visible}
          task={taskEditor.taskId ? tasks.find((task) => task.id === taskEditor.taskId) : undefined}
          initialTitle={taskEditor.initialTitle}
          initialDraft={taskEditor.initialDraft}
          onClose={() => setTaskEditor({ visible: false })}
          onSave={saveTask}
        />
        <IdeaEditorModal
          visible={ideaEditorVisible}
          onClose={() => setIdeaEditorVisible(false)}
          onSave={saveIdea}
        />
        <ActionMenuModal
          visible={createMenuVisible}
          title="Создать"
          onClose={() => setCreateMenuVisible(false)}
          items={[
            {
              label: 'Новая задача',
              icon: CheckSquare,
              onPress: () => {
                setCreateMenuVisible(false);
                setTaskEditor({ visible: true });
              },
            },
            {
              label: 'Общая задача',
              icon: Users,
              onPress: () => {
                setCreateMenuVisible(false);
                setTaskEditor({
                  visible: true,
                  initialDraft: { linkedUser: 'Анна', assignee: 'Анна' },
                });
              },
            },
            {
              label: 'Добавить идею',
              icon: Lightbulb,
              onPress: () => {
                setCreateMenuVisible(false);
                setIdeaEditorVisible(true);
              },
            },
          ]}
        />
        <PwaInstallHelpModal
          visible={pwaInstallHelpVisible}
          onClose={() => setPwaInstallHelpVisible(false)}
        />
      </View>
    </SafeAreaView>
  );
}

function createPendingMutation(input: PendingMutationInput): PendingMutation {
  return {
    ...input,
    id: `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };
}

async function flushPendingMutations(auth: AuthState, items: PendingMutation[]) {
  const remaining = [...items];

  while (remaining.length) {
    const mutation = remaining[0];
    try {
      await runPendingMutation(auth, mutation);
      remaining.shift();
    } catch {
      return remaining;
    }
  }

  return remaining;
}

function runPendingMutation(auth: AuthState, mutation: PendingMutation) {
  switch (mutation.type) {
    case 'createTask':
      return createRemoteTask(auth, mutation.task);
    case 'updateTask':
      return updateRemoteTask(auth, mutation.task);
    case 'deleteTask':
      return deleteRemoteTask(auth, mutation.taskId);
    case 'setTaskStatus':
      return setRemoteTaskStatus(auth, mutation.taskId, mutation.status);
    case 'markTaskSeen':
      return markRemoteTaskSeen(auth, mutation.taskId);
    case 'createComment':
      return createRemoteComment(auth, mutation.taskId, mutation.body);
    case 'createIdea':
      return createRemoteIdea(auth, mutation.idea);
    case 'convertIdea':
      return convertRemoteIdea(auth, mutation.ideaId, mutation.date);
  }
}

function getInitialOnline() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

function isStandalonePwa() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const standaloneDisplay =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return standaloneDisplay || navigatorWithStandalone.standalone === true;
}

function isIosWeb() {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent || '';
  const navigatorWithTouch = navigator as Navigator & { maxTouchPoints?: number };
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && (navigatorWithTouch.maxTouchPoints ?? 0) > 1)
  );
}

function getPwaAction({
  installPrompt,
  pwaInstalled,
  updateReady,
  iosInstallAvailable,
  onInstall,
  onUpdate,
  onIosInstallHelp,
}: {
  installPrompt: BeforeInstallPromptEvent | null;
  pwaInstalled: boolean;
  updateReady: boolean;
  iosInstallAvailable: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onIosInstallHelp: () => void;
}): PwaAction | undefined {
  if (updateReady) {
    return {
      label: 'Обновить',
      status: 'Доступно обновление',
      tone: 'update',
      onPress: onUpdate,
    };
  }
  if (installPrompt && !pwaInstalled) {
    return {
      label: 'Установить',
      status: 'Можно установить',
      tone: 'install',
      onPress: onInstall,
    };
  }
  if (iosInstallAvailable) {
    return {
      label: 'Как установить',
      status: 'Установка на iPhone',
      tone: 'install',
      onPress: onIosInstallHelp,
    };
  }
  return undefined;
}

function formatSyncStatus(status: string, pendingCount: number, online: boolean) {
  const networkSuffix = online ? '' : ' · нет сети';
  const queueSuffix = pendingCount > 0 ? ` · ${pendingCount} в очереди` : '';
  return `${status}${networkSuffix}${queueSuffix}`;
}

function AuthScreen({
  status,
  pwaAction,
  onAuthenticated,
  onLocalMode,
}: {
  status: string;
  pwaAction?: PwaAction;
  onAuthenticated: (auth: AuthState) => void;
  onLocalMode: () => void;
}) {
  const [phone, setPhone] = useState('+79990000000');
  const [challengeId, setChallengeId] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const requestCode = () => {
    setBusy(true);
    setError('');
    startPhoneLogin(phone)
      .then((challenge) => {
        setChallengeId(challenge.challengeId);
        if (challenge.devCode) {
          setDevCode(challenge.devCode);
          setCode(challenge.devCode);
        }
      })
      .catch(() => setError('API недоступен. Проверь, что backend запущен.'))
      .finally(() => setBusy(false));
  };

  const verifyCode = () => {
    if (!challengeId) {
      requestCode();
      return;
    }
    setBusy(true);
    setError('');
    verifyPhoneLogin(challengeId, code)
      .then(onAuthenticated)
      .catch(() => setError('Код не подошёл или срок действия истёк.'))
      .finally(() => setBusy(false));
  };

  return (
    <View style={styles.authScreen}>
      <View style={styles.authTop}>
        <Text style={styles.authTitle}>Вход</Text>
        <Text style={styles.authSubtitle}>Планирование дня, задачи и идеи</Text>
      </View>
      <View style={styles.authForm}>
        <Field label="Телефон">
          <TextInput
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+79990000000"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </Field>
        <Field label="Код">
          <TextInput
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="1234"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
        </Field>
        {devCode ? <Text style={styles.authHint}>Dev-код: {devCode}</Text> : null}
        {error ? <Text style={styles.authError}>{error}</Text> : null}
        <Pressable
          onPress={challengeId ? verifyCode : requestCode}
          disabled={busy}
          style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {busy ? 'Подключение...' : challengeId ? 'Войти' : 'Получить код'}
          </Text>
        </Pressable>
        {challengeId ? (
          <Pressable onPress={requestCode} disabled={busy} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Отправить код ещё раз</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onLocalMode} style={styles.localModeButton}>
          <Text style={styles.localModeText}>Продолжить локально</Text>
        </Pressable>
      </View>
      <View style={styles.authFooter}>
        <PwaActionBar action={pwaAction} />
        <Text style={styles.authStatus}>{status}</Text>
      </View>
    </View>
  );
}

function getHeaderTitle(view: ViewMode, taskCount: number) {
  if (view === 'day') return 'Сегодня';
  if (view === 'links') return 'Общие';
  if (view === 'ideas') return 'Идеи';
  return `Все задачи (${taskCount})`;
}

function Header({
  title,
  subtitle,
  centered,
  unreadCount,
  sessionLabel,
  pwaAction,
  tool,
  toolActive,
  onToolPress,
  onCreate,
  onLogout,
}: {
  title: string;
  subtitle?: string;
  centered?: boolean;
  unreadCount: number;
  sessionLabel: string;
  pwaAction?: PwaAction;
  tool?: HeaderTool;
  toolActive?: boolean;
  onToolPress?: () => void;
  onCreate: () => void;
  onLogout?: () => void;
}) {
  const ToolIcon = tool === 'timeline' ? Clock3 : tool === 'search' ? Search : null;

  return (
    <View style={styles.header}>
      <View style={styles.statusSpacer} />
      <View style={styles.headerRow}>
        <IconButton icon={Menu} />
        {centered ? (
          <View style={styles.dayTitleRow}>
            <ChevronLeft size={28} color={colors.text} strokeWidth={2} />
            <View style={styles.headerTitleStack}>
              <Text style={styles.headerTitle}>{title}</Text>
              <Text style={styles.headerSubtitle}>{subtitle}</Text>
            </View>
            <ChevronRight size={28} color={colors.text} strokeWidth={2} />
          </View>
        ) : (
          <View style={styles.headerTitleStack}>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
          </View>
        )}
        <View style={styles.headerActions}>
          <View style={styles.bellWrap}>
            <Bell size={23} color="#6f6f6f" strokeWidth={1.8} />
            {unreadCount > 0 ? <View style={styles.bellDot} /> : null}
          </View>
          <Pressable onPress={onCreate} style={styles.plusButton} accessibilityRole="button">
            <Plus size={28} color="#ffffff" strokeWidth={1.6} />
          </Pressable>
        </View>
      </View>
      <View style={styles.headerTools}>
        <View style={styles.sessionRow}>
          <Text numberOfLines={1} style={styles.sessionText}>
            {sessionLabel}
          </Text>
          {onLogout ? (
            <Pressable onPress={onLogout} style={styles.logoutButton}>
              <Text style={styles.logoutText}>Выйти</Text>
            </Pressable>
          ) : null}
        </View>
        {ToolIcon && onToolPress ? (
          <Pressable
            onPress={onToolPress}
            style={[styles.headerToolButton, toolActive && styles.headerToolButtonActive]}
          >
            <ToolIcon
              size={26}
              color={toolActive ? colors.text : '#686868'}
              strokeWidth={1.7}
            />
          </Pressable>
        ) : null}
      </View>
      <PwaActionBar action={pwaAction} />
    </View>
  );
}

function PwaActionBar({ action }: { action?: PwaAction }) {
  if (!action) return null;

  return (
    <View style={styles.pwaActionBar}>
      <Text numberOfLines={1} style={styles.pwaActionStatus}>
        {action.status}
      </Text>
      <Pressable
        onPress={action.onPress}
        style={[
          styles.pwaActionButton,
          action.tone === 'update' && styles.pwaActionButtonAccent,
        ]}
      >
        <Text
          numberOfLines={1}
          style={[
            styles.pwaActionButtonText,
            action.tone === 'update' && styles.pwaActionButtonTextAccent,
          ]}
        >
          {action.label}
        </Text>
      </Pressable>
    </View>
  );
}

function PwaInstallHelpModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.pwaHelpSheet}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>Установка на iPhone</Text>
            <Pressable onPress={onClose} style={styles.editorCloseButton}>
              <X size={24} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.pwaHelpSteps}>
            <PwaInstallStep index="1" text="Открой veratt.ru в Safari." />
            <PwaInstallStep index="2" text="Нажми «Поделиться» в нижней панели." />
            <PwaInstallStep index="3" text="Выбери «На экран Домой» и подтверди добавление." />
          </View>
          <Text style={styles.pwaHelpNote}>
            После добавления приложение откроется с иконки на домашнем экране и будет работать как PWA.
          </Text>
          <Pressable onPress={onClose} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Понятно</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function PwaInstallStep({ index, text }: { index: string; text: string }) {
  return (
    <View style={styles.pwaHelpStep}>
      <View style={styles.pwaHelpStepNumber}>
        <Text style={styles.pwaHelpStepNumberText}>{index}</Text>
      </View>
      <Text style={styles.pwaHelpStepText}>{text}</Text>
    </View>
  );
}

function ActionMenuModal({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: ActionMenuItem[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.menuBackdrop}>
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.menuSheet}>
          <View style={styles.menuHeader}>
            <Text numberOfLines={1} style={styles.menuTitle}>{title}</Text>
            <Pressable onPress={onClose} style={styles.menuCloseButton}>
              <X size={22} color={colors.text} strokeWidth={2} />
            </Pressable>
          </View>
          <View style={styles.menuItems}>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Pressable key={item.label} onPress={item.onPress} style={styles.menuItem}>
                  <View
                    style={[
                      styles.menuIconWrap,
                      item.destructive && styles.menuIconWrapDanger,
                    ]}
                  >
                    <Icon
                      size={20}
                      color={item.destructive ? colors.red : colors.text}
                      strokeWidth={2}
                    />
                  </View>
                  <Text
                    style={[
                      styles.menuItemText,
                      item.destructive && styles.menuItemTextDanger,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TaskContextMenuOverlay({
  task,
  items,
  onClose,
  anchorY,
  hideFocusBadge,
  hideImportantBadge,
  highlightImportant,
  hideAccent,
  showLinkDetails = true,
}: {
  task: Task | null;
  items: ActionMenuItem[];
  onClose: () => void;
  anchorY?: number;
  hideFocusBadge?: boolean;
  hideImportantBadge?: boolean;
  highlightImportant?: boolean;
  hideAccent?: boolean;
  showLinkDetails?: boolean;
}) {
  if (!task) return null;
  const paneOffset =
    typeof anchorY === 'number'
      ? Math.max(86, Math.min(anchorY - 68, 390))
      : Platform.OS === 'ios'
        ? 132
        : 144;

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <Pressable onPress={onClose} style={styles.taskContextBackdrop}>
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[styles.taskContextPane, { marginTop: paneOffset }]}
        >
          <TaskCard
            task={task}
            hideFocusBadge={hideFocusBadge}
            hideImportantBadge={hideImportantBadge}
            highlightImportant={highlightImportant}
            hideAccent={hideAccent}
            showLinkDetails={showLinkDetails}
            onPress={() => undefined}
            onToggle={() => undefined}
          />
          <View style={styles.taskContextMenu}>
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <Pressable key={item.label} onPress={item.onPress} style={styles.contextMenuItem}>
                  <View
                    style={[
                      styles.menuIconWrap,
                      item.destructive && styles.menuIconWrapDanger,
                    ]}
                  >
                    <Icon
                      size={20}
                      color={item.destructive ? colors.red : colors.text}
                      strokeWidth={2}
                    />
                  </View>
                  <Text
                    style={[
                      styles.menuItemText,
                      item.destructive && styles.menuItemTextDanger,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DayScreen({
  tasks,
  focusTasks,
  completedTasks,
  onTaskPress,
  onToggle,
  onSetFocus,
  onReorderFocus,
  onMakeShared,
  onMoveToIdea,
  onDelete,
}: {
  tasks: Task[];
  focusTasks: Task[];
  completedTasks: Task[];
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  onSetFocus: (taskId: string, focus: boolean, beforeTaskId?: string) => void;
  onReorderFocus: (taskId: string, beforeTaskId?: string) => void;
  onMakeShared: (taskId: string) => void;
  onMoveToIdea: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const regularTasks = tasks.filter((task) => !focusTasks.some((item) => item.id === task.id));
  const plannedMinutes = tasks.reduce((sum, task) => sum + (task.durationMinutes ?? 0), 0);
  const [expandedSections, setExpandedSections] = useState({
    focus: true,
    tasks: true,
    completed: false,
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [menuAnchorY, setMenuAnchorY] = useState<number | undefined>(undefined);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const dragStateRef = useRef<{
    taskId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressNextPressRef = useRef(false);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const toggleTaskExpansion = (taskId: string) => {
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      return;
    }
    onTaskPress(taskId);
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
  };

  const dropTask = (taskId: string, list: DayTaskListKey, beforeTaskId?: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task || list === 'completed') return;
    if (list === 'focus') {
      if (task.focus) {
        onReorderFocus(taskId, beforeTaskId);
      } else {
        onSetFocus(taskId, true, beforeTaskId);
      }
      return;
    }
    if (task.focus) {
      onSetFocus(taskId, false, beforeTaskId);
    }
  };

  const dragAttributesForTask = (task: Task, list: DayTaskListKey) => {
    if (Platform.OS !== 'web') return undefined;
    return {
      'data-task-id': task.id,
      'data-list-key': list,
      onPointerDown: (event: any) => {
        dragStateRef.current = {
          taskId: task.id,
          startX: event.nativeEvent?.clientX ?? event.clientX ?? 0,
          startY: event.nativeEvent?.clientY ?? event.clientY ?? 0,
          active: false,
        };
      },
      onPointerMove: (event: any) => {
        const dragState = dragStateRef.current;
        if (!dragState || dragState.taskId !== task.id) return;
        const clientX = event.nativeEvent?.clientX ?? event.clientX ?? 0;
        const clientY = event.nativeEvent?.clientY ?? event.clientY ?? 0;
        const moved =
          Math.abs(clientX - dragState.startX) > 10 ||
          Math.abs(clientY - dragState.startY) > 10;
        if (moved && !dragState.active) {
          dragState.active = true;
          suppressNextPressRef.current = true;
          setDraggingTaskId(task.id);
        }
      },
      onPointerUp: (event: any) => {
        const dragState = dragStateRef.current;
        dragStateRef.current = null;
        setDraggingTaskId(null);
        if (!dragState?.active || typeof document === 'undefined') return;
        event.preventDefault?.();
        event.stopPropagation?.();
        const clientX = event.nativeEvent?.clientX ?? event.clientX ?? 0;
        const clientY = event.nativeEvent?.clientY ?? event.clientY ?? 0;
        const target = document.elementFromPoint(clientX, clientY);
        const dropTarget = target?.closest?.('[data-task-id], [data-task-drop-list]');
        const targetTaskId = dropTarget?.getAttribute('data-task-id') ?? undefined;
        const targetList =
          (dropTarget?.getAttribute('data-list-key') ??
            dropTarget?.getAttribute('data-task-drop-list')) as DayTaskListKey | null;
        if (targetList) {
          dropTask(dragState.taskId, targetList, targetTaskId);
        }
      },
      onPointerCancel: () => {
        dragStateRef.current = null;
        setDraggingTaskId(null);
      },
    };
  };

  const dropAttributesForList = (list: DayTaskListKey) => {
    if (Platform.OS !== 'web') return undefined;
    return {
      'data-task-drop-list': list,
    };
  };

  return (
    <View>
      <SectionTitle
        title={`Фокус на (${focusTasks.length})`}
        collapsible
        expanded={expandedSections.focus}
        onPress={() => toggleSection('focus')}
      />
      <View {...(dropAttributesForList('focus') as object)}>
        {expandedSections.focus ? (
          <TaskStack
            listKey="focus"
            tasks={focusTasks}
            empty="Нет задач в фокусе"
            expandedTaskId={expandedTaskId}
            draggingTaskId={draggingTaskId}
            hideFocusBadge
            dragAttributesForTask={dragAttributesForTask}
            onTaskPress={toggleTaskExpansion}
            onTaskLongPress={(task, event) => {
              setMenuTask(task);
              setMenuAnchorY(event?.nativeEvent?.pageY);
            }}
            onToggle={onToggle}
          />
        ) : null}
      </View>
      <SectionTitle
        title={`Задачи (${regularTasks.length})`}
        collapsible
        expanded={expandedSections.tasks}
        onPress={() => toggleSection('tasks')}
      />
      <View {...(dropAttributesForList('tasks') as object)}>
        {expandedSections.tasks ? (
          <TaskStack
            listKey="tasks"
            tasks={regularTasks}
            empty="На сегодня задач нет"
            expandedTaskId={expandedTaskId}
            draggingTaskId={draggingTaskId}
            dragAttributesForTask={dragAttributesForTask}
            onTaskPress={toggleTaskExpansion}
            onTaskLongPress={(task) => setMenuTask(task)}
            onToggle={onToggle}
          />
        ) : null}
      </View>
      <SectionTitle
        title={`Выполнены (${completedTasks.length})`}
        collapsible
        expanded={expandedSections.completed}
        onPress={() => toggleSection('completed')}
      />
      {expandedSections.completed ? (
        <TaskStack
          listKey="completed"
          tasks={completedTasks}
          empty="Пока нет выполненных задач"
          expandedTaskId={expandedTaskId}
          draggingTaskId={draggingTaskId}
          dragAttributesForTask={dragAttributesForTask}
          onTaskPress={toggleTaskExpansion}
          onTaskLongPress={(task) => setMenuTask(task)}
          onToggle={onToggle}
        />
      ) : null}
      <Text style={styles.footerStat}>
        {tasks.length} задач{'\n'}День загружен на {formatDuration(plannedMinutes)}
      </Text>
      <ActionMenuModal
        visible={Boolean(menuTask)}
        title={menuTask?.title ?? 'Задача'}
        onClose={() => setMenuTask(null)}
        items={[
          {
            label: 'Сделать общей',
            icon: Users,
            onPress: () => {
              if (menuTask) onMakeShared(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Перенести в идеи',
            icon: Lightbulb,
            onPress: () => {
              if (menuTask) onMoveToIdea(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Удалить',
            icon: Trash2,
            destructive: true,
            onPress: () => {
              if (menuTask) onDelete(menuTask.id);
              setMenuTask(null);
            },
          },
        ]}
      />
    </View>
  );
}

function AllTasksScreen({
  query,
  onQueryChange,
  searchVisible,
  tasks,
  completedTasks,
  onTaskPress,
  onToggle,
  onMakeImportant,
  onMakeShared,
  onMoveToIdea,
  onDelete,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  searchVisible: boolean;
  tasks: Task[];
  completedTasks: Task[];
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  onMakeImportant: (taskId: string) => void;
  onMakeShared: (taskId: string) => void;
  onMoveToIdea: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [menuAnchorY, setMenuAnchorY] = useState<number | undefined>(undefined);

  const toggleTaskExpansion = (taskId: string) => {
    onTaskPress(taskId);
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
  };

  return (
    <View>
      {searchVisible || query ? (
        <CompactSearchInput value={query} onChange={onQueryChange} />
      ) : null}
      <TaskStack
        tasks={tasks}
        empty="Ничего не найдено"
        expandedTaskId={expandedTaskId}
        hideFocusBadge
        hideImportantBadge
        highlightImportant
        hideAccent
        showLinkDetails={false}
        onTaskPress={toggleTaskExpansion}
        onTaskLongPress={(task, event) => {
          setMenuTask(task);
          setMenuAnchorY(event?.nativeEvent?.pageY);
        }}
        onToggle={onToggle}
      />
      <SectionTitle
        title={`Выполненные задачи (${completedTasks.length})`}
        collapsible
        expanded={completedExpanded}
        onPress={() => setCompletedExpanded((current) => !current)}
      />
      {completedExpanded ? (
        <TaskStack
          tasks={completedTasks}
          empty="Пока нет выполненных задач"
          expandedTaskId={expandedTaskId}
          hideFocusBadge
          hideImportantBadge
          highlightImportant
          hideAccent
          showLinkDetails={false}
          rightActionForTask={(task) => ({
            icon: Trash2,
            label: 'Удалить',
            destructive: true,
            onPress: () => onDelete(task.id),
          })}
          onTaskPress={toggleTaskExpansion}
          onTaskLongPress={(task, event) => {
            setMenuTask(task);
            setMenuAnchorY(event?.nativeEvent?.pageY);
          }}
          onToggle={onToggle}
        />
      ) : null}
      <TaskContextMenuOverlay
        task={menuTask}
        onClose={() => setMenuTask(null)}
        anchorY={menuAnchorY}
        hideFocusBadge
        hideImportantBadge
        highlightImportant
        hideAccent
        showLinkDetails={false}
        items={[
          {
            label: 'Отметить как важное',
            icon: Star,
            onPress: () => {
              if (menuTask) onMakeImportant(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Сделать общей',
            icon: Users,
            onPress: () => {
              if (menuTask) onMakeShared(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Перенести в идеи',
            icon: Lightbulb,
            onPress: () => {
              if (menuTask) onMoveToIdea(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Удалить',
            icon: Trash2,
            destructive: true,
            onPress: () => {
              if (menuTask) onDelete(menuTask.id);
              setMenuTask(null);
            },
          },
        ]}
      />
    </View>
  );
}

function LinksScreen({
  tasks,
  onCreateShared,
  onTaskPress,
  onToggle,
  onMakeImportant,
  onMoveToIdea,
  onDelete,
}: {
  tasks: Task[];
  onCreateShared: (draft: TaskDraft) => void;
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  onMakeImportant: (taskId: string) => void;
  onMoveToIdea: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}) {
  const [tab, setTab] = useState<SharedTabKey>('others');
  const [formVisible, setFormVisible] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    accept: true,
    new: true,
    waiting: true,
    overdue: true,
    progress: true,
    completed: false,
  });
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [menuAnchorY, setMenuAnchorY] = useState<number | undefined>(undefined);

  const othersTasks = tasks.filter(isTaskAssignedToOther);
  const mineTasks = tasks.filter((task) => !isTaskAssignedToOther(task));
  const visibleTasks = tab === 'others' ? othersTasks : mineTasks;
  const completed = visibleTasks.filter((task) => task.status === 'completed');
  const active = visibleTasks.filter((task) => task.status === 'active');
  const overdue = active.filter((task) => isOverdue(task));
  const inProgress = active.filter((task) => task.seen && !isOverdue(task));
  const newTasks = active.filter((task) => !task.seen && !task.important);
  const waitingTasks = active.filter((task) => !task.seen && task.important);
  const acceptTasks = completed.filter((task) => !task.seen);
  const completedReady = completed.filter((task) => task.seen);

  const toggleSection = (key: string) => {
    setExpandedSections((current) => ({ ...current, [key]: !current[key] }));
  };
  const toggleTaskExpansion = (taskId: string) => {
    onTaskPress(taskId);
    setExpandedTaskId((current) => (current === taskId ? null : taskId));
  };

  const renderSection = (key: string, title: string, sectionTasks: Task[], collapsed = false) => {
    const expanded = expandedSections[key] ?? !collapsed;
    return (
      <>
        <SectionTitle
          title={`${title} (${sectionTasks.length})`}
          collapsible
          expanded={expanded}
          onPress={() => toggleSection(key)}
        />
        {expanded ? (
          <TaskStack
            tasks={sectionTasks}
            empty="Задач нет"
            expandedTaskId={expandedTaskId}
            hideFocusBadge
            highlightImportant
            onTaskPress={toggleTaskExpansion}
            onTaskLongPress={(task, event) => {
              setMenuTask(task);
              setMenuAnchorY(event?.nativeEvent?.pageY);
            }}
            onToggle={onToggle}
          />
        ) : null}
      </>
    );
  };

  return (
    <View>
      <SegmentedTabs
        value={tab}
        items={[
          { key: 'others', label: 'Чужие задачи' },
          { key: 'mine', label: 'Мои задачи' },
        ]}
        onChange={setTab}
      />
      <AddInput
        placeholder="+ Добавить задачу"
        onPress={() => setFormVisible((current) => !current)}
      />
      {formVisible ? (
        <InlineSharedTaskForm
          tab={tab}
          onCancel={() => setFormVisible(false)}
          onSave={(draft) => {
            onCreateShared(draft);
            setFormVisible(false);
          }}
        />
      ) : null}
      {tab === 'others' ? (
        <>
          {renderSection('accept', 'Принять задачи', acceptTasks)}
          {renderSection('overdue', 'Требует внимания', overdue)}
          {renderSection('progress', 'В процессе', inProgress)}
          {renderSection('completed', 'Выполненные', completedReady, true)}
        </>
      ) : (
        <>
          {renderSection('new', 'Новые задачи', newTasks)}
          {renderSection('waiting', 'Ждут принятия', waitingTasks)}
          {renderSection('overdue', 'Требует внимания', overdue)}
          {renderSection('progress', 'В процессе', inProgress)}
          {renderSection('completed', 'Выполненные', completedReady, true)}
        </>
      )}
      <TaskContextMenuOverlay
        task={menuTask}
        onClose={() => setMenuTask(null)}
        anchorY={menuAnchorY}
        hideFocusBadge
        highlightImportant
        items={[
          {
            label: 'Отметить как важное',
            icon: Star,
            onPress: () => {
              if (menuTask) onMakeImportant(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Перенести в идеи',
            icon: Lightbulb,
            onPress: () => {
              if (menuTask) onMoveToIdea(menuTask.id);
              setMenuTask(null);
            },
          },
          {
            label: 'Удалить',
            icon: Trash2,
            destructive: true,
            onPress: () => {
              if (menuTask) onDelete(menuTask.id);
              setMenuTask(null);
            },
          },
        ]}
      />
    </View>
  );
}

function SegmentedTabs({
  value,
  items,
  onChange,
}: {
  value: SharedTabKey;
  items: Array<{ key: SharedTabKey; label: string }>;
  onChange: (value: SharedTabKey) => void;
}) {
  return (
    <View style={styles.segmentedTabs}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[styles.segmentedTab, active && styles.segmentedTabActive]}
          >
            <Text style={[styles.segmentedTabText, active && styles.segmentedTabTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function InlineSharedTaskForm({
  tab,
  onCancel,
  onSave,
}: {
  tab: SharedTabKey;
  onCancel: () => void;
  onSave: (draft: TaskDraft) => void;
}) {
  const [title, setTitle] = useState('');
  const [linkedUser, setLinkedUser] = useState('Анна');
  const [date, setDate] = useState(TODAY);

  const submit = () => {
    const trimmed = title.trim();
    const user = linkedUser.trim() || 'Анна';
    if (!trimmed) {
      Alert.alert('Общая задача', 'Добавь название задачи.');
      return;
    }
    onSave({
      title: trimmed,
      description: '',
      date: date.trim() || TODAY,
      time: '',
      durationMinutes: '',
      assignee: tab === 'others' ? user : 'Я',
      linkedUser: user,
      focus: false,
      important: false,
    });
    setTitle('');
  };

  return (
    <View style={styles.inlineForm}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Название задачи"
        placeholderTextColor={colors.muted}
        style={styles.inlineFormInput}
      />
      <View style={styles.inlineFormRow}>
        <TextInput
          value={linkedUser}
          onChangeText={setLinkedUser}
          placeholder="С кем связана"
          placeholderTextColor={colors.muted}
          style={[styles.inlineFormInput, styles.inlineFormHalf]}
        />
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder={TODAY}
          placeholderTextColor={colors.muted}
          style={[styles.inlineFormInput, styles.inlineFormHalf]}
        />
      </View>
      <View style={styles.inlineFormActions}>
        <Pressable onPress={onCancel} style={styles.inlineFormButton}>
          <Text style={styles.inlineFormButtonText}>Отмена</Text>
        </Pressable>
        <Pressable onPress={submit} style={[styles.inlineFormButton, styles.inlineFormButtonPrimary]}>
          <Text style={[styles.inlineFormButtonText, styles.inlineFormButtonTextPrimary]}>
            Создать
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function IdeasScreen({
  ideas,
  onCreate,
  onConvert,
}: {
  ideas: Idea[];
  onCreate: () => void;
  onConvert: (idea: Idea) => void;
}) {
  return (
    <View>
      <AddInput placeholder="+ Добавить идею" outlined onPress={onCreate} />
      <View style={styles.cardStack}>
        {ideas.map((idea, index) => (
          <View key={idea.id} style={styles.ideaCard}>
            <Text numberOfLines={2} style={styles.ideaTitle}>
              {idea.title}
            </Text>
            {idea.description ? (
              <Text numberOfLines={3} style={styles.ideaDescription}>
                {idea.description}
              </Text>
            ) : null}
            <View style={styles.ideaFooter}>
              <Text style={styles.ideaMeta}>Идея {index + 1}</Text>
              {idea.convertedTaskId ? (
                <Text style={styles.convertedLabel}>Создана задача</Text>
              ) : (
                <Pressable onPress={() => onConvert(idea)} style={styles.textButton}>
                  <Text style={styles.textButtonLabel}>Создать задачу</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function TimelineScreen({ tasks, onBack }: { tasks: Task[]; onBack: () => void }) {
  const timedTasks = tasks.filter((task) => task.time);
  const withoutTime = tasks.filter((task) => !task.time);

  return (
    <>
      <View style={styles.timelineHeader}>
        <IconButton icon={Menu} />
        <Pressable onPress={onBack} style={styles.timelineDate}>
          <ChevronLeft size={27} color={colors.text} strokeWidth={2} />
          <View>
            <Text style={styles.headerTitle}>Сегодня</Text>
            <Text style={styles.headerSubtitle}>{formatLongDate(TODAY)}</Text>
          </View>
          <ChevronRight size={27} color={colors.text} strokeWidth={2} />
        </Pressable>
        <CalendarDays size={30} color="#6f6f6f" strokeWidth={1.8} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.timelineGrid}>
          {timeRows().map((time, index) => {
            const task = timedTasks.find((item) => item.time === time);
            return (
              <View key={time} style={styles.timeRow}>
                <Text style={[styles.timeText, index % 2 === 1 && styles.timeTextMuted]}>
                  {time}
                </Text>
                {task ? (
                  <View style={styles.inlineTimelineTask}>
                    <Text numberOfLines={1} style={styles.inlineTimelineTitle}>
                      {task.title}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <SectionTitle title="Без времени" />
        <View style={styles.cardStack}>
          {withoutTime.map((task) => (
            <View key={task.id} style={styles.timelineTask}>
              <Text style={styles.timelineTaskTitle}>{task.title}</Text>
              {task.durationMinutes ? (
                <Text style={styles.durationText}>{formatDuration(task.durationMinutes)}</Text>
              ) : null}
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

function DetailScreen({
  task,
  onBack,
  onEdit,
  onToggle,
  onComment,
}: {
  task: Task;
  onBack: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onComment: (comment: string) => void;
}) {
  const [comment, setComment] = useState('');

  const submit = () => {
    onComment(comment);
    setComment('');
  };

  return (
    <>
      <View style={styles.timelineHeader}>
        <IconButton icon={Menu} />
        <Pressable onPress={onBack} style={styles.timelineDate}>
          <ChevronLeft size={27} color={colors.text} strokeWidth={2} />
          <View>
            <Text style={styles.headerTitle}>Задача</Text>
            <Text style={styles.headerSubtitle}>{formatDate(task.date)}</Text>
          </View>
          <ChevronRight size={27} color={colors.text} strokeWidth={2} />
        </Pressable>
        <Pressable onPress={onEdit} style={styles.plusButton}>
          <Edit3 size={23} color="#ffffff" strokeWidth={1.8} />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <SectionTitle title={task.focus || task.important ? 'Фокус на' : 'Задача'} />
        <View style={styles.detailCard}>
          <View style={styles.detailTop}>
            <Pressable onPress={onToggle} style={styles.checkbox}>
              {task.status === 'completed' ? <Check size={15} color={colors.text} /> : null}
            </Pressable>
            <Text
              style={[
                styles.detailTitle,
                task.status === 'completed' && styles.taskTitleCompleted,
              ]}
            >
              {task.title}
            </Text>
            <Text style={styles.detailTime}>{formatTaskMeta(task)}</Text>
          </View>
          <View style={styles.divider} />
          <Text style={styles.detailBody}>
            {task.description || 'Описание пока не добавлено.'}
          </Text>
          <Text style={styles.detailHint}>✓ Идеальный конечный результат:</Text>
          <Text style={styles.detailResult}>Задача закрыта без лишних уточнений</Text>
          {task.linkedUser ? (
            <Text style={styles.shareLink}>Связано с: {task.linkedUser}</Text>
          ) : (
            <Text style={styles.shareLink}>Личная задача</Text>
          )}
          <View style={styles.commentInput}>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Добавить комментарий"
              placeholderTextColor={colors.muted}
              style={styles.commentField}
            />
            <Pressable onPress={submit} style={styles.sendButton}>
              <Send size={17} color="#ffffff" strokeWidth={2.4} />
            </Pressable>
            <Mic size={25} color="#6f6f6f" strokeWidth={1.8} />
          </View>
        </View>
        {task.comments.length > 0 ? (
          <>
            <SectionTitle title={`Комментарии (${task.comments.length})`} />
            <View style={styles.cardStack}>
              {task.comments.map((item, index) => (
                <View key={`${item}-${index}`} style={styles.commentCard}>
                  <Text style={styles.commentText}>{item}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function TaskEditorModal({
  visible,
  task,
  initialTitle,
  initialDraft,
  onClose,
  onSave,
}: {
  visible: boolean;
  task?: Task;
  initialTitle?: string;
  initialDraft?: Partial<TaskDraft>;
  onClose: () => void;
  onSave: (draft: TaskDraft, taskId?: string) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => toDraft(task, initialTitle, initialDraft));

  useEffect(() => {
    if (visible) setDraft(toDraft(task, initialTitle, initialDraft));
  }, [initialDraft, initialTitle, task, visible]);

  const update = (patch: Partial<TaskDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    if (!draft.title.trim()) {
      Alert.alert('Название задачи', 'Добавь короткое название задачи.');
      return;
    }
    const date = draft.date.trim() || TODAY;
    const time = draft.time.trim();
    const duration = draft.durationMinutes.trim();
    if (!isValidDateKey(date)) {
      Alert.alert('Дата', 'Введи дату в формате YYYY-MM-DD.');
      return;
    }
    if (time && !isValidTime(time)) {
      Alert.alert('Время', 'Введи время в формате 18:00.');
      return;
    }
    if (duration && !isValidPositiveInteger(duration)) {
      Alert.alert('Длительность', 'Введи длительность целым числом минут.');
      return;
    }
    onSave(draft, task?.id);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.editorSheet}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>{task ? 'Редактировать задачу' : 'Новая задача'}</Text>
            <Pressable onPress={onClose} style={styles.editorCloseButton}>
              <X size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Field label="Название">
              <TextInput
                value={draft.title}
                onChangeText={(title) => update({ title })}
                placeholder="Что нужно сделать?"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </Field>
            <Field label="Описание">
              <TextInput
                value={draft.description}
                onChangeText={(description) => update({ description })}
                placeholder="Короткий контекст"
                placeholderTextColor={colors.muted}
                multiline
                style={[styles.input, styles.textArea]}
              />
            </Field>
            <View style={styles.fieldGrid}>
              <Field label="Дата" compact>
                <TextInput
                  value={draft.date}
                  onChangeText={(date) => update({ date })}
                  placeholder={TODAY}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </Field>
              <Field label="Время" compact>
                <TextInput
                  value={draft.time}
                  onChangeText={(time) => update({ time })}
                  placeholder="18:00"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </Field>
            </View>
            <DateShortcutRow
              value={draft.date}
              onChange={(date) => update({ date })}
            />
            <View style={styles.fieldGrid}>
              <Field label="Длительность, мин" compact>
                <TextInput
                  value={draft.durationMinutes}
                  onChangeText={(durationMinutes) => update({ durationMinutes })}
                  keyboardType="number-pad"
                  placeholder="30"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </Field>
              <Field label="Исполнитель" compact>
                <TextInput
                  value={draft.assignee}
                  onChangeText={(assignee) => update({ assignee })}
                  placeholder="Я"
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                />
              </Field>
            </View>
            <Field label="Связанный пользователь">
              <TextInput
                value={draft.linkedUser}
                onChangeText={(linkedUser) => update({ linkedUser })}
                placeholder="Анна"
                placeholderTextColor={colors.muted}
                style={styles.input}
              />
            </Field>
            <View style={styles.toggleRow}>
              <ToggleChip
                label="Фокус"
                active={draft.focus}
                icon={Star}
                onPress={() => update({ focus: !draft.focus })}
              />
              <ToggleChip
                label="Важное"
                active={draft.important}
                icon={Bell}
                onPress={() => update({ important: !draft.important })}
              />
            </View>
          </ScrollView>
          <Pressable onPress={submit} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Сохранить</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function IdeaEditorModal({
  visible,
  onClose,
  onSave,
}: {
  visible: boolean;
  onClose: () => void;
  onSave: (title: string, description: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (visible) {
      setTitle('');
      setDescription('');
    }
  }, [visible]);

  const submit = () => {
    if (!title.trim()) {
      Alert.alert('Идея', 'Добавь название идеи.');
      return;
    }
    onSave(title, description);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalBackdrop}>
        <View style={styles.editorSheet}>
          <View style={styles.editorHeader}>
            <Text style={styles.editorTitle}>Новая идея</Text>
            <Pressable onPress={onClose} style={styles.editorCloseButton}>
              <X size={24} color={colors.text} />
            </Pressable>
          </View>
          <Field label="Название">
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Что стоит сохранить?"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
          </Field>
          <Field label="Описание">
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Детали идеи"
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, styles.textArea]}
            />
          </Field>
          <Pressable onPress={submit} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Сохранить идею</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  children,
  compact,
}: {
  label: string;
  children: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[styles.field, compact && styles.fieldCompact]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function ToggleChip({
  label,
  active,
  icon: Icon,
  onPress,
}: {
  label: string;
  active: boolean;
  icon: typeof Star;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.toggleChip, active && styles.toggleChipActive]}>
      <Icon size={18} color={active ? '#ffffff' : colors.text} />
      <Text style={[styles.toggleChipText, active && styles.toggleChipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DateShortcutRow({
  value,
  onChange,
}: {
  value: string;
  onChange: (date: string) => void;
}) {
  return (
    <View style={styles.dateShortcutRow}>
      {dateShortcuts.map((shortcut) => {
        const active = value === shortcut.value;
        return (
          <Pressable
            key={shortcut.value}
            onPress={() => onChange(shortcut.value)}
            style={[styles.dateShortcut, active && styles.dateShortcutActive]}
          >
            <CalendarDays
              size={16}
              color={active ? '#ffffff' : colors.text}
              strokeWidth={2}
            />
            <Text style={[styles.dateShortcutText, active && styles.dateShortcutTextActive]}>
              {shortcut.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CompactSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.compactSearchRow}>
      <View style={styles.compactSearchBox}>
        <Search size={20} color={colors.muted} strokeWidth={1.8} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder="Поиск"
          placeholderTextColor={colors.muted}
          style={styles.compactSearchInput}
          returnKeyType="search"
        />
        {value ? (
          <Pressable onPress={() => onChange('')} style={styles.compactSearchClear}>
            <X size={16} color={colors.muted} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function AddInput({
  placeholder,
  outlined,
  onPress,
}: {
  placeholder: string;
  outlined?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.addInput, outlined && styles.addInputOutlined]}>
      <Text style={styles.addInputText}>{placeholder}</Text>
      <Mic size={24} color={colors.muted} strokeWidth={1.8} />
    </Pressable>
  );
}

function SectionTitle({
  title,
  collapsible,
  expanded,
  onPress,
}: {
  title: string;
  collapsible?: boolean;
  expanded?: boolean;
  onPress?: () => void;
}) {
  const ChevronIcon = expanded === false ? ChevronRight : ChevronDown;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={styles.sectionTitleRow}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={collapsible ? { expanded: expanded ?? true } : undefined}
    >
      <Text style={styles.sectionTitle}>{title}</Text>
      {collapsible ? <ChevronIcon size={17} color={colors.text} strokeWidth={2} /> : null}
    </Pressable>
  );
}

function TaskStack({
  listKey,
  tasks,
  empty,
  expandedTaskId,
  draggingTaskId,
  hideFocusBadge,
  hideImportantBadge,
  highlightImportant,
  hideAccent,
  showLinkDetails = true,
  rightActionForTask,
  dragAttributesForTask,
  onTaskPress,
  onTaskLongPress,
  onToggle,
}: {
  listKey?: DayTaskListKey;
  tasks: Task[];
  empty?: string;
  expandedTaskId?: string | null;
  draggingTaskId?: string | null;
  hideFocusBadge?: boolean;
  hideImportantBadge?: boolean;
  highlightImportant?: boolean;
  hideAccent?: boolean;
  showLinkDetails?: boolean;
  rightActionForTask?: (task: Task) => CardAction | undefined;
  dragAttributesForTask?: (task: Task, list: DayTaskListKey) => Record<string, unknown> | undefined;
  onTaskPress: (taskId: string) => void;
  onTaskLongPress?: (task: Task, event?: any) => void;
  onToggle: (taskId: string) => void;
}) {
  if (!tasks.length) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>{empty ?? 'Список пуст'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.cardStack}>
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          expanded={expandedTaskId === task.id}
          dragging={draggingTaskId === task.id}
          hideFocusBadge={hideFocusBadge}
          hideImportantBadge={hideImportantBadge}
          highlightImportant={highlightImportant}
          hideAccent={hideAccent}
          showLinkDetails={showLinkDetails}
          rightAction={rightActionForTask?.(task)}
          dragAttributes={
            listKey && dragAttributesForTask ? dragAttributesForTask(task, listKey) : undefined
          }
          onPress={() => onTaskPress(task.id)}
          onLongPress={onTaskLongPress ? (event) => onTaskLongPress(task, event) : undefined}
          onToggle={() => onToggle(task.id)}
        />
      ))}
    </View>
  );
}

function TaskCard({
  task,
  expanded,
  dragging,
  hideFocusBadge,
  hideImportantBadge,
  highlightImportant,
  hideAccent,
  showLinkDetails = true,
  rightAction,
  dragAttributes,
  onPress,
  onLongPress,
  onToggle,
}: {
  task: Task;
  expanded?: boolean;
  dragging?: boolean;
  hideFocusBadge?: boolean;
  hideImportantBadge?: boolean;
  highlightImportant?: boolean;
  hideAccent?: boolean;
  showLinkDetails?: boolean;
  rightAction?: CardAction;
  dragAttributes?: Record<string, unknown>;
  onPress: () => void;
  onLongPress?: (event: any) => void;
  onToggle: () => void;
}) {
  const accent = hideAccent ? 'transparent' : getAccent(task);
  const RightIcon = rightAction?.icon;

  return (
    <Pressable
      {...(dragAttributes as object)}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={360}
      style={[
        styles.taskCard,
        highlightImportant && task.important && styles.taskCardImportant,
        expanded && styles.taskCardExpanded,
        dragging && styles.taskCardDragging,
      ]}
    >
      <View style={styles.taskRow}>
        <Pressable onPress={onToggle} style={styles.checkbox}>
          {task.status === 'completed' ? <Check size={15} color={colors.text} /> : null}
        </Pressable>
        <View style={styles.taskMain}>
          <View style={styles.taskBadges}>
            {task.linkedUser ? (
              <View style={styles.ownerRow}>
                <Users size={15} color="#111827" fill="#111827" strokeWidth={2} />
                <Text style={styles.ownerText}>{task.linkedUser}</Text>
              </View>
            ) : null}
            {task.focus && !hideFocusBadge ? <Text style={styles.badgeText}>Фокус</Text> : null}
            {task.important && !hideImportantBadge ? (
              <Text style={styles.badgeText}>Важное</Text>
            ) : null}
          </View>
          <Text
            style={[styles.taskTitle, task.status === 'completed' && styles.taskTitleCompleted]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
        </View>
        {rightAction ? (
          <Pressable
            onPress={(event) => {
              event.stopPropagation?.();
              rightAction.onPress();
            }}
            style={[
              styles.taskIconAction,
              rightAction.destructive && styles.taskIconActionDanger,
            ]}
            accessibilityLabel={rightAction.label}
          >
            {RightIcon ? (
              <RightIcon
                size={20}
                color={rightAction.destructive ? colors.red : colors.text}
                strokeWidth={2}
              />
            ) : null}
          </Pressable>
        ) : (
          <View style={styles.taskMeta}>
            <Text style={styles.taskMetaText}>{formatDate(task.date)}</Text>
            {task.time ? <Text style={styles.taskMetaText}>до {task.time}</Text> : null}
            {task.durationMinutes ? (
              <Text style={styles.taskMetaText}>{formatDuration(task.durationMinutes)}</Text>
            ) : null}
          </View>
        )}
      </View>
      {expanded ? <TaskInlineDetails task={task} showLinkDetails={showLinkDetails} /> : null}
      <View style={[styles.accentRail, { backgroundColor: accent }]} />
    </Pressable>
  );
}

function TaskInlineDetails({
  task,
  showLinkDetails = true,
}: {
  task: Task;
  showLinkDetails?: boolean;
}) {
  return (
    <View style={styles.taskInlineDetails}>
      <Text style={styles.taskInlineDescription}>
        {task.description || 'Описание пока не добавлено.'}
      </Text>
      <View style={styles.taskInlineMetaGrid}>
        <View style={styles.taskInlineMetaItem}>
          <Text style={styles.taskInlineMetaLabel}>Результат</Text>
          <Text style={styles.taskInlineMetaValue}>Задача закрыта без лишних уточнений</Text>
        </View>
        {showLinkDetails ? (
          <View style={styles.taskInlineMetaItem}>
            <Text style={styles.taskInlineMetaLabel}>Связь</Text>
            <Text style={styles.taskInlineMetaValue}>
              {task.linkedUser ? task.linkedUser : 'Без связанного пользователя'}
            </Text>
          </View>
        ) : null}
      </View>
      {task.comments.length > 0 ? (
        <Text style={styles.taskInlineComments}>Комментарии: {task.comments.length}</Text>
      ) : null}
    </View>
  );
}

function BottomNav({
  active,
  onChange,
}: {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={styles.navItem}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Icon
              size={31}
              color={isActive ? '#5b5b5b' : '#b4b4b4'}
              fill={isActive ? '#5b5b5b' : '#b4b4b4'}
              strokeWidth={1.8}
            />
            <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function IconButton({ icon: Icon }: { icon: typeof Menu }) {
  return (
    <Pressable style={styles.iconButton} accessibilityRole="button">
      <Icon size={31} color="#707070" strokeWidth={2.4} />
    </Pressable>
  );
}

function toDraft(task?: Task, initialTitle?: string, initialDraft?: Partial<TaskDraft>): TaskDraft {
  const draft = {
    title: task?.title ?? initialTitle ?? '',
    description: task?.description ?? '',
    date: task?.date ?? TODAY,
    time: task?.time ?? '',
    durationMinutes: task?.durationMinutes ? String(task.durationMinutes) : '',
    assignee: task?.assignee ?? '',
    linkedUser: task?.linkedUser ?? '',
    focus: task?.focus ?? false,
    important: task?.important ?? false,
  };
  return { ...draft, ...initialDraft };
}

function sortTasks(items: Task[]) {
  return [...items].sort((a, b) => {
    const priorityDelta = Number(b.focus || b.important) - Number(a.focus || a.important);
    if (priorityDelta !== 0) return priorityDelta;
    const dateDelta = a.date.localeCompare(b.date);
    if (dateDelta !== 0) return dateDelta;
    return (a.time ?? '99:99').localeCompare(b.time ?? '99:99');
  });
}

function orderDayTasks(items: Task[]) {
  const focusItems = items.filter((task) => task.focus);
  const regularItems = sortTasks(items.filter((task) => !task.focus));
  return [...focusItems, ...regularItems];
}

function isTaskAssignedToOther(task: Task) {
  return Boolean(task.linkedUser && task.assignee && task.assignee === task.linkedUser);
}

function isOverdue(task: Task) {
  return task.status === 'active' && task.date < TODAY;
}

function reorderTaskForDay(
  items: Task[],
  taskId: string,
  order: { list: DayTaskListKey; beforeTaskId?: string },
) {
  const movingTask = items.find((task) => task.id === taskId);
  if (!movingTask || order.list === 'completed') return items;

  const withoutMoving = items.filter((task) => task.id !== taskId);
  if (order.beforeTaskId && order.beforeTaskId !== taskId) {
    const beforeIndex = withoutMoving.findIndex((task) => task.id === order.beforeTaskId);
    if (beforeIndex >= 0) {
      return [
        ...withoutMoving.slice(0, beforeIndex),
        movingTask,
        ...withoutMoving.slice(beforeIndex),
      ];
    }
  }

  const sameDayActive = (task: Task) => task.status === 'active' && task.date === movingTask.date;
  const targetList = order.list === 'focus'
    ? (task: Task) => sameDayActive(task) && task.focus
    : (task: Task) => sameDayActive(task) && !task.focus;
  const insertAfterIndex = withoutMoving.reduce(
    (lastIndex, task, index) => (targetList(task) ? index : lastIndex),
    -1,
  );

  return [
    ...withoutMoving.slice(0, insertAfterIndex + 1),
    movingTask,
    ...withoutMoving.slice(insertAfterIndex + 1),
  ];
}

function parseOptionalInt(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidPositiveInteger(value: string) {
  return /^\d+$/.test(value) && Number.parseInt(value, 10) > 0;
}

function formatDate(date: string) {
  if (date === TODAY) return 'Сегодня';
  if (date === TOMORROW) return 'Завтра';
  const [, month, day] = date.split('-');
  return `${Number(day)}.${month}`;
}

function formatLongDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat('ru-RU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(value);
}

function formatTaskMeta(task: Task) {
  const rows = [formatDate(task.date)];
  if (task.time) rows.push(`до ${task.time}`);
  if (task.durationMinutes) rows.push(formatDuration(task.durationMinutes));
  return rows.join('\n');
}

function formatDuration(minutes: number) {
  if (minutes <= 0) return '0 мин';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

function getAccent(task: Task) {
  if (task.status === 'completed') return '#d9d9d9';
  if (task.important && task.date < TODAY) return colors.red;
  if (task.linkedUser && !task.seen) return colors.orange;
  if (task.focus || task.important) return colors.green;
  return 'transparent';
}

function timeRows() {
  return [
    '09:00',
    '09:30',
    '10:00',
    '10:30',
    '11:00',
    '11:30',
    '12:00',
    '12:30',
    '13:00',
    '13:30',
    '14:00',
    '14:30',
    '15:00',
    '15:30',
    '16:00',
    '16:30',
    '17:00',
    '17:30',
    '18:00',
    '18:30',
    '19:00',
  ];
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  shell: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  statusSpacer: {
    height: Platform.OS === 'ios' ? 8 : 14,
  },
  authScreen: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 42 : 28,
    paddingBottom: 22,
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  authTop: {
    marginTop: 28,
  },
  authTitle: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '700',
  },
  authSubtitle: {
    marginTop: 8,
    color: '#555555',
    fontSize: 18,
    lineHeight: 24,
  },
  authForm: {
    marginTop: 34,
  },
  authHint: {
    marginTop: 10,
    color: colors.blue,
    fontSize: 15,
    lineHeight: 20,
  },
  authError: {
    marginTop: 10,
    color: colors.red,
    fontSize: 15,
    lineHeight: 20,
  },
  authFooter: {
    gap: 10,
  },
  authStatus: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  header: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  headerRow: {
    minHeight: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleStack: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 128,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '400',
    textAlign: 'center',
  },
  headerSubtitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    textAlign: 'center',
  },
  dayTitleRow: {
    flex: 1,
    maxWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: {
    width: 94,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  bellWrap: {
    width: 28,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 6,
    right: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#ff0c12',
  },
  plusButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a9a9a9',
  },
  headerTools: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sessionRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sessionText: {
    maxWidth: 190,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 17,
  },
  logoutButton: {
    height: 30,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  logoutText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 17,
  },
  headerToolButton: {
    width: 46,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  headerToolButtonActive: {
    backgroundColor: '#ffffff',
  },
  pwaActionBar: {
    minHeight: 38,
    marginTop: 8,
    paddingLeft: 12,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  pwaActionStatus: {
    flex: 1,
    minWidth: 0,
    color: '#555555',
    fontSize: 14,
    lineHeight: 18,
  },
  pwaActionButton: {
    minHeight: 30,
    maxWidth: 136,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#f0f0f0',
  },
  pwaActionButtonAccent: {
    backgroundColor: '#000000',
  },
  pwaActionButtonText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  pwaActionButtonTextAccent: {
    color: '#ffffff',
  },
  iconButton: {
    width: 52,
    height: 52,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 128,
  },
  addInput: {
    height: 38,
    marginTop: 18,
    marginBottom: 12,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 6,
    backgroundColor: colors.card,
  },
  addInputOutlined: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#bdbdbd',
    backgroundColor: '#ffffff',
  },
  addInputText: {
    color: colors.muted,
    fontSize: 19,
    lineHeight: 24,
  },
  compactSearchRow: {
    minHeight: 42,
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginBottom: 8,
  },
  compactSearchBox: {
    width: 218,
    height: 38,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: colors.card,
  },
  compactSearchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  compactSearchClear: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleRow: {
    minHeight: 34,
    marginTop: 10,
    marginBottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  cardStack: {
    gap: 8,
  },
  taskCard: {
    position: 'relative',
    minHeight: 68,
    paddingVertical: 9,
    paddingLeft: 13,
    paddingRight: 12,
    borderRadius: 8,
    backgroundColor: colors.card,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
    overflow: 'hidden',
  },
  taskCardExpanded: {
    minHeight: 164,
  },
  taskCardImportant: {
    backgroundColor: '#fff6d8',
  },
  taskCardDragging: {
    opacity: 0.72,
    transform: [{ scale: 0.99 }],
  },
  taskRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 21,
    height: 21,
    marginRight: 12,
    borderRadius: 4,
    borderWidth: 1.4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  taskMain: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  taskBadges: {
    minHeight: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 2,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ownerText: {
    color: '#2a2a2a',
    fontSize: 14,
    lineHeight: 18,
  },
  badgeText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  taskTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: '400',
  },
  taskTitleCompleted: {
    color: '#8f8f8f',
    textDecorationLine: 'line-through',
  },
  taskMeta: {
    width: 74,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  taskMetaText: {
    color: '#5f5f5f',
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'right',
  },
  taskIconAction: {
    width: 42,
    height: 42,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  taskIconActionDanger: {
    backgroundColor: '#fff0f1',
  },
  taskInlineDetails: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    gap: 10,
  },
  taskInlineDescription: {
    color: '#3f3f3f',
    fontSize: 15,
    lineHeight: 21,
  },
  taskInlineMetaGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  taskInlineMetaItem: {
    flex: 1,
    minWidth: 0,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#f4f4f4',
  },
  taskInlineMetaLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  taskInlineMetaValue: {
    marginTop: 3,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  taskInlineComments: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 18,
  },
  accentRail: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  emptyCard: {
    minHeight: 58,
    paddingHorizontal: 14,
    alignItems: 'flex-start',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  emptyText: {
    color: colors.muted,
    fontSize: 16,
  },
  completedLink: {
    marginTop: 20,
    marginBottom: 16,
    color: colors.muted,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  footerStat: {
    marginTop: 56,
    color: '#b2b2b2',
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
  },
  segmentedTabs: {
    height: 42,
    marginTop: 8,
    padding: 4,
    flexDirection: 'row',
    borderRadius: 8,
    backgroundColor: '#e9e9e9',
  },
  segmentedTab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  segmentedTabActive: {
    backgroundColor: '#ffffff',
  },
  segmentedTabText: {
    color: '#777777',
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
  },
  segmentedTabTextActive: {
    color: colors.text,
  },
  inlineForm: {
    marginBottom: 10,
    padding: 12,
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  inlineFormRow: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineFormHalf: {
    flex: 1,
    minWidth: 0,
  },
  inlineFormInput: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: 8,
    color: colors.text,
    backgroundColor: '#f4f4f4',
    fontSize: 16,
  },
  inlineFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  inlineFormButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f3f3f3',
  },
  inlineFormButtonPrimary: {
    backgroundColor: '#000000',
  },
  inlineFormButtonText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '700',
  },
  inlineFormButtonTextPrimary: {
    color: '#ffffff',
  },
  linkSummary: {
    marginTop: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  summaryNumber: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '700',
  },
  summaryText: {
    flex: 1,
    color: '#4e4e4e',
    fontSize: 16,
    lineHeight: 22,
  },
  ideaCard: {
    minHeight: 92,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.card,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  ideaTitle: {
    color: colors.text,
    fontSize: 19,
    lineHeight: 25,
  },
  ideaDescription: {
    marginTop: 8,
    color: '#555555',
    fontSize: 15,
    lineHeight: 20,
  },
  ideaFooter: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ideaMeta: {
    color: colors.muted,
    fontSize: 14,
  },
  convertedLabel: {
    color: colors.green,
    fontSize: 14,
  },
  textButton: {
    minHeight: 30,
    justifyContent: 'center',
  },
  textButtonLabel: {
    color: colors.blue,
    fontSize: 15,
  },
  timelineHeader: {
    paddingTop: Platform.OS === 'ios' ? 8 : 20,
    paddingHorizontal: 12,
    minHeight: 116,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg,
  },
  timelineDate: {
    flex: 1,
    maxWidth: 250,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timelineGrid: {
    marginTop: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  timeRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  timeText: {
    width: 62,
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
  },
  timeTextMuted: {
    color: '#d1d1d1',
  },
  inlineTimelineTask: {
    flex: 1,
    height: 24,
    paddingHorizontal: 9,
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#ffffff',
  },
  inlineTimelineTitle: {
    color: colors.text,
    fontSize: 14,
  },
  timelineTask: {
    minHeight: 58,
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 8,
    backgroundColor: colors.card,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09,
    shadowRadius: 9,
    elevation: 4,
  },
  timelineTaskTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
  },
  durationText: {
    color: '#777777',
    fontSize: 14,
    lineHeight: 19,
  },
  detailCard: {
    padding: 13,
    borderRadius: 8,
    backgroundColor: colors.card,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.09,
    shadowRadius: 10,
    elevation: 4,
    borderRightWidth: 4,
    borderRightColor: colors.green,
  },
  detailTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  detailTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 19,
    lineHeight: 24,
  },
  detailTime: {
    width: 72,
    color: '#666666',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 17,
    backgroundColor: '#d9d9d9',
  },
  detailBody: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 26,
  },
  detailHint: {
    marginTop: 23,
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
  },
  detailResult: {
    marginTop: 9,
    color: colors.text,
    fontSize: 18,
    lineHeight: 24,
  },
  shareLink: {
    marginTop: 22,
    color: colors.blue,
    fontSize: 18,
    lineHeight: 24,
  },
  commentInput: {
    height: 42,
    marginTop: 24,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 21,
    backgroundColor: '#f0f0f0',
  },
  commentField: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    paddingVertical: 0,
  },
  sendButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6d6d6d',
  },
  commentCard: {
    padding: 13,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  commentText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  pwaHelpSheet: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.bg,
  },
  pwaHelpSteps: {
    marginTop: 10,
    gap: 10,
  },
  pwaHelpStep: {
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  pwaHelpStepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  pwaHelpStepNumberText: {
    color: '#ffffff',
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },
  pwaHelpStepText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  pwaHelpNote: {
    marginTop: 12,
    color: '#555555',
    fontSize: 14,
    lineHeight: 20,
  },
  menuBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  menuSheet: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 22,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.bg,
  },
  menuHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  menuTitle: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  menuCloseButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItems: {
    marginTop: 8,
    gap: 8,
  },
  menuItem: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  menuIconWrap: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f2f2f2',
  },
  menuIconWrapDanger: {
    backgroundColor: '#fff0f1',
  },
  menuItemText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
  },
  menuItemTextDanger: {
    color: colors.red,
  },
  taskContextBackdrop: {
    flex: 1,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  taskContextPane: {
    gap: 8,
  },
  taskContextMenu: {
    padding: 8,
    gap: 6,
    borderRadius: 8,
    backgroundColor: colors.bg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  contextMenuItem: {
    minHeight: 46,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  editorSheet: {
    maxHeight: '92%',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.bg,
  },
  editorHeader: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  editorTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
  },
  editorCloseButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    marginTop: 12,
  },
  fieldCompact: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    marginBottom: 6,
    color: '#555555',
    fontSize: 14,
    lineHeight: 18,
  },
  fieldGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    color: colors.text,
    backgroundColor: '#ffffff',
    fontSize: 17,
  },
  textArea: {
    minHeight: 96,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  toggleRow: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 10,
  },
  toggleChip: {
    minHeight: 42,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  toggleChipActive: {
    backgroundColor: '#000000',
  },
  toggleChipText: {
    color: colors.text,
    fontSize: 16,
  },
  toggleChipTextActive: {
    color: '#ffffff',
  },
  dateShortcutRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  dateShortcut: {
    minHeight: 38,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  dateShortcutActive: {
    backgroundColor: '#000000',
  },
  dateShortcutText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 19,
  },
  dateShortcutTextActive: {
    color: '#ffffff',
  },
  primaryButton: {
    height: 48,
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#000000',
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    height: 42,
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: colors.blue,
    fontSize: 16,
    lineHeight: 21,
  },
  localModeButton: {
    height: 44,
    marginTop: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  localModeText: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
  },
  bottomNav: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 92,
    paddingTop: 12,
    paddingHorizontal: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.nav,
  },
  navItem: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
  },
  navLabel: {
    color: '#ababab',
    fontSize: 16,
    lineHeight: 20,
    textAlign: 'center',
  },
  navLabelActive: {
    color: '#5b5b5b',
  },
});
