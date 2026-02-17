import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from './src/context/AppContext';
import { ConvexProvider, ConvexReactClient } from "convex/react";
import Constants from 'expo-constants';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { SessionsScreen } from './src/screens/SessionsScreen';
import { ChatScreen } from './src/screens/ChatScreen';

type RootStackParamList = {
  Connect: undefined;
  Sessions: undefined;
  Chat: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  // E2E flags removed: always start at Connect
  const initialRoute = 'Connect';
  const endpoint = Constants.expoConfig?.extra?.CONVEX_URL || process.env.EXPO_PUBLIC_CONVEX_URL || 'https://intent-chinchilla-833.convex.cloud';
  const client = new ConvexReactClient(endpoint as string);

  return (
    <SafeAreaProvider>
      <ConvexProvider client={client}>
        <AppProvider>
          <NavigationContainer>
            <Stack.Navigator
              initialRouteName={initialRoute}
              screenOptions={{
                headerShown: false
              }}
            >
              <Stack.Screen
                name="Connect"
                component={ConnectScreen}
              />
              <Stack.Screen
                name="Sessions"
                component={SessionsScreen}
              />
              <Stack.Screen
                name="Chat"
                component={ChatScreen}
              />
            </Stack.Navigator>
          </NavigationContainer>
        </AppProvider>
      </ConvexProvider>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
