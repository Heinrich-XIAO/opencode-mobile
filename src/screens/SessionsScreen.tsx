import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { SessionList } from '../components/SessionList';
import { useApp } from '../context/AppContext';
import { OpencodeClient } from '../services/opencodeClient';
import { Session, ServerConfig } from '../types';

type RootStackParamList = {
  Connect: undefined;
  Sessions: undefined;
  Chat: undefined;
};

type SessionsScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Sessions'>;
};

export function SessionsScreen({ navigation }: SessionsScreenProps) {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    if (!state.serverConfig) return;
    
    setLoading(true);
    try {
      const client = new OpencodeClient(state.serverConfig);
      const sessions = await client.listSessions();
      dispatch({ type: 'SET_SESSIONS', payload: sessions });
    } catch (err) {
      Alert.alert('Error', 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [state.serverConfig, dispatch]);

  useFocusEffect(
    useCallback(() => {
      fetchSessions();
    }, [fetchSessions])
  );

  const handleSelectSession = (session: Session) => {
    dispatch({ type: 'SET_CURRENT_SESSION', payload: session });
    navigation.navigate('Chat');
  };

  const handleDeleteSession = async (session: Session) => {
    Alert.alert(
      'Delete Session',
      'Are you sure you want to delete this session?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!state.serverConfig) return;
            try {
              const client = new OpencodeClient(state.serverConfig);
              await client.deleteSession(session.id);
              fetchSessions();
            } catch (err) {
              Alert.alert('Error', 'Failed to delete session');
            }
          },
        },
      ]
    );
  };

  const handleCreateNew = async () => {
    if (!state.serverConfig) return;
    
    try {
      const client = new OpencodeClient(state.serverConfig);
      const newSession = await client.createSession('New Chat');
      dispatch({ type: 'SET_CURRENT_SESSION', payload: newSession });
      navigation.navigate('Chat');
    } catch (err) {
      Alert.alert('Error', 'Failed to create session');
    }
  };

  if (loading && state.sessions.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SessionList
        sessions={state.sessions}
        onSelect={handleSelectSession}
        onDelete={handleDeleteSession}
        onCreateNew={handleCreateNew}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
