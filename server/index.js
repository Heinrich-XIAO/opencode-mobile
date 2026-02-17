require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('ws');

const app = express();
app.use(express.json());


// Helper to generate random code/password
function generateCode(length = 6) {
  return Math.random().toString(36).replace(/[^a-z]+/g, '').slice(0, length).toUpperCase();
}
function generatePassword(length = 10) {
  return [...Array(length)].map(() => Math.random().toString(36)[2]).join("");
}

// API to create a session
// 🚧 To be replaced: Create session endpoint now handled by Convex
// app.post('/api/session', ...)


// API to connect to a session (validate but not join WS)
// 🚧 To be replaced: Connect/validate session endpoint now handled by Convex
// app.post('/api/connect', ...)


const server = http.createServer(app);
const wss = new Server({ server });

// Simple relay logic per session
const sessionSockets = new Map(); // sessionId => Set of ws

// 🚧 To be replaced: All websocket relay logic handled via Convex real-time API
// wss.on('connection', ...)


// Fetch messages for a session
// 🚧 To be replaced: Message fetch now handled by Convex query
// app.get('/api/messages/:code', ...)


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
