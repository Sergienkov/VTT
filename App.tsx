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
  Users,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
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
  loadRemoteState,
  logoutRemote,
  markRemoteTaskSeen,
  setRemoteTaskStatus,
  startPhoneLogin,
  updateRemoteTask,
  verifyPhoneLogin,
} from './src/apiClient';
import { clearAuthState, loadAuthState, saveAuthState } from './src/authRepository';
import { addDays, AuthState, Idea, Task, TaskDraft, TaskStatus, TODAY, TOMORROW } from './src/domain';
import { loadLocalState, saveLocalState } from './src/localTaskRepository';
import { seedIdeas, seedTasks } from './src/seedData';

type TabKey = 'day' | 'all' | 'links' | 'ideas';
type ViewMode = TabKey | 'timeline' | 'detail';
type TaskFilter = 'all' | 'today' | 'personal' | 'shared' | 'focus';

const tabs: Array<{ key: TabKey; label: string; icon: typeof Sun }> = [
  { key: 'day', label: 'День', icon: Sun },
  { key: 'all', label: 'Все задачи', icon: CheckSquare },
  { key: 'links', label: 'Связи', icon: Users },
  { key: 'ideas', label: 'Идеи', icon: Lightbulb },
];

const taskFilters: Array<{ key: TaskFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'personal', label: 'Личные' },
  { key: 'shared', label: 'Совместные' },
  { key: 'focus', label: 'Важное' },
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
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [selectedTaskId, setSelectedTaskId] = useState(seedTasks[0].id);
  const [taskEditor, setTaskEditor] = useState<{
    visible: boolean;
    taskId?: string;
    initialTitle?: string;
  }>({ visible: false });
  const [ideaEditorVisible, setIdeaEditorVisible] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Локальные данные');

  useEffect(() => {
    let mounted = true;

    Promise.all([loadLocalState(), loadAuthState()])
      .then(([parsed, savedAuth]) => {
        if (!mounted) return;
        if (Array.isArray(parsed?.tasks)) setTasks(parsed.tasks);
        if (Array.isArray(parsed?.ideas)) setIdeas(parsed.ideas);
        if (parsed?.tasks?.[0]?.id) setSelectedTaskId(parsed.tasks[0].id);
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

  const activeTab = view === 'timeline' || view === 'detail' ? lastTab : view;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const unreadCount = tasks.filter((task) => !task.seen && task.status === 'active').length;

  const activeTasks = useMemo(
    () => sortTasks(tasks.filter((task) => task.status === 'active')),
    [tasks],
  );

  const completedTasks = useMemo(
    () => sortTasks(tasks.filter((task) => task.status === 'completed')),
    [tasks],
  );

  const dayTasks = useMemo(
    () => activeTasks.filter((task) => task.date === TODAY),
    [activeTasks],
  );

  const dayFocusTasks = dayTasks.filter((task) => task.focus || task.important);

  const filteredTasks = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    return activeTasks.filter((task) => {
      const matchesQuery = !trimmed || task.title.toLowerCase().includes(trimmed);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'today' && task.date === TODAY) ||
        (filter === 'personal' && !task.linkedUser) ||
        (filter === 'shared' && Boolean(task.linkedUser)) ||
        (filter === 'focus' && (task.focus || task.important));
      return matchesQuery && matchesFilter;
    });
  }, [activeTasks, filter, query]);

  const linkedTasks = activeTasks.filter((task) => Boolean(task.linkedUser));

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

  const runRemoteMutation = (operation: (session: AuthState) => Promise<unknown>) => {
    if (!auth || localOnly) return;
    operation(auth)
      .then(() => setSyncStatus('API подключен'))
      .catch(() => setSyncStatus('Офлайн: изменения сохранены локально'));
  };

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

  const openTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, seen: true } : task)),
    );
    runRemoteMutation((session) => markRemoteTaskSeen(session, taskId));
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
    runRemoteMutation((session) =>
      isEdit ? updateRemoteTask(session, nextTask) : createRemoteTask(session, nextTask),
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
    runRemoteMutation((session) => setRemoteTaskStatus(session, taskId, nextStatus));
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
    runRemoteMutation((session) => createRemoteComment(session, taskId, trimmed));
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
    runRemoteMutation((session) => createRemoteIdea(session, idea));
  };

  const convertIdeaToTask = (idea: Idea) => {
    const taskId = `task-${Date.now()}`;
    const now = new Date().toISOString();
    setTasks((current) => [
      {
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
      },
      ...current,
    ]);
    setIdeas((current) =>
      current.map((item) =>
        item.id === idea.id ? { ...item, convertedTaskId: taskId } : item,
      ),
    );
    setSelectedTaskId(taskId);
    setLastTab('all');
    setView('detail');
    runRemoteMutation((session) => convertRemoteIdea(session, idea.id, TODAY));
  };

  if (hydrated && !auth && !localOnly) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.shell}>
          <StatusBar style="dark" />
          <AuthScreen
            status={syncStatus}
            onAuthenticated={handleAuthenticated}
            onLocalMode={handleLocalMode}
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
              subtitle={view === 'day' ? formatLongDate(TODAY) : syncStatus}
              centered={view === 'day'}
              unreadCount={unreadCount}
              sessionLabel={syncStatus}
              onTimeline={() => setView('timeline')}
              onCreate={() => setTaskEditor({ visible: true })}
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
                  completedCount={completedTasks.filter((task) => task.date === TODAY).length}
                  onCreate={() => setTaskEditor({ visible: true })}
                  onTaskPress={openTask}
                  onToggle={toggleTask}
                />
              )}
              {view === 'all' && (
                <AllTasksScreen
                  filter={filter}
                  onFilterChange={setFilter}
                  query={query}
                  onQueryChange={setQuery}
                  tasks={filteredTasks}
                  completedTasks={completedTasks}
                  onCreate={() => setTaskEditor({ visible: true })}
                  onTaskPress={openTask}
                  onToggle={toggleTask}
                />
              )}
              {view === 'links' && (
                <LinksScreen
                  tasks={linkedTasks}
                  onCreate={() => setTaskEditor({ visible: true })}
                  onTaskPress={openTask}
                  onToggle={toggleTask}
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
          onClose={() => setTaskEditor({ visible: false })}
          onSave={saveTask}
        />
        <IdeaEditorModal
          visible={ideaEditorVisible}
          onClose={() => setIdeaEditorVisible(false)}
          onSave={saveIdea}
        />
      </View>
    </SafeAreaView>
  );
}

