import AsyncStorage from '@react-native-async-storage/async-storage';
import { ServerConfig } from '../types';

const SERVER_CONFIG_KEY = '@server_config';

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
