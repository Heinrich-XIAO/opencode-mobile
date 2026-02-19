import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from 'convex/react';
import { api } from '../convexApi';
import { useApp } from '../context/AppContext';
import { saveHostId } from '../services/storage';
import { isJwtExpired } from '../services/jwt';

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: Array<{ id: string; title?: string; updatedAt?: string; status?: string }> };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'HostSelection'>;
};

export function HostSelectionScreen({ navigation }: Props) {
  const { state, dispatch } = useApp();
  const [hostIdInput, setHostIdInput] = useState(
    state.hostId ? formatHostIdDisplay(state.hostId) : ''
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we already have a JWT - if so, skip to directory browser
  const hasJwt = !!state.jwt && !!state.hostId && !isJwtExpired(state.jwt);

  /** Strip non-digits and normalize to raw 10-digit ID */
  function normalizeHostId(input: string): string {
    return input.replace(/\D/g, '').slice(0, 10);
  }

  /** Format as "123 456 7890" for display */
  function formatHostIdDisplay(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`;
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 10)}`;
  }

  const handleInputChange = (text: string) => {
    setError(null);
    // Allow digits and spaces only
    const digitsOnly = text.replace(/\D/g, '').slice(0, 10);
    setHostIdInput(formatHostIdDisplay(digitsOnly));
  };

  const handleConnect = async () => {
    const normalized = normalizeHostId(hostIdInput);
    if (normalized.length !== 10) {
      setError('Host ID must be 10 digits');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Save host ID (stored as raw digits)
      await saveHostId(normalized);
      dispatch({ type: 'SET_HOST_ID', payload: normalized });

      if (hasJwt && normalized === state.hostId) {
        // Already authenticated, go to home
        navigation.navigate('Home');
      } else {
        // Need to authenticate
        navigation.navigate('Auth', { hostId: normalized });
      }
    } catch (err) {
      setError('Failed to connect');
    } finally {
      setLoading(false);
    }
  };


  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>OpenCode Remote</Text>
        <Text style={styles.subtitle}>
          Connect to a Host running the OpenCode companion
        </Text>

        <View style={styles.card}>
          <Text style={styles.label}>Host ID</Text>
          <TextInput
            style={styles.input}
            value={hostIdInput}
            onChangeText={handleInputChange}
            placeholder="e.g., 123 456 7890"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            maxLength={12}
            editable={!loading}
          />
          <Text style={styles.hint}>
            Copy the Host ID from the terminal running 'bun run host'
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleConnect}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {hasJwt && normalizeHostId(hostIdInput) === state.hostId
                  ? 'Resume Session'
                  : 'Connect'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

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
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#fafafa',
    color: '#333',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  hint: {
    fontSize: 12,
    color: '#888',
    marginTop: 8,
    fontStyle: 'italic',
  },
  error: {
    fontSize: 14,
    color: '#e74c3c',
    marginTop: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
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
