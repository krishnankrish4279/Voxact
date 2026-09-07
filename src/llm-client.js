/**
 * VoxAct — OpenAI GPT-4o LLM Client
 * Streaming chat completions with function calling for the medical triage assistant.
 * System prompt follows Rime's "writing for the ear" guidelines.
 */

const OpenAI = require('openai');
const { TOOL_DEFINITIONS } = require('./tools');

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

function getSystemPrompt(language = 'en') {
  if (language === 'ta') return SYSTEM_PROMPT_TA;
  if (language === 'hi') return SYSTEM_PROMPT_HI;
  return SYSTEM_PROMPT_EN;
}

function isNegative(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();
  // English
  if (/^(no|nope|nah|no thanks|not now|no need|don't check|dont check|cancel|not really|nevermind|i'm good|im good|no clinic|no hospital)\b/i.test(lower)) return true;
  if (/\b(don't check|dont check|do not check|no thanks|not now|no need|no clinic|no hospital|vendaam|rehne do)\b/i.test(lower)) return true;
  // Tamil: இல்லை, வேண்டாம், இல்ல, வேணாம், வேண்டாம் பரவாயில்லை, வேண்டாம் clinic வேண்டாம், illai, vendaam
  if (/^(illai|vendaam|illa|vendam|paravala|thevaiyillai)\b/i.test(lower)) return true;
  if (raw.includes('இல்லை') || raw.includes('வேண்டாம்') || raw.includes('இல்ல') || raw.includes('வேணாம்') || raw.includes('பரவாயில்லை')) return true;
  // Hindi: नहीं, ना, नहीं चाहिए, रहने दीजिए, रहने दो, अभी नहीं, नहीं धन्यवाद, nahi, nahin, rehne do
  if (/^(nahi|nahin|na|rehne do|mat karo|abhi nahi|nahi chahiye)\b/i.test(lower)) return true;
  if (raw.includes('नहीं') || raw.includes('ना') || raw.includes('नहीं चाहिए') || raw.includes('रहने दीजिए') || raw.includes('रहने दो') || raw.includes('मत')) return true;
  return false;
}

function isAffirmative(text) {
  if (!text) return false;
  // Strict priority: Negative intent always overrides
  if (isNegative(text)) return false;

  const lower = text.toLowerCase().trim();
  const raw = text.trim();
  // English
  if (/^(yes|yeah|yep|yup|sure|okay|ok|please do|certainly|go ahead|definitely|please check|check clinics|do that|sounds good|yes please)\b/i.test(lower)) return true;
  // Code-switching & common variations (e.g., "ஆமா, check பண்ணுங்க", "check pannunga", "yes, காட்டுங்க")
  if (/\b(yes|yeah|sure|okay|ok|check)\b/i.test(lower) && (raw.includes('பண்ணுங்க') || raw.includes('பாருங்க') || raw.includes('ஆமா') || raw.includes('காட்டு') || raw.includes('தேடு') || raw.includes('हाँ') || raw.includes('कहो') || raw.includes('करो') || raw.includes('दिखा'))) return true;
  // Tamil: ஆமா, ஆமாம், சரி, பாருங்க, பண்ணுங்க, தேடுங்க, காட்டுங்க, செக் பண்ணுங்க, aama, check pannunga
  if (/^(aama|aamam|sari|paarunga|pannunga|thedu|kaatunga|check pannunga)\b/i.test(lower)) return true;
  if (raw.includes('ஆமா') || raw.includes('ஆமாம்') || raw.includes('சரி') || raw.includes('பாருங்க') || raw.includes('பண்ணுங்க') || raw.includes('தேடுங்க') || raw.includes('காட்டுங்க') || raw.includes('செக் பண்ணு')) return true;
  // Hindi: हाँ, हां, हाँ जी, जी हाँ, ज़रूर, जरूर, दिखाइए, खोजिए, ठीक है, haan, zaroor, check karo
  if (/^(haan|haanji|ji haan|zaroor|theek hai|sahi hai|check karo|dikhao|karo)\b/i.test(lower)) return true;
  if (raw.includes('हाँ') || raw.includes('हां') || raw.includes('ज़रूर') || raw.includes('जरूर') || raw.includes('दिखाइए') || raw.includes('खोजिए') || raw.includes('ठीक है') || raw.includes('बताइए')) return true;
  return false;
}

function detectClinicCheckOffer(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (/check available clinics nearby/i.test(lower) ||
      /find the nearest emergency-capable clinic/i.test(lower) ||
      /look up local clinic options/i.test(lower) ||
      /find a clinic in your area/i.test(lower) ||
      /help you find a clinic/i.test(lower) ||
      /would you like me to (check|find|look up).*clinic/i.test(lower)) {
    return true;
  }
  if (text.includes('வரைபடத்தில் காட்டவா') || text.includes('கிளினிக்குகளைப் பார்க்கவா') || text.includes('கிளினிக்கைத் தேட உதவட்டுமா')) {
    return true;
  }
  if (text.includes('अस्पताल की जानकारी दिखाऊँ') || text.includes('क्लिनिक की तलाश करूँ') || text.includes('क्लिनिक खोजने में मदद करूँ')) {
    return true;
  }
  return false;
}

class LLMClient {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4o';
    this.language = config.language || 'en';
    this.pendingAction = config.pendingAction || null;
    this.nearbyCareStatus = config.nearbyCareStatus || (this.pendingAction ? 'pending' : 'not_requested');
    this.location = config.location || null;
    this.careDeclined = config.careDeclined || (this.nearbyCareStatus === 'declined');
    this.client = null;
    if (this.isConfigured()) {
      const opts = { apiKey: this.apiKey };
      if (process.env.OPENAI_BASE_URL) {
        opts.baseURL = process.env.OPENAI_BASE_URL;
      }
      this.client = new OpenAI(opts);
    }
    this.conversationHistory = [];
    this.maxHistoryLength = 20;
  }

  /**
   * Check if OpenAI API key is configured
   */
  isConfigured() {
    const key = this.apiKey || process.env.OPENAI_API_KEY;
    return !!key && key !== 'your_openai_api_key_here' && key.trim().length > 0;
  }

  /**
   * Dynamically switch language without restarting the session
   */
  setLanguage(lang) {
    if (lang && (lang === 'en' || lang === 'ta' || lang === 'hi')) {
      this.language = lang;
      if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
        this.conversationHistory[0].content = getSystemPrompt(this.language);
      }
      const langName = this.language === 'ta' ? 'Tamil (தமிழ்)' : (this.language === 'hi' ? 'Hindi (हिन्दी)' : 'English');
      this.conversationHistory.push({
        role: 'system',
        content: `[Session Language: ${langName}. The patient selected ${langName}. Respond naturally in ${langName}.]`,
      });
      this._trimHistory();
    }
  }

  /**
   * Add the system prompt to start a conversation
   */
  initConversation() {
    this.conversationHistory = [
      { role: 'system', content: getSystemPrompt(this.language) },
    ];
  }

  /**
   * Add a user message to the conversation history
   */
  addUserMessage(text) {
    this.conversationHistory.push({ role: 'user', content: text });
    this._trimHistory();
  }

  /**
   * Add an assistant message to the conversation history
   * Only adds what was actually spoken (for context accuracy after interruptions)
   */
  addAssistantMessage(text) {
    if (text && text.trim()) {
      this.conversationHistory.push({ role: 'assistant', content: text });
      this._trimHistory();
    }
  }

  /**
   * Add a tool call result to the conversation history
   */
  addToolResult(toolCallId, toolName, result) {
    this.conversationHistory.push({
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify(result),
    });
  }

  /**
   * Add an assistant message with tool calls to the history
   */
  addAssistantToolCall(toolCalls, content = null) {
    this.conversationHistory.push({
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls,
    });
  }

  /**
   * Deterministic handler for pending actions like CHECK_NEARBY_CARE / CHECK_NEARBY_CLINICS
   */
  async _handlePendingAction(lastUserMsg, previousAssistantMsg, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    const lang = this.language || 'en';

    if (isAffirmative(lastUserMsg)) {
      this.pendingAction = null;
      this.nearbyCareStatus = 'accepted';
      let careType = 'urgent_care';
      const lastToolMsg = [...this.conversationHistory].reverse().find(m => m.role === 'tool');
      if (lastToolMsg) {
        try {
          const data = JSON.parse(lastToolMsg.content);
          if (data.possibleConditions?.some(c => c.urgency === 'high' || c.urgency === 'emergency')) {
            careType = 'emergency';
          }
        } catch (e) {}
      }
      if (/emergency|hospital|அவசர|மருத்துவமனை|ஆपातकालीन|अस्पताल/i.test(previousAssistantMsg)) {
        careType = 'emergency';
      }

      const toolCallId = 'call_act_' + Math.random().toString(36).substring(2, 9);
      const facilityArgs = {
        careType,
        urgencyLevel: careType === 'emergency' ? 'high' : 'medium'
      };
      if (this.location && this.location.lat !== null && this.location.lat !== undefined && this.location.lon !== null && this.location.lon !== undefined) {
        facilityArgs.lat = this.location.lat;
        facilityArgs.lon = this.location.lon;
        if (this.location.city) facilityArgs.locationName = this.location.city;
      }

      const toolCalls = [{
        id: toolCallId,
        type: 'function',
        function: {
          name: 'findNearbyCareFacilities',
          arguments: JSON.stringify(facilityArgs)
        }
      }];

      this.addAssistantToolCall(toolCalls, null);

      if (onToolCall && !signal?.aborted) {
        await onToolCall('findNearbyCareFacilities', facilityArgs, toolCallId);
      }

      return {
        cancelled: false,
        text: '',
        toolCalls: [{ id: toolCallId, name: 'findNearbyCareFacilities', arguments: facilityArgs }],
        firstTokenMs: 50,
        totalMs: Date.now() - startTime,
      };
    } else if (isNegative(lastUserMsg)) {
      this.pendingAction = null;
      this.nearbyCareStatus = 'declined';
      this.careDeclined = true;
      let responseText = '';
      if (lang === 'ta') {
        responseText = "சரி, புரிந்து கொண்டேன். உங்கள் அறிகுறிகள் மாறினாலோ அல்லது வேறு ஏதேனும் உதவி தேவைப்பட்டாலோ தெரிவிக்கவும்.";
      } else if (lang === 'hi') {
        responseText = "ठीक है, समझ गया। यदि लक्षणों में कोई बदलाव हो या अन्य सहायता चाहिए तो अवश्य बताएं।";
      } else {
        responseText = "Understood. Please let me know if your symptoms change or if you need help with anything else.";
      }

      const sentences = responseText.match(/[^.!?।]+[.!?।]+/g) || [responseText];
      let fullText = '';
      for (const s of sentences) {
        if (signal?.aborted) return { cancelled: true, text: fullText, toolCalls: [] };
        await new Promise(r => setTimeout(r, 40));
        fullText += s;
        onTextChunk(s);
      }

      this.addAssistantMessage(fullText);
      return {
        cancelled: false,
        text: fullText,
        toolCalls: [],
        firstTokenMs: 40,
        totalMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Stream a chat completion, returning chunks as they arrive.
   * Supports function calling for tools.
   * 
   * @param {AbortSignal} signal - For cancellation
   * @param {function} onTextChunk - Callback(text) for streaming text
   * @param {function} onToolCall - Callback(toolName, args, toolCallId) when a tool is called
   * @returns {Promise<object>} The complete response metadata
   */
  async streamCompletion(signal, onTextChunk, onToolCall) {
    const lastUserMsg = [...this.conversationHistory].reverse().find(m => m.role === 'user')?.content || '';
    const previousAssistantMsg = [...this.conversationHistory].reverse().find(m => m.role === 'assistant' && m.content)?.content || '';
    const hasClinicOffer = this.pendingAction === 'CHECK_NEARBY_CLINICS' ||
      this.pendingAction === 'CHECK_NEARBY_CARE' ||
      this.nearbyCareStatus === 'pending' ||
      detectClinicCheckOffer(previousAssistantMsg);

    if ((hasClinicOffer && (isAffirmative(lastUserMsg) || isNegative(lastUserMsg))) ||
        (isNegative(lastUserMsg) && (lastUserMsg.toLowerCase().includes('clinic') || lastUserMsg.toLowerCase().includes('hospital') || lastUserMsg.includes('கிளினிக்') || lastUserMsg.includes('மருத்துவமனை') || lastUserMsg.includes('अस्पताल')))) {
      return this._handlePendingAction(lastUserMsg, previousAssistantMsg, signal, onTextChunk, onToolCall);
    }

    if (!this.isConfigured() || !this.client) {
      return this._simulateCompletion(signal, onTextChunk, onToolCall);
    }

    const startTime = Date.now();
    let firstTokenTime = null;

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.conversationHistory,
        tools: TOOL_DEFINITIONS,
        stream: true,
        temperature: 0.7,
        max_tokens: 500,
      });

      let fullText = '';
      let toolCalls = [];

      for await (const chunk of stream) {
        // Check for cancellation
        if (signal?.aborted) {
          stream.controller?.abort?.();
          return {
            cancelled: true,
            text: fullText,
            toolCalls: [],
            firstTokenMs: firstTokenTime ? firstTokenTime - startTime : null,
          };
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        // Handle text content
        if (delta.content) {
          if (!firstTokenTime) {
            firstTokenTime = Date.now();
          }
          fullText += delta.content;
          onTextChunk(delta.content);
        }

        // Handle tool calls
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Process completed tool calls
      const completedToolCalls = [];
      const validToolCalls = [];
      for (const tc of toolCalls) {
        if (tc && tc.function && tc.function.name) {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            completedToolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: args,
            });
            validToolCalls.push(tc);
          } catch (err) {
            console.error('[LLM] Failed to parse tool arguments:', err.message);
          }
        }
      }

      // CRITICAL: Add the assistant's message with tool_calls to conversation history FIRST,
      // before any tool callbacks run and append tool results
      if (validToolCalls.length > 0) {
        this.addAssistantToolCall(validToolCalls, fullText);
      } else if (fullText) {
        this.addAssistantMessage(fullText);
      }

      // Execute tool calls sequentially
      for (const tc of completedToolCalls) {
        if (signal?.aborted) break;
        if (onToolCall) {
          await onToolCall(tc.name, tc.arguments, tc.id);
        }
      }

      if (detectClinicCheckOffer(fullText) && !this.careDeclined && this.nearbyCareStatus !== 'declined') {
        this.pendingAction = 'CHECK_NEARBY_CARE';
        this.nearbyCareStatus = 'pending';
      }

      if (detectClinicCheckOffer(fullText) && !this.careDeclined && this.nearbyCareStatus !== 'declined') {
        this.pendingAction = 'CHECK_NEARBY_CARE';
        this.nearbyCareStatus = 'pending';
      }

      return {
        cancelled: false,
        text: fullText,
        toolCalls: completedToolCalls,
        firstTokenMs: firstTokenTime ? firstTokenTime - startTime : null,
        totalMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        return {
          cancelled: true,
          text: '',
          toolCalls: [],
          firstTokenMs: null,
        };
      }
      if (err.status === 429 || err.message?.includes('credits') || err.message?.includes('quota')) {
        console.warn('[LLM] OpenAI quota exhausted (429), seamlessly falling back to internal medical triage engine');
        return this._simulateCompletion(signal, onTextChunk, onToolCall);
      }
      throw err;
    }
  }
  /**
   * Get a follow-up response after tool results have been added
   */
  async streamFollowUp(signal, onTextChunk) {
    if (!this.isConfigured() || !this.client) {
      return this._simulateFollowUp(signal, onTextChunk);
    }

    const startTime = Date.now();
    let firstTokenTime = null;

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: this.conversationHistory,
        tools: TOOL_DEFINITIONS,
        stream: true,
        temperature: 0.7,
        max_tokens: 500,
      });

      let fullText = '';
      let toolCalls = [];

      for await (const chunk of stream) {
        if (signal?.aborted) {
          stream.controller?.abort?.();
          return { cancelled: true, text: fullText, toolCalls: [] };
        }

        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          if (!firstTokenTime) firstTokenTime = Date.now();
          fullText += delta.content;
          onTextChunk(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) toolCalls[tc.index].id = tc.id;
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      const completedToolCalls = [];
      const validToolCalls = [];
      for (const tc of toolCalls) {
        if (tc && tc.function && tc.function.name) {
          try {
            const args = JSON.parse(tc.function.arguments || '{}');
            completedToolCalls.push({ id: tc.id, name: tc.function.name, arguments: args });
            validToolCalls.push(tc);
          } catch (e) {
            // skip
          }
        }
      }

      if (validToolCalls.length > 0) {
        this.addAssistantToolCall(validToolCalls, fullText);
      } else if (fullText) {
        this.addAssistantMessage(fullText);
      }

      return {
        cancelled: false,
        text: fullText,
        toolCalls: completedToolCalls,
        firstTokenMs: firstTokenTime ? firstTokenTime - startTime : null,
        totalMs: Date.now() - startTime,
      };
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        return { cancelled: true, text: '', toolCalls: [] };
      }
      if (err.status === 429 || err.message?.includes('credits') || err.message?.includes('quota')) {
        console.warn('[LLM] OpenAI quota exhausted (429), seamlessly falling back to internal follow-up generator');
        return this._simulateFollowUp(signal, onTextChunk);
      }
      throw err;
    }
  }

  /**
   * Simulated triage completion with broad clinical vocabulary and context awareness
   */
  async _simulateCompletion(signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    const lastUserMsg = [...this.conversationHistory].reverse().find(m => m.role === 'user')?.content || '';
    const lower = lastUserMsg.toLowerCase().trim();
    const lang = this.language || 'en';

    // 1. Immediate hold / pause command handling across English, Tamil, and Hindi
    const isHoldCommand = /^(wait|hold on|stop|one second|just a second|hang on|poru|nillu|niruthu|ruko|rukiye|thahro)\b/i.test(lower) ||
      lastUserMsg.includes('பொறு') || lastUserMsg.includes('நில்') || lastUserMsg.includes('நிறுத்து') || lastUserMsg.includes('காத்திரு') || lastUserMsg.includes('ஒரு நிமிடம்') ||
      lastUserMsg.includes('रुको') || lastUserMsg.includes('रुकिए') || lastUserMsg.includes('ठहरो') || lastUserMsg.includes('ठहरिए') || lastUserMsg.includes('बंद करो') || lastUserMsg.includes('एक मिनट');

    if (isHoldCommand) {
      let ack = "I'm listening, take your time.";
      if (lang === 'ta') {
        ack = "நான் கேட்கிறேன், பொறுமையாக சொல்லுங்கள்.";
      } else if (lang === 'hi') {
        ack = "मैं सुन रहा हूँ, आराम से बताइए।";
      }

      onTextChunk(ack);
      this.addAssistantMessage(ack);
      return {
        cancelled: false,
        text: ack,
        toolCalls: [],
        firstTokenMs: 20,
        totalMs: Date.now() - startTime,
      };
    }

    // 2. Comprehensive clinical symptom pattern matching supporting English, Tamil, Hindi, and Code-switching
    const SYMPTOM_PATTERNS = [
      { canonical: 'headache', triggers: ['headache', 'head hurts', 'head ache', 'migraine', 'throbbing head', 'pain in my head', 'தலைவலி', 'தலவலி', 'தல வலி', 'सिरदर्द', 'सिर दर्द', 'सरदर्द', 'सर में दर्द'] },
      { canonical: 'dizziness', triggers: ['dizzy', 'dizziness', 'lightheaded', 'light headed', 'vertigo', 'room spinning', 'unsteady', 'மயக்கம்', 'தலைசுற்றல்', 'चक्कर', 'चक्कर आना'] },
      { canonical: 'nausea', triggers: ['nausea', 'nauseous', 'sick to my stomach', 'sick to stomach', 'queasy', 'vomit', 'vomiting', 'throwing up', 'puking', 'வாந்தி', 'குமட்டல்', 'उल्टी', 'जी मिचलाना'] },
      { canonical: 'fever', triggers: ['fever', 'feverish', 'high temperature', 'temperature', 'chills', 'shivering', 'burning up', 'sweats', 'sweating', 'காய்ச்சல்', 'சூடு', 'बुखार', 'तापमान', 'तेज बुखार'] },
      { canonical: 'chest pain', triggers: ['chest pain', 'chest hurts', 'chest tightness', 'chest pressure', 'angina', 'tightness in chest', 'heart hurts', 'நெஞ்சு வலி', 'மார்பு வலி', 'सीने में दर्द', 'छाती में दर्द'] },
      { canonical: 'shortness of breath', triggers: ['shortness of breath', 'breathless', 'trouble breathing', 'hard to breathe', 'wheezing', 'can\'t breathe', 'gasping', 'மூச்சு திணறல்', 'மூச்சுக்குழல்', 'சாப்பாடு', 'सांस लेने में तकलीफ', 'सांस फूलना'] },
      { canonical: 'stomach pain', triggers: ['stomach pain', 'stomach ache', 'stomach hurts', 'belly ache', 'abdominal pain', 'cramps', 'cramping', 'gut hurts', 'tummy ache', 'வயிற்று வலி', 'வயிறு வலி', 'पेट दर्द', 'पेट में दर्द'] },
      { canonical: 'fatigue', triggers: ['fatigue', 'fatigued', 'exhausted', 'exhaustion', 'tired', 'tiredness', 'no energy', 'weakness', 'weak', 'drained', 'சோர்வு', 'களைப்பு', 'थकान', 'कमजोरी', 'थकावट'] },
      { canonical: 'sore throat', triggers: ['sore throat', 'throat hurts', 'scratchy throat', 'hard to swallow', 'swollen glands', 'தொண்டை வலி', 'கரகரப்பு', 'गले में खराश', 'गले में दर्द'] },
      { canonical: 'cough', triggers: ['cough', 'coughing', 'hack', 'hacking', 'dry cough', 'phlegm', 'இருமல்', 'சளி', 'खांसी', 'कफ'] },
      { canonical: 'back pain', triggers: ['back pain', 'back hurts', 'lower back pain', 'backache', 'spine hurts', 'முதுகு வலி', 'पीठ दर्द', 'कमर दर्द'] },
      { canonical: 'rash', triggers: ['rash', 'hives', 'itching', 'itchy skin', 'bumps', 'red spots', 'skin irritation', 'அரிப்பு', 'தடிப்பு', 'खुजली', 'चकत्ते'] }
    ];

    const currentTurnDetected = [];
    for (const item of SYMPTOM_PATTERNS) {
      if (item.triggers.some(t => lower.includes(t.toLowerCase()))) {
        currentTurnDetected.push(item.canonical);
      }
    }

    const detected = [...currentTurnDetected];
    // Only enrich with symptoms mentioned in previous turns if the user reported symptoms in this current turn
    if (currentTurnDetected.length > 0) {
      for (const msg of this.conversationHistory) {
        if (msg.role === 'user') {
          const msgLower = msg.content.toLowerCase();
          for (const item of SYMPTOM_PATTERNS) {
            if (!detected.includes(item.canonical) && item.triggers.some(t => msgLower.includes(t.toLowerCase()))) {
              detected.push(item.canonical);
            }
          }
        }
      }
    }

    // 3. If any symptoms are found, dispatch analyzeSymptoms tool
    if (detected.length > 0) {
      const toolCallId = 'call_sim_' + Math.random().toString(36).substring(2, 9);
      const toolCalls = [{
        id: toolCallId,
        type: 'function',
        function: {
          name: 'analyzeSymptoms',
          arguments: JSON.stringify({ symptoms: detected })
        }
      }];

      this.addAssistantToolCall(toolCalls, null);

      if (onToolCall && !signal?.aborted) {
        await onToolCall('analyzeSymptoms', { symptoms: detected }, toolCallId);
      }

      return {
        cancelled: false,
        text: '',
        toolCalls: [{ id: toolCallId, name: 'analyzeSymptoms', arguments: { symptoms: detected } }],
        firstTokenMs: 50,
        totalMs: Date.now() - startTime,
      };
    }

    // 3b. Care Navigation requests (e.g., "find nearby urgent care", "hospital", "மருத்துவமனை", "अस्पताल")
    const isCareRequest = /\b(hospital|clinic|urgent care|emergency|doctor|care)\b/i.test(lower) ||
      lastUserMsg.includes('மருத்துவமனை') || lastUserMsg.includes('கிளினிக்') || lastUserMsg.includes('அவசர') || lastUserMsg.includes('சிகிச்சை') ||
      lastUserMsg.includes('अस्पताल') || lastUserMsg.includes('क्लिनिक') || lastUserMsg.includes('आपातकालीन') || lastUserMsg.includes('डॉक्टर');

    if (isCareRequest) {
      let careType = 'urgent_care';
      if (/hospital|emergency/i.test(lower) || lastUserMsg.includes('மருத்துவமனை') || lastUserMsg.includes('அவசர') || lastUserMsg.includes('अस्पताल') || lastUserMsg.includes('आपातकालीन')) {
        careType = 'emergency';
      } else if (/clinic|walk/i.test(lower) || lastUserMsg.includes('கிளினிக்') || lastUserMsg.includes('क्लिनिक')) {
        careType = 'walk_in_clinic';
      }

      const toolCallId = 'call_sim_' + Math.random().toString(36).substring(2, 9);
      const toolCalls = [{
        id: toolCallId,
        type: 'function',
        function: {
          name: 'findNearbyCareFacilities',
          arguments: JSON.stringify({ careType, urgencyLevel: careType === 'emergency' ? 'high' : 'medium' })
        }
      }];

      this.addAssistantToolCall(toolCalls, null);

      if (onToolCall && !signal?.aborted) {
        await onToolCall('findNearbyCareFacilities', { careType, urgencyLevel: careType === 'emergency' ? 'high' : 'medium' }, toolCallId);
      }

      return {
        cancelled: false,
        text: '',
        toolCalls: [{ id: toolCallId, name: 'findNearbyCareFacilities', arguments: { careType } }],
        firstTokenMs: 50,
        totalMs: Date.now() - startTime,
      };
    }

    // 4. Conversational Responses for non-symptom queries (multilingual)
    let responseText = '';
    const userTurnCount = this.conversationHistory.filter(m => m.role === 'user').length;

    if (lang === 'ta') {
      if (/\b(வணக்கம்|ஹலோ|hello|hi)\b/i.test(lower)) {
        responseText = "வணக்கம்! நான் VoxAct, உங்கள் மருத்துவ உதவியாளர். உங்களுக்கு என்ன பிரச்சனை? உங்கள் உடல்நிலை இப்போது எப்படி இருக்கிறது?";
      } else if (/\b(நன்றி|thanks)\b/i.test(lower)) {
        responseText = "மகிழ்ச்சி. வேறு ஏதேனும் அறிகுறிகள் உள்ளதா என்பதைத் தெரிவிக்கவும்.";
      } else {
        const dynamicInquiriesTa = [
          "நான் கவனமாகக் கேட்கிறேன். உங்கள் உடலில் என்ன மாற்றங்களை அல்லது அசௌகரியத்தை உணர்கிறீர்கள்?",
          "உங்களுக்கு தலைவலி, காய்ச்சல், அல்லது வேறு ஏதேனும் உடல் வலி உள்ளதா?",
          "நீங்கள் உணரும் முக்கிய பிரச்சனையை விளக்கினால், நான் சரியான வழிகாட்டலை வழங்க முடியும்.",
        ];
        responseText = dynamicInquiriesTa[userTurnCount % dynamicInquiriesTa.length];
      }
    } else if (lang === 'hi') {
      if (/\b(नमस्ते|नमस्कार|हेलो|hello|hi)\b/i.test(lower)) {
        responseText = "नमस्ते! मैं VoxAct हूँ, आपका मेडिकल ट्रायज सहायक। आप इस समय कैसा महसूस कर रहे हैं और आपको क्या समस्या है?";
      } else if (/\b(धन्यवाद|शुक्रिया|thanks)\b/i.test(lower)) {
        responseText = "आपका स्वागत है। यदि आपको कोई अन्य लक्षण महसूस हो रहे हैं तो मुझे अवश्य बताएं।";
      } else {
        const dynamicInquiriesHi = [
          "मैं ध्यान से सुन रहा हूँ। कृपया बताएं कि आपके शरीर में कौन से मुख्य लक्षण दिखाई दे रहे हैं?",
          "क्या आपको सिरदर्द, बुखार, चक्कर या किसी हिस्से में दर्द महसूस हो रहा है?",
          "आपकी स्थिति का सही आकलन करने के लिए, क्या आप अपनी तकलीफ के बारे में थोड़ा और बता सकते हैं?",
        ];
        responseText = dynamicInquiriesHi[userTurnCount % dynamicInquiriesHi.length];
      }
    } else {
      // English
      if (/\b(hi|hello|hey|good morning|good afternoon)\b/i.test(lower)) {
        responseText = "Hello there. I'm VoxAct, your medical triage assistant. How are you feeling right now, and what symptoms brought you in today?";
      } else if (/\b(since|yesterday|today|days|hours|morning|night|week|started)\b/i.test(lower)) {
        responseText = "Thank you for clarifying the timeline. Could you tell me what specific physical symptoms or sensations you are feeling right now?";
      } else if (/\b(severe|terrible|bad|unbearable|mild|a lot|hurts|pain)\b/i.test(lower)) {
        responseText = "I hear you, and I want to make sure you get appropriate care. Where in your body are you experiencing this discomfort?";
      } else if (/\b(yes|yeah|sure|okay|alright)\b/i.test(lower)) {
        responseText = "Whenever you're ready, please describe your main symptoms so I can assess them for you.";
      } else if (/\b(thank you|thanks)\b/i.test(lower)) {
        responseText = "You're very welcome. Please let me know if there is anything else you'd like me to evaluate.";
      } else {
        const dynamicInquiries = [
          "I'm listening closely. Could you describe what main symptoms or changes in your body you've noticed?",
          "To help evaluate what might be going on, are you having a headache, nausea, fever, or any pain?",
          "I want to make sure we assess this thoroughly. Could you share what discomfort is troubling you most?",
          "I'm here to assist you. Are you feeling dizzy, sick to your stomach, or running a temperature?",
        ];
        responseText = dynamicInquiries[userTurnCount % dynamicInquiries.length];
      }
    }

    const sentences = responseText.match(/[^.!?।]+[.!?।]+/g) || [responseText];
    let fullText = '';
    for (const s of sentences) {
      if (signal?.aborted) return { cancelled: true, text: fullText, toolCalls: [] };
      await new Promise(r => setTimeout(r, 40));
      fullText += s;
      onTextChunk(s);
    }

    this.addAssistantMessage(fullText);
    if (detectClinicCheckOffer(fullText) && !this.careDeclined && this.nearbyCareStatus !== 'declined') {
      this.pendingAction = 'CHECK_NEARBY_CARE';
      this.nearbyCareStatus = 'pending';
    }
    return {
      cancelled: false,
      text: fullText,
      toolCalls: [],
      firstTokenMs: 40,
      totalMs: Date.now() - startTime,
    };
  }

  /**
   * Simulated follow-up response after tool execution (multilingual)
   */
  async _simulateFollowUp(signal, onTextChunk) {
    const startTime = Date.now();
    const toolMsg = [...this.conversationHistory].reverse().find(m => m.role === 'tool');
    let toolData = null;
    try {
      if (toolMsg) toolData = JSON.parse(toolMsg.content);
    } catch (e) {}

    const lang = this.language || 'en';
    let responseText = '';

    // If follow-up is for Care Navigation / Facility Search
    if (toolData && (toolData.facilities || toolData.targetCareType)) {
      if (toolData.spokenSummary) {
        responseText = toolData.spokenSummary;
      } else {
        const topFac = toolData.facilities?.[0];
        if (lang === 'ta') {
          responseText = `உங்கள் அறிகுறிகளுக்கு ஏற்ற சிகிச்சை மையங்களை வரைபடத்தில் தயார் செய்துள்ளேன். மிக அருகில் இருப்பது ${topFac?.name || 'மருத்துவ மையம்'}. வரைபடத்தில் மேலும் விவரங்களைப் பார்க்கலாம்.`;
        } else if (lang === 'hi') {
          responseText = `मैंने आपके लक्षणों के अनुसार उपयुक्त चिकित्सा केंद्रों की पहचान कर ली है। सबसे नजदीकी केंद्र ${topFac?.name || 'स्वास्थ्य केंद्र'} है। मानचित्र पर सभी विकल्प देखे जा सकते हैं।`;
        } else {
          responseText = `I've found recommended care options for your situation. The nearest facility is ${topFac?.name || 'a nearby clinic'}. You can view the details on the care map.`;
        }
      }
    } else if (toolData && toolData.possibleConditions && toolData.possibleConditions.length > 0) {
      const top = toolData.possibleConditions[0];
      const second = toolData.possibleConditions[1];
      const hasEmergency = toolData.possibleConditions.some(c => c.urgency === 'high' || c.urgency === 'emergency');

      const offerCare = !this.careDeclined && this.nearbyCareStatus !== 'declined';
      if (lang === 'ta') {
        if (hasEmergency) {
          responseText = offerCare
            ? `உங்கள் அறிகுறிகளைப் பார்க்கும்போது, இது ${top.condition} ஆக இருக்க வாய்ப்புள்ளது. இது அவசர கவனிப்பு தேவைப்படலாம் என்பதால், உடனடியாக அவசர சிகிச்சை மையத்தை அணுகுமாறு பரிந்துரைக்கிறேன். உங்களுக்கு அருகில் உள்ள அவசர மருத்துவமனையை வரைபடத்தில் காட்டவா?`
            : `உங்கள் அறிகுறிகளைப் பார்க்கும்போது, இது ${top.condition} ஆக இருக்க வாய்ப்புள்ளது. இது அவசர கவனிப்பு தேவைப்படலாம் என்பதால், உடனடியாக அவசர சிகிச்சை மையத்தை அணுகுமாறு பரிந்துரைக்கிறேன். தேவைப்பட்டால் அவசர உதவி எண் 108-ஐ அழைக்கவும்.`;
        } else {
          responseText = offerCare
            ? `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${top.condition} நிலையுடன் ஒத்துப்போகிறது. போதுமான ஓய்வெடுத்து நீர் அருந்துங்கள். அறிகுறிகள் தொடர்ந்தால் மருத்துவரை அணுகவும். உங்களுக்கு அருகில் உள்ள கிளினிக்குகளைப் பார்க்கவா?`
            : `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${top.condition} நிலையுடன் ஒத்துப்போகிறது. போதுமான ஓய்வெடுத்து நீர் அருந்துங்கள். அறிகுறிகள் மாறினால் தயங்காமல் தெரிவிக்கவும்.`;
        }
      } else if (lang === 'hi') {
        if (hasEmergency) {
          responseText = offerCare
            ? `आपके लक्षणों के आधार पर, यह ${top.condition} का संकेत हो सकता है। यह गंभीर स्थिति हो सकती है, इसलिए तुरंत आपातकालीन चिकित्सा सहायता लेने की सलाह दी जाती है। क्या मैं आपके नजदीकी अस्पताल की जानकारी दिखाऊँ?`
            : `आपके लक्षणों के आधार पर, यह ${top.condition} का संकेत हो सकता है। यह गंभीर स्थिति हो सकती है, इसलिए तुरंत आपातकालीन चिकित्सा सहायता लेने की सलाह दी जाती है।`;
        } else {
          responseText = offerCare
            ? `आपके लक्षणों के अनुसार, यह ${top.condition} की ओर संकेत करता है। कृपया पर्याप्त आराम करें और पानी पिएं। यदि सुधार न हो तो डॉक्टर से परामर्श लें। क्या मैं पास के क्लिनिक की तलाश करूँ?`
            : `आपके लक्षणों के अनुसार, यह ${top.condition} की ओर संकेत करता है। कृपया पर्याप्त आराम करें और पानी पिएं। यदि सुधार न हो तो मुझे अवश्य बताएं।`;
        }
      } else {
        if (hasEmergency) {
          responseText = offerCare
            ? `Based on what you've described, this could potentially indicate ${top.condition}. Because these symptoms can be serious, I strongly recommend seeking medical evaluation right away or going to an urgent care clinic. Would you like me to find the nearest emergency-capable clinic for you?`
            : `Based on what you've described, this could potentially indicate ${top.condition}. Because these symptoms can be serious, I strongly recommend seeking medical evaluation right away or going to an urgent care clinic.`;
        } else if (second) {
          responseText = offerCare
            ? `Based on your symptoms, the triage analysis points towards ${top.condition}, or possibly ${second.condition}. In the meantime, rest and stay well-hydrated. If your symptoms don't improve or start getting worse, I'd recommend having a healthcare provider take a look. Would you like me to check available clinics nearby?`
            : `Based on your symptoms, the triage analysis points towards ${top.condition}, or possibly ${second.condition}. In the meantime, rest and stay well-hydrated. If your symptoms don't improve or start getting worse, I'd recommend having a healthcare provider take a look.`;
        } else {
          responseText = offerCare
            ? `Based on what you've shared, this looks consistent with ${top.condition}. I suggest resting and drinking plenty of fluids. If things don't improve over the next day or two, please consult with a doctor. Would you like me to look up local clinic options?`
            : `Based on what you've shared, this looks consistent with ${top.condition}. I suggest resting and drinking plenty of fluids. If things don't improve over the next day or two, please consult with a doctor.`;
        }
      }
    } else {
      if (lang === 'ta') {
        responseText = "ஓய்வெடுத்து தேவையான அளவு தண்ணீர் குடிப்பது நல்லது. அறிகுறிகள் அதிகமானால் மருத்துவரை அணுகவும். அருகில் உள்ள கிளினிக்கைத் தேட உதவட்டுமா?";
      } else if (lang === 'hi') {
        responseText = "इस समय आराम करना और पर्याप्त पानी पीना उचित रहेगा। यदि लक्षण बढ़ें तो कृपया चिकित्सा पेशेवर से संपर्क करें। क्या मैं नजदीकी क्लिनिक खोजने में मदद करूँ?";
      } else {
        responseText = "Based on your description, it's a good idea to rest and stay well hydrated. If your symptoms persist or worsen, please consult a medical professional. Can I help you find a clinic in your area?";
      }
    }

    const sentences = responseText.match(/[^.!?।]+[.!?।]+/g) || [responseText];
    let fullText = '';
    for (const s of sentences) {
      if (signal?.aborted) return { cancelled: true, text: fullText, toolCalls: [] };
      await new Promise(r => setTimeout(r, 45));
      fullText += s;
      onTextChunk(s);
    }

    this.addAssistantMessage(fullText);
    if (detectClinicCheckOffer(fullText) && !this.careDeclined && this.nearbyCareStatus !== 'declined') {
      this.pendingAction = 'CHECK_NEARBY_CARE';
      this.nearbyCareStatus = 'pending';
    }
    return {
      cancelled: false,
      text: fullText,
      toolCalls: [],
      firstTokenMs: 45,
      totalMs: Date.now() - startTime,
    };
  }

  /**
   * Trim conversation history to avoid context length issues
   * Keeps system prompt and last N messages
   */
  _trimHistory() {
    if (this.conversationHistory.length > this.maxHistoryLength + 1) {
      const system = this.conversationHistory[0];
      const recent = this.conversationHistory.slice(-(this.maxHistoryLength));
      this.conversationHistory = [system, ...recent];
    }
  }

  /**
   * Update conversation history to reflect what was actually heard
   * (for context accuracy after interruptions)
   */
  truncateLastAssistant(spokenText) {
    // Remove any trailing dangling assistant tool calls or tool messages from the interrupted turn
    while (this.conversationHistory.length > 1) {
      const last = this.conversationHistory[this.conversationHistory.length - 1];
      if (last.role === 'tool' || (last.role === 'assistant' && last.tool_calls && !last.content)) {
        this.conversationHistory.pop();
      } else {
        break;
      }
    }

    if (spokenText && spokenText.trim()) {
      const last = this.conversationHistory[this.conversationHistory.length - 1];
      if (last && last.role === 'assistant' && last.content) {
        last.content = spokenText.trim() + '... [interrupted]';
      } else {
        this.conversationHistory.push({
          role: 'assistant',
          content: spokenText.trim() + '... [interrupted]',
        });
      }
    }
  }

  /**
   * Reset conversation history
   */
  reset() {
    this.initConversation();
  }
}

module.exports = LLMClient;
module.exports.isAffirmative = isAffirmative;
module.exports.isNegative = isNegative;
module.exports.detectClinicCheckOffer = detectClinicCheckOffer;
