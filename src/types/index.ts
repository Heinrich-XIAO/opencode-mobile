export interface ServerConfig {
  hostname: string;
  port: number;
  username?: string;
  password?: string;
}

export interface Session {
  id: string;
  code?: string;
  password?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface Part {
  type: 'text' | 'reasoning' | 'tool' | 'image' | 'error';
  text?: string;
  toolName?: string;
  toolInput?: string;
  toolOutput?: string;
}

export interface MessageWithParts {
  info: {
    id: string;
    role: string;
    createdAt: string;
  };
  parts: Part[];
}

export interface HealthResponse {
  healthy: boolean;
  version: string;
}

// Host-related types
export interface HostInfo {
  hostId: string;
  status: 'online' | 'offline';
  activeDirectories: ActiveDirectory[];
  version: string;
  platform: string;
  lastSeen: number;
}

export interface ActiveDirectory {
  path: string;
  port: number;
  pid: number;
  startedAt: number;
  lastActivity: number;
}

export interface AppState {
  serverConfig: ServerConfig | null;
  connected: boolean;
  sessions: Session[];
  currentSession: Session | null;
  messages: MessageWithParts[];
  loading: boolean;
  error: string | null;
  // Host-related state
  hostId: string | null;
  jwt: string | null;
  hostStatus: 'disconnected' | 'connecting' | 'authenticated' | 'browsing' | 'chatting';
  currentDirectory: string | null;
  opencodePort: number | null;
  clientId: string;
}

export type AppAction =
  | { type: 'SET_SERVER_CONFIG'; payload: ServerConfig | null }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_SESSIONS'; payload: Session[] }
  | { type: 'SET_CURRENT_SESSION'; payload: Session | null }
  | { type: 'SET_MESSAGES'; payload: MessageWithParts[] }
  | { type: 'ADD_MESSAGE'; payload: MessageWithParts }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  // Host-related actions
  | { type: 'SET_HOST_ID'; payload: string | null }
  | { type: 'SET_JWT'; payload: string | null }
  | { type: 'SET_HOST_STATUS'; payload: AppState['hostStatus'] }
  | { type: 'SET_CURRENT_DIRECTORY'; payload: string | null }
  | { type: 'SET_OPENCODE_PORT'; payload: number | null };
