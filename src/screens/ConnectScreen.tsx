import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ServerConnection } from '../components/ServerConnection';
import { useApp } from '../context/AppContext';
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
  const [autoConnectAttempted, setAutoConnectAttempted] = useState(false);

  useEffect(() => {
    if (state.serverConfig && !autoConnectAttempted && !state.connected) {
      setAutoConnectAttempted(true);
      handleConnect(state.serverConfig);
    }
  }, [state.serverConfig]);

  const handleConnect = async (config: ServerConfig) => {
  // For Convex-backed flow we simply save the config locally so UI works
    setLoading(true);
    try {
      await saveServerConfig(config);
      dispatch({ type: 'SET_SERVER_CONFIG', payload: config });
      dispatch({ type: 'SET_CONNECTED', payload: true });
      navigation.replace('Sessions');
    } catch (err) {
      setError('Failed to connect');
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
