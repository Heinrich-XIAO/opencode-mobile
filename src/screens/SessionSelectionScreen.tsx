import React from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type SessionSummary = {
  id: string;
  title?: string;
  updatedAt?: string;
  status?: string;
};

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: SessionSummary[] };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'SessionSelection'>;
  route: { params: { hostId: string; jwt: string; directory: string; port: number; sessions: SessionSummary[] } };
};

function formatTimestamp(raw?: string): string {
  if (!raw) return '';
  const asNumber = Number(raw);
  const date = Number.isFinite(asNumber) ? new Date(asNumber) : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export function SessionSelectionScreen({ navigation, route }: Props) {
  const { hostId, jwt, directory, port, sessions } = route.params;

  const openChat = (sessionId?: string) => {
    navigation.navigate('HostChat', {
      hostId,
      jwt,
      directory,
      port,
      sessionId,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Select Session</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.subtitle}>Choose an existing OpenCode session or start a new one.</Text>

        <TouchableOpacity style={styles.newButton} onPress={() => openChat()}>
          <Text style={styles.newButtonText}>Start new session</Text>
        </TouchableOpacity>

        {sessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No existing sessions found in this directory.</Text>
          </View>
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            style={styles.list}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => openChat(item.id)}>
                <Text style={styles.itemTitle} numberOfLines={1}>{item.title?.trim() || item.id}</Text>
                <Text style={styles.itemMeta} numberOfLines={1}>{item.id}</Text>
                {!!item.status && <Text style={styles.itemMeta}>Status: {item.status}</Text>}
                {!!formatTimestamp(item.updatedAt) && (
                  <Text style={styles.itemMeta}>Updated: {formatTimestamp(item.updatedAt)}</Text>
                )}
              </TouchableOpacity>
            )}
          />
        )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backText: {
    color: '#007AFF',
    fontSize: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  body: {
    flex: 1,
    padding: 16,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
  },
  newButton: {
    backgroundColor: '#2ecc71',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  newButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyState: {
    marginTop: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  item: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  itemTitle: {
    fontSize: 15,
    color: '#333',
    fontWeight: '600',
  },
  itemMeta: {
    fontSize: 12,
    color: '#777',
    marginTop: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
});
