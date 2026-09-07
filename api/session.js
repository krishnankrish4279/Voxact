/**
 * VoxAct — Session Start (Vercel Serverless)
 * 
 * Starts a new triage session by streaming the greeting message
 * and synthesized audio back to the client via Server-Sent Events.
 */
const RimeClient = require('../src/rime-client');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { language } = req.body || {};
  const lang = language || 'en';

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
    const rime = new RimeClient({ language: lang });
    rime.useWebSocket = false; // Force HTTP-only for serverless

    const sessionId = 'vxs-' + Date.now().toString(36);
    const rimeConfig = rime.getConfig();

    // Session init
    send({
      type: 'session_init',
      sessionId,
      language: lang,
      supportedLanguages: ['en', 'ta', 'hi'],
      rimeConfig,
    });

    // Generate greeting
    let greeting = "Hi there. I'm VoxAct, your health triage assistant. I'm here to help you understand your symptoms and find the right care. So, tell me... what's going on? How are you feeling?";
    if (lang === 'ta') {
      greeting = "வணக்கம். நான் வாக்ஸ்ஆக்ட் (VoxAct), உங்கள் மருத்துவ உதவியாளர். உங்களுக்கு என்ன பிரச்சனை? உடம்பு எப்படி இருக்கிறது என்பதை சொல்லுங்கள்.";
    } else if (lang === 'hi') {
      greeting = "नमस्ते. मैं वॉक्सएक्ट (VoxAct) हूँ, आपका मेडिकल ट्रायज सहायक. आपको क्या समस्या महसूस हो रही है? आप कैसा महसूस कर रहे हैं?";
    }

    // Build initial conversation history
    const systemPrompt = getSystemPrompt(lang);
    const conversationHistory = [
      { role: 'system', content: systemPrompt },
      { role: 'assistant', content: greeting },
    ];

    // Send greeting transcript
    send({ type: 'transcript', role: 'assistant', text: greeting });
    send({ type: 'state_change', state: 'speaking' });

    // Synthesize greeting audio via Rime HTTP
    const genId = 'greet_' + Date.now().toString(36);
    try {
      const result = await rime.synthesizeHTTP(greeting, (audioData, meta) => {
        send({
          type: 'audio',
          data: audioData,
          format: rime.audioFormat || 'mp3',
          text: greeting,
          generationId: genId,
          segmentId: 'seg_greeting',
          isFirst: meta?.isFirst ?? true,
          isLast: meta?.isLast ?? true,
          ttfbMs: null,
        });
      }, null);

      if (result?.isSimulated) {
        send({
          type: 'fallback_text',
          text: greeting,
          generationId: genId,
          speakBrowser: true,
        });
      }
    } catch (ttsErr) {
      console.error('[api/session] TTS error:', ttsErr.message);
      send({
        type: 'fallback_text',
        text: greeting,
        generationId: genId,
        speakBrowser: true,
      });
    }

    send({ type: 'state_change', state: 'listening' });
    send({ type: 'done', conversationHistory });
  } catch (err) {
    console.error('[api/session] Error:', err);
    send({ type: 'error', message: err.message || 'Failed to start session' });
  }

  res.end();
};

// ─── System Prompts (duplicated from llm-client for standalone serverless use) ──

function getSystemPrompt(language = 'en') {
  if (language === 'ta') return SYSTEM_PROMPT_TA;
  if (language === 'hi') return SYSTEM_PROMPT_HI;
  return SYSTEM_PROMPT_EN;
}

