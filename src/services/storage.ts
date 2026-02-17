import AsyncStorage from '@react-native-async-storage/async-storage';
import { MessageWithParts, ServerConfig, Session } from '../types';

const STORAGE_KEYS = {
  serverConfig: 'opencode.serverConfig',
  sessions: 'opencode.sessions',
  currentSession: 'opencode.currentSession',
  messages: 'opencode.messages',
  hostId: 'opencode.hostId',
  jwt: 'opencode.jwt',
  currentDirectory: 'opencode.currentDirectory',
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  await writeJson(STORAGE_KEYS.serverConfig, config);
}

export async function loadServerConfig(): Promise<ServerConfig | null> {
  return readJson<ServerConfig>(STORAGE_KEYS.serverConfig);
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  await writeJson(STORAGE_KEYS.sessions, sessions);
}

export async function loadSessions(): Promise<Session[]> {
  return (await readJson<Session[]>(STORAGE_KEYS.sessions)) || [];
}

export async function saveCurrentSession(session: Session | null): Promise<void> {
  if (!session) {
    await AsyncStorage.removeItem(STORAGE_KEYS.currentSession);
    return;
  }
  await writeJson(STORAGE_KEYS.currentSession, session);
}

export async function loadCurrentSession(): Promise<Session | null> {
  return readJson<Session>(STORAGE_KEYS.currentSession);
}

export async function saveMessages(messages: MessageWithParts[]): Promise<void> {
  await writeJson(STORAGE_KEYS.messages, messages);
}

export async function loadMessages(): Promise<MessageWithParts[]> {
  return (await readJson<MessageWithParts[]>(STORAGE_KEYS.messages)) || [];
}

export async function saveHostId(hostId: string | null): Promise<void> {
  if (!hostId) {
    await AsyncStorage.removeItem(STORAGE_KEYS.hostId);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEYS.hostId, hostId);
}

export async function loadHostId(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.hostId);
}

export async function saveJwt(jwt: string | null): Promise<void> {
  if (!jwt) {
    await AsyncStorage.removeItem(STORAGE_KEYS.jwt);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEYS.jwt, jwt);
}

export async function loadJwt(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.jwt);
}

export async function saveCurrentDirectory(directory: string | null): Promise<void> {
  if (!directory) {
    await AsyncStorage.removeItem(STORAGE_KEYS.currentDirectory);
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEYS.currentDirectory, directory);
}
