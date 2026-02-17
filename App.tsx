import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/context/AppContext';
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Constants from 'expo-constants';

// Screens
import { HostSelectionScreen } from './src/screens/HostSelectionScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { DirectoryBrowserScreen } from './src/screens/DirectoryBrowserScreen';
import { HostChatScreen } from './src/screens/HostChatScreen';

type RootStackParamList = {
  HostSelection: undefined;
  Auth: { hostId: string };
  DirectoryBrowser: { hostId: string; jwt: string };
  HostChat: { hostId: string; jwt: string; directory: string; port: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const endpoint = Constants.expoConfig?.extra?.CONVEX_URL || process.env.EXPO_PUBLIC_CONVEX_URL || 'https://intent-chinchilla-833.convex.cloud';
  const client = new ConvexReactClient(endpoint as string);

  return (
    <SafeAreaProvider>
      <ConvexProvider client={client}>
        <AppProvider>
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName="HostSelection"
              screenOptions={{
                headerShown: false,
              }}
            >
              {/* Host flow (new) */}
              <Stack.Screen name="HostSelection" component={HostSelectionScreen} />
              <Stack.Screen name="Auth" component={AuthScreen} />
              <Stack.Screen name="DirectoryBrowser" component={DirectoryBrowserScreen} />
              <Stack.Screen name="HostChat" component={HostChatScreen} />

            </Stack.Navigator>
          </NavigationContainer>
        </AppProvider>
      </ConvexProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