function AuthScreen({
  status,
  onAuthenticated,
  onLocalMode,
}: {
  status: string;
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
      <Text style={styles.authStatus}>{status}</Text>
    </View>
  );
}

function getHeaderTitle(view: ViewMode, taskCount: number) {
  if (view === 'day') return 'Сегодня';
  if (view === 'links') return 'Связи';
  if (view === 'ideas') return 'Идеи';
  return `Все задачи (${taskCount})`;
}

function Header({
  title,
  subtitle,
  centered,
  unreadCount,
  sessionLabel,
  onTimeline,
  onCreate,
  onLogout,
}: {
  title: string;
  subtitle?: string;
  centered?: boolean;
  unreadCount: number;
  sessionLabel: string;
  onTimeline: () => void;
  onCreate: () => void;
  onLogout?: () => void;
}) {
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
        <Pressable onPress={onTimeline} style={styles.headerToolButton}>
          <Clock3 size={26} color="#686868" strokeWidth={1.7} />
        </Pressable>
      </View>
    </View>
  );
}

function DayScreen({
  tasks,
  focusTasks,
  completedCount,
  onCreate,
  onTaskPress,
  onToggle,
}: {
  tasks: Task[];
  focusTasks: Task[];
  completedCount: number;
  onCreate: () => void;
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
}) {
  const regularTasks = tasks.filter((task) => !focusTasks.some((item) => item.id === task.id));
  const plannedMinutes = tasks.reduce((sum, task) => sum + (task.durationMinutes ?? 0), 0);

  return (
    <View>
      <AddInput placeholder="+ Добавить задачу" onPress={onCreate} />
      <SectionTitle title="Фокус на" collapsible />
      <TaskStack
        tasks={focusTasks}
        empty="Нет задач в фокусе"
        onTaskPress={onTaskPress}
        onToggle={onToggle}
      />
      <SectionTitle title={`Задачи дня (${regularTasks.length})`} collapsible />
      <TaskStack
        tasks={regularTasks}
        empty="На сегодня задач нет"
        onTaskPress={onTaskPress}
        onToggle={onToggle}
      />
      <Text style={styles.completedLink}>Выполненные ({completedCount}) ›</Text>
      <Text style={styles.footerStat}>
        {tasks.length} задач{'\n'}День загружен на {formatDuration(plannedMinutes)}
      </Text>
    </View>
  );
}

function AllTasksScreen({
  filter,
  onFilterChange,
  query,
  onQueryChange,
  tasks,
  completedTasks,
  onCreate,
  onTaskPress,
  onToggle,
}: {
  filter: TaskFilter;
  onFilterChange: (filter: TaskFilter) => void;
  query: string;
  onQueryChange: (query: string) => void;
  tasks: Task[];
  completedTasks: Task[];
  onCreate: () => void;
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
}) {
  return (
    <View>
      <FilterTabs value={filter} onChange={onFilterChange} items={taskFilters} />
      <AddInput placeholder="+ Добавить задачу" onPress={onCreate} />
      <SearchInput value={query} onChange={onQueryChange} />
      <TaskStack
        tasks={tasks}
        empty="Ничего не найдено"
        onTaskPress={onTaskPress}
        onToggle={onToggle}
      />
      <SectionTitle title={`Выполненные (${completedTasks.length})`} />
      <TaskStack
        tasks={completedTasks.slice(0, 3)}
        empty="Пока нет выполненных задач"
        onTaskPress={onTaskPress}
        onToggle={onToggle}
      />
    </View>
  );
}

