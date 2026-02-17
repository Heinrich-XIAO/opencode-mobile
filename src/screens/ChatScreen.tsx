import React, { useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, Square } from 'lucide-react-native';
import { ChatBubble } from '../components/ChatBubble';
import { useApp } from '../context/AppContext';

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
  // Convex useQuery expects either args or a "skip" token. Use a safe
  // fallback when sessionId is not available so hooks are stable.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const messagesData = useQuery(api.messages.list, sessionId ? { sessionId } : "skip") || [];
  const messages = messagesData.map(msg => ({
    info: {
      id: msg._id,
      role: msg.sender,
      createdAt: new Date(msg.timestamp).toISOString(),
    },
    parts: [{ type: 'text', text: msg.text }]
  }));
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Attach a real keydown handler on web to detect shift+enter
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

  const sendMutation = useMutation(api.messages.send);

  const handleSend = async () => {
    if (!inputText.trim() || !sessionId) return;

    const text = inputText.trim();
    setInputText('');

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
      // Convex mutation; pass sessionId (may be an Id type).
      // @ts-ignore
      await sendMutation({ sessionId, sender: 'You', text });
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
                disabled={!inputText.trim()}
                style={[styles.iconButton, styles.sendButton, !inputText.trim() && styles.disabledButton]}
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
  stopButton: {
    backgroundColor: '#dc3545',
  },
  disabledButton: {
    opacity: 0.5,
  },
  loadingIndicator: {
    marginTop: 8,
  },
});
