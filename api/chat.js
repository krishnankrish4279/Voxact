/**
 * VoxAct — Chat / Conversation Handler (Vercel Serverless)
 * 
 * Receives user speech text + conversation history, streams back the full
 * orchestrator response (transcript, audio, triage updates, care navigation)
 * via Server-Sent Events.
 * 
 * This is a linearized, stateless version of the WebSocket orchestrator
 * optimized for Vercel's request-response serverless model.
 */
const LLMClient = require('../src/llm-client');
const RimeClient = require('../src/rime-client');
const FillerManager = require('../src/filler-manager');
const { TOOL_FUNCTIONS } = require('../src/tools');
const { normalizeMedicalSpeech } = require('../src/medical-transcriber');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, conversationHistory, language, location, pendingAction, nearbyCareStatus, turnId } = req.body || {};

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'No text provided' });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (e) { /* connection closed */ }
  };

  try {
    const lang = language || 'en';
    const genId = req.body?.generationId || 'gen_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);

    // ─── Initialize components ─────────────────────────────────────
    const llm = new LLMClient({
      language: lang,
      pendingAction: pendingAction || null,
      nearbyCareStatus: nearbyCareStatus || 'not_requested',
      location: location || null
    });
    const rime = new RimeClient({ language: lang });
    rime.useWebSocket = false; // Force HTTP-only for serverless
    const filler = new FillerManager(lang);

    // Load conversation history (client sends it with each request)
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      llm.conversationHistory = JSON.parse(JSON.stringify(conversationHistory));
    } else {
      llm.initConversation();
    }

    // ─── Normalize medical speech ──────────────────────────────────
    const normalized = normalizeMedicalSpeech(text, lang);
    const processedText = normalized.normalizedTranscript || text;

    // ─── Send user transcript ──────────────────────────────────────
    send({
      type: 'transcript',
      role: 'user',
      text: processedText,
      rawTranscript: text,
      normalizedTranscript: processedText,
      medicalTerms: normalized.detectedMedicalTerms || [],
    });
    send({ type: 'state_change', state: 'processing' });

    // Add user message to LLM history
    llm.addUserMessage(processedText);

    // ─── Helper: Find sentence boundaries ──────────────────────────
    function findSentenceEnd(buf) {
      const punctuation = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '। ', '।\n', '.. ', '... '];
      let minIndex = -1;
      for (const p of punctuation) {
        const idx = buf.indexOf(p);
        if (idx > -1 && (minIndex === -1 || idx < minIndex)) minIndex = idx;
      }
      if (minIndex === -1) {
        if (buf.endsWith('.') || buf.endsWith('!') || buf.endsWith('?') || buf.endsWith('।')) {
          minIndex = buf.length - 1;
        }
      }
      if (minIndex === -1 && buf.length >= 45) {
        const clauseMarks = [', ', '; ', ' - '];
        for (const cm of clauseMarks) {
          const idx = buf.indexOf(cm, 20);
          if (idx > -1 && (minIndex === -1 || idx < minIndex)) minIndex = idx;
        }
      }
      return minIndex;
    }

    // ─── Helper: Synthesize a sentence and stream audio ────────────
    let segmentCounter = 0;
    let isFirstSentenceOfTurn = true;
    async function synthesizeAndSend(sentence, segId) {
      if (!sentence || !sentence.trim()) return;
      const isFirst = isFirstSentenceOfTurn;
      isFirstSentenceOfTurn = false;
      try {
        const result = await rime.synthesizeHTTP(sentence, (audioData, meta) => {
          send({
            type: 'audio',
            data: audioData,
            format: rime.audioFormat || 'mp3',
            text: sentence,
            generationId: genId,
            segmentId: segId || `seg_${++segmentCounter}`,
            chunkIndex: 1,
            isFirst: isFirst,
            isLast: meta?.isLast ?? true,
          });
        }, null);

        if (result?.isSimulated) {
          send({
            type: 'fallback_text',
            text: sentence,
            generationId: genId,
            speakBrowser: true,
          });
        }
      } catch (ttsErr) {
        console.error('[api/chat] TTS error:', ttsErr.message);
        send({
          type: 'fallback_text',
          text: sentence,
          generationId: genId,
          speakBrowser: true,
        });
      }
    }

    // ─── Helper: Handle a tool call ────────────────────────────────
    async function handleToolCall(toolName, args, toolCallId) {
      console.log(`[api/chat] Tool call: ${toolName}`, args);
      send({ type: 'state_change', state: 'tool_work' });

      // 1. Filler speech (keeps the user engaged during tool execution)
      const fillerText = filler.getFiller(toolName, { language: lang });
      send({ type: 'filler_event', text: fillerText, toolName, generationId: genId });
      await synthesizeAndSend(fillerText, 'seg_filler_' + toolName);

      // 2. Execute the tool
      const toolFn = TOOL_FUNCTIONS[toolName];
      if (!toolFn) {
        console.error(`[api/chat] Unknown tool: ${toolName}`);
        return;
      }

      let toolResult;
      try {
        if (toolName === 'analyzeSymptoms') {
          toolResult = await toolFn(args?.symptoms || args, null);
        } else if (toolName === 'calculateUrgency') {
          toolResult = await toolFn(args?.analysisResult || args, null);
        } else if (toolName === 'findNearestClinics') {
          toolResult = await toolFn(args?.urgencyLevel || args?.urgency || 'medium', null);
        } else if (toolName === 'findNearbyCareFacilities') {
          toolResult = await toolFn({
            ...args,
            lat: location?.lat ?? null,
            lon: location?.lon ?? (location?.lng ?? null),
            locationName: location?.city ?? 'Current Location',
            urgencyLevel: args?.urgencyLevel || 'medium',
            careType: args?.careType || null,
            language: lang,
          }, null);
        } else if (toolName === 'checkAvailability') {
          toolResult = await toolFn(args?.clinicId || args?.clinic_id || 'clinic_001', null);
        }
      } catch (toolErr) {
        console.error(`[api/chat] Tool execution error (${toolName}):`, toolErr.message);
        toolResult = { error: toolErr.message };
      }

      // 3. Send triage/navigation update to client
      if (toolName === 'findNearbyCareFacilities') {
        send({ type: 'care_navigation_update', toolName, data: toolResult, generationId: genId });
      } else {
        send({ type: 'triage_update', toolName, data: toolResult, generationId: genId });
      }

      // 4. Clinical bundle for analyzeSymptoms (urgency + clinics)
      // Care navigation only included if user has explicitly accepted nearby care
      if (toolName === 'analyzeSymptoms' && toolResult && !toolResult.error) {
        try {
          const urgency = await TOOL_FUNCTIONS['calculateUrgency'](toolResult, null);
          const clinics = await TOOL_FUNCTIONS['findNearestClinics'](urgency.urgencyLevel, null);
          let careNav = null;
          if (llm.nearbyCareStatus === 'accepted') {
            try {
              careNav = await TOOL_FUNCTIONS['findNearbyCareFacilities']({
                urgencyLevel: urgency.urgencyLevel,
                lat: location?.lat ?? null,
                lon: location?.lon ?? (location?.lng ?? null),
                locationName: location?.city ?? 'Current Location',
                language: lang,
                allowFallback: false,
              }, null);
            } catch (e) { /* ignore */ }
          }

          send({
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
        } catch (bundleErr) {
          console.error('[api/chat] Clinical bundle error:', bundleErr.message);
        }
      }

      // 5. Add tool result to conversation and get LLM follow-up
      llm.addToolResult(toolCallId, toolName, toolResult);
      send({ type: 'state_change', state: 'speaking' });

      let followUpBuffer = '';
      const followUpResult = await llm.streamFollowUp(null, (chunk) => {
        followUpBuffer += chunk;
        send({ type: 'transcript_chunk', role: 'assistant', text: chunk, generationId: genId });
      });

      // 6. Synthesize follow-up sentences
      if (followUpBuffer.trim()) {
        const sentences = splitIntoSentences(followUpBuffer);
        for (const sentence of sentences) {
          await synthesizeAndSend(sentence, `seg_followup_${++segmentCounter}`);
        }
      }

      // 7. Handle cascading tool calls from follow-up
      if (followUpResult?.toolCalls && followUpResult.toolCalls.length > 0) {
        for (const tc of followUpResult.toolCalls) {
          await handleToolCall(tc.name, tc.arguments, tc.id);
        }
      }
    }

    // ─── Helper: Split text into sentences ─────────────────────────
    function splitIntoSentences(text) {
      const sentences = text.match(/[^.!?।]+[.!?।]+/g);
      if (sentences && sentences.length > 0) {
        return sentences.map(s => s.trim()).filter(s => s.length > 0);
      }
      return text.trim() ? [text.trim()] : [];
    }

    // ─── Main: Stream LLM completion ───────────────────────────────
    let sentenceBuffer = '';
    const sentenceQueue = [];

    const result = await llm.streamCompletion(
      null, // no abort signal in serverless
      // onTextChunk: accumulate sentences
      (chunk) => {
        sentenceBuffer += chunk;
        send({ type: 'transcript_chunk', role: 'assistant', text: chunk, generationId: genId });

        // Detect complete sentences
        let sentenceEnd = findSentenceEnd(sentenceBuffer);
        while (sentenceEnd > -1) {
          const sentence = sentenceBuffer.slice(0, sentenceEnd + 1).trim();
          sentenceBuffer = sentenceBuffer.slice(sentenceEnd + 1);
          if (sentence.length > 0) {
            sentenceQueue.push(sentence);
          }
          sentenceEnd = findSentenceEnd(sentenceBuffer);
        }
      },
      // onToolCall: synthesize queued text, then handle tool
      async (toolName, args, toolCallId) => {
        // Synthesize any text that was streamed before the tool call
        if (sentenceQueue.length > 0) {
          send({ type: 'state_change', state: 'speaking', generationId: genId });
          for (const s of sentenceQueue) {
            await synthesizeAndSend(s, `seg_${++segmentCounter}`);
          }
          sentenceQueue.length = 0;
        }
        await handleToolCall(toolName, args, toolCallId);
      }
    );

    // ─── Synthesize remaining text ─────────────────────────────────
    if (sentenceBuffer.trim()) {
      sentenceQueue.push(sentenceBuffer.trim());
      sentenceBuffer = '';
    }

    if (sentenceQueue.length > 0) {
      send({ type: 'state_change', state: 'speaking', generationId: genId });
      for (const s of sentenceQueue) {
        await synthesizeAndSend(s, `seg_${++segmentCounter}`);
      }
    }

    if (llm.pendingAction !== pendingAction) {
      send({ type: 'pending_action_change', pendingAction: llm.pendingAction || null, generationId: genId });
    }

    if (llm.nearbyCareStatus !== nearbyCareStatus) {
      send({ type: 'nearby_care_status_change', nearbyCareStatus: llm.nearbyCareStatus || 'not_requested', generationId: genId });
    }

    // ─── Done ──────────────────────────────────────────────────────
    send({ type: 'state_change', state: 'listening', generationId: genId });
    send({
      type: 'done',
      conversationHistory: llm.conversationHistory,
      pendingAction: llm.pendingAction || null,
      nearbyCareStatus: llm.nearbyCareStatus || 'not_requested',
      turnId: turnId || null,
      generationId: genId,
    });

  } catch (err) {
    console.error('[api/chat] Error:', err);
    send({ type: 'error', message: err.message || 'Internal server error' });
  }

  res.end();
};
