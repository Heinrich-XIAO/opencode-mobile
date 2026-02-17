import React, { useState, useRef, useEffect } from 'react';
import { View, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, TouchableOpacity, Text } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, Settings } from 'lucide-react-native';
import { ChatBubble } from '../components/ChatBubble';
import { useApp } from '../context/AppContext';
import { OpencodeClient } from '../services/opencodeClient';

import { MessageWithParts } from '../types';
import { useQuery, useMutation } from "convex/react";
import { api } from '../convexApi';

type RootStackParamList = {
  Connect: undefined;
  Sessions: undefined;
  Chat: undefined;
};

type ChatScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Chat'>;
};

export function ChatScreen({ navigation }: ChatScreenProps) {
  const { state, dispatch } = useApp();
  const validateRes = useQuery(api.sessions.validate, {
    code: state.currentSession?.code || '',
    password: state.currentSession?.password || ''
  });
  const sessionId = validateRes;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const messagesData = useQuery(api.messages.list, sessionId ? { sessionId } : "skip") || [];
  const messages = messagesData.map(msg => ({
    info: {
      id: msg._id,
      role: msg.sender,
      createdAt: new Date(msg.timestamp).toISOString(),
    },
    parts: [{ type: 'text' as const, text: msg.text }]
  }));
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [opencodeHost, setOpencodeHost] = useState('localhost');
  const [opencodePort, setOpencodePort] = useState('4096');
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  
  const sendMutation = useMutation(api.messages.send);

  useEffect(() => {
    if (Platform.OS === 'web' && inputRef.current) {
      const node = inputRef.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inputDom = (node as any)._inputElement as HTMLTextAreaElement | undefined;
      if (!inputDom) return;
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          if (inputText.trim()) {
            e.preventDefault();
            handleSend();
          }
        }
      };
      inputDom.addEventListener('keydown', handler);
      return () => inputDom.removeEventListener('keydown', handler);
    }
  }, [inputText, sending]);

  if (!sessionId) {
    return <ActivityIndicator style={styles.container} />;
  }

  const handleSend = async () => {
    if (!inputText.trim() || !sessionId) return;

    const text = inputText.trim();
    setInputText('');

    // Add user message optimistically
    const optimisticId = `local-${Date.now()}`;
    const optimisticMsg: MessageWithParts = {
      info: {
        id: optimisticId,
        role: 'You',
        createdAt: new Date().toISOString(),
      },
      parts: [{ type: 'text', text }],
    };
    dispatch({ type: 'ADD_MESSAGE', payload: optimisticMsg });

    try {
      setSending(true);
      // Store user message in Convex
      // @ts-ignore
      await sendMutation({ sessionId, sender: 'You', text });
      
      // If OpenCode is configured, send to it and get response
      if (opencodeHost && opencodePort) {
        try {
          const client = new OpencodeClient({ 
            hostname: opencodeHost, 
            port: parseInt(opencodePort, 10) 
          });
          
          // For now, we create a new session on OpenCode for each conversation
          // In a real implementation, you'd map Convex session to OpenCode session
          const ocSession = await client.createSession();
          const ocResponse = await client.sendMessage(ocSession.id, text);
          
          // Extract response text from OpenCode response
          const responseText = ocResponse.parts
            ?.filter((p: any) => p.type === 'text')
            ?.map((p: any) => p.text)
            ?.join(' ') || 'No response';
          
          // Store AI response in Convex
          // @ts-ignore
          await sendMutation({ 
            sessionId, 
            sender: 'OpenCode', 
            text: responseText 
          });
          
          // Add AI message optimistically
          const aiMsg: MessageWithParts = {
            info: {
              id: `ai-${Date.now()}`,
              role: 'OpenCode',
              createdAt: new Date().toISOString(),
            },
            parts: [{ type: 'text', text: responseText }],
          };
          dispatch({ type: 'ADD_MESSAGE', payload: aiMsg });
        } catch (ocError) {
          console.error('OpenCode error:', ocError);
          // Store error message
          const errorText = `OpenCode error: ${ocError instanceof Error ? ocError.message : 'Failed to connect'}`;
          // @ts-ignore
          await sendMutation({ sessionId, sender: 'System', text: errorText });
          const errorMsg: MessageWithParts = {
            info: {
              id: `error-${Date.now()}`,
              role: 'System',
              createdAt: new Date().toISOString(),
            },
            parts: [{ type: 'text', text: errorText }],
          };
          dispatch({ type: 'ADD_MESSAGE', payload: errorMsg });
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item }: { item: MessageWithParts }) => (
    <ChatBubble message={item} />
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {state.currentSession?.code || 'Chat'}
        </Text>
        <TouchableOpacity 
          onPress={() => setShowSettings(!showSettings)}
          style={styles.settingsButton}
        >
          <Settings size={24} color="#007AFF" />
        </TouchableOpacity>
      </View>

      {showSettings && (
        <View style={styles.settingsPanel}>
          <Text style={styles.settingsLabel}>OpenCode Server</Text>
          <View style={styles.settingsRow}>
            <TextInput
              style={[styles.settingsInput, { flex: 2 }]}
              value={opencodeHost}
              onChangeText={setOpencodeHost}
              placeholder="Host (e.g., localhost)"
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.settingsInput, { flex: 1, marginLeft: 8 }]}
              value={opencodePort}
              onChangeText={setOpencodePort}
              placeholder="Port"
              keyboardType="numeric"
            />
          </View>
          <Text style={styles.settingsHint}>
            Run: opencode serve --hostname 0.0.0.0 --port 4096 --cors
          </Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item, index) => item.info.id || `msg-${index}`}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

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
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <View style={styles.buttonWrapper}>
              <TouchableOpacity
                onPress={handleSend}
                disabled={!inputText.trim() || sending}
                style={[styles.iconButton, styles.sendButton, (!inputText.trim() || sending) && styles.disabledButton]}
              >
                <Send size={20} color={inputText.trim() ? '#007AFF' : '#ccc'} />
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  settingsButton: {
    padding: 8,
  },
  settingsPanel: {
    padding: 16,
    backgroundColor: '#f9f9f9',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  settingsLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  settingsRow: {
    flexDirection: 'row',
  },
  settingsInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  settingsHint: {
    fontSize: 12,
    color: '#666',
    marginTop: 8,
    fontStyle: 'italic',
  },
  messageList: {
    flex: 1,
  },
  messageContent: {
    paddingVertical: 8,
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
    paddingRight: 80,
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
