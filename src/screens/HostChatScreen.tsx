import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Text,
  Modal,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Send, ArrowLeft, ChevronDown, X } from 'lucide-react-native';
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

interface ProviderModel {
  id: string;
  name: string;
  providerID: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  models: ProviderModel[];
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

  // Model selection state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<{ providerID: string; modelID: string; displayName: string } | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providerRequestId, setProviderRequestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const createRequest = useMutation(api.requests.create);

  // Watch the active request for streaming updates
  const streamingData = useQuery(
    api.requests.getStreamingResponse,
    activeRequestId ? { requestId: activeRequestId as any } : 'skip'
  );

  // Watch the provider request
  const providerResponse = useQuery(
    api.requests.getStreamingResponse,
    providerRequestId ? { requestId: providerRequestId as any } : 'skip'
  );

  // Fetch providers on mount
  useEffect(() => {
    async function fetchProviders() {
      setLoadingProviders(true);
      const clientId = `providers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const reqId = await createRequest({
          hostId,
          type: 'get_providers',
          payload: { port },
          jwt,
          clientId,
        });
        setProviderRequestId(reqId);
      } catch (err) {
        console.error('Failed to fetch providers:', err);
        setLoadingProviders(false);
      }
    }
    fetchProviders();
  }, []);

  // Handle provider response
  useEffect(() => {
    if (!providerResponse || !providerRequestId) return;

    if (providerResponse.status === 'completed') {
      try {
        const json = (providerResponse.response as any)?.providersJson;
        if (json) {
          const data = JSON.parse(json);
          setProviders(data.providers || []);
        }
      } catch (err) {
        console.error('Failed to parse providers:', err);
      }
      setLoadingProviders(false);
      setProviderRequestId(null);
    } else if (providerResponse.status === 'failed') {
      console.error('Provider fetch failed');
      setLoadingProviders(false);
      setProviderRequestId(null);
    }
  }, [providerResponse, providerRequestId]);

  // Handle streaming response updates
  useEffect(() => {
    if (!streamingData || !activeRequestId) return;

    if (streamingData.status === 'processing' && streamingData.partialResponse) {
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

    const userMsg: LocalMessage = {
      id: `user-${Date.now()}`,
      role: 'You',
      text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    const clientId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const payload: any = {
        message: text,
        port,
        directory,
      };
      if (selectedModel) {
        payload.providerID = selectedModel.providerID;
        payload.modelID = selectedModel.modelID;
      }

      const requestId = await createRequest({
        hostId,
        type: 'relay_message',
        payload,
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
  }, [inputText, sending, hostId, jwt, port, selectedModel]);

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

  const dirParts = directory.split('/').filter(Boolean);
  const dirName = dirParts[dirParts.length - 1] || directory;

  // Filter providers/models by search query
  const filteredProviders = providers
    .map(p => ({
      ...p,
      models: p.models.filter(m => {
        const q = searchQuery.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q)
        );
      }),
    }))
    .filter(p => p.models.length > 0);

  const modelDisplayName = selectedModel?.displayName || 'Default model';

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
          <TouchableOpacity
            onPress={() => setShowModelPicker(true)}
            style={styles.modelButton}
          >
            <Text style={styles.modelButtonText} numberOfLines={1}>
              {loadingProviders ? 'Loading models...' : modelDisplayName}
            </Text>
            <ChevronDown size={14} color="#007AFF" />
          </TouchableOpacity>
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

      {/* Model Picker Modal */}
      <Modal
        visible={showModelPicker}
        animationType="slide"
        transparent
        onRequestClose={() => setShowModelPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Model</Text>
              <TouchableOpacity onPress={() => setShowModelPicker(false)}>
                <X size={24} color="#333" />
              </TouchableOpacity>
            </View>

            {/* Search */}
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search models..."
              placeholderTextColor="#999"
              autoFocus
            />

            {/* Default option */}
            <TouchableOpacity
              style={[
                styles.modelOption,
                !selectedModel && styles.modelOptionSelected,
              ]}
              onPress={() => {
                setSelectedModel(null);
                setShowModelPicker(false);
                setSearchQuery('');
              }}
            >
              <Text style={[styles.modelOptionText, !selectedModel && styles.modelOptionTextSelected]}>
                Default model
              </Text>
              <Text style={styles.modelOptionProvider}>Use server default</Text>
            </TouchableOpacity>

            {/* Provider/Model list */}
            <ScrollView style={styles.modelList}>
              {loadingProviders ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color="#007AFF" />
                  <Text style={styles.loadingText}>Loading providers...</Text>
                </View>
              ) : filteredProviders.length === 0 ? (
                <Text style={styles.noResults}>No models found</Text>
              ) : (
                filteredProviders.map(provider => (
                  <View key={provider.id}>
                    <Text style={styles.providerHeader}>{provider.name}</Text>
                    {provider.models.map(model => {
                      const isSelected =
                        selectedModel?.providerID === provider.id &&
                        selectedModel?.modelID === model.id;
                      return (
                        <TouchableOpacity
                          key={`${provider.id}/${model.id}`}
                          style={[
                            styles.modelOption,
                            isSelected && styles.modelOptionSelected,
                          ]}
                          onPress={() => {
                            setSelectedModel({
                              providerID: provider.id,
                              modelID: model.id,
                              displayName: `${model.name} (${provider.name})`,
                            });
                            setShowModelPicker(false);
                            setSearchQuery('');
                          }}
                        >
                          <Text
                            style={[
                              styles.modelOptionText,
                              isSelected && styles.modelOptionTextSelected,
                            ]}
                            numberOfLines={1}
                          >
                            {model.name}
                          </Text>
                          <Text style={styles.modelOptionId} numberOfLines={1}>
                            {model.id}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
  modelButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  modelButtonText: {
    fontSize: 12,
    color: '#007AFF',
    marginRight: 4,
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
  // Model picker modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  searchInput: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    fontSize: 15,
    backgroundColor: '#f9f9f9',
  },
  modelList: {
    paddingHorizontal: 16,
  },
  providerHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 6,
    paddingHorizontal: 4,
  },
  modelOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 2,
  },
  modelOptionSelected: {
    backgroundColor: '#E8F0FE',
  },
  modelOptionText: {
    fontSize: 15,
    color: '#333',
  },
  modelOptionTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  modelOptionId: {
    fontSize: 11,
    color: '#999',
    marginTop: 1,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  modelOptionProvider: {
    fontSize: 12,
    color: '#999',
    marginTop: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#888',
    fontSize: 14,
  },
  noResults: {
    textAlign: 'center',
    color: '#888',
    fontSize: 14,
    paddingVertical: 30,
  },
});
