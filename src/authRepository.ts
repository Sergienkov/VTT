import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthState } from './domain';

const AUTH_KEY = 'task-manager-auth-v1';

export async function loadAuthState(): Promise<AuthState | null> {
  const raw = await AsyncStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as AuthState;
}

export async function saveAuthState(auth: AuthState): Promise<void> {
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

export async function clearAuthState(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY);
}
