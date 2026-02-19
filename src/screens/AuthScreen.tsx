import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convexApi';
import { useApp } from '../context/AppContext';
import { saveJwt, saveHostId } from '../services/storage';

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: Array<{ id: string; title?: string; updatedAt?: string; status?: string }> };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Auth'>;
  route: { params: { hostId: string } };
};

export function AuthScreen({ navigation, route }: Props) {
  const { hostId } = route.params;
  const { dispatch } = useApp();
  const [otpInput, setOtpInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestClientId] = useState(`auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const createRequest = useMutation(api.requests.create);

  // Poll for the auth response
  const authResponse = useQuery(api.requests.getResponse, { clientId: requestClientId });

  // User clicks Connect - send the OTP to host
  const handleConnect = async () => {
    if (!otpInput.trim()) {
      setError('Please enter the startup OTP from the terminal');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Send authentication request to the Host with user-provided OTP
      await createRequest({
        hostId,
        type: 'authenticate',
        payload: {
          otp: otpInput.trim(),
        },
        clientId: requestClientId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
      setLoading(false);
    }
  };

  // Watch for Host response with JWT
  useEffect(() => {
    if (!authResponse) return;

    if (authResponse.status === 'completed' && authResponse.response?.jwtToken) {
      // Success! Save JWT and go to home screen
      const jwt = authResponse.response.jwtToken;
      saveJwt(jwt);
      saveHostId(hostId);
      dispatch({ type: 'SET_JWT', payload: jwt });
      dispatch({ type: 'SET_HOST_ID', payload: hostId });
      dispatch({ type: 'SET_HOST_STATUS', payload: 'authenticated' });

      navigation.replace('Home');
    } else if (authResponse.status === 'failed') {
      setError(authResponse.response?.error || 'Authentication failed');
      setLoading(false);
    }
  }, [authResponse, hostId, navigation, dispatch]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter OTP</Text>
      <Text style={styles.subtitle}>
        Enter the OTP shown when bun run host starts
      </Text>

      <TextInput
        style={styles.input}
        value={otpInput}
        onChangeText={setOtpInput}
        placeholder="Enter OTP from terminal"
        placeholderTextColor="#999"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleConnect}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Connect</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  error: {
    color: '#d00',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
