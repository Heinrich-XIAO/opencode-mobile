import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { MessageWithParts } from '../types';

interface ChatBubbleProps {
  message: MessageWithParts;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.info.role === 'user';

  const renderContent = () => {
    return message.parts.map((part, index) => {
      if (part.type === 'text' && part.text) {
        return (
          <Text key={index} style={[styles.text, isUser && styles.userText]}>
            {part.text}
          </Text>
        );
      }
      if (part.type === 'tool') {
        // API returns 'tool' field for the name
        const toolName = (part as any).tool || part.toolName || 'Unknown Tool';
        return (
          <View key={index} style={styles.toolContainer}>
            <Text style={styles.toolName}>
              🔧 {toolName}
            </Text>

          </View>
        );
      }
      if (part.type === 'error') {
        return (
          <Text key={index} style={styles.errorText}>
            ❌ {part.text}
          </Text>
        );
      }
      return null;
    });
  };

  return (
    <View style={[styles.container, isUser ? styles.userContainer : styles.assistantContainer]}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        {renderContent()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
  },
  userBubble: {
    backgroundColor: '#007AFF',
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: '#e9ecef',
    borderBottomLeftRadius: 4,
  },
  text: {
    fontSize: 15,
    lineHeight: 20,
    color: '#333',
  },
  userText: {
    color: '#fff',
  },
  toolContainer: {
    backgroundColor: '#fff3cd',
    padding: 8,
    borderRadius: 6,
    marginTop: 4,
  },
  toolName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#856404',
  },
  toolDetails: {
    marginTop: 4,
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#856404',
    textTransform: 'uppercase',
  },
  toolCode: {
    fontSize: 11,
    color: '#856404',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: 'rgba(133, 100, 4, 0.1)',
    padding: 4,
    borderRadius: 3,
    marginTop: 2,
  },
  errorText: {
    fontSize: 14,
    color: '#dc3545',
  },
});
