import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, Linking, Image, ScrollView, TouchableOpacity } from 'react-native';
import { MessageWithParts } from '../types';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ChatBubbleProps {
  message: MessageWithParts;
}

export function ChatBubble({ message }: ChatBubbleProps) {
  const role = message.info.role;
  const isUser = role === 'You';
  const [toolExpanded, setToolExpanded] = useState<Record<number, boolean>>({});
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
           strong: ({ children }) => <Text style={styles.textStrong}>{children}</Text>,
           em: ({ children }) => <Text style={styles.textEm}>{children}</Text>,
           code: ({ className, children, ...props }: any) => {
             const inline = props.inline;
             const match = /language-(\w+)/.exec(className || '');
             const codeText = String(children).replace(/\n$/, '');
             if (!inline) {
               if (Platform.OS === 'web') {
                 return (
                  <SyntaxHighlighter
                    style={oneLight}
                    language={match?.[1] || 'text'}
                    PreTag="div"
                    customStyle={StyleSheet.flatten(styles.codeBlock) as any}
                  >
                     {codeText}
                   </SyntaxHighlighter>
                 );
               }
               return (
                 <Text style={styles.codeBlockText}>{codeText}</Text>
               );
             }
             return (
               <Text style={styles.inlineCode}>{children}</Text>
             );
           },
           a: ({ href, children }) => (
             <Text
               style={styles.linkText}
               onPress={() => {
                 if (href) {
                   Linking.openURL(href).catch(() => null);
                 }
               }}
             >
               {children}
             </Text>
           ),
           ul: ({ children }) => (
             <View style={styles.list}>{children}</View>
           ),
           ol: ({ children }) => (
             <View style={styles.list}>{children}</View>
           ),
           li: ({ children }) => (
             <Text style={[styles.text, styles.listItem]}>{children}</Text>
           ),
           table: ({ children }) => (
             <ScrollView horizontal style={styles.tableScroll}>
               <View style={styles.table}>{children}</View>
             </ScrollView>
           ),
           thead: ({ children }) => (
             <View style={styles.tableHeader}>{children}</View>
           ),
           tbody: ({ children }) => (
             <View style={styles.tableBody}>{children}</View>
           ),
           tr: ({ children }) => (
             <View style={styles.tableRow}>{children}</View>
           ),
           th: ({ children }) => (
             <Text style={[styles.tableCell, styles.tableHeaderCell]}>{children}</Text>
           ),
           td: ({ children }) => (
             <Text style={styles.tableCell}>{children}</Text>
           ),
           img: ({ src, alt }) => {
             if (!src) return null;
             return (
               <Image
                 source={{ uri: src }}
                 accessibilityLabel={alt}
                 style={styles.image}
               />
             );
           },
         }}
       >{part.text}</Markdown>
     );
   }
        if (part.type === 'tool') {
          // API returns 'tool' field for the name
          const toolName = (part as any).tool || part.toolName || 'Unknown Tool';
          const isExpanded = toolExpanded[index] ?? false;

          return (
            <View key={index} style={styles.toolContainer}>
              <TouchableOpacity
                onPress={() => setToolExpanded(prev => ({ ...prev, [index]: !prev[index] }))}
                style={styles.toolHeader}
              >
                <Text style={styles.toolName}>
                  {isExpanded ? '▼' : '▶'} 🔧 {toolName}
                </Text>
              </TouchableOpacity>

              {isExpanded && part.toolInput && (
                <View style={styles.toolDetails}>
                  <Text style={styles.toolLabel}>Input:</Text>
                  <Text style={styles.toolCode}>{part.toolInput}</Text>
                </View>
              )}

              {isExpanded && part.toolOutput && (
                <View style={styles.toolDetails}>
                  <Text style={styles.toolLabel}>Output:</Text>
                  <Text style={styles.toolCode}>{part.toolOutput}</Text>
                </View>
              )}
            </View>
          );
        }
       if (part.type === 'reasoning' && part.text) {
         return (
           <View key={index} style={styles.reasoningContainer}>
             <Text style={styles.reasoningLabel}>Thinking:</Text>
             <Text style={styles.reasoningText}>{part.text}</Text>
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
  textStrong: {
    fontWeight: '700',
  },
  textEm: {
    fontStyle: 'italic',
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
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
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
  reasoningContainer: {
    backgroundColor: '#fff3cd',
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ffe69c',
  },
  reasoningLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#856404',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  reasoningText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#856404',
  },
  inlineCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#f0f0f0',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  codeBlock: {
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#f6f8fa',
    fontSize: 13,
  },
  codeBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#f6f8fa',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    color: '#1f2328',
  },
  linkText: {
    color: '#007AFF',
    textDecorationLine: 'underline',
  },
  list: {
    paddingLeft: 16,
  },
  listItem: {
    marginBottom: 4,
  },
  tableScroll: {
    marginTop: 8,
    marginBottom: 8,
  },
  table: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    overflow: 'hidden',
  },
  tableHeader: {
    backgroundColor: '#f6f8fa',
  },
  tableBody: {
    backgroundColor: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
    fontSize: 12,
    color: '#333',
    minWidth: 80,
  },
  tableHeaderCell: {
    fontWeight: '700',
  },
  image: {
    width: 240,
    height: 160,
    resizeMode: 'contain',
    marginVertical: 8,
    borderRadius: 6,
  },
  errorText: {
    fontSize: 14,
    color: '#dc3545',
  },
});
