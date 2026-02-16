import React, { useState, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, Square } from 'lucide-react-native';
import { ChatBubble } from '../components/ChatBubble';
import { useApp } from '../context/AppContext';
import { OpencodeClient } from '../services/opencodeClient';
import { MessageWithParts } from '../types';

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
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  const fetchMessages = useCallback(async () => {
    if (!state.serverConfig || !state.currentSession) return;

    try {
      const client = new OpencodeClient(state.serverConfig);
      const messages = await client.getMessages(state.currentSession.id);
      dispatch({ type: 'SET_MESSAGES', payload: messages });
    } catch (err) {
      console.error('Failed to fetch messages:', err);
    }
  }, [state.serverConfig, state.currentSession, dispatch]);

  const handleSend = async () => {
    if (!inputText.trim() || !state.serverConfig || !state.currentSession) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);

    try {
      const client = new OpencodeClient(state.serverConfig);
      const response = await client.sendMessage(state.currentSession.id, text);
      
      // Add user message first (we need to construct it)
      const userMessage: MessageWithParts = {
        info: {
          id: `user-${Date.now()}`,
          role: 'user',
          createdAt: new Date().toISOString(),
        },
        parts: [{ type: 'text', text }],
      };
      
      dispatch({ type: 'ADD_MESSAGE', payload: userMessage });
      dispatch({ type: 'ADD_MESSAGE', payload: response });
      
      // Refresh messages to get full history
      await fetchMessages();
    } catch (err) {
      Alert.alert('Error', 'Failed to send message');
      setInputText(text); // Restore input on error
    } finally {
      setSending(false);
    }
  };

  const handleAbort = async () => {
    if (!state.serverConfig || !state.currentSession) return;
    
    try {
      const client = new OpencodeClient(state.serverConfig);
      await client.abortSession(state.currentSession.id);
    } catch (err) {
      console.error('Failed to abort:', err);
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
        data={state.messages}
        renderItem={renderMessage}
        keyExtractor={(item, index) => item.info.id || `msg-${index}`}
        style={styles.messageList}
        contentContainerStyle={styles.messageContent}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />

      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            value={inputText}
            onChangeText={setInputText}
            placeholder="Type a message..."
            placeholderTextColor="#999"
            multiline
            maxLength={10000}
            editable={!sending}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <View style={styles.buttonWrapper}>
            {sending ? (
              <TouchableOpacity
                onPress={handleAbort}
                style={[styles.iconButton, styles.stopButton]}
              >
                <Square size={20} color="#fff" fill="#dc3545" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleSend}
                disabled={!inputText.trim()}
                style={[styles.iconButton, styles.sendButton, !inputText.trim() && styles.disabledButton]}
              >
                <Send size={20} color={inputText.trim() ? '#007AFF' : '#ccc'} />
              </TouchableOpacity>
            )}
          </View>
        </View>
        {sending && (
          <ActivityIndicator style={styles.loadingIndicator} size="small" color="#007AFF" />
        )}
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
