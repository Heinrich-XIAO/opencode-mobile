export interface ServerConfig {
  hostname: string;
  port: number;
  username?: string;
  password?: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface Part {
  type: 'text' | 'tool' | 'image' | 'error';
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

export interface AppState {
  serverConfig: ServerConfig | null;
  connected: boolean;
  sessions: Session[];
  currentSession: Session | null;
  messages: MessageWithParts[];
  loading: boolean;
  error: string | null;
}

export type AppAction =
  | { type: 'SET_SERVER_CONFIG'; payload: ServerConfig | null }
  | { type: 'SET_CONNECTED'; payload: boolean }
  | { type: 'SET_SESSIONS'; payload: Session[] }
  | { type: 'SET_CURRENT_SESSION'; payload: Session | null }
  | { type: 'SET_MESSAGES'; payload: MessageWithParts[] }
  | { type: 'ADD_MESSAGE'; payload: MessageWithParts }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };
