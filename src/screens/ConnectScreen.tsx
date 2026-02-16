import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ServerConnection } from '../components/ServerConnection';
import { useApp } from '../context/AppContext';
import { OpencodeClient } from '../services/opencodeClient';
import { ServerConfig } from '../types';
import { saveServerConfig } from '../services/storage';

type RootStackParamList = {
  Connect: undefined;
  Sessions: undefined;
  Chat: undefined;
};

type ConnectScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Connect'>;
};

export function ConnectScreen({ navigation }: ConnectScreenProps) {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async (config: ServerConfig) => {
    setLoading(true);
    setError(null);

    try {
      const client = new OpencodeClient(config);
      const health = await client.checkHealth();
      
      if (health.healthy) {
        await saveServerConfig(config);
        dispatch({ type: 'SET_SERVER_CONFIG', payload: config });
        dispatch({ type: 'SET_CONNECTED', payload: true });
        navigation.replace('Sessions');
      } else {
        setError('Server is not healthy');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ServerConnection
        onConnect={handleConnect}
        loading={loading}
        error={error}
        initialConfig={state.serverConfig}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
});
