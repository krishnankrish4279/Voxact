/**
 * VoxAct — Latency Tracker
 * Measures and logs performance metrics across the voice pipeline.
 * All timestamps are high-resolution (process.hrtime.bigint or performance.now).
 */

class LatencyTracker {
  constructor() {
    this.sessions = new Map();
  }

  /**
   * Start a new tracking session for a conversation turn
   */
  startSession(sessionId, generationId) {
    const session = {
      generationId,
      startTime: Date.now(),
      hrStart: process.hrtime.bigint(),
      events: [],
      metrics: {}
    };
    this.sessions.set(sessionId + ':' + generationId, session);
    return session;
  }

  /**
   * Record a named event with high-resolution timestamp
   */
  recordEvent(sessionId, generationId, eventName, metadata = {}) {
    const key = sessionId + ':' + generationId;
    const session = this.sessions.get(key);
    if (!session) return;

    const elapsed = Number(process.hrtime.bigint() - session.hrStart) / 1e6; // ms
    session.events.push({
      name: eventName,
      timestamp: Date.now(),
      elapsedMs: Math.round(elapsed * 100) / 100,
      ...metadata
    });
  }

  /**
   * Calculate all derived metrics for a session
   */
  calculateMetrics(sessionId, generationId) {
    const key = sessionId + ':' + generationId;
    const session = this.sessions.get(key);
    if (!session) return null;

    const events = session.events;
    const findEvent = (name) => events.find(e => e.name === name);

    const userSpeechEnd = findEvent('user_speech_end');
    const llmStart = findEvent('llm_request_start');
    const llmFirstToken = findEvent('llm_first_token');
    const llmComplete = findEvent('llm_complete');
    const toolDispatch = findEvent('tool_dispatch');
    const toolComplete = findEvent('tool_complete');
    const fillerDispatched = findEvent('filler_dispatched');
    const rimeFirstByte = findEvent('rime_first_byte');
    const rimeComplete = findEvent('rime_complete');
    const fillerRimeFirstByte = findEvent('filler_rime_first_byte');
    const interrupted = findEvent('interrupted');

    const metrics = {};

    // E2E: end of user speech → first audible response (filler or direct response)
    const firstAudible = fillerRimeFirstByte && (!rimeFirstByte || fillerRimeFirstByte.elapsedMs < rimeFirstByte.elapsedMs)
      ? fillerRimeFirstByte
      : rimeFirstByte;

    if (userSpeechEnd && firstAudible) {
      metrics.e2eLatencyMs = Math.round((firstAudible.elapsedMs - userSpeechEnd.elapsedMs) * 100) / 100;
    }

    // LLM response time
    if (llmStart && llmFirstToken) {
      metrics.llmFirstTokenMs = Math.round((llmFirstToken.elapsedMs - llmStart.elapsedMs) * 100) / 100;
    }
    if (llmStart && llmComplete) {
      metrics.llmTotalMs = Math.round((llmComplete.elapsedMs - llmStart.elapsedMs) * 100) / 100;
    }

    // Tool execution time
    if (toolDispatch && toolComplete) {
      metrics.toolExecutionMs = Math.round((toolComplete.elapsedMs - toolDispatch.elapsedMs) * 100) / 100;
    }

    // Filler insertion latency (critical metric)
    // Time from tool dispatch to first filler audio byte arriving
    if (toolDispatch && fillerRimeFirstByte) {
      metrics.fillerInsertionMs = Math.round((fillerRimeFirstByte.elapsedMs - toolDispatch.elapsedMs) * 100) / 100;
    }

    // Filler dispatch latency (how fast we decided to send filler)
    if (toolDispatch && fillerDispatched) {
      metrics.fillerDispatchMs = Math.round((fillerDispatched.elapsedMs - toolDispatch.elapsedMs) * 100) / 100;
    }

    // Rime TTFB / First Chunk
    if (rimeFirstByte) {
      const rimeRequest = findEvent('rime_request_start');
      if (rimeRequest) {
        metrics.rimeTTFBMs = Math.round((rimeFirstByte.elapsedMs - rimeRequest.elapsedMs) * 100) / 100;
        metrics.rimeFirstChunkMs = metrics.rimeTTFBMs;
      }
    }

    const clientSent = findEvent('client_audio_sent');
    if (clientSent) {
      const rimeRequest = findEvent('rime_request_start');
      if (rimeRequest) {
        metrics.clientChunkSentMs = Math.round((clientSent.elapsedMs - rimeRequest.elapsedMs) * 100) / 100;
      }
    }

    const browserPlayback = findEvent('browser_playback_start');
    if (browserPlayback) {
      const rimeRequest = findEvent('rime_request_start');
      if (rimeRequest) {
        metrics.browserPlaybackLatencyMs = Math.round((browserPlayback.elapsedMs - rimeRequest.elapsedMs) * 100) / 100;
      }
    }

    if (rimeComplete) {
      const rimeRequest = findEvent('rime_request_start');
      if (rimeRequest) {
        metrics.totalSynthesisMs = Math.round((rimeComplete.elapsedMs - rimeRequest.elapsedMs) * 100) / 100;
      }
    }

    // Interruption response time
    if (interrupted) {
      const audioStop = findEvent('audio_stopped');
      if (interrupted.data?.clientHaltMs !== undefined && interrupted.data?.clientHaltMs !== null) {
        metrics.clientHaltMs = Math.round(interrupted.data.clientHaltMs * 100) / 100;
      }
      if (audioStop) {
        metrics.interruptionResponseMs = Math.round((audioStop.elapsedMs - interrupted.elapsedMs) * 100) / 100;
      }
    }

    // Was this generation stale-fenced?
    metrics.wasFenced = !!findEvent('stale_fenced');
    metrics.isStaleFenced = metrics.wasFenced;

    session.metrics = metrics;
    return metrics;
  }

  /**
   * Get a summary of all sessions for evidence reporting
   */
  getSummary() {
    const summaries = [];
    for (const [key, session] of this.sessions) {
      const parts = key.split(':');
      const sessId = parts[0];
      const genId = parts[1];
      const computed = this.calculateMetrics(sessId, genId) || session.metrics;

      summaries.push({
        key,
        generationId: session.generationId,
        startTime: new Date(session.startTime).toISOString(),
        eventCount: session.events.length,
        metrics: computed,
        events: session.events
      });
    }
    return summaries;
  }

  /**
   * Get the latest N sessions
   */
  getLatest(n = 5) {
    const all = this.getSummary();
    return all.slice(-n);
  }

  /**
   * Clean up old sessions (keep last 50)
   */
  cleanup() {
    const keys = Array.from(this.sessions.keys());
    if (keys.length > 50) {
      const toRemove = keys.slice(0, keys.length - 50);
      toRemove.forEach(k => this.sessions.delete(k));
    }
  }
}

module.exports = LatencyTracker;
