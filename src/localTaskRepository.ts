import AsyncStorage from '@react-native-async-storage/async-storage';

import { StoredState } from './domain';

export const STORAGE_KEY = 'task-manager-mvp-state-v1';

export async function loadLocalState(): Promise<Partial<StoredState> | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as Partial<StoredState>;
}

export async function saveLocalState(state: StoredState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
