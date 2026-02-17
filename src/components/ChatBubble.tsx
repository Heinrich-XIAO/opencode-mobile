import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { MessageWithParts } from '../types';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatBubbleProps {
  message: MessageWithParts;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const role = message.info.role;
  const isUser = role === 'You';
  const isSystem = role === 'System';
  const isOpenCode = role === 'OpenCode';
  const isAssistant = !isUser && !isSystem;

  const renderContent = () => {
    return message.parts.map((part, index) => {
if (part.type === 'text' && part.text) {
    return (
      <Markdown
        key={index}
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <Text style={[styles.text, isUser && styles.userText, isSystem && styles.systemText]}>{children}</Text>
          ),
          strong: ({ children }) => <Text style={{ fontWeight: 'bold' }}>{children}</Text>,
          em: ({ children }) => <Text style={{ fontStyle: 'italic' }}>{children}</Text>,
          code: ({ children }) => (
            <Text style={{ fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: '#f0f0f0', borderRadius: 3, padding: 2 }}>{children}</Text>
          ),
          a: ({ href, children }) => (
            <Text style={{ color: '#007AFF', textDecorationLine: 'underline' }}>{children}</Text>
          ),
          ul: ({ children }) => (
            <View style={{ paddingLeft: 16 }}>{children}</View>
          ),
          ol: ({ children }) => (
            <View style={{ paddingLeft: 16 }}>{children}</View>
          ),
          li: ({ children }) => (
            <Text style={styles.text}>{children}</Text>
          ),
        }}
      >{part.text}</Markdown>
    );
  }
       if (part.type === 'tool') {
         // API returns 'tool' field for the name
         const toolName = (part as any).tool || part.toolName || 'Unknown Tool';
         return (
           <View key={index} style={styles.toolContainer}>
             <Text style={styles.toolName}>🔧 {toolName}</Text>
             {part.toolInput ? (
               <View style={styles.toolDetails}>
                 <Text style={styles.toolLabel}>Input:</Text>
                 <Text style={styles.toolCode}>{part.toolInput}</Text>
               </View>
             ) : null}
             {part.toolOutput ? (
               <View style={styles.toolDetails}>
                 <Text style={styles.toolLabel}>Output:</Text>
                 <Text style={styles.toolCode}>{part.toolOutput}</Text>
               </View>
             ) : null}
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
      <View style={[
        styles.bubble, 
        isUser ? styles.userBubble : 
        isSystem ? styles.systemBubble : 
        styles.assistantBubble
      ]}>
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
  systemBubble: {
    backgroundColor: '#ffebee',
    borderBottomLeftRadius: 4,
  },
  systemText: {
    color: '#c62828',
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
