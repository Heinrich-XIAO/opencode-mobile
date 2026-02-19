import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useApp } from '../context/AppContext';
import { loadRecentDirectories, RecentDirectory } from '../services/storage';
import { isJwtExpired } from '../services/jwt';
import { FolderOpen, MessageSquare, Clock, ChevronRight } from 'lucide-react-native';

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: Array<{ id: string; title?: string; updatedAt?: string; status?: string }> };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Home'>;
};

export function HomeScreen({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const [recentDirectories, setRecentDirectories] = useState<RecentDirectory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      const dirs = await loadRecentDirectories();
      setRecentDirectories(dirs);
      setLoading(false);
    };
    loadData();
  }, []);

  const handleBrowseFolders = () => {
    navigation.navigate('HostSelection');
  };

  const handleRecentDirectory = async (dir: RecentDirectory) => {
    // Need to authenticate first
    if (!state.jwt || state.hostId !== dir.hostId || isJwtExpired(state.jwt)) {
      navigation.navigate('Auth', { hostId: dir.hostId });
      return;
    }

    // Navigate to directory browser with existing directory
    navigation.navigate('DirectoryBrowser', {
      hostId: dir.hostId,
      jwt: state.jwt!,
    });
  };

  const renderRecentDirectory = ({ item }: { item: RecentDirectory }) => (
    <TouchableOpacity style={styles.directoryCard} onPress={() => handleRecentDirectory(item)}>
      <FolderOpen size={20} color="#007AFF" />
      <View style={styles.directoryInfo}>
        <Text style={styles.directoryPath} numberOfLines={1}>{item.path}</Text>
        <Text style={styles.directoryMeta}>
          <Clock size={10} color="#888" /> {new Date(item.lastAccessed).toLocaleDateString()}
        </Text>
      </View>
      <ChevronRight size={16} color="#ccc" />
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>OpenCode Remote</Text>
      </View>

      <TouchableOpacity style={styles.browseButton} onPress={handleBrowseFolders}>
        <View style={styles.browseButtonContent}>
          <FolderOpen size={24} color="#fff" />
          <Text style={styles.browseButtonText}>Browse Folders</Text>
        </View>
        <ChevronRight size={20} color="#fff" />
      </TouchableOpacity>

      {recentDirectories.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Folders</Text>
          <FlatList
            data={recentDirectories.slice(0, 5)}
            renderItem={renderRecentDirectory}
            keyExtractor={(item, idx) => `${item.hostId}-${item.path}-${idx}`}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalList}
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Sessions</Text>
        <Text style={styles.emptyText}>Go to a folder to see sessions</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: Platform.OS === 'ios' ? 50 : 24,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
  },
  browseButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  browseButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  browseButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  horizontalList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  directoryCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    width: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  directoryInfo: {
    flex: 1,
  },
  directoryPath: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  directoryMeta: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
  },
  loader: {
    marginTop: 20,
  },
  emptyText: {
    paddingHorizontal: 20,
    color: '#888',
    fontSize: 14,
  },
});
