import AsyncStorage from '@react-native-async-storage/async-storage';
import { ServerConfig, Session, MessageWithParts } from '../types';

const SERVER_CONFIG_KEY = '@server_config';
const SESSIONS_KEY = '@sessions';
const CURRENT_SESSION_KEY = '@current_session';
const MESSAGES_KEY = '@messages';

export async function saveServerConfig(config: ServerConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVER_CONFIG_KEY, JSON.stringify(config));
  } catch (error) {
    console.error('Failed to save server config:', error);
  }
}

export async function loadServerConfig(): Promise<ServerConfig | null> {
  try {
    const stored = await AsyncStorage.getItem(SERVER_CONFIG_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to load server config:', error);
    return null;
  }
}

export async function clearServerConfig(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SERVER_CONFIG_KEY);
  } catch (error) {
    console.error('Failed to clear server config:', error);
  }
}

export async function saveSessions(sessions: Session[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('Failed to save sessions:', error);
  }
}

export async function loadSessions(): Promise<Session[]> {
  try {
    const stored = await AsyncStorage.getItem(SESSIONS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load sessions:', error);
    return [];
  }
}

export async function saveCurrentSession(session: Session | null): Promise<void> {
  try {
    if (session) {
      await AsyncStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(session));
    } else {
      await AsyncStorage.removeItem(CURRENT_SESSION_KEY);
    }
  } catch (error) {
    console.error('Failed to save current session:', error);
  }
}

export async function loadCurrentSession(): Promise<Session | null> {
  try {
    const stored = await AsyncStorage.getItem(CURRENT_SESSION_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('Failed to load current session:', error);
    return null;
  }
}

export async function saveMessages(messages: MessageWithParts[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
  } catch (error) {
    console.error('Failed to save messages:', error);
  }
}

export async function loadMessages(): Promise<MessageWithParts[]> {
  try {
    const stored = await AsyncStorage.getItem(MESSAGES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error('Failed to load messages:', error);
    return [];
  }
}

export async function clearAllStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([SERVER_CONFIG_KEY, SESSIONS_KEY, CURRENT_SESSION_KEY, MESSAGES_KEY]);
  } catch (error) {
    console.error('Failed to clear all storage:', error);
  }
}
