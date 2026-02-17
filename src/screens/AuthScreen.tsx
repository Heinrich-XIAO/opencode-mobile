import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convexApi';
import { useApp } from '../context/AppContext';
import { saveJwt, saveHostId } from '../services/storage';

/** Format a 10-digit host ID for display: "123 456 7890" */
function formatHostId(id: string): string {
  const digits = id.replace(/\D/g, '');
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

type RootStackParamList = {
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  HostChat: { hostId: string; jwt: string; directory: string; port: number };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Auth'>;
  route: { params: { hostId: string } };
};

export function AuthScreen({ navigation, route }: Props) {
  const { hostId } = route.params;
  const { state, dispatch } = useApp();
  const [step, setStep] = useState<'creating' | 'waiting' | 'error'>('creating');
  const [sessionCode, setSessionCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [requestClientId] = useState(`auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const createSession = useMutation(api.sessions.create);
  const createRequest = useMutation(api.requests.create);

  // Poll for the auth response
  const authResponse = useQuery(api.requests.getResponse, { clientId: requestClientId });

  // Step 1: Create a session and send auth request
  useEffect(() => {
    let cancelled = false;

    const startAuth = async () => {
      try {
        // Create a new Convex session to get code + OTP
        const session = await createSession({});
        if (cancelled) return;

        setSessionCode(session.code);
        setPassword(session.password);

        // Send authentication request to the Host
        await createRequest({
          hostId,
          type: 'authenticate',
          payload: {
            sessionCode: session.code,
            otpAttempt: session.password,
          },
          clientId: requestClientId,
        });

        setStep('waiting');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStep('error');
      }
    };

    startAuth();
    return () => { cancelled = true; };
  }, []);

  // Step 2: Watch for Host response
  useEffect(() => {
    if (!authResponse) return;

    if (authResponse.status === 'completed' && authResponse.response?.jwtToken) {
      const jwt = authResponse.response.jwtToken;

      // Store JWT and update state
      saveJwt(jwt);
      saveHostId(hostId);
      dispatch({ type: 'SET_JWT', payload: jwt });
      dispatch({ type: 'SET_HOST_ID', payload: hostId });
      dispatch({ type: 'SET_HOST_STATUS', payload: 'authenticated' });

      // Navigate to directory browser
      navigation.replace('DirectoryBrowser', { hostId, jwt });
    } else if (authResponse.status === 'failed') {
      setError(authResponse.response?.error || 'Authentication failed');
      setStep('error');
    }
  }, [authResponse]);

  const handleRetry = () => {
    setStep('creating');
    setError(null);
    // Re-mount will trigger useEffect again
    navigation.replace('Auth', { hostId });
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Authenticating</Text>
        <Text style={styles.subtitle}>Connecting to Host: {formatHostId(hostId)}</Text>

        {step === 'creating' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.status}>Creating session...</Text>
          </View>
        )}

        {step === 'waiting' && (
          <View style={styles.card}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.status}>Waiting for Host to validate...</Text>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Session Code</Text>
              <Text style={styles.codeValue}>{sessionCode}</Text>
            </View>
            <Text style={styles.hint}>
              The Host will automatically validate your session.
              Make sure 'bun run host' is running on the target machine.
            </Text>
          </View>
        )}

        {step === 'error' && (
          <View style={styles.card}>
            <Text style={styles.errorIcon}>!</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.button} onPress={handleRetry}>
              <Text style={styles.buttonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'ios' ? 60 : 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  status: {
    fontSize: 16,
    color: '#555',
    marginTop: 16,
  },
  codeBox: {
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 16,
    marginTop: 20,
    alignItems: 'center',
    width: '100%',
  },
  codeLabel: {
    fontSize: 12,
    color: '#888',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  codeValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    letterSpacing: 4,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  hint: {
    fontSize: 13,
    color: '#888',
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 18,
  },
  errorIcon: {
    fontSize: 48,
    color: '#e74c3c',
    fontWeight: '700',
    marginBottom: 12,
  },
  errorText: {
    fontSize: 16,
    color: '#e74c3c',
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  backButton: {
    alignItems: 'center',
    marginTop: 24,
    padding: 12,
  },
  backText: {
    color: '#007AFF',
    fontSize: 14,
  },
});
