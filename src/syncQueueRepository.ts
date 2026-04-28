import AsyncStorage from '@react-native-async-storage/async-storage';

import { PendingMutation } from './domain';

const SYNC_QUEUE_KEY = 'task-manager-sync-queue-v1';

export async function loadPendingMutations(): Promise<PendingMutation[]> {
  const raw = await AsyncStorage.getItem(SYNC_QUEUE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as PendingMutation[]) : [];
}

export async function savePendingMutations(items: PendingMutation[]): Promise<void> {
  if (!items.length) {
    await AsyncStorage.removeItem(SYNC_QUEUE_KEY);
    return;
  }
  await AsyncStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(items));
}
