import { Idea, Task, TODAY } from './domain';

export const seedTasks: Task[] = [
  createSeedTask({
    id: 'task-1',
    title: 'Актуализировать статус по задачам Леухина',
    description:
      'Сверить прогресс, коротко обновить статус и отметить блокеры на сегодня.',
    date: TODAY,
    time: '18:00',
    durationMinutes: 30,
    assignee: 'Анна',
    linkedUser: 'Анна',
    focus: true,
    important: true,
  }),
  createSeedTask({
    id: 'task-2',
    title: 'Подготовить информацию по ключницам в Ростокино и Крюково',
    description:
      'Собрать актуальные данные по объектам и подготовить короткий список вопросов.',
    date: TODAY,
    important: true,
  }),
  createSeedTask({
    id: 'task-3',
    title: 'Проверить подписи в корпоративной почте',
    description:
      'Перед отправкой проверь, чтобы в письмах были актуальные контакты и единый формат подписи.',
    date: TODAY,
    time: '12:30',
    durationMinutes: 30,
    focus: true,
  }),
  createSeedTask({
    id: 'task-4',
    title: 'Собрать публикации о компании в СМИ',
    date: TODAY,
  }),
  createSeedTask({
    id: 'task-5',
    title: 'Проверить склад РМ',
    date: TODAY,
    durationMinutes: 30,
  }),
  createSeedTask({
    id: 'task-6',
    title: 'Сверить статусы задач по прошлому спринту',
    date: TODAY,
    time: '19:30',
    durationMinutes: 60,
    assignee: 'Алексей',
    linkedUser: 'Алексей',
    important: true,
  }),
  createSeedTask({
    id: 'task-7',
    title: 'Обновить раздел "Партнёры" на сайте',
    date: '2025-10-07',
    assignee: 'Алексей',
    important: true,
  }),
  createSeedTask({
    id: 'task-8',
    title: 'Проверить состояние транспортных кейсов',
    date: '2025-11-11',
    time: '10:30',
    assignee: 'Денис',
    linkedUser: 'Денис',
    seen: false,
  }),
  createSeedTask({
    id: 'task-9',
    title: 'Уточнить контактное лицо в депо Калужское',
    date: '2025-10-10',
    time: '12:30',
    assignee: 'Михаил',
    linkedUser: 'Михаил',
    seen: false,
  }),
  createSeedTask({
    id: 'task-10',
    title: 'Проверить оформление актов выполненных работ',
    date: '2025-10-11',
    assignee: 'Лидия',
    linkedUser: 'Лидия',
    status: 'completed',
  }),
];

export const seedIdeas: Idea[] = [
  {
    id: 'idea-1',
    title: 'Переносная энергостанция в защитном кейсе',
    description:
      'LiFePO4-батарея, инвертор и понятный индикатор заряда в компактном кейсе.',
    createdAt: '2025-10-09T09:00:00.000Z',
  },
  {
    id: 'idea-2',
    title: 'Диагностический модуль OBD-II с предиктивной аналитикой',
    createdAt: '2025-10-09T09:10:00.000Z',
  },
  {
    id: 'idea-3',
    title: 'Герметичные кейсы с Bluetooth-мониторингом состояния батареи',
    createdAt: '2025-10-09T09:20:00.000Z',
  },
  {
    id: 'idea-4',
    title: 'Микропроизводство корпусов и кейсов на 3D-принтерах',
    createdAt: '2025-10-09T09:30:00.000Z',
  },
];

function createSeedTask(task: Partial<Task> & Pick<Task, 'id' | 'title' | 'date'>): Task {
  const timestamp = '2025-10-09T09:00:00.000Z';
  return {
    description: '',
    durationMinutes: undefined,
    assignee: '',
    linkedUser: '',
    status: 'active',
    focus: false,
    important: false,
    seen: true,
    comments: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...task,
  };
}
