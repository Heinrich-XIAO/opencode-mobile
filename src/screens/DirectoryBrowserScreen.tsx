import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convexApi';
import { useApp } from '../context/AppContext';
import { saveCurrentDirectory, saveJwt, addRecentDirectory } from '../services/storage';
import { isJwtExpiringSoon } from '../services/jwt';

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: SessionSummary[] };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type SessionSummary = {
  id: string;
  title?: string;
  updatedAt?: string;
  status?: string;
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'DirectoryBrowser'>;
  route: { params: { hostId: string; jwt: string } };
};

function getFriendlyDirectoryError(rawError?: string | null): string {
  if (!rawError) return 'Unable to list directories. Please try again.';
  const message = rawError.toLowerCase();

  if (message.includes('access denied')) {
    return 'Access denied. This path is outside the Host base directory.';
  }

  if (message.includes('directory not found')) {
    return 'Directory not found. It may have been moved or deleted.';
  }

  if (message.includes('cannot read directory')) {
    return 'Cannot read this directory. Check permissions and try again.';
  }

  if (message.includes('invalid or expired jwt')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  if (message.includes('jwt expired')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  return rawError;
}

function getFriendlyStartError(rawError?: string | null): string {
  if (!rawError) return 'Unable to start OpenCode. Please try again.';
  const message = rawError.toLowerCase();

  if (message.includes('no available ports in range')) {
    return 'No open ports available for OpenCode. Stop other sessions or widen the port range on the Host.';
  }

  if (message.includes('failed to start on port')) {
    return 'OpenCode failed to start on an available port. Try again or restart the Host companion.';
  }

  if (message.includes('access denied')) {
    return 'Access denied. This path is outside the Host base directory.';
  }

  if (message.includes('directory not found')) {
    return 'Directory not found. It may have been moved or deleted.';
  }

  if (message.includes('invalid or expired jwt')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  if (message.includes('jwt expired')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  return rawError;
}

function parseSessions(sessionsJson?: string): SessionSummary[] {
  if (!sessionsJson) return [];
  try {
    const parsed = JSON.parse(sessionsJson) as SessionSummary[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function DirectoryBrowserScreen({ navigation, route }: Props) {
  const { hostId, jwt } = route.params;
  const { state, dispatch } = useApp();
  const [currentPath, setCurrentPath] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJwt, setActiveJwt] = useState(jwt);
  const [refreshingJwt, setRefreshingJwt] = useState(false);

  // Unique client IDs for different request types
  const [listClientId] = useState(`list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [startClientId] = useState(`start-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [refreshClientId] = useState(`refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const createRequest = useMutation(api.requests.create);

  // Watch for list_dirs response
  const listResponse = useQuery(api.requests.getLatestByType, {
    clientId: listClientId,
    type: 'list_dirs',
  });

  // Watch for start_opencode response
  const startResponse = useQuery(api.requests.getLatestByType, {
    clientId: startClientId,
    type: 'start_opencode',
  });

  const refreshResponse = useQuery(api.requests.getLatestByType, {
    clientId: refreshClientId,
    type: 'refresh_jwt',
  });

  // Load initial directory listing
  useEffect(() => {
    browse('/');
  }, []);

  useEffect(() => {
    if (refreshingJwt || !isJwtExpiringSoon(activeJwt)) return;

    const refreshJwt = async () => {
      setRefreshingJwt(true);
      try {
        await createRequest({
          hostId,
          type: 'refresh_jwt',
          payload: {},
          jwt: activeJwt,
          clientId: refreshClientId,
        });
      } catch (err) {
        setError(getFriendlyStartError(err instanceof Error ? err.message : undefined));
        setRefreshingJwt(false);
      }
    };

    refreshJwt();
  }, [refreshingJwt, activeJwt, hostId, refreshClientId, createRequest]);

  useEffect(() => {
    if (!refreshResponse) return;

    if (refreshResponse.status === 'completed' && refreshResponse.response?.jwtToken) {
      const newJwt = refreshResponse.response.jwtToken;
      setActiveJwt(newJwt);
      saveJwt(newJwt);
      dispatch({ type: 'SET_JWT', payload: newJwt });
      setRefreshingJwt(false);
    } else if (refreshResponse.status === 'failed') {
      setError(getFriendlyStartError(refreshResponse.response?.error));
      dispatch({ type: 'SET_JWT', payload: null });
      setRefreshingJwt(false);
    }
  }, [refreshResponse, dispatch]);

  // Handle list_dirs response
  useEffect(() => {
    if (!listResponse) return;

    if (listResponse.status === 'completed' && listResponse.response?.directories) {
      setDirectories(listResponse.response.directories);
      setLoading(false);
      setError(null);
    } else if (listResponse.status === 'failed') {
      setError(getFriendlyDirectoryError(listResponse.response?.error));
      setLoading(false);
    }
  }, [listResponse]);

  // Handle start_opencode response
  useEffect(() => {
    if (!startResponse) return;

    if (startResponse.status === 'completed' && startResponse.response?.port) {
      const port = startResponse.response.port;
      const sessions = parseSessions(startResponse.response.sessionsJson);
      setStarting(false);

      // Save current directory
      saveCurrentDirectory(currentPath);
      dispatch({ type: 'SET_CURRENT_DIRECTORY', payload: currentPath });
      dispatch({ type: 'SET_OPENCODE_PORT', payload: port });
      dispatch({ type: 'SET_HOST_STATUS', payload: 'browsing' });

      // Save to recent directories
      addRecentDirectory({
        path: currentPath,
        hostId,
        port,
        lastAccessed: Date.now(),
      });

      navigation.navigate('SessionSelection', {
        hostId,
        jwt: activeJwt,
        directory: currentPath,
        port,
        sessions,
      });
    } else if (startResponse.status === 'failed') {
      setError(getFriendlyStartError(startResponse.response?.error));
      setStarting(false);
    }
  }, [startResponse, currentPath, dispatch, navigation, hostId, activeJwt]);

  const browse = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setCurrentPath(path);

    try {
      await createRequest({
        hostId,
        type: 'list_dirs',
        payload: { path },
        jwt: activeJwt,
        clientId: listClientId,
      });
    } catch (err) {
      setError(getFriendlyDirectoryError(err instanceof Error ? err.message : undefined));
      setLoading(false);
    }
  }, [hostId, activeJwt, listClientId]);

  const handleSelectDir = (dirName: string) => {
    const newPath = currentPath === '/' ? `/${dirName}` : `${currentPath}/${dirName}`;
    browse(newPath);
  };

  const handleGoUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    browse(parentPath);
  };

  const handleStartOpencode = async () => {
    setStarting(true);
    setError(null);

    try {
      await createRequest({
        hostId,
        type: 'start_opencode',
        payload: { directory: currentPath },
        jwt: activeJwt,
        clientId: startClientId,
      });
    } catch (err) {
      setError(getFriendlyStartError(err instanceof Error ? err.message : undefined));
      setStarting(false);
    }
  };

  const renderItem = ({ item }: { item: string }) => (
    <TouchableOpacity
      style={styles.dirItem}
      onPress={() => handleSelectDir(item)}
      disabled={loading}
    >
      <Text style={styles.dirIcon}>D</Text>
      <Text style={styles.dirName}>{item}</Text>
      <Text style={styles.dirArrow}>{'>'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Browse Files
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Current path */}
      <View style={styles.pathBar}>
        {currentPath !== '/' && (
          <TouchableOpacity style={styles.upButton} onPress={handleGoUp}>
            <Text style={styles.upText}>{'.. up'}</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.pathText} numberOfLines={1}>
          {currentPath}
        </Text>
      </View>

      {/* Error */}
      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Directory list */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading directories...</Text>
        </View>
      ) : (
        <FlatList
          data={directories}
          renderItem={renderItem}
          keyExtractor={(item) => item}
          style={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No subdirectories found</Text>
            </View>
          }
        />
      )}

      {/* Start OpenCode button */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.startButton, starting && styles.startButtonDisabled]}
          onPress={handleStartOpencode}
          disabled={starting || loading}
        >
          {starting ? (
            <View style={styles.startRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.startButtonText}> Starting OpenCode...</Text>
            </View>
          ) : (
            <Text style={styles.startButtonText}>
              Open in this directory
            </Text>
          )}
        </TouchableOpacity>
        <Text style={styles.footerHint}>
          Opens an OpenCode session in: {currentPath}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerBack: {
    color: '#007AFF',
    fontSize: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
  },
  pathBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e8e8e8',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  upButton: {
    backgroundColor: '#ddd',
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 10,
  },
  upText: {
    fontSize: 14,
    color: '#555',
    fontWeight: '500',
  },
  pathText: {
    fontSize: 14,
    color: '#333',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    flex: 1,
  },
  errorBar: {
    backgroundColor: '#fce4e4',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: '#c0392b',
    fontSize: 14,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 16,
  },
  list: {
    flex: 1,
  },
  dirItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  dirIcon: {
    fontSize: 18,
    marginRight: 12,
    width: 24,
    textAlign: 'center',
    color: '#f39c12',
    fontWeight: '700',
  },
  dirName: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  dirArrow: {
    fontSize: 18,
    color: '#ccc',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#999',
    fontSize: 16,
  },
  footer: {
    padding: 16,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  startButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  startButtonDisabled: {
    opacity: 0.6,
  },
  startRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  footerHint: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
});
