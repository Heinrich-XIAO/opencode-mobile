import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../convexApi';
import { SessionList } from '../components/SessionList';
import { useApp } from '../context/AppContext';
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

  // Use reactive Convex query to list sessions
  const sessionsQuery = useQuery(api.sessions.list) || [];

  useEffect(() => {
    try {
      if (sessionsQuery && sessionsQuery.length >= 0) {
        const mapped = sessionsQuery.map((s: any) => ({ id: String(s._id || s.sessionId || ''), code: s.code, password: s.password, title: s.title || '' }));
        // only update global state when the session list actually changes to avoid render loops
        const prev = state.sessions || [];
        const prevIds = prev.map(p => String(p.id)).join(',');
        const newIds = mapped.map(m => String(m.id)).join(',');
        if (prevIds !== newIds) {
          dispatch({ type: 'SET_SESSIONS', payload: mapped });
        }
      }
    } catch (err) {
      // if something goes wrong, notify user
      Alert.alert('Error', 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [sessionsQuery, dispatch]);

  const handleSelectSession = (session: Session) => {
    dispatch({ type: 'SET_CURRENT_SESSION', payload: session });
    navigation.navigate('Chat');
  };

  const removeMutation = useMutation(api.sessions.remove);
  const createMutation = useMutation(api.sessions.create);

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
                try {
                  // Convex expects an Id type; our app stores session.id as string
                  await removeMutation({ sessionId: session.id as any });
                } catch (err) {
                  Alert.alert('Error', 'Failed to delete session');
                }
              },
        },
      ]
    );
  };

  const createdRef = React.useRef(false);

  const handleCreateNew = async () => {
    try {
      const s: any = await createMutation({});
      const id = s.sessionId || s._id || String(s);
      const sessionObj = { id: String(id), code: s.code, password: s.password, title: '' };
      dispatch({ type: 'SET_CURRENT_SESSION', payload: sessionObj });
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
