/**
 * VoxAct — Rime TTS WebSocket Client
 * Connects to Rime's /ws3 endpoint for streaming text-to-speech.
 * Supports mid-stream cancellation and TTFB measurement.
 */

const WebSocket = require('ws');
const { synthesizeClearAudio } = require('./tts-synthesizer');

// Validated Rime configurations for multilingual medical triage
const LANGUAGE_PROFILES = {
  en: { modelId: 'mist', speaker: 'cove', language: 'eng' },
  eng: { modelId: 'mist', speaker: 'cove', language: 'eng' },
  ta: { modelId: 'arcana', speaker: 'anaya', language: 'tam' },
  tam: { modelId: 'arcana', speaker: 'anaya', language: 'tam' },
  hi: { modelId: 'coda', speaker: 'taru', language: 'hin' },
  hin: { modelId: 'coda', speaker: 'taru', language: 'hin' },
};

// MP3 Bitrates (kbps) for MPEG-1 Layer III
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
// MP3 Bitrates for MPEG-2/2.5 Layer III
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
// Sample rates (Hz)
const SAMPLE_RATES = {
  1: [44100, 48000, 32000],      // MPEG-1
  2: [22050, 24000, 16000],      // MPEG-2
  2.5: [11025, 12000, 8000]      // MPEG-2.5
};

function getMp3FrameSize(buf, offset) {
  if (offset + 4 > buf.length) return null;
  const b0 = buf[offset];
  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];

  if (b0 !== 0xFF || (b1 & 0xE0) !== 0xE0) return null;

  const vBits = (b1 >> 3) & 0x03;
  let version = 1;
  if (vBits === 0) version = 2.5;
  else if (vBits === 2) version = 2;
  else if (vBits === 3) version = 1;
  else return null;

  const layer = (b1 >> 1) & 0x03;
  if (layer !== 1) return null; // Layer III only

  const bitrateIdx = (b2 >> 4) & 0x0F;
  const sampleRateIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;

  if (bitrateIdx === 0 || bitrateIdx === 15 || sampleRateIdx === 3) return null;

  const bitrate = (version === 1 ? BITRATES_V1_L3[bitrateIdx] : BITRATES_V2_L3[bitrateIdx]) * 1000;
  const sampleRate = SAMPLE_RATES[version][sampleRateIdx];
  if (!sampleRate) return null;

  const coef = version === 1 ? 144 : 72;
  const frameSize = Math.floor((coef * bitrate) / sampleRate) + padding;
  return frameSize > 0 ? frameSize : null;
}

class RimeClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.RIME_API_KEY;

    // Resolve initial language profile
    let reqLang = config.language || process.env.RIME_LANGUAGE || 'eng';
    if (reqLang === 'en') reqLang = 'eng';
    const profile = LANGUAGE_PROFILES[reqLang] || LANGUAGE_PROFILES.en;

    this.modelId = config.modelId || process.env.RIME_MODEL_ID || profile.modelId;
    this.speaker = config.speaker || process.env.RIME_SPEAKER || profile.speaker;
    this.language = profile.language;
    this.audioFormat = config.audioFormat || process.env.RIME_AUDIO_FORMAT || 'mp3';
    this.endpoint = config.endpoint || process.env.RIME_ENDPOINT || 'wss://users-ws.rime.ai/ws3';
    this.speedAlpha = config.speedAlpha || 1.0;

    this.useWebSocket = config.useWebSocket !== false;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
  }

  /**
   * Dynamically switch the TTS language/model/speaker without reloading
   * @param {string} langCode - 'en', 'ta', or 'hi'
   */
  setLanguage(langCode) {
    const code = (langCode || 'en').toLowerCase();
    const profile = LANGUAGE_PROFILES[code] || LANGUAGE_PROFILES.en;
    const changed = (this.language !== profile.language || this.modelId !== profile.modelId || this.speaker !== profile.speaker);

    this.modelId = profile.modelId;
    this.speaker = profile.speaker;
    this.language = profile.language;

    if (changed) {
      console.log(`[Rime] Language switched to ${code} (model: ${this.modelId}, speaker: ${this.speaker}, lang: ${this.language})`);
      this._resetConnection();
    }
  }

  /**
   * Build the WebSocket connection URL with query parameters
   */
  _buildUrl() {
    const params = new URLSearchParams({
      speaker: this.speaker,
      modelId: this.modelId,
      audioFormat: this.audioFormat,
      lang: this.language,
      speedAlpha: String(this.speedAlpha),
    });
    return `${this.endpoint}?${params.toString()}`;
  }

  /**
   * Connect to Rime WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      const url = this._buildUrl();

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error('Rime WebSocket connection timeout'));
        this.ws.terminate();
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('[Rime] Connected to Rime TTS WebSocket');
        resolve();
      });

      this.ws.on('error', (err) => {
        clearTimeout(timeout);
        if (this.isConnected) {
          console.error('[Rime] WebSocket error:', err.message);
        }
        reject(err);
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        console.log(`[Rime] WebSocket closed: ${code} ${reason}`);
      });
    });
  }

  /**
   * Check if Rime API key is configured
   */
  isConfigured() {
    return !!this.apiKey && this.apiKey !== 'your_rime_api_key_here' && this.apiKey.trim().length > 0;
  }

  /**
   * Synthesize text to speech, streaming audio chunks back via callback.
   * Returns a promise that resolves when synthesis is complete.
   * 
   * @param {string} text - Text to synthesize
   * @param {function} onAudioChunk - Callback(base64AudioData, metadata)
   * @param {AbortSignal} signal - For cancellation
   * @returns {Promise<object>} Synthesis metadata including timing
   */
  async synthesize(text, onAudioChunk, signal) {
    if (!text || text.trim().length === 0) {
      return { skipped: true, reason: 'empty text' };
    }

    if (!this.isConfigured()) {
      return await this.synthesizeHTTP(text, onAudioChunk, signal);
    }

    // Ensure connection
    if (!this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let firstByteTime = null;
      let totalBytes = 0;
      let chunkCount = 0;
      let resolved = false;

      // Handle cancellation
      if (signal) {
        signal.addEventListener('abort', () => {
          if (!resolved) {
            resolved = true;
            // Close and reconnect for clean state
            this._resetConnection();
            resolve({
              cancelled: true,
              chunksReceived: chunkCount,
              totalBytes,
              ttfbMs: firstByteTime ? firstByteTime - startTime : null,
            });
          }
        }, { once: true });
      }

      let emittedChunkCount = 0;

      const messageHandler = (data) => {
        if (resolved) return;

        try {
          // Try JSON parsing first (ws3 format)
          let message;
          if (typeof data === 'string') {
            message = JSON.parse(data);
          } else if (Buffer.isBuffer(data)) {
            try {
              message = JSON.parse(data.toString());
            } catch {
              message = { data: data.toString('base64') };
            }
          }

          const audioData = message?.data || message?.audio || message?.audioContent;
          if (audioData) {
            const isFirst = !firstByteTime;
            if (!firstByteTime) {
              firstByteTime = Date.now();
            }

            const rawBuf = Buffer.from(audioData, 'base64');
            totalBytes += rawBuf.length;
            chunkCount++;
            emittedChunkCount++;

            // Forward audio chunk immediately to client without butchering stream boundaries
            onAudioChunk(audioData, {
              chunkIndex: emittedChunkCount,
              isFirst: emittedChunkCount === 1,
              isLast: false,
              ttfbMs: firstByteTime - startTime,
              timestamps: message.timestamps || null,
            });
          }

          // Check for completion signal (Rime ws3 sends { type: 'done' })
          if (message && (message.type === 'done' || message.done || message.is_final || message.finished || message.endOfStream || message.eos)) {
            cleanup();
            resolved = true;

            onAudioChunk(null, {
              chunkIndex: emittedChunkCount + 1,
              isFirst: emittedChunkCount === 0,
              isLast: true,
              timestamps: message.timestamps || null,
            });

            resolve({
              cancelled: false,
              chunksReceived: emittedChunkCount || chunkCount,
              totalBytes,
              ttfbMs: firstByteTime ? firstByteTime - startTime : null,
              totalMs: Date.now() - startTime,
            });
          }
        } catch (err) {
          console.error('[Rime] Error processing message:', err.message);
        }
      };

      const errorHandler = (err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      };

      const closeHandler = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          if (chunkCount > 0) {
            onAudioChunk(null, {
              chunkIndex: emittedChunkCount + 1,
              isFirst: false,
              isLast: true,
            });
            resolve({
              cancelled: false,
              chunksReceived: emittedChunkCount || chunkCount,
              totalBytes,
              ttfbMs: firstByteTime ? firstByteTime - startTime : null,
              totalMs: Date.now() - startTime,
              closedEarly: true,
            });
          } else {
            reject(new Error('Rime WebSocket closed before receiving audio'));
          }
        }
      };

      const cleanup = () => {
        if (this.ws) {
          this.ws.removeListener('message', messageHandler);
          this.ws.removeListener('error', errorHandler);
          this.ws.removeListener('close', closeHandler);
        }
      };

      this.ws.on('message', messageHandler);
      this.ws.on('error', errorHandler);
      this.ws.on('close', closeHandler);

      // Send the text
      try {
        this.ws.send(JSON.stringify({ text }));
      } catch (err) {
        cleanup();
        reject(err);
      }

      // Safety timeout — if no response in 15 seconds, resolve
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          if (chunkCount > 0) {
            resolve({
              cancelled: false,
              chunksReceived: chunkCount,
              totalBytes,
              ttfbMs: firstByteTime ? firstByteTime - startTime : null,
              totalMs: Date.now() - startTime,
              timedOut: true,
            });
          } else {
            reject(new Error('Rime TTS timed out after 15 seconds'));
          }
        }
      }, 15000);
    });
  }

  /**
   * Synthesize using HTTP API as fallback
   * More reliable for single-shot synthesis (fillers)
   */
  async synthesizeHTTP(text, onAudioChunk, signal) {
    if (signal?.aborted) {
      return { cancelled: true, reason: 'aborted' };
    }
    if (!text || text.trim().length === 0) {
      return { skipped: true, reason: 'empty text' };
    }

    const startTime = Date.now();

    // 1. If Rime is configured, attempt Rime synthesis
    if (this.isConfigured()) {
      try {
        const response = await fetch('https://users.rime.ai/v1/rime-tts', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'audio/mp3, audio/mpeg',
          },
          body: JSON.stringify({
            text,
            speaker: this.speaker,
            modelId: this.modelId,
            lang: this.language,
            speedAlpha: this.speedAlpha,
          }),
          signal,
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const firstByteTime = Date.now();

          onAudioChunk(buffer.toString('base64'), {
            chunkIndex: 1,
            isFirst: true,
            isLast: true,
          });

          return {
            cancelled: false,
            chunksReceived: 1,
            totalBytes: buffer.length,
            ttfbMs: firstByteTime - startTime,
            totalMs: Date.now() - startTime,
            method: 'http',
            isSimulated: false,
          };
        }
        console.warn(`[Rime] HTTP returned ${response.status}, falling back to clear audio synthesizer`);
      } catch (err) {
        if (err.name === 'AbortError' || signal?.aborted) {
          return { cancelled: true, reason: 'aborted' };
        }
        console.warn('[Rime] HTTP synthesis error, falling back to clear audio:', err.message);
      }
    }

    // 2. High-clarity native multilingual audio synthesis (crystal-clear Tamil / Hindi / English)
    try {
      const clearAudio = await synthesizeClearAudio(text, { language: this.language, signal });
      if (clearAudio && clearAudio.base64) {
        const firstByteTime = Date.now();
        onAudioChunk(clearAudio.base64, {
          chunkIndex: 1,
          isFirst: true,
          isLast: true,
          format: 'mp3',
        });

        return {
          cancelled: false,
          chunksReceived: 1,
          totalBytes: clearAudio.buffer.length,
          ttfbMs: firstByteTime - startTime,
          totalMs: Date.now() - startTime,
          method: 'clear-tts',
          isSimulated: false,
        };
      }
    } catch (clearErr) {
      if (clearErr.name === 'AbortError' || signal?.aborted) {
        return { cancelled: true, reason: 'aborted' };
      }
      console.warn('[Rime] Clear TTS synthesis error:', clearErr.message);
    }

    // 3. Fallback simulation when offline/unavailable
    return {
      cancelled: false,
      chunksReceived: 0,
      totalBytes: 0,
      ttfbMs: 15,
      totalMs: 25,
      method: 'simulation',
      isSimulated: true,
    };
  }

  /**
   * Reset the WebSocket connection (for after cancellation)
   */
  async _resetConnection() {
    if (this.ws) {
      try {
        this.ws.terminate();
      } catch (e) {
        // Ignore
      }
    }
    this.isConnected = false;
    this.ws = null;
  }

  /**
   * Disconnect from Rime
   */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.isConnected = false;
    }
  }

  /**
   * Get the current Rime configuration for documentation
   */
  getConfig() {
    return {
      modelId: this.modelId,
      speaker: this.speaker,
      language: this.language,
      audioFormat: this.audioFormat,
      endpoint: this.endpoint,
      speedAlpha: this.speedAlpha,
      transport: 'WebSocket (ws3)',
    };
  }
}

RimeClient.LANGUAGE_PROFILES = LANGUAGE_PROFILES;
module.exports = RimeClient;
