import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, ArrowLeft } from 'lucide-react-native';
import { ChatBubble } from '../components/ChatBubble';
import { useApp } from '../context/AppContext';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../convexApi';
import { MessageWithParts } from '../types';

type RootStackParamList = {
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  HostChat: { hostId: string; jwt: string; directory: string; port: number };
  Connect: undefined;
  Sessions: undefined;
  Chat: undefined;
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'HostChat'>;
  route: { params: { hostId: string; jwt: string; directory: string; port: number } };
};

interface LocalMessage {
  id: string;
  role: string;
  text: string;
  createdAt: string;
  pending?: boolean;
}

/** Format a 10-digit host ID for display: "123 456 7890" */
function formatHostId(id: string): string {
  const digits = id.replace(/\D/g, '');
  if (digits.length !== 10) return id;
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

export function HostChatScreen({ navigation, route }: Props) {
  const { hostId, jwt, directory, port } = route.params;
  const { state, dispatch } = useApp();
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const createRequest = useMutation(api.requests.create);

  // Watch the active request for streaming updates
  const streamingData = useQuery(
    api.requests.getStreamingResponse,
    activeRequestId ? { requestId: activeRequestId as any } : 'skip'
  );

  // Handle streaming response updates
  useEffect(() => {
    if (!streamingData || !activeRequestId) return;

    if (streamingData.status === 'processing' && streamingData.partialResponse) {
      // Update or add the streaming assistant message
      setMessages(prev => {
        const streamId = `stream-${activeRequestId}`;
        const existing = prev.find(m => m.id === streamId);
        if (existing) {
          return prev.map(m =>
            m.id === streamId ? { ...m, text: streamingData.partialResponse! } : m
          );
        }
        return [
          ...prev,
          {
            id: streamId,
            role: 'OpenCode',
            text: streamingData.partialResponse!,
            createdAt: new Date().toISOString(),
            pending: true,
          },
        ];
      });
    } else if (streamingData.status === 'completed') {
      const finalText =
        (streamingData.response as any)?.aiResponse ||
        streamingData.partialResponse ||
        '(no response)';
      const streamId = `stream-${activeRequestId}`;
      setMessages(prev => {
        const existing = prev.find(m => m.id === streamId);
        if (existing) {
          return prev.map(m =>
            m.id === streamId ? { ...m, text: finalText, pending: false } : m
          );
        }
        return [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            role: 'OpenCode',
            text: finalText,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      setSending(false);
      setActiveRequestId(null);
    } else if (streamingData.status === 'failed') {
      const errorText =
        (streamingData.response as any)?.error || 'Request failed';
      const streamId = `stream-${activeRequestId}`;
      setMessages(prev => {
        // Remove any partial streaming message
        const filtered = prev.filter(m => m.id !== streamId);
        return [
          ...filtered,
          {
            id: `error-${Date.now()}`,
            role: 'System',
            text: `Error: ${errorText}`,
            createdAt: new Date().toISOString(),
          },
        ];
      });
      setSending(false);
      setActiveRequestId(null);
    }
  }, [streamingData, activeRequestId]);

  // Web enter key handler
  useEffect(() => {
    if (Platform.OS === 'web' && inputRef.current) {
      const node = inputRef.current;
      const inputDom = (node as any)._inputElement as HTMLTextAreaElement | undefined;
      if (!inputDom) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (inputText.trim() && !sending) {
            e.preventDefault();
            handleSend();
          }
        }
      };
      inputDom.addEventListener('keydown', handler);
      return () => inputDom.removeEventListener('keydown', handler);
    }
  }, [inputText, sending]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || sending) return;

    const text = inputText.trim();
    setInputText('');

    // Add user message optimistically
    const userMsg: LocalMessage = {
      id: `user-${Date.now()}`,
      role: 'You',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    // Generate unique client ID for this request
    const clientId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const requestId = await createRequest({
        hostId,
        type: 'relay_message',
        payload: {
          message: text,
          port,
        },
        jwt,
        clientId,
      });
      setActiveRequestId(requestId);
    } catch (err) {
      const errorMsg: LocalMessage = {
        id: `error-${Date.now()}`,
        role: 'System',
        text: `Failed to send: ${err instanceof Error ? err.message : 'Unknown error'}`,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
      setSending(false);
      setActiveRequestId(null);
    }
  }, [inputText, sending, hostId, jwt, port]);

  // Convert local messages to MessageWithParts for ChatBubble
  const messageItems: MessageWithParts[] = messages.map(m => ({
    info: {
      id: m.id,
      role: m.role,
      createdAt: m.createdAt,
    },
    parts: [{ type: 'text' as const, text: m.text }],
  }));

  const renderMessage = ({ item }: { item: MessageWithParts }) => (
    <ChatBubble message={item} />
  );

  // Extract directory name for display
  const dirParts = directory.split('/').filter(Boolean);
  const dirName = dirParts[dirParts.length - 1] || directory;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <ArrowLeft size={20} color="#007AFF" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{dirName}</Text>
          <Text style={styles.headerSubtitle}>
            Port {port} | {formatHostId(hostId)}
          </Text>
        </View>
        <View style={styles.statusDot} />
      </View>

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messageItems}
        renderItem={renderMessage}
        keyExtractor={(item) => item.info.id}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyTitle}>Ready to chat</Text>
            <Text style={styles.emptySubtitle}>
              OpenCode is running in {directory}
            </Text>
          </View>
        }
      />

      {/* Sending indicator - only show before streaming starts */}
      {sending && !streamingData?.partialResponse && (
        <View style={styles.sendingBar}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.sendingText}> Waiting for response...</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#999"
            multiline
            maxLength={10000}
            editable={!sending}
          />
          <View style={styles.buttonWrapper}>
            <TouchableOpacity
              onPress={handleSend}
              disabled={!inputText.trim() || sending}
              style={[
                styles.iconButton,
                styles.sendButton,
                (!inputText.trim() || sending) && styles.disabledButton,
              ]}
            >
              <Send size={20} color={inputText.trim() && !sending ? '#007AFF' : '#ccc'} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: '#fff',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2ecc71',
    marginLeft: 8,
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  sendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#f9f9f9',
  },
  sendingText: {
    color: '#666',
    fontSize: 14,
  },
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    padding: 8,
    backgroundColor: '#fff',
  },
  inputWrapper: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingRight: 50,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    backgroundColor: '#f9f9f9',
  },
  buttonWrapper: {
    position: 'absolute',
    right: 4,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButton: {
    backgroundColor: '#f0f0f0',
  },
  disabledButton: {
    opacity: 0.5,
  },
});
