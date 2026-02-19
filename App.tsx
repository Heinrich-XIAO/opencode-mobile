import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/context/AppContext';
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Constants from 'expo-constants';

// Screens
import { HomeScreen } from './src/screens/HomeScreen';
import { HostSelectionScreen } from './src/screens/HostSelectionScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { DirectoryBrowserScreen } from './src/screens/DirectoryBrowserScreen';
import { SessionSelectionScreen } from './src/screens/SessionSelectionScreen';
import { HostChatScreen } from './src/screens/HostChatScreen';

export type OpenCodeSessionSummary = {
  id: string;
  title?: string;
  updatedAt?: string;
  status?: string;
};

type RootStackParamList = {
  Home: undefined;
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  SessionSelection: { hostId: string; jwt: string; directory: string; port: number; sessions: OpenCodeSessionSummary[] };
  HostChat: { hostId: string; jwt: string; directory: string; port: number; sessionId?: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const endpoint = Constants.expoConfig?.extra?.CONVEX_URL || process.env.EXPO_PUBLIC_CONVEX_URL || 'https://utmost-wren-887.convex.cloud';
  const client = new ConvexReactClient(endpoint as string);

  return (
    <SafeAreaProvider>
      <ConvexProvider client={client}>
        <AppProvider>
          <NavigationContainer
            documentTitle={{
              formatter: () => 'MoblVibe',
            }}
          >
            <Stack.Navigator
              initialRouteName="Home"
              screenOptions={{
                headerShown: false,
              }}
            >
              {/* Home screen - entry point */}
              <Stack.Screen name="Home" component={HomeScreen} />
              {/* Host flow */}
              <Stack.Screen name="HostSelection" component={HostSelectionScreen} />
              <Stack.Screen name="Auth" component={AuthScreen} />
              <Stack.Screen name="DirectoryBrowser" component={DirectoryBrowserScreen} />
              <Stack.Screen name="SessionSelection" component={SessionSelectionScreen} />
              <Stack.Screen name="HostChat" component={HostChatScreen} />

            </Stack.Navigator>
          </NavigationContainer>
        </AppProvider>
      </ConvexProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
