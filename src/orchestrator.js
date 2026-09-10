/**
 * VoxAct — Conversation Orchestrator
 * 
 * The core innovation: Manages conversation state, tool execution with filler speech,
 * interruption handling, and stale-result fencing to ensure conversation continuity
 * during tool work.
 * 
 * State Machine:
 *   idle → listening → processing → (speaking | tool_work) → listening
 * 
 * Key mechanisms:
 *   1. Generation IDs: Every LLM request gets a unique ID. Interruptions invalidate
 *      the current ID, causing stale results to be discarded.
 *   2. Filler Speech: When tools dispatch, contextual filler is immediately sent to
 *      Rime TTS so the user never hears silence.
 *   3. Interruption Handling: User speech during speaking/tool_work triggers immediate
 *      audio stop, generation invalidation, and context preservation.
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const RimeClient = require('./rime-client');
const LLMClient = require('./llm-client');
const FillerManager = require('./filler-manager');
const LatencyTracker = require('./latency-tracker');
const { normalizeMedicalSpeech } = require('./medical-transcriber');
const { TOOL_FUNCTIONS } = require('./tools');
const { classifyUserIntent, INTENTS, isWaitInterruption, stripControlPrefix, normalizeConversationalControl } = require('./intent-router');

// States
const STATE = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  TOOL_WORK: 'tool_work',
};

class Orchestrator extends EventEmitter {
  constructor(sessionId, sendToClient, options = {}) {
    super();

    // Support both new Orchestrator('sess-1', sendFn, opts) and new Orchestrator({ sessionId: 'sess-1', ... })
    if (typeof sessionId === 'object' && sessionId !== null) {
      options = sessionId;
      sessionId = options.sessionId;
      sendToClient = options.sendToClient;
    }

    this.sessionId = sessionId || uuidv4().slice(0, 8);
    const rawSend = typeof sendToClient === 'function' ? sendToClient : () => {};
    this.sendToClient = (msg) => {
      try {
        if (msg && msg.type) {
          this.emit(msg.type, msg);
        }
        this.emit('message', msg);
      } catch (e) {}
      return rawSend(msg);
    };

    // Language and location state
    this.language = options.language || 'en';
    this.sessionLocation = options.location || null;

    // Core components
    this.rime = new RimeClient({ language: this.language });
    this.llm = new LLMClient({ language: this.language });
    this.filler = new FillerManager(this.language);
    this.latency = new LatencyTracker();

    // State management
    this.state = STATE.IDLE;
    this.currentGenerationId = null;
    this.activeAbortController = null;
    this.spokenTextBuffer = ''; // Tracks what was actually spoken to the user
    this.pendingToolResults = new Map(); // generationId → results
    this.synthesisQueue = Promise.resolve();
    this.staleResultsFenced = 0;
    this.staleResultsSpoken = 0;

    this.pendingAction = options.pendingAction || null;
    this.nearbyCareStatus = options.nearbyCareStatus || 'not_requested';
    this.accumulatedSymptoms = options.accumulatedSymptoms ? [...options.accumulatedSymptoms] : [];
    this.latestFacilityResults = options.latestFacilityResults ? [...options.latestFacilityResults] : [];
    this.selectedFacility = options.selectedFacility || null;
    this.caseContext = options.caseContext || null;
    this.pendingQuestion = options.pendingQuestion || null;
    this.answeredQuestions = options.answeredQuestions ? new Set(options.answeredQuestions) : new Set();
    this.collectedSymptoms = options.collectedSymptoms || {};

    // Initialize conversation
    this.llm.initConversation();
    this.llm.accumulatedSymptoms = this.accumulatedSymptoms;
    this.llm.latestFacilityResults = this.latestFacilityResults;
    this.llm.selectedFacility = this.selectedFacility;
    this.llm.caseContext = this.caseContext;
    this.llm.pendingQuestion = this.pendingQuestion;
    this.llm.answeredQuestions = this.answeredQuestions;
    this.llm.collectedSymptoms = this.collectedSymptoms;

    console.log(`[Orchestrator:${this.sessionId}] Created (language: ${this.language})`);
  }

  /**
   * Dynamically switch conversation language without reloading page
   * @param {string} langCode - 'en', 'ta', or 'hi'
   */
  setLanguage(langCode) {
    const code = (langCode || 'en').toLowerCase();
    if (code === 'en' || code === 'ta' || code === 'hi') {
      this.language = code;
      this.rime.setLanguage(code);
      this.filler.setLanguage(code);
      this.llm.setLanguage(code);
      console.log(`[Orchestrator:${this.sessionId}] Switched language to ${code}`);
      this.sendToClient({
        type: 'language_changed',
        language: code,
        rimeConfig: this.rime.getConfig(),
      });
    }
  }

  get fillerManager() {
    return this.filler;
  }

  set fillerManager(fm) {
    this.filler = fm;
  }

  handleInterruption(text) {
    return this._handleInterruption(text);
  }

  /**
   * Set user coordinates / location for care navigation
   * @param {object} loc - { lat, lon, city }
   */
  setLocation(loc) {
    if (loc && typeof loc === 'object') {
      const lat = Number(loc.lat);
      const rawLon = loc.lon !== undefined ? loc.lon : loc.lng;
      const lon = Number(rawLon);
      this.sessionLocation = {
        lat: !isNaN(lat) ? lat : (this.sessionLocation?.lat ?? null),
        lon: !isNaN(lon) ? lon : (this.sessionLocation?.lon ?? null),
        city: loc.city || loc.locationName || (this.sessionLocation?.city ?? 'Current Location'),
        accuracy: loc.accuracy !== undefined ? loc.accuracy : null,
        timestamp: loc.timestamp || Date.now(),
      };
      if (this.llm) {
        this.llm.location = this.sessionLocation;
      }
      console.log(`[Orchestrator:${this.sessionId}] Updated location to:`, this.sessionLocation);
    }
  }

  /**
   * Transition to a new state and notify the client
   */
  _setState(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[Orchestrator:${this.sessionId}] ${oldState} → ${newState}`);
    this.sendToClient({
      type: 'state_change',
      state: newState,
      previousState: oldState,
    });
  }

  /**
   * Create a new generation ID and abort controller
   * Returns the generation ID
   */
  _newGeneration(customGenId = null) {
    // Abort any existing work
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    const genId = customGenId || uuidv4().slice(0, 8);
    this.currentGenerationId = genId;
    this.activeAbortController = new AbortController();
    this.spokenTextBuffer = '';
    this.seenSegments = new Set();
    this.pipelineQueue = [];
    this.isDrainingPipeline = false;
    this.responseTurnCounter = 0;
    this.segmentCounter = 0;
    this.rimeWsBusy = false;

    console.log(`[Orchestrator:${this.sessionId}] New generation: ${genId}`);
    return genId;
  }

  /**
   * Normalize segment text for accurate duplicate detection
   */
  _normalizeSegment(text) {
    return String(text || '').trim().toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’।]/g, '');
  }

  /**
   * Queue sentence for pipelined synthesis with deduplication and seamless playback
   */
  _queueSynthesis(text, genId, signal, meta = {}) {
    if (!this._isCurrentGeneration(genId) || signal?.aborted) return;
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    const responseId = meta.responseId || `resp_${genId}_${this.responseTurnCounter || 0}`;
    this.segmentCounter = (this.segmentCounter || 0) + 1;
    const segmentIndex = this.segmentCounter;
    const segmentId = meta.segmentId || `seg_${segmentIndex}`;
    const isFirst = (segmentIndex === 1);

    if (!this.seenSegments) this.seenSegments = new Set();
    const segmentKey = `${genId}:${responseId}:${segmentId}`;
    const normKey = `${genId}:${this._normalizeSegment(cleanText)}`;
    if (this.seenSegments.has(segmentKey) || this.seenSegments.has(normKey)) {
      console.log(`[Orchestrator:${this.sessionId}] Duplicate segment suppressed: "${cleanText}" (${segmentKey})`);
      return;
    }
    this.seenSegments.add(segmentKey);
    this.seenSegments.add(normKey);

    console.log(`[VOICE] RIME_START text="${cleanText}" (genId: ${genId})`);

    // Sentence-level pipelining: start background synthesis immediately without waiting for sentence 1 playback
    const audioPromise = this._synthesizeSegmentSafe(cleanText, genId, segmentId, responseId, signal);

    if (!this.pipelineQueue) this.pipelineQueue = [];
    this.pipelineQueue.push({
      text: cleanText,
      genId,
      segmentId,
      responseId,
      isFirst,
      signal,
      audioPromise,
    });

    this._drainPipeline();
  }

  /**
   * Drain pipeline queue in FIFO order to dispatch complete prepared audio sentences to client
   */
  async _drainPipeline() {
    if (this.isDrainingPipeline) return;
    this.isDrainingPipeline = true;

    try {
      while (this.pipelineQueue && this.pipelineQueue.length > 0) {
        const item = this.pipelineQueue[0];
        if (!this._isCurrentGeneration(item.genId) || item.signal?.aborted) {
          this.pipelineQueue.shift();
          continue;
        }

        const res = await item.audioPromise;
        this.pipelineQueue.shift();

        if (!this._isCurrentGeneration(item.genId) || item.signal?.aborted || !res) {
          continue;
        }

        this._setState(STATE.SPEAKING);

        if (res.isSimulated) {
          this.spokenTextBuffer += item.text + ' ';
          this.sendToClient({
            type: 'fallback_text',
            text: item.text,
            generationId: item.genId,
            responseId: item.responseId,
            segmentId: item.segmentId,
            speakBrowser: true,
          });
        } else if (res.audioBase64) {
          const audioSent = Date.now();
          this.spokenTextBuffer += item.text + ' ';
          this.latency.recordEvent(this.sessionId, item.genId, 'client_audio_sent', {
            segmentId: item.segmentId,
            responseId: item.responseId,
            isFirst: item.isFirst,
            isLast: true,
          });

          console.log(`[VOICE] RIME_AUDIO_READY text="${item.text}" format="${this.rime.audioFormat || 'mp3'}" ttfbMs=${res.ttfbMs || 0}`);

          this.sendToClient({
            type: 'audio',
            data: res.audioBase64,
            format: this.rime.audioFormat || 'mp3',
            text: item.text,
            generationId: item.genId,
            responseId: item.responseId,
            segmentId: item.segmentId,
            chunkIndex: 1,
            isFirst: item.isFirst,
            isLast: true,
            ttfbMs: res.ttfbMs || null,
            synthesisStart: res.synthesisStart || null,
            synthesisComplete: res.synthesisComplete || null,
            audioSent,
          });
        }
      }
    } catch (err) {
      console.error(`[Orchestrator:${this.sessionId}] Pipeline drain error:`, err.message);
    } finally {
      this.isDrainingPipeline = false;
    }
  }

  /**
   * Called when client begins audible browser playback
   */
  handlePlaybackStart(generationId, metadata = {}) {
    if (this._isCurrentGeneration(generationId)) {
      this.latency.recordEvent(this.sessionId, generationId, 'browser_playback_start', metadata);
      console.log(`[Orchestrator:${this.sessionId}] Browser playback started for gen:${generationId}`);
    }
  }

  /**
   * Called when client has finished audible playback
   */
  handlePlaybackComplete(generationId) {
    if (this._isCurrentGeneration(generationId) && (this.state === STATE.SPEAKING || this.state === STATE.TOOL_WORK)) {
      this.latency.calculateMetrics(this.sessionId, generationId);
      this._setState(STATE.LISTENING);
    }
  }

  /**
   * Check if a generation ID is still current (not stale)
   */
  _isCurrentGeneration(genId) {
    return genId === this.currentGenerationId;
  }

  /**
   * Handle incoming user speech (transcription from client)
   */
  async handleUserSpeech(textOrPayload) {
    let rawText = '';
    let clientNormalized = null;
    let clientTerms = null;

    let clientGenId = null;

    if (typeof textOrPayload === 'object' && textOrPayload !== null) {
      rawText = (textOrPayload.rawTranscript || textOrPayload.text || '').trim();
      clientNormalized = textOrPayload.normalizedTranscript;
      clientTerms = textOrPayload.medicalTerms;
      clientGenId = textOrPayload.generationId || null;
      if (textOrPayload.location) {
        this.setLocation(textOrPayload.location);
      }
    } else {
      rawText = String(textOrPayload || '').trim();
    }

    if (!rawText || rawText.length === 0) return;

    // Clinical speech normalization layer
    const normalizedData = normalizeMedicalSpeech(rawText, this.language);
    const rawTranscript = normalizedData.rawTranscript;
    const normalizedTranscript = clientNormalized || normalizedData.normalizedTranscript;
    const detectedMedicalTerms = clientTerms || normalizedData.detectedMedicalTerms;
    const isAmbiguous = normalizedData.isAmbiguous;
    const clarificationPrompt = normalizedData.clarificationPrompt;

    console.log(`[ORCHESTRATOR] START text="${rawTranscript}"`);
    console.log(`[Orchestrator:${this.sessionId}] User said: raw="${rawTranscript}" | normalized="${normalizedTranscript}" (terms: ${detectedMedicalTerms.length})`);

    // Contextual normalization of conversational control phrases (e.g. "ஒரு" -> "பொரு" if speaking/waiting)
    const normalizedControl = normalizeConversationalControl(rawTranscript, {
      assistantSpeaking: this.state === STATE.SPEAKING || this.state === STATE.TOOL_WORK,
      pendingQuestion: this.pendingQuestion,
      lastAssistantMsg: this.spokenTextBuffer
    });

    const isHoldStandalone = isWaitInterruption(normalizedControl) || isWaitInterruption(normalizedTranscript);

    // If currently speaking or doing tool work, this is an interruption
    if (this.state === STATE.SPEAKING || this.state === STATE.TOOL_WORK) {
      await this._handleInterruption(normalizedControl || normalizedTranscript, { rawTranscript, normalizedTranscript, detectedMedicalTerms, generationId: clientGenId });
      return;
    }

    // If a standalone hold/wait command is received while already in LISTENING state, do NOT dispatch to LLM
    if (isHoldStandalone) {
      console.log(`[Orchestrator:${this.sessionId}] Standalone hold/wait command received ("${normalizedControl || normalizedTranscript}"), awaiting user continuation without LLM call`);
      this._setState(STATE.LISTENING);
      return;
    }

    // Strip leading conversational control prefix if user started with hold word then continued
    const cleanedText = stripControlPrefix(normalizedControl || normalizedTranscript);
    const textToProcess = cleanedText || normalizedTranscript;

    // Safety guard: ambiguous utterances must prompt for clarification rather than assuming severe diagnoses
    if (isAmbiguous && clarificationPrompt && detectedMedicalTerms.length === 0) {
      const clarifyGenId = this._newGeneration(clientGenId);
      this.llm.addUserMessage(rawTranscript);
      this.llm.addAssistantMessage(clarificationPrompt);
      this.sendToClient({
        type: 'transcript',
        role: 'user',
        text: rawTranscript,
        rawTranscript,
        normalizedTranscript,
        isAmbiguous: true,
      });
      this.sendToClient({
        type: 'transcript',
        role: 'assistant',
        text: clarificationPrompt,
        generationId: clarifyGenId,
      });
      await this._synthesizeAndPlay(clarificationPrompt, clarifyGenId, this.activeAbortController.signal);
      this._setState(STATE.LISTENING);
      return;
    }

    // Normal flow: user finished speaking
    await this._processUserInput(textToProcess, { rawTranscript, normalizedTranscript, detectedMedicalTerms }, clientGenId);
  }

  /**
   * Immediately abort current active generation upon user speaking (instant cut-off)
   */
  abortCurrentGeneration(clientHaltMs = null) {
    const interruptedGenId = this.currentGenerationId;
    console.log(`[Orchestrator:${this.sessionId}] INTERRUPT_START: immediately invalidating gen:${interruptedGenId} (client halt: ${clientHaltMs}ms)`);

    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    this.sendToClient({ type: 'stop_audio' });
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'audio_stopped');
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'interrupted', { clientHaltMs });
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'stale_fenced');

    if (this.spokenTextBuffer) {
      this.llm.truncateLastAssistant(this.spokenTextBuffer);
    }

    this.currentGenerationId = null;
    this._setState(STATE.LISTENING);
  }

  /**
   * Handle an interruption: user spoke while we were speaking or working
   */
  async _handleInterruption(newText, meta = {}) {
    const interruptedGenId = this.currentGenerationId;
    console.log(`[Orchestrator:${this.sessionId}] INTERRUPTION detected during ${this.state}, invalidating gen:${interruptedGenId}`);

    // 1. Record the interruption event
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'interrupted');

    // 2. Abort all current work (LLM, tools, Rime synthesis)
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }

    // 3. Tell the client to stop audio immediately
    this.sendToClient({ type: 'stop_audio' });
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'audio_stopped');

    // 4. Update conversation history to reflect what was actually heard
    if (this.spokenTextBuffer) {
      this.llm.truncateLastAssistant(this.spokenTextBuffer);
    }

    // 5. Mark stale results
    this.latency.recordEvent(this.sessionId, interruptedGenId, 'stale_fenced');
    this.latency.calculateMetrics(this.sessionId, interruptedGenId);

    // 6. Check for quick pause/hold commands (English "wait", Tamil "பொரு" / "பொறு", Hindi "रुको")
    const isHold = isWaitInterruption(newText);

    if (isHold) {
      console.log(`[Orchestrator:${this.sessionId}] Pure hold command ("${newText}") during interruption: halting audio and entering quiet wait without LLM call or assistant response`);
      this.currentGenerationId = null;
      this._setState(STATE.LISTENING);
      return;
    }

    // Strip leading conversational hold / control prefix before medical processing if followed by substantive speech
    const cleanedText = stripControlPrefix(newText);
    const textToProcess = cleanedText || newText;

    // 7. Process the new input with a fresh generation
    await this._processUserInput(textToProcess, meta, meta.generationId || null);
  }

  /**
   * Process user input: send to LLM, handle response (text or tool calls)
   */
  async _processUserInput(text, meta = {}, clientGenId = null) {
    const genId = this._newGeneration(clientGenId);
    const signal = this.activeAbortController.signal;

    this.lastUserSpeech = text;
    console.log(`[VOICE] ANALYSIS_START text="${text}"`);

    this._setState(STATE.PROCESSING);
    this.latency.startSession(this.sessionId, genId);
    this.latency.recordEvent(this.sessionId, genId, 'user_speech_end');

    // Add user message to conversation history
    this.llm.addUserMessage(text);
    this.sendToClient({
      type: 'transcript',
      role: 'user',
      text,
      rawTranscript: meta.rawTranscript || text,
      normalizedTranscript: meta.normalizedTranscript || text,
      medicalTerms: meta.detectedMedicalTerms || [],
    });

    // Classify user intent
    const previousAssistantMsg = [...this.llm.conversationHistory].reverse().find(m => m.role === 'assistant' && m.content)?.content || '';
    const { intent } = classifyUserIntent(text, {
      previousAssistantMsg,
      pendingAction: this.llm.pendingAction,
      nearbyCareStatus: this.nearbyCareStatus,
    });

    if (intent === INTENTS.WAIT_INTERRUPTION) {
      let ack = "I'm listening, take your time.";
      if (this.language === 'ta') {
        ack = "நான் கேட்கிறேன், பொறுமையாக சொல்லுங்கள்.";
      } else if (this.language === 'hi') {
        ack = "मैं सुन रहा हूँ, आराम से बताइए.";
      }
      this.llm.addAssistantMessage(ack);
      this.sendToClient({ type: 'transcript', role: 'assistant', text: ack, generationId: genId });
      await this._synthesizeAndPlay(ack, genId, signal);
      this._setState(STATE.LISTENING);
      return;
    }

    // Proactively extract and evaluate symptoms to update Live Clinical Assessment Card immediately,
    // but ONLY when the intent is symptom_information, symptom_triage, or emergency, and NOT for fever alone,
    // medicine requests, self-care requests, or facility declines/accepts.
    const isSymptomIntent = intent === INTENTS.SYMPTOM_INFORMATION || intent === INTENTS.SYMPTOM_TRIAGE || intent === INTENTS.EMERGENCY;
    if (isSymptomIntent) {
      const currentSymptoms = this._extractSymptoms(text);
      for (const s of currentSymptoms) {
        if (!this.accumulatedSymptoms.includes(s)) {
          this.accumulatedSymptoms.push(s);
        }
      }
      this.llm.accumulatedSymptoms = this.accumulatedSymptoms;
    }
    const detected = isSymptomIntent ? [...this.accumulatedSymptoms] : [];
    const isOnlyFever = detected.length === 1 && (
      detected[0].toLowerCase() === 'fever' ||
      detected[0] === 'காய்ச்சல்' ||
      detected[0] === 'புखार' ||
      detected[0] === 'बुखार'
    );

    if (detected.length > 0 && !isOnlyFever) {
      (async () => {
        try {
          const analysis = await TOOL_FUNCTIONS['analyzeSymptoms'](detected, signal);
          if (!this._isCurrentGeneration(genId)) return;
          const urgency = await TOOL_FUNCTIONS['calculateUrgency'](analysis, signal);
          const clinics = await TOOL_FUNCTIONS['findNearestClinics'](urgency.urgencyLevel, signal);
          let careNav = null;
          if (this.nearbyCareStatus === 'accepted') {
            try {
              careNav = await TOOL_FUNCTIONS['findNearbyCareFacilities']({
                urgencyLevel: urgency.urgencyLevel,
                lat: this.sessionLocation?.lat ?? null,
                lon: this.sessionLocation?.lon ?? null,
                locationName: this.sessionLocation?.city ?? 'Current Location',
                language: this.language,
                allowFallback: false,
              }, signal);
            } catch (e) {}
          }

          this.sendToClient({
            type: 'triage_update',
            toolName: 'clinical_bundle',
            data: {
              symptoms: detected,
              possibleConditions: analysis.possibleConditions,
              urgency,
              clinics: clinics.clinics,
              careNavigation: careNav?.facilities ? careNav : null,
            },
            generationId: genId,
          });
        } catch (e) {
          // ignore aborted or background errors
        }
      })();
    } else if (isOnlyFever) {
      this.sendToClient({
        type: 'triage_update',
        toolName: 'clinical_bundle',
        data: {
          symptoms: ['fever'],
          possibleConditions: [],
          isOnlyFever: true,
          urgency: { urgencyLevel: 'low', reason: 'Fever reported alone, awaiting clarifying details' },
          clinics: [],
          careNavigation: null,
        },
        generationId: genId,
      });
    }

    // Stream LLM completion
    this.latency.recordEvent(this.sessionId, genId, 'llm_request_start');

    let textBuffer = '';
    let sentenceBuffer = '';
    let firstTokenSent = false;

    const responseId = `resp_${genId}_${++this.responseTurnCounter}`;
    let segmentIndex = 0;

    console.log(`[LLM] REQUEST text="${text}"`);
    try {
      const result = await this.llm.streamCompletion(
        signal,
        // onTextChunk
        (chunk) => {
          if (!this._isCurrentGeneration(genId)) return;

          if (!firstTokenSent) {
            this.latency.recordEvent(this.sessionId, genId, 'llm_first_token');
            firstTokenSent = true;
          }

          textBuffer += chunk;
          sentenceBuffer += chunk;

          // Send text to client for visual display
          this.sendToClient({ type: 'transcript_chunk', role: 'assistant', text: chunk, generationId: genId });

          // When we have a complete sentence, synthesize it
          let sentenceEnd = this._findSentenceEnd(sentenceBuffer);
          while (sentenceEnd > -1) {
            const sentence = sentenceBuffer.slice(0, sentenceEnd + 1).trim();
            sentenceBuffer = sentenceBuffer.slice(sentenceEnd + 1);

            if (sentence.length > 0) {
              this._queueSynthesis(sentence, genId, signal, { responseId, segmentId: `seg_${++segmentIndex}` });
            }
            sentenceEnd = this._findSentenceEnd(sentenceBuffer);
          }
        },
        // onToolCall
        async (toolName, args, toolCallId) => {
          if (!this._isCurrentGeneration(genId)) return;
          await this._handleToolCall(toolName, args, toolCallId, genId, signal);
        }
      );

      if (!this._isCurrentGeneration(genId)) return;

      if (this.llm.pendingAction !== this.pendingAction) {
        this.pendingAction = this.llm.pendingAction;
        this.sendToClient({
          type: 'pending_action_change',
          pendingAction: this.pendingAction,
        });
      }

      if (this.llm.nearbyCareStatus !== this.nearbyCareStatus) {
        this.nearbyCareStatus = this.llm.nearbyCareStatus;
        this.sendToClient({
          type: 'nearby_care_status_change',
          nearbyCareStatus: this.nearbyCareStatus,
        });
      }

      this.latency.recordEvent(this.sessionId, genId, 'llm_complete');

      if (textBuffer.trim().length > 0) {
        const fullAssistantText = textBuffer.trim();
        console.log(`[LLM] RESPONSE text="${fullAssistantText}"`);
        console.log(`[SERVER] ASSISTANT_RESPONSE text="${fullAssistantText}"`);
        console.log(`[VOICE] ASSISTANT_RESPONSE text="${fullAssistantText}"`);
        console.log(`[VOICE] ANALYSIS_END text="${text}"`);

        // Send full assistant response event to client for guaranteed UI render and turn completion
        this.sendToClient({
          type: 'assistant_response',
          role: 'assistant',
          text: fullAssistantText,
          generationId: genId,
        });
        this.sendToClient({
          type: 'transcript',
          role: 'assistant',
          text: fullAssistantText,
          generationId: genId,
        });
      }

      // Synthesize any remaining text in the buffer
      if (sentenceBuffer.trim().length > 0) {
        this._queueSynthesis(sentenceBuffer.trim(), genId, signal, { responseId, segmentId: `seg_${++segmentIndex}` });
        sentenceBuffer = '';
      }

      // If no tool calls, wait for playback complete or fallback timeout
      if (!result.toolCalls || result.toolCalls.length === 0) {
        setTimeout(() => {
          if (this._isCurrentGeneration(genId) && this.state === STATE.SPEAKING) {
            this.latency.calculateMetrics(this.sessionId, genId);
            this._setState(STATE.LISTENING);
          }
        }, 12000);
      }
    } catch (err) {
      if (signal.aborted) return;
      console.error(`[Orchestrator:${this.sessionId}] LLM error:`, err.message);
      // Speak an error message
      await this._synthesizeAndPlay(
        "I'm sorry, I had a bit of trouble there. Could you try saying that again?",
        genId, signal
      );
      this._setState(STATE.LISTENING);
    }
  }

  /**
   * Handle a tool call from the LLM
   * This is where conversation continuity magic happens:
   * 1. Immediately dispatch filler speech
   * 2. Run the tool in background
   * 3. When tool completes, check if generation is still current
   * 4. If current, send results back to LLM for spoken summary
   */
  async _handleToolCall(toolName, args, toolCallId, genId, signal) {
    console.log(`[Orchestrator:${this.sessionId}] Tool call: ${toolName}`, args);

    this._setState(STATE.TOOL_WORK);
    this.latency.recordEvent(this.sessionId, genId, 'tool_dispatch', { toolName });

    // 1. IMMEDIATELY send filler speech to avoid dead air
    const context = {
      userDistress: this._detectDistress(),
      language: this.language,
    };
    const fillerText = this.filler.getFiller(toolName, context);
    this.latency.recordEvent(this.sessionId, genId, 'filler_dispatched', { fillerText });

    const sessionData = this.latency.sessions.get(this.sessionId + ':' + genId);
    const dispatchEvt = sessionData?.events?.find(e => e.name === 'tool_dispatch');
    const fillerEvt = sessionData?.events?.find(e => e.name === 'filler_dispatched');
    const dispatchMs = (dispatchEvt && fillerEvt) ? Math.max(0.1, fillerEvt.elapsedMs - dispatchEvt.elapsedMs) : null;

    // Send filler event to client for jury telemetry display
    this.sendToClient({
      type: 'filler_event',
      text: fillerText,
      toolName,
      dispatchMs: dispatchMs ? Math.round(dispatchMs * 100) / 100 : null,
      generationId: genId,
    });

    // Synthesize filler via HTTP (faster for short phrases)
    this._synthesizeFiller(fillerText, genId, signal);

    // 2. Execute the tool
    try {
      const toolFn = TOOL_FUNCTIONS[toolName];
      if (!toolFn) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      // Prepare arguments based on tool name
      let toolResult;
      if (toolName === 'analyzeSymptoms') {
        toolResult = await toolFn(args?.symptoms || args, signal);
      } else if (toolName === 'calculateUrgency') {
        toolResult = await toolFn(args?.analysisResult || args, signal);
      } else if (toolName === 'findNearestClinics') {
        toolResult = await toolFn(args?.urgencyLevel || args?.urgency || 'medium', signal);
      } else if (toolName === 'findNearbyCareFacilities') {
        const facilityArgs = {
          ...args,
          lat: this.sessionLocation?.lat ?? null,
          lon: this.sessionLocation?.lon ?? null,
          locationName: this.sessionLocation?.city ?? 'Current Location',
          urgencyLevel: args?.urgencyLevel || 'medium',
          careType: args?.careType || null,
          language: this.language,
        };
        toolResult = await toolFn(facilityArgs, signal);
      } else if (toolName === 'checkAvailability') {
        toolResult = await toolFn(args?.clinicId || args?.clinic_id || 'clinic_001', signal);
      } else if (toolName === 'focusMap') {
        const fac = args?.facility || (this.latestFacilityResults && this.latestFacilityResults[args?.index || 0]);
        if (fac) {
          this.selectedFacility = fac;
          this.llm.selectedFacility = fac;
        }
        toolResult = await toolFn({ ...args, facility: fac }, signal);
      } else if (toolName === 'getDirections') {
        const fac = args?.facility || this.selectedFacility || (this.latestFacilityResults && this.latestFacilityResults[0]);
        if (fac) {
          this.selectedFacility = fac;
          this.llm.selectedFacility = fac;
        }
        toolResult = await toolFn({ ...args, facility: fac }, signal);
      }

      this.latency.recordEvent(this.sessionId, genId, 'tool_complete', { toolName });

      // Send live triage or care navigation update to client
      if (toolName === 'findNearbyCareFacilities') {
        if (toolResult && Array.isArray(toolResult.facilities)) {
          this.latestFacilityResults = toolResult.facilities;
          this.llm.latestFacilityResults = toolResult.facilities;
        }
        this.sendToClient({
          type: 'care_navigation_update',
          toolName: 'findNearbyCareFacilities',
          data: toolResult,
          generationId: genId,
        });
      } else if (toolName === 'focusMap') {
        const fac = toolResult.facility || this.selectedFacility;
        this.sendToClient({
          type: 'map_focus',
          facility: fac,
          index: args?.index ?? 0,
          lat: toolResult.lat ?? fac?.lat,
          lon: toolResult.lon ?? fac?.lon,
          zoom: toolResult.zoom ?? 15,
          generationId: genId,
        });
        this.sendToClient({
          type: 'facility_selected',
          facility: fac,
          index: args?.index ?? 0,
          generationId: genId,
        });
      } else if (toolName === 'getDirections') {
        const fac = toolResult.facility || this.selectedFacility;
        this.sendToClient({
          type: 'directions_open',
          facility: fac,
          mapsUrl: toolResult.mapsUrl,
          generationId: genId,
        });
      } else {
        this.sendToClient({
          type: 'triage_update',
          toolName,
          data: toolResult,
          generationId: genId,
        });
      }

      if (toolName === 'analyzeSymptoms') {
        // Run clinical bundle in background non-blocking so LLM follow-up streams immediately
        (async () => {
          try {
            const urgency = await TOOL_FUNCTIONS['calculateUrgency'](toolResult, signal);
            if (!this._isCurrentGeneration(genId) || signal?.aborted) return;
            const clinics = await TOOL_FUNCTIONS['findNearestClinics'](urgency.urgencyLevel, signal);
            if (!this._isCurrentGeneration(genId) || signal?.aborted) return;
            let careNav = null;
            try {
              careNav = await TOOL_FUNCTIONS['findNearbyCareFacilities']({
                urgencyLevel: urgency.urgencyLevel,
                lat: this.sessionLocation?.lat ?? null,
                lon: this.sessionLocation?.lon ?? null,
                locationName: this.sessionLocation?.city ?? 'Current Location',
                language: this.language,
              }, signal);
            } catch (e) {}

            if (!this._isCurrentGeneration(genId) || signal?.aborted) return;
            this.sendToClient({
              type: 'triage_update',
              toolName: 'clinical_bundle',
              data: {
                symptoms: toolResult.symptoms || args?.symptoms || [],
                possibleConditions: toolResult.possibleConditions,
                urgency,
                clinics: clinics.clinics,
                careNavigation: careNav?.facilities ? careNav : null,
              },
              generationId: genId,
            });
          } catch (e) {}
        })();
      }

      // 3. CHECK IF GENERATION IS STILL CURRENT (stale-result fence)
      if (!this._isCurrentGeneration(genId)) {
        console.log(`[Orchestrator:${this.sessionId}] Tool result for stale gen:${genId}, discarding`);
        this.staleResultsFenced++;
        this.latency.recordEvent(this.sessionId, genId, 'stale_fenced');
        return;
      }

      // 4. Add tool result to conversation and get LLM follow-up
      this.llm.addToolResult(toolCallId, toolName, toolResult);

      // Get the LLM to summarize the result in spoken language
      let followUpBuffer = '';
      let followUpSentenceBuffer = '';
      const followUpResponseId = `resp_${genId}_${++this.responseTurnCounter}`;
      let followUpSegIndex = 0;

      const followUpResult = await this.llm.streamFollowUp(
        signal,
        (chunk) => {
          if (!this._isCurrentGeneration(genId)) return;

          followUpBuffer += chunk;
          followUpSentenceBuffer += chunk;

          this.sendToClient({ type: 'transcript_chunk', role: 'assistant', text: chunk });

          let sentenceEnd = this._findSentenceEnd(followUpSentenceBuffer);
          while (sentenceEnd > -1) {
            const sentence = followUpSentenceBuffer.slice(0, sentenceEnd + 1).trim();
            followUpSentenceBuffer = followUpSentenceBuffer.slice(sentenceEnd + 1);

            if (sentence.length > 0) {
              this._queueSynthesis(sentence, genId, signal, {
                responseId: followUpResponseId,
                segmentId: `seg_${++followUpSegIndex}`,
              });
            }
            sentenceEnd = this._findSentenceEnd(followUpSentenceBuffer);
          }
        }
      );

      if (!this._isCurrentGeneration(genId)) return;

      if (this.llm.pendingAction !== this.pendingAction) {
        this.pendingAction = this.llm.pendingAction;
        this.sendToClient({
          type: 'pending_action_change',
          pendingAction: this.pendingAction,
        });
      }

      if (this.llm.nearbyCareStatus !== this.nearbyCareStatus) {
        this.nearbyCareStatus = this.llm.nearbyCareStatus;
        this.sendToClient({
          type: 'nearby_care_status_change',
          nearbyCareStatus: this.nearbyCareStatus,
        });
      }

      // Handle remaining text
      if (followUpSentenceBuffer.trim().length > 0) {
        this._queueSynthesis(followUpSentenceBuffer.trim(), genId, signal, {
          responseId: followUpResponseId,
          segmentId: `seg_${++followUpSegIndex}`,
        });
      }

      if (followUpBuffer.trim().length > 0) {
        const fullFollowUpText = followUpBuffer.trim();
        console.log(`[LLM] RESPONSE text="${fullFollowUpText}"`);
        console.log(`[SERVER] ASSISTANT_RESPONSE text="${fullFollowUpText}"`);
        console.log(`[VOICE] ASSISTANT_RESPONSE text="${fullFollowUpText}"`);
        console.log(`[VOICE] ANALYSIS_END text="${this.lastUserSpeech || ''}"`);
        this.sendToClient({
          type: 'assistant_response',
          role: 'assistant',
          text: fullFollowUpText,
          generationId: genId,
        });
        this.sendToClient({
          type: 'transcript',
          role: 'assistant',
          text: fullFollowUpText,
          generationId: genId,
        });
      }

      // Handle any additional tool calls from the follow-up
      if (followUpResult.toolCalls && followUpResult.toolCalls.length > 0) {
        for (const tc of followUpResult.toolCalls) {
          if (this._isCurrentGeneration(genId)) {
            await this._handleToolCall(tc.name, tc.arguments, tc.id, genId, signal);
          }
        }
        return;
      }

      // Done with tool work, wait for playback complete or fallback timeout
      this.filler.nextTurn();
      setTimeout(() => {
        if (this._isCurrentGeneration(genId) && this.state === STATE.SPEAKING) {
          this.latency.calculateMetrics(this.sessionId, genId);
          this._setState(STATE.LISTENING);
        }
      }, 12000);

    } catch (err) {
      if (!this._isCurrentGeneration(genId)) {
        console.log(`[Orchestrator:${this.sessionId}] Tool execution cancelled/stale for gen:${genId}`);
        this.staleResultsFenced++;
        this.latency.recordEvent(this.sessionId, genId, 'stale_fenced');
        return;
      }
      if (signal?.aborted) return;
      console.error(`[Orchestrator:${this.sessionId}] Tool error:`, err.message);

      if (this._isCurrentGeneration(genId)) {
        await this._synthesizeAndPlay(
          "I ran into a small issue checking that. Let me try a different approach. Can you tell me more about what you're experiencing?",
          genId, signal
        );
        this._setState(STATE.LISTENING);
      }
    }
  }

  /**
   * Synthesize an isolated segment safely.
   * Uses WebSocket for the primary stream if available and free,
   * or concurrent HTTP for background pipeline prefetching without chunk intermingling.
   */
  async _synthesizeSegmentSafe(text, genId, segmentId, responseId, signal) {
    if (!this._isCurrentGeneration(genId) || signal?.aborted) return null;

    const useWs = Boolean(this.rime.useWebSocket && !this.rimeWsBusy && this.rime.isConfigured());
    const startTime = Date.now();
    let audioChunks = [];

    const collectAudio = (audioData) => {
      if (audioData) {
        audioChunks.push(audioData);
      }
    };

    try {
      let result;
      if (useWs) {
        this.rimeWsBusy = true;
        try {
          result = await this.rime.synthesize(text, collectAudio, signal);
        } catch (wsErr) {
          console.warn(`[Orchestrator:${this.sessionId}] WS synthesis failed, falling back to HTTP:`, wsErr.message);
          audioChunks = [];
          result = await this.rime.synthesizeHTTP(text, collectAudio, signal);
        } finally {
          this.rimeWsBusy = false;
        }
      } else {
        result = await this.rime.synthesizeHTTP(text, collectAudio, signal);
      }

      if (!this._isCurrentGeneration(genId) || signal?.aborted) return null;

      if (result?.isSimulated) {
        return { isSimulated: true, ttfbMs: 15 };
      }

      if (audioChunks.length === 0) {
        try {
          audioChunks = [];
          result = await this.rime.synthesizeHTTP(text, collectAudio, signal);
        } catch (httpFallbackErr) {
          console.warn(`[Orchestrator:${this.sessionId}] HTTP fallback failed:`, httpFallbackErr.message);
        }
      }

      if (audioChunks.length === 0) {
        console.warn(`[Orchestrator:${this.sessionId}] No audio chunks produced for segment ${segmentId}, falling back to browser speech`);
        return { isSimulated: true, fallback: true };
      }

      const fullBuffer = Buffer.concat(audioChunks.map(c => Buffer.from(c, 'base64')));
      const synthesisComplete = Date.now();
      return {
        audioBase64: fullBuffer.toString('base64'),
        ttfbMs: result.ttfbMs || (synthesisComplete - startTime),
        totalBytes: fullBuffer.length,
        synthesisStart: startTime,
        synthesisComplete,
      };
    } catch (err) {
      if (signal?.aborted || !this._isCurrentGeneration(genId)) return null;
      console.error(`[Orchestrator:${this.sessionId}] Synthesis failed for segment ${segmentId}:`, err.message);
      return { isSimulated: true, fallback: true };
    }
  }

  /**
   * Synthesize text with Rime and send audio to client
   */
  async _synthesizeAndPlay(text, genId, signal) {
    if (!this._isCurrentGeneration(genId) || signal?.aborted) return;

    this._setState(STATE.SPEAKING);
    this.latency.recordEvent(this.sessionId, genId, 'rime_request_start', { text });
    this.segmentCounter = (this.segmentCounter || 0) + 1;
    const segId = `direct_seg_${this.segmentCounter}`;

    const onAudio = (audioData, metadata = {}) => {
      if (!this._isCurrentGeneration(genId)) return;

      if (metadata.isFirst) {
        this.latency.recordEvent(this.sessionId, genId, 'rime_first_byte', { ttfbMs: metadata.ttfbMs });
        this.spokenTextBuffer += text + ' ';
      }

      this.latency.recordEvent(this.sessionId, genId, 'client_audio_sent', {
        chunkIndex: metadata.chunkIndex,
        isFirst: metadata.isFirst,
        isLast: metadata.isLast,
      });

      // Send audio chunk to client immediately
      this.sendToClient({
        type: 'audio',
        data: audioData,
        format: this.rime.audioFormat || 'mp3',
        text: text,
        generationId: genId,
        responseId: `direct_${genId}`,
        segmentId: segId,
        chunkIndex: metadata.chunkIndex,
        isFirst: metadata?.isFirst ?? false,
        isLast: metadata?.isLast ?? false,
        ttfbMs: metadata?.ttfbMs || null,
      });
    };

    try {
      let result;
      // Try WebSocket streaming first if configured, otherwise fallback to HTTP
      try {
        result = await this.rime.synthesize(text, onAudio, signal);
      } catch (wsErr) {
        result = await this.rime.synthesizeHTTP(text, onAudio, signal);
      }

      if (result?.isSimulated) {
        this.spokenTextBuffer += text + ' ';
        this.sendToClient({
          type: 'fallback_text',
          text: text,
          generationId: genId,
          speakBrowser: true,
        });
      } else if (result && !result.cancelled) {
        this.latency.recordEvent(this.sessionId, genId, 'rime_complete', {
          ttfbMs: result.ttfbMs,
          totalMs: result.totalMs,
        });
      }
    } catch (err) {
      if (signal?.aborted) return;
      console.error(`[Orchestrator:${this.sessionId}] Rime synthesis error:`, err.message);
      // Send text visually and speak via browser if cloud TTS is unavailable
      this.spokenTextBuffer += text + ' ';
      this.sendToClient({
        type: 'fallback_text',
        text: text,
        reason: 'tts_error',
        generationId: genId,
        speakBrowser: true,
      });
    }
  }

  /**
   * Synthesize filler speech (non-blocking, fire-and-forget)
   */
  async _synthesizeFiller(text, genId, signal) {
    const startTime = Date.now();
    try {
      const result = await this.rime.synthesizeHTTP(text, (audioData, metadata = {}) => {
        if (!this._isCurrentGeneration(genId)) return;

        if (metadata.isFirst) {
          this.latency.recordEvent(this.sessionId, genId, 'filler_rime_first_byte');
          this.spokenTextBuffer += text + ' ';
        }

        const audioSent = Date.now();
        this.sendToClient({
          type: 'audio',
          data: audioData,
          format: this.rime.audioFormat || 'mp3',
          text: text,
          generationId: genId,
          responseId: `filler_${genId}`,
          segmentId: 'seg_filler',
          chunkIndex: metadata.chunkIndex || 1,
          isFirst: metadata.isFirst ?? true,
          isLast: metadata.isLast ?? true,
          isFiller: true,
          synthesisStart: startTime,
          synthesisComplete: audioSent,
          audioSent,
        });
      }, signal);

      if (result?.isSimulated) {
        this.spokenTextBuffer += text + ' ';
        this.sendToClient({
          type: 'fallback_text',
          text: text,
          generationId: genId,
          isFiller: true,
          speakBrowser: true,
        });
      }
    } catch (err) {
      if (signal?.aborted) return;
      console.error(`[Orchestrator:${this.sessionId}] Filler synthesis error:`, err.message);
    }
  }

  /**
   * Find the end of a complete sentence or clause in the buffer
   * Looks for sentence-ending punctuation or clause boundaries for low TTFA
   */
  _findSentenceEnd(text) {
    const punctuation = [
      '. ', '! ', '? ', '.\n', '!\n', '?\n',
      '। ', '।\n',
      '.. ', '... ',
    ];
    let minIndex = -1;

    for (const p of punctuation) {
      const idx = text.indexOf(p);
      if (idx > -1 && (minIndex === -1 || idx < minIndex)) {
        minIndex = idx;
      }
    }

    // Also check if text ends with punctuation
    if (minIndex === -1) {
      if (text.endsWith('.') || text.endsWith('!') || text.endsWith('?') || text.endsWith('।')) {
        minIndex = text.length - 1;
      }
    }

    // Natural clause boundary optimization for low TTFA without waiting for long compound sentences
    if (minIndex === -1 && text.length >= 45) {
      const clauseMarks = [', ', '; ', ' - '];
      for (const cm of clauseMarks) {
        const idx = text.indexOf(cm, 20);
        if (idx > -1 && (minIndex === -1 || idx < minIndex)) {
          minIndex = idx;
        }
      }
    }

    return minIndex;
  }

  /**
   * Simple distress detection based on conversation history
   */
  _detectDistress() {
    const distressWords = ['pain', 'hurt', 'severe', 'terrible', 'awful', 'scared',
      'worried', 'can\'t breathe', 'dizzy', 'bleeding', 'emergency'];

    const recentMessages = this.llm.conversationHistory
      .filter(m => m.role === 'user')
      .slice(-3)
      .map(m => m.content.toLowerCase());

    return recentMessages.some(msg =>
      distressWords.some(word => msg.includes(word))
    );
  }

  /**
   * Extract known clinical symptoms from text for instant triage UI feedback
   */
  _extractSymptoms(text) {
    if (!text || typeof text !== 'string') return [];
    const lower = text.toLowerCase();
    const knownSymptoms = [
      'headache', 'fever', 'chest pain', 'nausea', 'dizziness', 'sore throat',
      'cough', 'stomach pain', 'fatigue', 'back pain', 'shortness of breath',
      'rash', 'vomiting', 'body ache', 'migraine', 'chills', 'weakness', 'diarrhea',
      'தலைவலி', 'காய்ச்சல்', 'நெஞ்சு வலி', 'மயக்கம்', 'தொண்டை வலி', 'இருமல்', 'வயிற்று வலி', 'வாந்தி', 'சோர்வு',
      'सिरदर्द', 'बुखार', 'सीने में दर्द', 'चक्कर', 'गले में खराश', 'खांसी', 'पेट दर्द', 'उल्टी', 'थकान'
    ];
    return knownSymptoms.filter(s => lower.includes(s.toLowerCase()));
  }

  /**
   * Start the session — speak a greeting in the selected language
   */
  async startSession() {
    const genId = this._newGeneration();
    let greeting = "Hi there. I'm VoxAct, your health triage assistant. I'm here to help you understand your symptoms and find the right care. So, tell me... what's going on? How are you feeling?";
    if (this.language === 'ta') {
      greeting = "வணக்கம். நான் வாக்ஸ்ஆக்ட் (VoxAct), உங்கள் மருத்துவ உதவியாளர். உங்களுக்கு என்ன பிரச்சனை? உடம்பு எப்படி இருக்கிறது என்பதை சொல்லுங்கள்.";
    } else if (this.language === 'hi') {
      greeting = "नमस्ते. मैं वॉक्सएक्ट (VoxAct) हूँ, आपका मेडिकल ट्रायज सहायक. आपको क्या समस्या महसूस हो रही है? आप कैसा महसूस कर रहे हैं?";
    }

    this.llm.addAssistantMessage(greeting);
    this.sendToClient({ type: 'transcript', role: 'assistant', text: greeting });

    await this._synthesizeAndPlay(greeting, genId, this.activeAbortController.signal);

    // Safety fallback timeout in case playback_complete message is not received
    setTimeout(() => {
      if (this._isCurrentGeneration(genId) && this.state === STATE.SPEAKING) {
        this.latency.calculateMetrics(this.sessionId, genId);
        this._setState(STATE.LISTENING);
      }
    }, 12000);
  }

  /**
   * Get latency metrics for the current session
   */
  getMetrics() {
    return this.latency.getSummary();
  }

  /**
   * Get Rime configuration for documentation
   */
  getRimeConfig() {
    return this.rime.getConfig();
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
    this.rime.disconnect();
    console.log(`[Orchestrator:${this.sessionId}] Destroyed`);
  }
}

module.exports = { Orchestrator, STATE };