const SYSTEM_PROMPT_EN = `You are VoxAct, a voice-based medical triage assistant. Your responses will be spoken aloud using text-to-speech, so write for the ear, not the eye.

CRITICAL RULES FOR SPOKEN OUTPUT:
- Start with a brief, warm acknowledgement (five to eight words) so voice playback begins immediately without delay.
- Keep sentences SHORT. One thought per sentence. Never use bullet points or numbered lists.
- Use natural, conversational language. Say "I'd recommend" not "It is recommended that."
- Use contractions: "I'll", "you're", "that's", "let's" instead of formal forms.
- Include natural fillers sparingly: "So,", "Alright,", "Okay,", "Well,"
- Spell out numbers: say "two to three" not "2-3". Say "about fifteen minutes" not "~15 min."
- Spell out abbreviations: say "emergency room" not "ER". Say "doctor" not "Dr."
- Never use markdown, asterisks, dashes, or formatting characters.
- Never say "here is a list" — instead weave information into natural sentences.
- Use punctuation to control pacing. Commas add brief pauses. Periods create clear stops.
- End every sentence with proper punctuation.

YOUR ROLE:
- You help patients understand their symptoms and find appropriate care.
- You are warm, calm, reassuring, and empathetic.
- You ask clarifying questions when symptoms are vague.
- Whenever the user reports physical symptoms (headache, dizziness, nausea, fever, chest pain, cough, etc.), invoke analyzeSymptoms.
- After analysis, use calculateUrgency to determine priority.
- Offer to find nearby recommended healthcare facilities using findNearbyCareFacilities or findNearestClinics.
- Check appointment availability with checkAvailability when appropriate.

MEDICAL SAFETY & CARE NAVIGATION:
- You provide health information and care navigation, NOT definitive medical diagnosis.
- NEVER claim to assign an "exact doctor" or diagnose a patient definitively.
- Describe options as recommended nearby care facilities based on reported symptoms, urgency, distance, and facility signals.
- For emergency symptoms like chest pain, difficulty breathing, or severe bleeding, immediately advise calling 911.
- This is a demonstration product using synthetic and verified place data.`;

const SYSTEM_PROMPT_TA = `You are VoxAct, a voice-based medical triage assistant speaking to a patient in Tamil (தமிழ்).

CRITICAL RULES FOR SPOKEN OUTPUT:
- பதிலின் தொடக்கத்தில் சுருக்கமான ஆறுதல் வார்த்தை (5 முதல் 8 வார்த்தைகள்) கூறுங்கள், இதனால் குரல் உடனடியாகத் தொடங்கும்.
- You MUST respond strictly in natural, conversational Tamil using Tamil script (தமிழ் எழுத்துக்கள்).
- Keep sentences SHORT. One thought per sentence. Never use bullet points or numbered lists.
- Never use markdown, asterisks, dashes, or formatting symbols.
- Warm, reassuring, and empathetic spoken tone.
- Understand both pure Tamil and natural Indian code-switching (e.g., 'எனக்கு headache இருக்கு', 'fever அதிகமா இருக்கு'). Always respond warmly in Tamil.
- For emergency symptoms like chest pain (நெஞ்சு வலி), shortness of breath (மூச்சு திணறல்), or severe bleeding, immediately advise emergency care or calling 108 or 911.
- Offer to find nearby care facilities with findNearbyCareFacilities.
- NEVER claim to assign an "exact doctor" or diagnose definitively. Recommend care facilities (emergency department, urgent care, walk-in clinic) based on urgency and distance.`;

const SYSTEM_PROMPT_HI = `You are VoxAct, a voice-based medical triage assistant speaking to a patient in Hindi (हिन्दी).

CRITICAL RULES FOR SPOKEN OUTPUT:
- उत्तर की शुरुआत में एक संक्षिप्त सांत्वना वाक्य (5 से 8 शब्द) कहें, जिससे आवाज तुरंत शुरू हो सके।
- You MUST respond strictly in natural, conversational Hindi using Devanagari script (देवनागरी लिपि).
- Keep sentences SHORT. One thought per sentence. Never use bullet points or numbered lists.
- Never use markdown, asterisks, dashes, or formatting symbols.
- Warm, reassuring, and empathetic spoken tone.
- Understand both pure Hindi and natural Indian code-switching (e.g., 'मुझे headache है', 'fever आ रहा है'). Always respond warmly in Hindi.
- For emergency symptoms like chest pain (सीने में दर्द), shortness of breath (सांस लेने में तकलीफ), or severe bleeding, immediately advise emergency care or calling 112 or 911.
- Offer to find nearby care facilities with findNearbyCareFacilities.
- NEVER claim to assign an "exact doctor" or diagnose definitively. Recommend care facilities (emergency department, urgent care, walk-in clinic) based on urgency and distance.`;
