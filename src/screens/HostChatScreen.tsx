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
import { isJwtExpiringSoon } from '../services/jwt';
import { saveJwt, saveMessages } from '../services/storage';

type RootStackParamList = {
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: Array<{ id: string; title?: string; updatedAt?: string; status?: string }> };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'HostChat'>;
  route: { params: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string } };
};

interface LocalMessage {
  id: string;
  role: string;
  text: string;
  reasoningText?: string;
  toolPart?: {
    toolName: string;
    toolInput: any;
    toolCallId: string;
  };
  partType?: 'text' | 'reasoning' | 'tool';
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

function getFriendlyRelayError(rawError?: string | null): string {
  if (!rawError) return 'Request failed. Please try again.';
  const message = rawError.toLowerCase();

  if (message.includes('no active opencode serve')) {
    return 'OpenCode is not running for this directory. Return to the browser and start it again.';
  }

  if (message.includes('invalid or expired jwt')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  if (message.includes('jwt expired')) {
    return 'Your session expired. Please reconnect and try again.';
  }

  if (message.includes('timed out waiting for ai response')) {
    return 'The model timed out. Try again or switch to a lighter model.';
  }

  if (message.includes('sse connection failed')) {
    return 'Streaming connection failed. Try again in a moment.';
  }

  if (message.includes('failed to create session')) {
    return 'OpenCode could not create a session. Restart OpenCode and try again.';
  }

  return rawError;
}

export function HostChatScreen({ navigation, route }: Props) {
  const { hostId, jwt, directory, port, sessionId } = route.params;
  const { state, dispatch } = useApp();
  const [activeJwt, setActiveJwt] = useState(jwt);
  const [refreshingJwt, setRefreshingJwt] = useState(false);
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
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerRequestId, setProviderRequestId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshRequestId, setRefreshRequestId] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<{ name?: string; modelID?: string; providerID?: string } | null>(null);
  const [historyRequestId, setHistoryRequestId] = useState<string | null>(null);

  // Tool invocation state
  const [pendingTool, setPendingTool] = useState<{
    toolName: string;
    toolInput: any;
    toolCallId: string;
  } | null>(null);
  const [toolAnswer, setToolAnswer] = useState('');
  const [submittingTool, setSubmittingTool] = useState(false);

  const createRequest = useMutation(api.requests.create);
  const submitToolResult = useMutation(api.requests.submitToolResult);

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

  const refreshResponse = useQuery(
    api.requests.getStreamingResponse,
    refreshRequestId ? { requestId: refreshRequestId as any } : 'skip'
  );

  const historyResponse = useQuery(
    api.requests.getStreamingResponse,
    historyRequestId ? { requestId: historyRequestId as any } : 'skip'
  );

  // Watch for tool status changes (question tool invocations)
  const toolStatus = useQuery(
    api.requests.getToolStatus,
    activeRequestId ? { requestId: activeRequestId as any } : 'skip'
  );

  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    setProviderError(null);
    const clientId = `providers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const reqId = await createRequest({
        hostId,
        type: 'get_providers',
        payload: { port },
        jwt: activeJwt,
        clientId,
      });
      setProviderRequestId(reqId);
    } catch (err) {
      console.error('Failed to fetch providers:', err);
      setProviderError('Failed to load models. Check OpenCode and try again.');
      setLoadingProviders(false);
    }
  }, [hostId, port, activeJwt]);

  // Fetch providers on mount
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Fetch chat history when sessionId is available
  useEffect(() => {
    if (!sessionId || !port || historyRequestId) return;

    const clientId = `history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const requestHistory = async () => {
      try {
        const reqId = await createRequest({
          hostId,
          type: 'get_history',
          payload: { port, sessionId },
          jwt: activeJwt,
          clientId,
        });
        setHistoryRequestId(reqId);
      } catch (err) {
        console.error('Failed to fetch history:', err);
      }
    };

    requestHistory();
  }, [sessionId, port, hostId, activeJwt, historyRequestId]);

  // Handle history response
  useEffect(() => {
    if (!historyResponse || !historyRequestId) return;

    if (historyResponse.status === 'completed') {
      try {
        const historyJson = (historyResponse.response as any)?.historyJson;
        if (historyJson) {
          const history = JSON.parse(historyJson);
          
          // Convert OpenCode history format to LocalMessage format
          const loadedMessages: LocalMessage[] = (Array.isArray(history) ? history : []).map((msg: any, idx: number) => {
            const role = msg.role === 'user' ? 'You' : (msg.role === 'assistant' ? 'OpenCode' : msg.role);
            
            // Handle different message formats from OpenCode
            const parts = msg.parts || (msg.content ? [{ type: 'text', text: msg.content }] : []);
            
            return parts.map((part: any, partIdx: number) => {
              // Skip step-related parts that don't have visible content
              if (part.type === 'step-start' || part.type === 'step-finish') {
                return null;
              }
              
              if (part.type === 'tool' || part.toolName) {
                return {
                  id: `${msg.id || idx}-${partIdx}`,
                  role,
                  text: part.text || '',
                  toolPart: part.toolName ? {
                    toolName: part.toolName,
                    toolInput: typeof part.toolInput === 'string' ? JSON.parse(part.toolInput) : part.toolInput,
                    toolCallId: part.toolCallId || `${msg.id || idx}-${partIdx}`,
                  } : undefined,
                  partType: 'tool' as const,
                  createdAt: msg.createdAt || msg.timestamp || new Date().toISOString(),
                };
              }
              
              if (part.type === 'reasoning' || part.type === 'thinking') {
                return {
                  id: `${msg.id || idx}-${partIdx}`,
                  role,
                  text: '',
                  reasoningText: part.text || part.content || '',
                  partType: 'reasoning' as const,
                  createdAt: msg.createdAt || msg.timestamp || new Date().toISOString(),
                };
              }
              
              return {
                id: `${msg.id || idx}-${partIdx}`,
                role,
                text: part.text || part.content || '',
                createdAt: msg.createdAt || msg.timestamp || new Date().toISOString(),
              };
            });
          }).flat().filter(Boolean);

          if (loadedMessages.length > 0) {
            setMessages(loadedMessages);
          }
        }
      } catch (err) {
        console.error('Failed to parse history:', err);
      }
      setHistoryRequestId(null);
    } else if (historyResponse.status === 'failed') {
      console.error('History fetch failed:', (historyResponse.response as any)?.error);
      setHistoryRequestId(null);
    }
  }, [historyResponse, historyRequestId]);

  useEffect(() => {
    if (refreshingJwt || !isJwtExpiringSoon(activeJwt)) return;

    async function refreshJwt() {
      setRefreshingJwt(true);
      const clientId = `refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const reqId = await createRequest({
          hostId,
          type: 'refresh_jwt',
          payload: {},
          jwt: activeJwt,
          clientId,
        });
        setRefreshRequestId(reqId);
      } catch (err) {
        const friendlyError = getFriendlyRelayError(
          err instanceof Error ? err.message : undefined
        );
        setMessages(prev => [
          ...prev,
          {
            id: `error-${Date.now()}`,
            role: 'System',
            text: `Error: ${friendlyError}`,
            createdAt: new Date().toISOString(),
          },
        ]);
        setRefreshingJwt(false);
      }
    }

    refreshJwt();
  }, [refreshingJwt, activeJwt, hostId, createRequest]);

  useEffect(() => {
    if (!refreshResponse || !refreshRequestId) return;

    if (refreshResponse.status === 'completed' && refreshResponse.response?.jwtToken) {
      const newJwt = refreshResponse.response.jwtToken;
      setActiveJwt(newJwt);
      saveJwt(newJwt);
      dispatch({ type: 'SET_JWT', payload: newJwt });
      setRefreshRequestId(null);
      setRefreshingJwt(false);
    } else if (refreshResponse.status === 'failed') {
      const errorText = getFriendlyRelayError((refreshResponse.response as any)?.error);
      setMessages(prev => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: 'System',
          text: `Error: ${errorText}`,
          createdAt: new Date().toISOString(),
        },
      ]);
      dispatch({ type: 'SET_JWT', payload: null });
      setRefreshRequestId(null);
      setRefreshingJwt(false);
    }
  }, [refreshResponse, refreshRequestId, dispatch]);

  // Handle provider response
  useEffect(() => {
    if (!providerResponse || !providerRequestId) return;

    if (providerResponse.status === 'completed') {
      try {
        const json = (providerResponse.response as any)?.providersJson;
        if (json) {
          const data = JSON.parse(json);
          setProviders(data.providers || []);
          setDefaultModel(data.default || null);
        }
      } catch (err) {
        console.error('Failed to parse providers:', err);
        setProviderError('Failed to parse model list. Try again.');
      }
      setLoadingProviders(false);
      setProviderRequestId(null);
    } else if (providerResponse.status === 'failed') {
      console.error('Provider fetch failed');
      setProviderError('Failed to load models. Check OpenCode and try again.');
      setLoadingProviders(false);
      setProviderRequestId(null);
    }
  }, [providerResponse, providerRequestId]);

  // Handle streaming response updates - create separate bubbles for each part type
  useEffect(() => {
    if (!streamingData || !activeRequestId) return;

    const parts = streamingData.parts as Array<{
      type: string;
      content: string;
      metadata?: any;
      createdAt: number;
    }> | null;

    // Handle parts-based rendering (new approach with separate bubbles)
    if (parts && parts.length > 0) {
      const partMessages: LocalMessage[] = parts.map((part, index) => {
        const partId = `part-${activeRequestId}-${index}`;
        
        if (part.type === 'reasoning') {
          return {
            id: partId,
            role: 'OpenCode' as const,
            text: '',
            reasoningText: part.content,
            partType: 'reasoning' as const,
            createdAt: new Date(part.createdAt).toISOString(),
            pending: streamingData.status === 'processing',
          };
        }
        
        if (part.type === 'tool') {
          return {
            id: partId,
            role: 'OpenCode' as const,
            text: part.content,
            toolPart: part.metadata ? {
              toolName: part.metadata.toolName,
              toolInput: part.metadata.toolInput,
              toolCallId: part.metadata.toolCallId,
            } : undefined,
            partType: 'tool' as const,
            createdAt: new Date(part.createdAt).toISOString(),
            pending: streamingData.status === 'processing',
          };
        }
        
        // Default to text part
        return {
          id: partId,
          role: 'OpenCode' as const,
          text: part.content,
          partType: 'text' as const,
          createdAt: new Date(part.createdAt).toISOString(),
          pending: streamingData.status === 'processing',
        };
      });

      setMessages(prev => {
        // Remove old streaming messages for this request
        const withoutOldParts = prev.filter(m => !m.id.startsWith(`part-${activeRequestId}`) && !m.id.startsWith(`stream-${activeRequestId}`));
        return [...withoutOldParts, ...partMessages];
      });
    } else {
      // Fallback to old behavior if no parts yet (backward compatibility)
      const partialReasoning = (streamingData as any).partialReasoning as string | null | undefined;

      if (streamingData.status === 'processing' && streamingData.partialResponse) {
        setMessages(prev => {
          const streamId = `stream-${activeRequestId}`;
          const existing = prev.find(m => m.id === streamId);
          if (existing) {
            return prev.map(m =>
              m.id === streamId
                ? {
                    ...m,
                    text: streamingData.partialResponse!,
                    reasoningText: partialReasoning || undefined,
                  }
                : m
            );
          }
          return [
            ...prev,
            {
              id: streamId,
              role: 'OpenCode',
              text: streamingData.partialResponse!,
              reasoningText: partialReasoning || undefined,
              createdAt: new Date().toISOString(),
              pending: true,
            },
          ];
        });
      } else if (streamingData.status === 'processing' && partialReasoning) {
        setMessages(prev => {
          const streamId = `stream-${activeRequestId}`;
          const existing = prev.find(m => m.id === streamId);
          if (existing) {
            return prev.map(m =>
              m.id === streamId ? { ...m, reasoningText: partialReasoning, pending: true } : m
            );
          }
          return [
            ...prev,
            {
              id: streamId,
              role: 'OpenCode',
              text: '',
              reasoningText: partialReasoning,
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
        const finalReasoning =
          (streamingData.response as any)?.reasoning ||
          partialReasoning ||
          undefined;
        const streamId = `stream-${activeRequestId}`;
        setMessages(prev => {
          const existing = prev.find(m => m.id === streamId);
          if (existing) {
            return prev.map(m =>
              m.id === streamId
                ? { ...m, text: finalText, reasoningText: finalReasoning, pending: false }
                : m
            );
          }
          return [
            ...prev,
            {
              id: `ai-${Date.now()}`,
              role: 'OpenCode',
              text: finalText,
              reasoningText: finalReasoning,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        setSending(false);
        setActiveRequestId(null);
      } else if (streamingData.status === 'failed') {
        const errorText =
          getFriendlyRelayError((streamingData.response as any)?.error) || 'Request failed';
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
    }
  }, [streamingData, activeRequestId]);

  // Handle tool invocations - show question modal when pending tool is detected
  useEffect(() => {
    if (!toolStatus?.pendingTool) {
      setPendingTool(null);
      return;
    }

    // Check if this is a new pending tool we haven't shown yet
    if (toolStatus.pendingTool && !pendingTool) {
      setPendingTool({
        toolName: toolStatus.pendingTool.toolName,
        toolInput: toolStatus.pendingTool.toolInput,
        toolCallId: toolStatus.pendingTool.toolCallId,
      });
    }
  }, [toolStatus]);

  // Load messages from AppContext on mount (only for existing sessions)
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }

    const loadedMessages: LocalMessage[] = state.messages.map(msg => {
      const textPart = msg.parts.find(p => p.type === 'text');
      const reasoningPart = msg.parts.find(p => p.type === 'reasoning');
      const toolPart = msg.parts.find(p => p.type === 'tool');
      
      if (toolPart) {
        return {
          id: msg.info.id,
          role: msg.info.role,
          text: toolPart.text || '',
          toolPart: toolPart.toolName ? {
            toolName: toolPart.toolName,
            toolInput: toolPart.toolInput ? JSON.parse(toolPart.toolInput) : undefined,
            toolCallId: msg.info.id,
          } : undefined,
          partType: 'tool' as const,
          createdAt: msg.info.createdAt,
        };
      }
      
      if (reasoningPart) {
        return {
          id: msg.info.id,
          role: msg.info.role,
          text: '',
          reasoningText: reasoningPart.text,
          partType: 'reasoning' as const,
          createdAt: msg.info.createdAt,
        };
      }
      
      return {
        id: msg.info.id,
        role: msg.info.role,
        text: textPart?.text || '',
        createdAt: msg.info.createdAt,
      };
    });
    
    if (loadedMessages.length > 0) {
      setMessages(loadedMessages);
    }
  }, [state.messages]);

  // Save messages to storage when they change
  useEffect(() => {
    if (messages.length > 0) {
      const messagesWithParts: MessageWithParts[] = messages.map(m => {
        if (m.partType === 'tool' && m.toolPart) {
          return {
            info: { id: m.id, role: m.role, createdAt: m.createdAt },
            parts: [{
              type: 'tool' as const,
              text: m.text,
              toolName: m.toolPart.toolName,
              toolInput: JSON.stringify(m.toolPart.toolInput),
            }],
          };
        }
        if (m.partType === 'reasoning' || m.reasoningText) {
          return {
            info: { id: m.id, role: m.role, createdAt: m.createdAt },
            parts: [{ type: 'reasoning' as const, text: m.reasoningText || '' }],
          };
        }
        return {
          info: { id: m.id, role: m.role, createdAt: m.createdAt },
          parts: [{ type: 'text' as const, text: m.text }],
        };
      });
      saveMessages(messagesWithParts);
    }
  }, [messages]);

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
      if (sessionId) {
        payload.sessionId = sessionId;
      }
      if (selectedModel) {
        payload.providerID = selectedModel.providerID;
        payload.modelID = selectedModel.modelID;
      }

      const requestId = await createRequest({
        hostId,
        type: 'relay_message',
        payload,
        jwt: activeJwt,
        clientId,
      });
      setActiveRequestId(requestId);
    } catch (err) {
      const friendlyError = getFriendlyRelayError(
        err instanceof Error ? err.message : undefined
      );
      const errorMsg: LocalMessage = {
        id: `error-${Date.now()}`,
        role: 'System',
        text: `Failed to send: ${friendlyError}`,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, errorMsg]);
      setSending(false);
      setActiveRequestId(null);
    }
  }, [inputText, sending, hostId, activeJwt, port, directory, selectedModel, sessionId]);

  // Handle submitting a tool result (e.g., answer to a question)
  const handleToolSubmit = useCallback(async () => {
    if (!pendingTool || !activeRequestId || !toolAnswer.trim()) return;
    
    setSubmittingTool(true);
    
    try {
      await submitToolResult({
        requestId: activeRequestId as any,
        toolCallId: pendingTool.toolCallId,
        result: toolAnswer.trim(),
      });
      
      // The tool result will be cleared by the useEffect when toolStatus updates
    } catch (err) {
      console.error('Failed to submit tool result:', err);
      setSubmittingTool(false);
    }
  }, [pendingTool, activeRequestId, toolAnswer, submitToolResult]);

  const messageItems: MessageWithParts[] = messages.flatMap(m => {
    // If it's a tool part, create a tool-type part
    if (m.partType === 'tool' && m.toolPart) {
      const msg: MessageWithParts = {
        info: { id: m.id, role: m.role, createdAt: m.createdAt },
        parts: [{
          type: 'tool',
          text: m.text,
          toolName: m.toolPart.toolName,
          toolInput: JSON.stringify(m.toolPart.toolInput, null, 2),
        }],
      };
      return [msg];
    }

    // If it's a reasoning-only part
    if (m.partType === 'reasoning' || m.reasoningText) {
      const msg: MessageWithParts = {
        info: { id: m.id, role: m.role, createdAt: m.createdAt },
        parts: [{ type: 'reasoning', text: m.reasoningText || '' }],
      };
      return [msg];
    }

    // Default: text message
    const msg: MessageWithParts = {
      info: { id: m.id, role: m.role, createdAt: m.createdAt },
      parts: [{ type: 'text', text: m.text }],
    };
    return [msg];
  });

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

  const defaultLabel = defaultModel?.name || defaultModel?.modelID || null;
  const modelDisplayName = selectedModel?.displayName || (defaultLabel ? `Default: ${defaultLabel}` : 'Default model');

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

            {providerError && (
              <View style={styles.providerErrorBar}>
                <Text style={styles.providerErrorText}>{providerError}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={fetchProviders}
                  disabled={loadingProviders}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}

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
              <Text style={styles.modelOptionProvider}>
                {defaultLabel ? `Use server default (${defaultLabel})` : 'Use server default'}
              </Text>
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

      {/* Tool Question Modal */}
      <Modal
        visible={!!pendingTool}
        animationType="slide"
        transparent
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Question</Text>
            </View>
            
            <View style={styles.questionContainer}>
              <Text style={styles.questionText}>
                {pendingTool?.toolInput?.questions?.[0]?.question || 
                 pendingTool?.toolInput?.question || 
                 'The AI has a question for you:'}
              </Text>
              
              <TextInput
                style={styles.questionInput}
                value={toolAnswer}
                onChangeText={setToolAnswer}
                placeholder="Type your answer..."
                placeholderTextColor="#999"
                multiline
                maxLength={1000}
                editable={!submittingTool}
                autoFocus
              />
              
              <TouchableOpacity
                style={[styles.submitButton, (!toolAnswer.trim() || submittingTool) && styles.submitButtonDisabled]}
                onPress={handleToolSubmit}
                disabled={!toolAnswer.trim() || submittingTool}
              >
                {submittingTool ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Answer</Text>
                )}
              </TouchableOpacity>
            </View>
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
  providerErrorBar: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#fdecea',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  providerErrorText: {
    flex: 1,
    color: '#c0392b',
    fontSize: 12,
    marginRight: 8,
  },
  retryButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#007AFF',
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
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
  // Tool question styles
  questionContainer: {
    padding: 16,
  },
  questionText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 16,
    lineHeight: 22,
  },
  questionInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    backgroundColor: '#f9f9f9',
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
