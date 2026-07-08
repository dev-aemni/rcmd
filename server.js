#!/usr/bin/env node

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Store active sessions
const sessions = new Map(); // sessionId -> { host, clients }
const peerConnections = new Map(); // ws -> { sessionId, role, peerId }

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'active',
    service: 'RCMD Relay Server',
    version: '1.0.0',
    activeSessions: sessions.size,
    uptime: process.uptime()
  });
});

// API to get active sessions (for debugging)
app.get('/sessions', (req, res) => {
  const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    host: session.host ? 'connected' : 'waiting',
    clients: session.clients.length,
    createdAt: session.createdAt,
    metadata: session.metadata
  }));
  res.json({ sessions: sessionList });
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session');
  const role = url.searchParams.get('role'); // 'host' or 'client'
  const authToken = url.searchParams.get('token');

  if (!sessionId || !role || !authToken) {
    ws.close(4000, 'Missing parameters');
    return;
  }

  // Create or join session
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      host: null,
      clients: [],
      createdAt: new Date(),
      metadata: null,
      authToken: hashToken(authToken)
    });
  }

  const session = sessions.get(sessionId);
  const peerId = uuidv4();

  // Verify token for existing sessions
  if (session.host && session.authToken !== hashToken(authToken)) {
    ws.close(4001, 'Invalid authentication token');
    return;
  }

  const connection = {
    ws,
    peerId,
    role,
    connectedAt: new Date(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
  };

  peerConnections.set(ws, { sessionId, role, peerId });

  // Handle role-specific logic
  if (role === 'host') {
    if (session.host) {
      // Notify existing host about replacement
      if (session.host.ws.readyState === WebSocket.OPEN) {
        session.host.ws.send(JSON.stringify({
          type: 'displaced',
          message: 'Another host connected with same session'
        }));
      }
      peerConnections.delete(session.host.ws);
      session.host.ws.close();
    }
    session.host = connection;
    
    // Send metadata request to host
    ws.send(JSON.stringify({
      type: 'request_metadata',
      sessionId
    }));
    
    console.log(`[${sessionId}] Host connected: ${connection.ip}`);
  } 
  else if (role === 'client') {
    session.clients.push(connection);
    
    // If host is connected, send metadata to new client
    if (session.host && session.metadata) {
      ws.send(JSON.stringify({
        type: 'metadata',
        data: session.metadata
      }));
    }
    
    console.log(`[${sessionId}] Client connected: ${connection.ip} (Total: ${session.clients.length})`);
  }

  // Handle messages between peers
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (role === 'host') {
        // Forward messages to all clients or specific client
        if (message.targetPeerId) {
          // Send to specific client
          const targetClient = session.clients.find(c => c.peerId === message.targetPeerId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify({
              ...message,
              fromPeerId: peerId
            }));
          }
        } else {
          // Broadcast to all clients
          session.clients.forEach(client => {
            if (client.ws.readyState === WebSocket.OPEN) {
              client.ws.send(JSON.stringify({
                ...message,
                fromPeerId: peerId
              }));
            }
          });
        }
      } 
      else if (role === 'client' && session.host) {
        // Forward client messages to host
        if (session.host.ws.readyState === WebSocket.OPEN) {
          session.host.ws.send(JSON.stringify({
            ...message,
            fromPeerId: peerId
          }));
        }
      }

      // Handle metadata response from host
      if (message.type === 'metadata_response') {
        session.metadata = message.data;
        
        // Send metadata to all connected clients
        session.clients.forEach(client => {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({
              type: 'metadata',
              data: session.metadata
            }));
          }
        });
        
        console.log(`[${sessionId}] Metadata received:`, session.metadata);
      }
    } catch (error) {
      console.error(`[${sessionId}] Error processing message:`, error.message);
    }
  });

  // Handle disconnection
  ws.on('close', (code, reason) => {
    peerConnections.delete(ws);
    
    if (role === 'host') {
      // Notify all clients about host disconnection
      session.clients.forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'host_disconnected',
            message: 'Host has disconnected'
          }));
        }
      });
      
      // Clean up session after delay (keep for reconnection)
      setTimeout(() => {
        if (session.host === connection) {
          console.log(`[${sessionId}] Session cleaned up`);
          sessions.delete(sessionId);
        }
      }, 60000); // Keep session alive for 1 minute for reconnection
      
      console.log(`[${sessionId}] Host disconnected: ${connection.ip}`);
    } else {
      // Remove client from session
      session.clients = session.clients.filter(c => c !== connection);
      console.log(`[${sessionId}] Client disconnected: ${connection.ip} (Remaining: ${session.clients.length})`);
    }
  });

  ws.on('error', (error) => {
    console.error(`[${sessionId}] WebSocket error:`, error.message);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`\n✓ RCMD Relay Server running on port ${PORT}`);
  console.log(`✓ WebSocket server ready for connections\n`);
});

// Clean up stale sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    const age = now - session.createdAt.getTime();
    if (!session.host && age > 3600000) { // Remove sessions older than 1 hour without host
      sessions.delete(id);
      console.log(`[${id}] Stale session cleaned up`);
    }
  }
}, 300000); // Check every 5 minutes

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n✓ Server shutting down gracefully...');
  wss.close(() => {
    console.log('✓ All connections closed');
    process.exit(0);
  });
});