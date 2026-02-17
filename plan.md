# OpenCode Mobile - React Native Expo App

## Project Overview

Build a React Native Expo app that allows users to connect to a remote opencode server and interact with it from iOS or Android devices.

## How It Works (legacy)

This project originally connected to a local OpenCode REST server. That flow is deprecated in this branch: the app now uses Convex for persistence and realtime features. The old instructions remain for reference:

1. **OpenCode Server** runs on a machine (e.g., your desktop) with `opencode serve --port 4096 --hostname 0.0.0.0 --cors <mobile-app-origin>`
2. **Mobile App** connects to this server via HTTP REST API (deprecated)
3. Users can create sessions, send prompts, and view AI responses

## Tech Stack

- **Framework**: React Native with Expo
- **Language**: TypeScript
- **API Client**: `@opencode-ai/sdk` (or direct HTTP fetch if SDK doesn't work in React Native)
- **State Management**: React Context + useReducer
- **UI Components**: React Native built-in + custom components
- **Navigation**: React Navigation (expo-router or @react-navigation/native)

## Key Features

### 1. Server Connection
- Input fields for server hostname/IP and port
- Optional Basic Auth (username/password)
- Connection status indicator
- Save/remember server configuration

### 2. Session Management
- List existing sessions
- Create new session
- Delete sessions
- Continue/fork sessions

### 3. Chat Interface
- Text input for prompts
- Display AI responses (text, markdown rendered)
- Show tool calls/actions taken by AI
- Loading states while waiting for response

### 4. Additional Features
- Model selector (if multiple models available)
- Provider status display
- Real-time events via SSE (if supported)

## Architecture

```
src/
├── components/        # Reusable UI components
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── ChatBubble.tsx
│   ├── SessionList.tsx
│   └── ServerConnection.tsx
├── screens/           # App screens
│   ├── ConnectScreen.tsx    # Server connection
│   ├── SessionsScreen.tsx   # Session list
│   └── ChatScreen.tsx       # Main chat interface
├── context/           # App state
│   └── AppContext.tsx
├── services/          # API client
│   └── opencodeClient.ts
├── types/             # TypeScript types
│   └── index.ts
└── App.tsx            # Entry point
```

## API Endpoints to Use

- `GET /global/health` - Check server health
- `GET /session` - List sessions
- `POST /session` - Create new session
- `GET /session/:id` - Get session details
- `POST /session/:id/message` - Send prompt, get response
- `GET /session/:id/message` - Get message history
- `DELETE /session/:id` - Delete session

## Implementation Steps

1. Initialize Expo project with TypeScript
2. Install dependencies (react-navigation, etc.)
3. Create API client service
4. Build connection screen
5. Build session management
6. Build chat interface
7. Add error handling and loading states
8. Test with running opencode server
