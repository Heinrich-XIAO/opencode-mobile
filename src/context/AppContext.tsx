import React, { createContext, useContext, useReducer, ReactNode, useEffect, useState } from 'react';
import { AppState, AppAction, ServerConfig, Session, MessageWithParts } from '../types';
import { loadServerConfig, loadSessions, loadCurrentSession, loadMessages, saveSessions, saveCurrentSession, saveMessages } from '../services/storage';

const initialState: AppState = {
  // Provide a default serverConfig so web builds auto-connect and use Convex
  serverConfig: { hostname: 'convex', port: 0 },
  connected: false,
  sessions: [],
  currentSession: null,
  messages: [],
  loading: false,
  error: null,
};

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_SERVER_CONFIG':
      return { ...state, serverConfig: action.payload };
    case 'SET_CONNECTED':
      return { ...state, connected: action.payload };
    case 'SET_SESSIONS':
      return { ...state, sessions: action.payload };
    case 'SET_CURRENT_SESSION':
      return { ...state, currentSession: action.payload };
    case 'SET_MESSAGES':
      return { ...state, messages: action.payload };
    case 'ADD_MESSAGE':
      return { ...state, messages: [...state.messages, action.payload] };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    default:
      return state;
  }
}

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const [config, sessions, currentSession, messages] = await Promise.all([
          loadServerConfig(),
          loadSessions(),
          loadCurrentSession(),
          loadMessages()
        ]);

        if (config) {
          dispatch({ type: 'SET_SERVER_CONFIG', payload: config });
        }
        if (sessions.length > 0) {
          dispatch({ type: 'SET_SESSIONS', payload: sessions });
        }
        if (currentSession) {
          dispatch({ type: 'SET_CURRENT_SESSION', payload: currentSession });
        }
        if (messages.length > 0) {
          dispatch({ type: 'SET_MESSAGES', payload: messages });
        }

        // E2E seeding removed: sessions are no longer auto-created here.
      } catch (error) {
        console.error('Failed to load stored data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStoredData();
  }, []);

  if (isLoading) {
    return null;
  }

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
