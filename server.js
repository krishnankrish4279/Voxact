/**
 * VoxAct — Express + WebSocket Server
 * 
 * Serves the frontend and manages WebSocket connections for real-time
 * voice communication between the browser and the orchestrator.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Orchestrator } = require('./src/orchestrator');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Serverless API Endpoints (Chat, Session, TTS) ──────────────────────────
app.post('/api/chat', require('./api/chat'));
app.post('/api/session', require('./api/session'));
app.get('/api/tts', require('./api/tts'));
app.post('/api/tts', require('./api/tts'));

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rime: {
      configured: !!process.env.RIME_API_KEY,
      model: process.env.RIME_MODEL_ID || 'mist',
      speaker: process.env.RIME_SPEAKER || 'cove',
    },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
  });
});

// ─── API Key Validation ────────────────────────────────────────────────────

app.get('/api/preflight', async (req, res) => {
  const issues = [];
  const rimeConfigured = !!process.env.RIME_API_KEY && process.env.RIME_API_KEY !== 'your_rime_api_key_here';
  const openaiConfigured = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';

  if (!rimeConfigured) {
    issues.push('RIME_API_KEY is not set (using browser speech fallback)');
  }
  if (!openaiConfigured) {
    issues.push('OPENAI_API_KEY is not set (using simulated medical triage reasoning)');
  }

  const isLive = rimeConfigured && openaiConfigured;

  res.json({
    ok: true,
    mode: isLive ? 'live' : 'simulation',
    issues,
    message: isLive ? 'All API keys configured' : 'Running in simulation mode',
    rime: { configured: rimeConfigured },
    openai: { configured: openaiConfigured },
  });
});

// ─── Metrics Endpoint ──────────────────────────────────────────────────────

const activeSessions = new Map();

app.get('/api/metrics', (req, res) => {
  const allMetrics = [];
  for (const [id, orchestrator] of activeSessions) {
    allMetrics.push({
      sessionId: id,
      metrics: orchestrator.getMetrics(),
      rimeConfig: orchestrator.getRimeConfig(),
    });
  }
  res.json(allMetrics);
});

// ─── Healthcare Facilities & Care Navigation Endpoint ───────────────────────

const { searchHealthcareFacilities } = require('./src/care-navigator');

app.get('/api/facilities', async (req, res) => {
  try {
    const rawLat = req.query.lat;
    const rawLon = req.query.lon !== undefined ? req.query.lon : req.query.lng;
    const lat = (rawLat !== undefined && rawLat !== null && rawLat !== '') ? parseFloat(rawLat) : NaN;
    const lon = (rawLon !== undefined && rawLon !== null && rawLon !== '') ? parseFloat(rawLon) : NaN;

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        error: 'location_required',
        facilities: []
      });
    }

    const urgencyLevel = req.query.urgency || req.query.urgencyLevel || 'medium';
    const careType = req.query.type || req.query.careType || null;
    const locationName = req.query.city || req.query.location || null;
    const language = req.query.lang || req.query.language || 'en';

    const results = await searchHealthcareFacilities({
      lat,
      lon,
      urgencyLevel,
      careType,
      locationName,
      language
    });
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── WebSocket Connection Handler ──────────────────────────────────────────

wss.on('connection', (ws) => {
  const sessionId = uuidv4().slice(0, 12);
  console.log(`[Server] New connection: ${sessionId}`);

  // Create orchestrator for this session
  const sendToClient = (message) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const orchestrator = new Orchestrator(sessionId, sendToClient);
  activeSessions.set(sessionId, orchestrator);

  // Send session info to client
  sendToClient({
    type: 'session_init',
    sessionId,
    language: orchestrator.language,
    supportedLanguages: ['en', 'ta', 'hi'],
    rimeConfig: orchestrator.getRimeConfig(),
  });

  // Handle incoming messages
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'start_session':
          // Client is ready, start with greeting
          await orchestrator.startSession();
          break;

        case 'set_language':
          if (message.language) {
            orchestrator.setLanguage(message.language);
          }
          break;

        case 'set_location':
          if (message.location) {
            orchestrator.setLocation(message.location);
          }
          break;

        case 'user_speech':
          if (message.pendingAction !== undefined) {
            orchestrator.pendingAction = message.pendingAction;
            orchestrator.llm.pendingAction = message.pendingAction;
          }
          if (message.nearbyCareStatus !== undefined) {
            orchestrator.nearbyCareStatus = message.nearbyCareStatus;
            orchestrator.llm.nearbyCareStatus = message.nearbyCareStatus;
            if (message.nearbyCareStatus === 'declined') {
              orchestrator.llm.careDeclined = true;
            }
          }
          // User finished speaking (final transcription)
          await orchestrator.handleUserSpeech(message.text || message);
          break;

        case 'user_speech_interim':
          // Interim transcription (for interruption detection during tool_work)
          // We only interrupt if we're in a speaking or tool_work state and text is meaningful
          if (message.text && message.text.trim().length > 5) {
            // Don't act on every interim — only if we're in an interruptible state
            // The client handles actual interruption detection
          }
          break;

        case 'interrupt_start':
          orchestrator.abortCurrentGeneration(message.clientHaltMs);
          break;

        case 'interrupt':
          // Client detected user speaking while audio is playing
          if (message.text) {
            await orchestrator.handleUserSpeech(message.text);
          }
          break;

        case 'playback_start':
          orchestrator.handlePlaybackStart(message.generationId, message);
          break;

        case 'playback_complete':
          orchestrator.handlePlaybackComplete(message.generationId);
          break;

        case 'get_metrics':
          sendToClient({
            type: 'metrics',
            data: orchestrator.getMetrics(),
          });
          break;

        default:
          console.log(`[Server] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error(`[Server] Error handling message:`, err);
      sendToClient({
        type: 'error',
        message: 'An internal error occurred. Please try again.',
      });
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    console.log(`[Server] Connection closed: ${sessionId}`);
    orchestrator.destroy();
    activeSessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[Server] WebSocket error for ${sessionId}:`, err.message);
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║                                                  ║
║   🎙️  VoxAct — Medical Triage Assistant          ║
║                                                  ║
║   Server running at http://localhost:${PORT}        ║
║                                                  ║
║   Rime Model:   ${(process.env.RIME_MODEL_ID || 'mist').padEnd(30)}║
║   Rime Speaker: ${(process.env.RIME_SPEAKER || 'luna').padEnd(30)}║
║   LLM Model:    ${(process.env.OPENAI_MODEL || 'gpt-4o').padEnd(30)}║
║                                                  ║
╚══════════════════════════════════════════════════╝
  `);

  // Preflight check
  if (!process.env.RIME_API_KEY) {
    console.warn('⚠️  WARNING: RIME_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  WARNING: OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
});

module.exports = { app, server };
