import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Clipboard, StyleSheet } from 'react-native';
import { Button } from './Button';
import { Input } from './Input';
import { ServerConfig } from '../types';

interface ServerConnectionProps {
  onConnect: (config: ServerConfig) => void;
  loading?: boolean;
  error?: string | null;
  initialConfig?: ServerConfig | null;
}

const SERVER_COMMAND = 'opencode serve --hostname 0.0.0.0 --port 4096';

export function ServerConnection({ onConnect, loading, error, initialConfig }: ServerConnectionProps) {
  const [hostname, setHostname] = useState(initialConfig?.hostname ?? '');
  const [port, setPort] = useState(initialConfig?.port?.toString() ?? '4096');
  const [username, setUsername] = useState(initialConfig?.username ?? '');
  const [password, setPassword] = useState(initialConfig?.password ?? '');
  const [copied, setCopied] = useState(false);

  const handleCopyCommand = () => {
    Clipboard.setString(SERVER_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConnect = () => {
    if (!hostname.trim()) return;
    onConnect({
      hostname: hostname.trim(),
      port: parseInt(port, 10) || 4096,
      username: username.trim() || undefined,
      password: password || undefined,
    });
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Connect to OpenCode</Text>
        <Text style={styles.subtitle}>
          Enter your server details to connect
        </Text>

        <Input
          label="Server Address"
          placeholder="192.168.1.100 or hostname"
          value={hostname}
          onChangeText={setHostname}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Input
          label="Port"
          placeholder="4096"
          value={port}
          onChangeText={setPort}
          keyboardType="numeric"
        />

        <Input
          label="Username (optional)"
          placeholder="opencode"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />

        <Input
          label="Password (optional)"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <Button
          title={loading ? 'Connecting...' : 'Connect'}
          onPress={handleConnect}
          loading={loading}
          disabled={!hostname.trim()}
        />

        <View style={styles.hintContainer}>
          <Text style={styles.hintLabel}>Run this on your computer:</Text>
          <TouchableOpacity onPress={handleCopyCommand} style={styles.codeBlock}>
            <Text style={styles.codeText}>{SERVER_COMMAND}</Text>
          </TouchableOpacity>
          {copied && <Text style={styles.copiedText}>Copied to clipboard!</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
  },
  error: {
    color: '#dc3545',
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  hintContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  hintLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    fontStyle: 'italic',
  },
  codeBlock: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  codeText: {
    fontSize: 13,
    color: '#333',
    fontFamily: 'monospace',
  },
  copiedText: {
    fontSize: 11,
    color: '#007AFF',
    marginTop: 6,
  },
});