function LinksScreen({
  tasks,
  onCreate,
  onTaskPress,
  onToggle,
}: {
  tasks: Task[];
  onCreate: () => void;
  onTaskPress: (taskId: string) => void;
  onToggle: (taskId: string) => void;
}) {
  const unseenTasks = tasks.filter((task) => !task.seen);
  const seenTasks = tasks.filter((task) => task.seen);

  return (
    <View>
      <View style={styles.linkSummary}>
        <Text style={styles.summaryNumber}>{tasks.length}</Text>
        <Text style={styles.summaryText}>совместных задач с тестовыми пользователями</Text>
      </View>
      <AddInput placeholder="+ Добавить совместную задачу" onPress={onCreate} />
      {unseenTasks.length > 0 ? (
        <>
          <SectionTitle title={`Новые задачи (${unseenTasks.length})`} collapsible />
          <TaskStack tasks={unseenTasks} onTaskPress={onTaskPress} onToggle={onToggle} />
        </>
      ) : null}
      <SectionTitle title="В работе" collapsible />
      <TaskStack
        tasks={seenTasks}
        empty="Совместных задач пока нет"
        onTaskPress={onTaskPress}
        onToggle={onToggle}
      />
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
  onClose,
  onSave,
}: {
  visible: boolean;
  task?: Task;
  initialTitle?: string;
  onClose: () => void;
  onSave: (draft: TaskDraft, taskId?: string) => void;
}) {
  const [draft, setDraft] = useState<TaskDraft>(() => toDraft(task, initialTitle));

  useEffect(() => {
    if (visible) setDraft(toDraft(task, initialTitle));
  }, [initialTitle, task, visible]);

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

function FilterTabs({
  value,
  items,
  onChange,
}: {
  value: TaskFilter;
  items: Array<{ key: TaskFilter; label: string }>;
  onChange: (value: TaskFilter) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterTabs}>
      {items.map((item) => (
        <Pressable key={item.key} onPress={() => onChange(item.key)} style={styles.filterChip}>
          <Text style={[styles.filterText, item.key === value && styles.filterTextActive]}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.searchBox}>
      <Search size={23} color={colors.muted} strokeWidth={1.8} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Поиск"
        placeholderTextColor={colors.muted}
        style={styles.searchInput}
        returnKeyType="search"
      />
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

function SectionTitle({ title, collapsible }: { title: string; collapsible?: boolean }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {collapsible ? <ChevronDown size={17} color={colors.text} strokeWidth={2} /> : null}
    </View>
  );
}

function TaskStack({
  tasks,
  empty,
  onTaskPress,
  onToggle,
}: {
  tasks: Task[];
  empty?: string;
  onTaskPress: (taskId: string) => void;
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
          onPress={() => onTaskPress(task.id)}
          onToggle={() => onToggle(task.id)}
        />
      ))}
    </View>
  );
}

function TaskCard({
  task,
  onPress,
  onToggle,
}: {
  task: Task;
  onPress: () => void;
  onToggle: () => void;
}) {
  const accent = getAccent(task);

  return (
    <Pressable onPress={onPress} style={styles.taskCard}>
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
            {task.focus ? <Text style={styles.badgeText}>Фокус</Text> : null}
            {task.important ? <Text style={styles.badgeText}>Важное</Text> : null}
          </View>
          <Text
            style={[styles.taskTitle, task.status === 'completed' && styles.taskTitleCompleted]}
            numberOfLines={2}
          >
            {task.title}
          </Text>
        </View>
        <View style={styles.taskMeta}>
          <Text style={styles.taskMetaText}>{formatDate(task.date)}</Text>
          {task.time ? <Text style={styles.taskMetaText}>до {task.time}</Text> : null}
          {task.durationMinutes ? (
            <Text style={styles.taskMetaText}>{formatDuration(task.durationMinutes)}</Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.accentRail, { backgroundColor: accent }]} />
    </Pressable>
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

function toDraft(task?: Task, initialTitle?: string): TaskDraft {
  return {
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
  filterTabs: {
    gap: 22,
    paddingVertical: 8,
    paddingRight: 12,
  },
  filterChip: {
    height: 36,
    justifyContent: 'center',
  },
  filterText: {
    color: colors.muted,
    fontSize: 17,
    lineHeight: 22,
  },
  filterTextActive: {
    color: colors.text,
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
  searchBox: {
    height: 38,
    marginBottom: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 6,
    backgroundColor: colors.card,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 17,
    paddingVertical: 0,
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
