/**
 * VoxAct — OpenAI GPT-4o LLM Client
 * Streaming chat completions with function calling for the medical triage assistant.
 * System prompt follows Rime's "writing for the ear" guidelines.
 */

const OpenAI = require('openai');
const { TOOL_DEFINITIONS } = require('./tools');
const { extractClinicalSymptoms } = require('./medical-transcriber');
const { TAMIL_CONDITION_NAMES, HINDI_CONDITION_NAMES } = require('./tts-synthesizer');
const {
  INTENTS,
  classifyUserIntent,
  isDecline,
  isAffirmative: routerIsAffirmative,
  extractNamedFacility,
  isPendingFacilityOffer,
} = require('./intent-router');

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

    if (isAffirmative(lastUserMsg) || routerIsAffirmative(lastUserMsg)) {
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
    } else if (isNegative(lastUserMsg) || isDecline(lastUserMsg)) {
      return this._handleFacilityDecline(lastUserMsg, signal, onTextChunk, onToolCall);
    }
  }

  /**
   * Deterministic handler when user declines clinic / hospital offers
   */
  async _handleFacilityDecline(lastUserMsg, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    const lang = this.language || 'en';

    this.pendingAction = null;
    this.nearbyCareStatus = 'declined';
    this.careDeclined = true;
    let responseText = '';
    if (lang === 'ta') {
      responseText = "சரி, புரிந்து கொண்டேன். நான் கிளினிக்குகளையோ மருத்துவமனைகளையோ தேட மாட்டேன். உங்கள் அறிகுறிகளைக் கவனிப்பதில் கவனம் செலுத்துவோம்.";
    } else if (lang === 'hi') {
      responseText = "ठीक है, समझ गया। मैं अस्पतालों या क्लिनिकों की तलाश नहीं करूँगा। आइए आपके लक्षणों के प्रबंधन पर ध्यान दें।";
    } else {
      responseText = "Understood. I will not search for clinics or hospitals. Let's focus on managing your symptoms. Please let me know if you need help with anything else.";
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

  /**
   * Deterministic handler when user accepts a facility offer
   */
  async _handleFacilityAccept(lastUserMsg, previousAssistantMsg, signal, onTextChunk, onToolCall) {
    return this._handlePendingAction(lastUserMsg, previousAssistantMsg, signal, onTextChunk, onToolCall);
  }

  /**
   * Deterministic handler for named facility search (e.g. "Virutcham Hospital near me")
   */
  async _handleNamedFacilitySearch(lastUserMsg, facilityName, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    this.pendingAction = null;
    this.nearbyCareStatus = 'accepted';

    const toolCallId = 'call_named_' + Math.random().toString(36).substring(2, 9);
    const facilityArgs = {
      facilityName: facilityName || 'Virutcham Hospital',
      careType: 'emergency',
      urgencyLevel: 'high',
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
  }

  /**
   * Deterministic handler for explicit hospital search
   */
  async _handleHospitalSearch(lastUserMsg, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    this.pendingAction = null;
    this.nearbyCareStatus = 'accepted';

    const toolCallId = 'call_hosp_' + Math.random().toString(36).substring(2, 9);
    const facilityArgs = {
      careType: 'emergency',
      urgencyLevel: 'high',
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
  }

  /**
   * Deterministic handler for explicit clinic search
   */
  async _handleClinicSearch(lastUserMsg, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    this.pendingAction = null;
    this.nearbyCareStatus = 'accepted';

    const toolCallId = 'call_clinic_' + Math.random().toString(36).substring(2, 9);
    const facilityArgs = {
      careType: 'urgent_care',
      urgencyLevel: 'medium',
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
  }

  /**
   * Deterministic handler for medicine requests
   * Must NEVER trigger hospital searches or disclaimers.
   * Asks minimum safety questions before providing general OTC options.
   */
  async _handleMedicineRequest(lastUserMsg, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    const lang = this.language || 'en';
    const lower = lastUserMsg.toLowerCase();

    const isVomiting = lower.includes('vomit') || lastUserMsg.includes('வாந்தி') || lastUserMsg.includes('உல்டி') || lastUserMsg.includes('उल्टी');

    let text = '';
    if (isVomiting) {
      if (lang === 'ta') {
        text = "நான் குறிப்பிட்ட மருந்துகளையோ அளவுகளையோ பரிந்துரைக்க முடியாது, ஏனெனில் அவற்றை தகுதியுள்ள மருத்துவர் அல்லது மருந்தாளுநரே பரிந்துரைக்க வேண்டும். வாந்தியின் போது மிக முக்கியமானது, நீர்ச்சத்து இழப்பைத் தடுக்க சிறிது சிறிதாக தண்ணீர் அல்லது ஓ.ஆர்.எஸ் (ORS) கரைசல் குடிப்பதாகும். எண்ணெய் மற்றும் கடினமான உணவுகளைத் தவிர்க்கவும். வாந்தி நிற்காவிட்டாலோ அல்லது ரத்தம் இருந்தாலோ உடனே மருத்துவரை அணுகவும்.";
      } else if (lang === 'hi') {
        text = "मैं विशिष्ट दवाइयां या खुराक निर्धारित नहीं कर सकता, क्योंकि यह किसी डॉक्टर या फार्मासिस्ट द्वारा ही तय की जानी चाहिए। उल्टी की स्थिति में सबसे महत्वपूर्ण है कि थोड़ा-थोड़ा पानी या ओआरएस पीकर शरीर में पानी की कमी न होने दें। जब तक पेट सामान्य न हो, हल्का भोजन लें। यदि उल्टी बंद न हो तो तुरंत डॉक्टर से संपर्क करें।";
      } else {
        text = "I cannot prescribe specific medications or provide exact dosages, as medications must be safely guided by a licensed doctor or pharmacist. For vomiting, the most crucial step is preventing dehydration by taking small, frequent sips of water or oral rehydration salts (ORS). Avoid heavy or greasy foods until your stomach settles. If you cannot keep fluids down for over twenty-four hours or notice blood in your vomit, please seek medical attention immediately.";
      }
    } else {
      const allUserHistory = this.conversationHistory
        .filter(m => m.role === 'user')
        .map(m => m.content || '')
        .join(' ')
        .toLowerCase();

      const hasAge = /\b(\d{1,3}\s*(?:years|yrs|yo|வயது|साल)|adult|child|kid|age\s*\d{1,3})\b/i.test(allUserHistory);
      const hasTemp = /\b(10[0-5]|9[7-9])(?:\.[0-9])?\s*(?:degrees|f|c)?\b/i.test(allUserHistory) || /fever\s*is\s*\d{2,3}/i.test(allUserHistory);

      if (!hasAge || !hasTemp) {
        if (lang === 'ta') {
          text = "காய்ச்சலுக்கான பாதுகாப்பான மருந்து வழிகாட்டலை வழங்க, உங்கள் வயது என்ன, காய்ச்சல் எத்தனை டிகிரி இருக்கிறது, மற்றும் உங்களுக்கு ஏதேனும் அலர்ஜி உள்ளதா என்பதை கூற முடியுமா? நான் குறிப்பிட்ட மருந்து பரிந்துரைகளை வழங்க முடியாது, மருந்தாளுநர் ஆலோசனையுடன் மட்டுமே மருந்துகளை உட்கொள்ள வேண்டும்.";
        } else if (lang === 'hi') {
          text = "बुखार की सुरक्षित दवा के बारे में मार्गदर्शन के लिए, क्या आप अपनी उम्र, शरीर का तापमान और क्या आपको कोई एलर्जी है, यह बता सकते हैं? मैं कोई विशिष्ट दवा निर्धारित नहीं कर सकता, डॉक्टर या फार्मासिस्ट का परामर्श अवश्य लें।";
        } else {
          text = "To give you safe information on fever relief, could you share your approximate age, what temperature you measured, and whether you have any allergies or other medical conditions? Note that I cannot prescribe specific medications or dosages, as medications must be safely guided by a licensed doctor or pharmacist. In the meantime, focus on resting and staying well-hydrated with plenty of fluids.";
        }
      } else {
        if (lang === 'ta') {
          text = "பெரியவர்களுக்கு காய்ச்சல் குறைய பாராசிட்டமால் போன்ற பொதுவான காய்ச்சல் நிவாரணிகள் பயன்படுகின்றன. சரியான அளவு மற்றும் பயன்பாட்டுக்கு ஒரு மருந்தாளுநரின் ஆலோசனையைப் பெறுங்கள். மேலும் நிறைய தண்ணீர் குடித்து போதுமான ஓய்வெடுங்கள்.";
        } else if (lang === 'hi') {
          text = "वयस्कों में बुखार के लिए पेरासिटामोल जैसी सामान्य ओवर-द-काउंटर दवाएं तापमान कम करने में मदद करती हैं। सही खुराक के लिए किसी स्थानीय फार्मासिस्ट से परामर्श अवश्य लें, तथा भरपूर पानी पिएं और आराम करें।";
        } else {
          text = "For fever relief in adults, common over-the-counter options like paracetamol or acetaminophen can help reduce temperature and body aches. Please check with a pharmacist for appropriate dosage and directions, stay well-hydrated, and get plenty of rest.";
        }
      }
    }

    const sentences = text.match(/[^.!?।]+[.!?।]+/g) || [text];
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

  /**
   * Deterministic handler for self-care requests (including "don't suggest doctor")
   * Respects user preference and provides home self-care without repeating doctor consultations.
   */
  async _handleSelfCareRequest(lastUserMsg, details, signal, onTextChunk, onToolCall) {
    const startTime = Date.now();
    const lang = this.language || 'en';

    let text = '';
    if (lang === 'ta') {
      text = "சரி, வீட்டிலேயே கவனித்துக் கொள்ளும் முறைகளில் கவனம் செலுத்துவோம். போதுமான அளவு தண்ணீர், கஞ்சி அல்லது இளநீர் குடித்து நீர்ச்சத்துடன் இருங்கள். நன்கு காற்றோட்டமான அறையில் ஓய்வெடுத்து, நெற்றியில் வெதுவெதுப்பான ஈரத்துணி ஒத்தடம் கொடுங்கள். மெல்லிய பருத்தி ஆடைகளை அணியுங்கள்.";
    } else if (lang === 'hi') {
      text = "ठीक है, घर पर देखभाल के तरीकों पर ध्यान देते हैं। भरपूर मात्रा में पानी, नारियल पानी या सूप पिएं ताकि शरीर में पानी की कमी न हो। ठंडे और हवादार कमरे में आराम करें तथा माथे पर हल्के गीले कपड़े की पट्टी रखें। हल्के कपड़े पहनें ताकि शरीर का तापमान सामान्य हो सके।";
    } else {
      text = "Understood, let's focus on supportive home care. Drink plenty of fluids like water, clear broths, or electrolyte solutions to stay well hydrated. Rest in a cool, quiet room, and apply a lukewarm damp cloth to your forehead to help ease the discomfort. Wear light, breathable clothing to let your body cool naturally.";
    }

    const sentences = text.match(/[^.!?।]+[.!?।]+/g) || [text];
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

    // 1. Strict user-intent classification for latest user message
    const intentResult = classifyUserIntent(lastUserMsg, {
      previousAssistantMsg,
      pendingAction: this.pendingAction,
      nearbyCareStatus: this.nearbyCareStatus,
    });
    const { intent, details } = intentResult;

    if (intent === INTENTS.FACILITY_CONFIRMATION_NO) {
      return this._handleFacilityDecline(lastUserMsg, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.FACILITY_CONFIRMATION_YES) {
      return this._handleFacilityAccept(lastUserMsg, previousAssistantMsg, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.NAMED_FACILITY_SEARCH) {
      return this._handleNamedFacilitySearch(lastUserMsg, details?.facilityName, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.NEARBY_HOSPITAL) {
      // If user also reported specific physical symptoms (e.g. "I have a bad headache, can you suggest a nearby hospital?"),
      // prioritize symptom triage while immediately activating care navigation
      const hasSpecificSymptom = /\b(headache|head\s*ache|migraine|dizzy|dizziness|nausea|vomit|chest\s*pain|stomach\s*pain|back\s*pain|knee\s*pain)\b/i.test(lastUserMsg);
      if (hasSpecificSymptom) {
        this.hasExplicitCareRequest = true;
        this.nearbyCareStatus = 'accepted';
        this.pendingAction = null;
        return this._simulateCompletion(signal, onTextChunk, onToolCall);
      }
      return this._handleHospitalSearch(lastUserMsg, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.NEARBY_CLINIC) {
      const hasSpecificSymptom = /\b(headache|head\s*ache|migraine|dizzy|dizziness|nausea|vomit|chest\s*pain|stomach\s*pain|back\s*pain|knee\s*pain)\b/i.test(lastUserMsg);
      if (hasSpecificSymptom) {
        this.hasExplicitCareRequest = true;
        this.nearbyCareStatus = 'accepted';
        this.pendingAction = null;
        return this._simulateCompletion(signal, onTextChunk, onToolCall);
      }
      return this._handleClinicSearch(lastUserMsg, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.MEDICINE_REQUEST) {
      return this._handleMedicineRequest(lastUserMsg, signal, onTextChunk, onToolCall);
    }
    if (intent === INTENTS.SELF_CARE) {
      return this._handleSelfCareRequest(lastUserMsg, details, signal, onTextChunk, onToolCall);
    }

    const hasClinicOffer = this.pendingAction === 'CHECK_NEARBY_CLINICS' ||
      this.pendingAction === 'CHECK_NEARBY_CARE' ||
      this.nearbyCareStatus === 'pending' ||
      detectClinicCheckOffer(previousAssistantMsg);

    if ((hasClinicOffer && (isAffirmative(lastUserMsg) || isNegative(lastUserMsg))) ||
        (isNegative(lastUserMsg) && (lastUserMsg.toLowerCase().includes('clinic') || lastUserMsg.toLowerCase().includes('hospital') || lastUserMsg.includes('கிளினிக்') || lastUserMsg.includes('மருத்துவமனை') || lastUserMsg.includes('அஸ்பத்தால்') || lastUserMsg.includes('अस्पताल')))) {
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

    // 2. Medicine / Drug guidance request safety flow
    const isMedicineRequest = /\b(medicine|medication|tablets?|pills?|drug|syrup|dosage|what can i take|take for)\b/i.test(lower) ||
      lastUserMsg.includes('மருந்து') || lastUserMsg.includes('மாத்திரை') ||
      lastUserMsg.includes('दवा') || lastUserMsg.includes('दवाई') || lastUserMsg.includes('गोली');

    if (isMedicineRequest) {
      let medResponse = '';
      const isVomiting = lower.includes('vomit') || lastUserMsg.includes('வாந்தி') || lastUserMsg.includes('உல்டி') || lastUserMsg.includes('उल्टी');
      const isHeadache = lower.includes('headache') || lower.includes('head') || lastUserMsg.includes('தலைவலி') || lastUserMsg.includes('தலவலி') || lastUserMsg.includes('सिरदर्द');
      const isFever = lower.includes('fever') || lastUserMsg.includes('காய்ச்சல்') || lastUserMsg.includes('ஜுரம்') || lastUserMsg.includes('बुखार');

      if (lang === 'ta') {
        if (isVomiting) {
          medResponse = "நான் குறிப்பிட்ட மருந்துகளையோ அளவுகளையோ பரிந்துரைக்க முடியாது, ஏனெனில் அவற்றை தகுதியுள்ள மருத்துவர் அல்லது மருந்தாளுநரே பரிந்துரைக்க வேண்டும். வாந்தியின் போது மிக முக்கியமானது, நீர்ச்சத்து இழப்பைத் தடுக்க சிறிது சிறிதாக தண்ணீர் அல்லது ஓ.ஆர்.எஸ் (ORS) கரைசல் குடிப்பதாகும். எண்ணெய் மற்றும் கடினமான உணவுகளைத் தவிர்க்கவும். வாந்தி நிற்காவிட்டாலோ அல்லது ரத்தம் இருந்தாலோ உடனே மருத்துவரை அணுகவும்.";
        } else if (isHeadache) {
          medResponse = "நான் குறிப்பிட்ட மருந்து பரிந்துரைகளை வழங்க முடியாது. தலைவலிக்கு அமைதியான இருட்டான அறையில் ஓய்வெடுத்து தேவையான அளவு தண்ணீர் குடிக்கவும். பாராசிட்டமால் போன்ற பொதுவான வலி நிவாரணிகளை மருந்தாளுநர் ஆலோசனையுடன் மட்டுமே உட்கொள்ள வேண்டும். வலி தீவிரமானால் மருத்துவரை அணுகவும்.";
        } else {
          medResponse = "நான் குறிப்பிட்ட மருந்துகளைப் பரிந்துரைக்க முடியாது, ஏனெனில் அது மருத்துவப் பரிசோதனைக்குப் பின்பே முடிவு செய்யப்பட வேண்டும். உங்கள் அறிகுறிகளைப் பொறுத்து ஓய்வு மற்றும் நீர்ச்சத்து எடுத்துக்கொள்ளுங்கள். தேவையான மருந்துகளுக்கு மருத்துவர் அல்லது மருந்தாளுநரிடம் ஆலோசனை பெறவும்.";
        }
      } else if (lang === 'hi') {
        if (isVomiting) {
          medResponse = "मैं विशिष्ट दवाइयां या खुराक निर्धारित नहीं कर सकता, क्योंकि यह किसी डॉक्टर या फार्मासिस्ट द्वारा ही तय की जानी चाहिए। उल्टी की स्थिति में सबसे महत्वपूर्ण है कि थोड़ा-थोड़ा पानी या ओआरएस पीकर शरीर में पानी की कमी न होने दें। जब तक पेट सामान्य न हो, हल्का भोजन लें। यदि उल्टी बंद न हो तो तुरंत डॉक्टर से संपर्क करें।";
        } else if (isHeadache) {
          medResponse = "मैं कोई विशिष्ट दवा निर्धारित नहीं कर सकता। सिरदर्द में शांत और अंधेरे कमरे में आराम करें तथा पर्याप्त पानी पिएं। पेरासिटामोल जैसी सामान्य दर्द निवारक दवा केवल फार्मासिस्ट या डॉक्टर की सलाह पर ही लें। यदि दर्द बढ़ जाए तो तुरंत चिकित्सा परामर्श लें।";
        } else {
          medResponse = "मैं विशिष्ट दवाइयों की सिफारिश नहीं कर सकता। किसी भी दवा के सेवन से पहले कृपया योग्य डॉक्टर या फार्मासिस्ट से परामर्श अवश्य लें। आराम करें और खूब पानी पिएं।";
        }
      } else {
        if (isVomiting) {
          medResponse = "I cannot prescribe specific medications or provide exact dosages, as medications must be safely guided by a licensed doctor or pharmacist. For vomiting, the most crucial step is preventing dehydration by taking small, frequent sips of water or oral rehydration salts (ORS). Avoid heavy or greasy foods until your stomach settles. If you cannot keep fluids down for over twenty-four hours or notice blood in your vomit, please seek medical attention immediately.";
        } else if (isHeadache) {
          medResponse = "I cannot prescribe medications or recommend specific dosages. For a headache, rest in a quiet, dark room, stay well hydrated, and apply a cool cloth to your forehead. Common over-the-counter pain relievers can be discussed with a pharmacist or doctor, but if the headache is sudden and severe, please seek medical evaluation.";
        } else {
          medResponse = "I cannot prescribe medications or specify drug dosages. It is always safest to consult a licensed doctor or pharmacist before taking any medication. In the meantime, focus on resting and staying well-hydrated.";
        }
      }

      const sentences = medResponse.match(/[^.!?।]+[.!?।]+/g) || [medResponse];
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

    // 2b. "Cannot see a doctor" supportive care flow
    const isCannotSeeDoctor = /\b(can(?:not|'t)\s+(?:go|visit|see)\s+(?:a\s+)?doctor|unable to (?:go|visit|see)\s+(?:a\s+)?doctor|can't afford|no doctor|cannot visit|unable to visit)\b/i.test(lower) ||
      lastUserMsg.includes('மருத்துவரிடம் போக முடியாது') || lastUserMsg.includes('டாக்டரிடம் செல்ல முடியாது') ||
      (lastUserMsg.includes('முடியாது') && (lastUserMsg.includes('டாக்டர்') || lastUserMsg.includes('மருத்துவர்'))) ||
      lastUserMsg.includes('डॉक्टर के पास नहीं जा सकता') || lastUserMsg.includes('अस्पताल नहीं जा सकता');

    if (isCannotSeeDoctor) {
      let doctorResponse = '';
      let hasRedFlag = false;
      const lastToolMsg = [...this.conversationHistory].reverse().find(m => m.role === 'tool');
      if (lastToolMsg) {
        try {
          const data = JSON.parse(lastToolMsg.content);
          if (data.redFlags && data.redFlags.length > 0) hasRedFlag = true;
          if (data.possibleConditions?.some(c => c.urgency === 'high' || c.urgency === 'emergency')) hasRedFlag = true;
        } catch (e) {}
      }
      const userText = this.conversationHistory.filter(m => m.role === 'user').map(m => m.content || '').join(' ').toLowerCase();
      if (/chest pain|tightness in chest|pressure in chest|நெஞ்சு\s*வலி|மார்பு\s*வலி|सीने\s*में\s*दर्द|shortness of breath|trouble breathing|hard to breathe|can't breathe|cannot breathe|மூச்சுத்திணறல்|सांस\s*लेने\s*में\s*तकलीफ|loss of consciousness|passed out|fainted|blackout|vomiting blood|coughing blood|severe bleeding|radiating/i.test(userText)) {
        hasRedFlag = true;
      }

      if (lang === 'ta') {
        if (hasRedFlag) {
          doctorResponse = "மருத்துவரிடம் செல்வது தற்போது சிரமமாக இருக்கலாம் என்பதை நான் முழுமையாகப் புரிந்து கொள்கிறேன். இருப்பினும், உங்கள் அறிகுறிகள் தீவிரமானதாக இருக்கக்கூடும் என்பதால் உடனடி மருத்துவப் பரிசோதனை மிக அவசியமாகும். தயவுசெய்து தாமதிக்காமல் அவசர உதவி எண் 108 அல்லது 112-ஐ அழைக்கவும் அல்லது உடனடி உதவி பெறவும்.";
        } else {
          doctorResponse = "தற்போது மருத்துவரிடம் செல்ல முடியாத சூழலை புரிந்து கொள்கிறேன். வீட்டில் இருக்கும்போது, பாதிக்கப்பட்ட பகுதிக்கு சிரமம் கொடுக்காமல் முழுமையாக ஓய்வெடுங்கள். வலி உள்ள இடத்தில் ஐஸ் ஒத்தடம் கொடுக்கலாம். ஆனால் வீக்கம் அதிகரித்தாலோ, கடுமையான வலி ஏற்பட்டாலோ அல்லது காய்ச்சல் வந்தாலோ கட்டாயமாக அவசர மருத்துவ உதவியை நாட வேண்டும்.";
        }
      } else if (lang === 'hi') {
        if (hasRedFlag) {
          doctorResponse = "मैं समझता हूँ कि अभी डॉक्टर के पास जाना मुश्किल हो सकता है। लेकिन आपके लक्षण गंभीर हो सकते हैं, इसलिए पेशेवर चिकित्सीय जांच अत्यंत आवश्यक है। कृपया किसी भी देरी के बिना आपातकालीन नंबर 112 या 108 पर संपर्क करें।";
        } else {
          doctorResponse = "मैं समझता हूँ कि इस समय डॉक्टर के पास जाना संभव नहीं है। घर पर देखभाल के लिए पर्याप्त आराम करें और प्रभावित हिस्से पर दबाव न डालें। यदि सूजन हो तो ठंडी सिकाई करें। लेकिन यदि दर्द अचानक बढ़ जाए या बुखार आए, तो तुरंत आपातकालीन सहायता लें।";
        }
      } else {
        if (hasRedFlag) {
          doctorResponse = "I understand that visiting a doctor is difficult right now. However, because your reported symptoms could indicate a serious or life-threatening condition, a professional medical evaluation is truly essential. Please do not wait — call emergency services at 108 or 911 immediately, or ask someone to help you reach emergency care.";
        } else {
          doctorResponse = "I understand that you cannot visit a doctor right now. For supportive home care, get plenty of rest and avoid putting weight or strain on the painful area. You can apply cold packs for fifteen minutes at a time and keep the limb elevated. Watch closely for warning signs: if you develop severe swelling, spreading redness, a fever, or an inability to move, you should seek emergency medical care immediately.";
        }
      }

      const sentences = doctorResponse.match(/[^.!?।]+[.!?।]+/g) || [doctorResponse];
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

    // 2c. Comprehensive clinical symptom pattern matching supporting English, Tamil, Hindi, and Code-switching
    const SYMPTOM_PATTERNS = [
      { canonical: 'headache', triggers: ['headache', 'head hurts', 'head ache', 'migraine', 'throbbing head', 'pain in my head', 'தலைவலி', 'தலவலி', 'தல வலி', 'सिरदर्द', 'सिर दर्द', 'सरदर्द', 'सर में दर्द'] },
      { canonical: 'dizziness', triggers: ['dizzy', 'dizziness', 'lightheaded', 'light headed', 'vertigo', 'room spinning', 'unsteady', 'மயக்கம்', 'தலைசுற்றல்', 'चक्कर', 'चक्कर आना'] },
      { canonical: 'nausea', triggers: ['nausea', 'nauseous', 'sick to my stomach', 'sick to stomach', 'queasy', 'குமட்டல்', 'जी मिचलाना'] },
      { canonical: 'fever', triggers: ['fever', 'feverish', 'high temperature', 'temperature', 'chills', 'shivering', 'burning up', 'sweats', 'sweating', 'காய்ச்சல்', 'சூடு', 'बुखार', 'तापमान', 'तेज बुखार'] },
      { canonical: 'chest pain', triggers: ['chest pain', 'chest hurts', 'chest tightness', 'chest pressure', 'angina', 'tightness in chest', 'heart hurts', 'நெஞ்சு வலி', 'மார்பு வலி', 'सीने में दर्द', 'छाती में दर्द'] },
      { canonical: 'shortness of breath', triggers: ['shortness of breath', 'breathless', 'trouble breathing', 'hard to breathe', 'wheezing', 'can\'t breathe', 'gasping', 'மூச்சு திணறல்', 'மூச்சுக்குழல்', 'சாப்பாடு', 'सांस लेने में तकलीफ', 'सांस फूलना'] },
      { canonical: 'stomach pain', triggers: ['stomach pain', 'stomach ache', 'stomach hurts', 'belly ache', 'abdominal pain', 'cramps', 'cramping', 'gut hurts', 'tummy ache', 'வயிற்று வலி', 'வயிறு வலி', 'पेट दर्द', 'पेट में दर्द'] },
      { canonical: 'fatigue', triggers: ['fatigue', 'fatigued', 'exhausted', 'exhaustion', 'tired', 'tiredness', 'no energy', 'drained', 'சோர்வு', 'களைப்பு', 'थकान', 'थकावट'] },
      { canonical: 'sore throat', triggers: ['sore throat', 'throat hurts', 'scratchy throat', 'hard to swallow', 'swollen glands', 'தொண்டை வலி', 'கரகரப்பு', 'गले में खराश', 'गले में दर्द'] },
      { canonical: 'cough', triggers: ['cough', 'coughing', 'hack', 'hacking', 'dry cough', 'phlegm', 'இருமல்', 'சளி', 'खांसी', 'कफ'] },
      { canonical: 'back pain', triggers: ['back pain', 'back hurts', 'lower back pain', 'backache', 'spine hurts', 'முதுகு வலி', 'पीठ दर्द', 'कमर दर्द'] },
      { canonical: 'rash', triggers: ['rash', 'hives', 'itching', 'itchy skin', 'bumps', 'red spots', 'skin irritation', 'அரிப்பு', 'தடிப்பு', 'खुजली', 'चकत्ते'] },
      { canonical: 'knee pain', triggers: ['knee pain', 'knees hurt', 'knee hurts', 'pain in my knees', 'pain in my knee', 'hurts when i walk', 'hurt when i walk', 'knee ache', 'sore knees', 'swollen knees', 'knees', 'knee', 'முழங்கால் வலி', 'முழங்கால்', 'முழங்கால்ல வலி', 'முட்டி வலி', 'முட்டில வலி', 'முட்டில பெயின்', 'முட்டில pain', 'கால் வலி', 'muzhang kaal vali', 'mutti vali', 'muttile pain', 'knee la romba pain', 'घुटने में दर्द', 'घुटने का दर्द', 'घुटनों में दर्द'] },
      { canonical: 'vomiting', triggers: ['vomit', 'vomiting', 'threw up', 'throwing up', 'puking', 'வாந்தி', 'வாந்தி வருது', 'வாந்தி இருக்கு', 'enaku vomit aagudhu', 'vomit aagudhu', 'उल्टी', 'उल्टी होना'] },
      { canonical: 'weakness', triggers: ['weakness', 'weak', 'very weak', 'so weak', 'loss of strength', 'பலவீனம்', 'உடம்பு பலவீனம்', 'முடியல', 'உடம்பு ரொம்ப முடியல', 'weak-aa இருக்கு', 'weak aa irukku', 'udambu romba weak aa irukku', 'udambu romba mudiyala', 'कमजोरी', 'अशक्तता'] },
    ];

    const currentTurnDetected = [];
    for (const item of SYMPTOM_PATTERNS) {
      if (item.triggers.some(t => lower.includes(t.toLowerCase()))) {
        currentTurnDetected.push(item.canonical);
      }
    }

    // Deterministic clinical symptom extraction from medical-transcriber
    const clinicalExtraction = extractClinicalSymptoms(lastUserMsg, lang);
    if (clinicalExtraction && clinicalExtraction.symptoms) {
      for (const s of clinicalExtraction.symptoms) {
        const canonical = s.toLowerCase();
        if (!currentTurnDetected.includes(canonical)) {
          currentTurnDetected.push(canonical);
        }
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
      // Check if user explicitly asked for care facilities in this turn (Combined Request)
      const isAntiDoctorOrSelfCare = /\b(don'?t|do\s*not|no)\s+(suggest|recommend|tell|send)\b/i.test(lower) ||
        /\b(cure|remedy|home|self\s*care)\b/i.test(lower) ||
        lastUserMsg.includes('சொல்லாதே') || lastUserMsg.includes('வேண்டாம்') || lastUserMsg.includes('मत');

      const isExplicitCare = !isAntiDoctorOrSelfCare && (
        /\b(suggest|find|show|locate|search|nearest|closest|near\s+me)\s+(?:a\s+)?(?:hospital|clinic|urgent\s*care|emergency)\b/i.test(lower) ||
        /\b(?:hospital|clinic|urgent\s*care|emergency\s*room)\s+near\s+me\b/i.test(lower) ||
        /\bsuggest\s+(?:a\s+)?nearby\s+(?:hospital|clinic)\b/i.test(lower) ||
        /அருகில்\s*உள்ள\s*(மருத்துவமனை|கிளினிக்)|மருத்துவமனை\s*பரிந்துரை/i.test(lastUserMsg) ||
        /नजदीकी\s*(अस्पताल|क्लिनिक)|अस्पताल\s*बताएं/i.test(lastUserMsg)
      );

      if (isExplicitCare && !this.careDeclined && this.nearbyCareStatus !== 'declined') {
        this.hasExplicitCareRequest = true;
        this.nearbyCareStatus = 'accepted';
        this.pendingAction = null;
      }

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
        responseText = "வணக்கம்! நான் வாக்ஸ் ஆக்ட், உங்கள் மருத்துவ உதவியாளர். உங்களுக்கு என்ன தொந்தரவு? உங்கள் உடல்நிலை இப்போது எப்படி இருக்கிறது?";
      } else if (/\b(நன்றி|thanks)\b/i.test(lower)) {
        responseText = "மகிழ்ச்சி. வேறு ஏதேனும் அறிகுறிகள் உள்ளதா என்பதைத் தெரிவிக்கவும்.";
      } else {
        const dynamicInquiriesTa = [
          "நான் கவனமாகக் கேட்கிறேன். உங்கள் உடலில் என்ன மாற்றங்களை அல்லது அசௌகரியத்தை உணர்கிறீர்கள்?",
          "உங்களுக்கு தலைவலி, காய்ச்சல், அல்லது வேறு ஏதேனும் உடல் வலி உள்ளதா?",
          "நீங்கள் உணரும் முக்கிய தொந்தரவை விளக்கினால், நான் சரியான வழிகாட்டலை வழங்க முடியும்.",
        ];
        responseText = dynamicInquiriesTa[userTurnCount % dynamicInquiriesTa.length];
      }
    } else if (lang === 'hi') {
      if (/\b(नमस्ते|नमस्कार|हेलो|hello|hi)\b/i.test(lower)) {
        responseText = "नमस्ते! मैं वॉक्सएक्ट (VoxAct) हूँ, आपका मेडिकल ट्रायज सहायक। आप इस समय कैसा महसूस कर रहे हैं और आपको क्या समस्या है?";
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
          "To help evaluate what might be going on, could you share a bit more detail about when your symptoms started?",
          "I want to make sure we assess this thoroughly. Could you tell me what physical discomfort is troubling you most?",
          "I'm here to assist you. Could you describe what you are experiencing right now?",
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
    } else if (toolData && toolData.isOnlyFever) {
      if (lang === 'ta') {
        responseText = toolData.clarificationPromptTa || "இந்தக் காய்ச்சல் எத்தனை நாட்களாக இருக்கிறது, வெப்பநிலை என்னவென்று அளந்தீர்களா, மற்றும் சளி அல்லது தொண்டை வலி போன்ற பிற அறிகுறிகள் உள்ளதா?";
      } else if (lang === 'hi') {
        responseText = toolData.clarificationPromptHi || "यह बुखार कितने दिनों से है, क्या आपने तापमान नापा है, और क्या आपको खांसी या ठंड लगने जैसे अन्य लक्षण भी हैं?";
      } else {
        responseText = toolData.clarificationPrompt || "To better understand your fever, could you tell me how long you've had it, what temperature you measured, and whether you have other symptoms like a cough, sore throat, or chills?";
      }
    } else if (toolData && toolData.possibleConditions && toolData.possibleConditions.length > 0) {
      const top = toolData.possibleConditions[0];
      const second = toolData.possibleConditions[1];
      const hasEmergency = toolData.possibleConditions.some(c => c.urgency === 'high' || c.urgency === 'emergency');
      const isKnee = toolData.symptoms?.some(s => s.toLowerCase().includes('knee'));
      const isVomit = toolData.symptoms?.some(s => s.toLowerCase().includes('vomit'));

      const isExplicitCare = Boolean(this.hasExplicitCareRequest);
      this.hasExplicitCareRequest = false;

      const offerCare = !this.careDeclined && this.nearbyCareStatus !== 'declined' && hasEmergency && !isExplicitCare;
      const score = top.patternMatchScore ?? Math.round((top.confidence || 0.6) * 100);

      if (lang === 'ta') {
        const condTa = TAMIL_CONDITION_NAMES[top.condition] || top.condition;
        if (isExplicitCare) {
          responseText = `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${condTa} நிலையுடன் ${score}% ஒத்துப்போகிறது. உங்களுக்கு அருகில் உள்ள மருத்துவமனைகளை வரைபடத்தில் தயார் செய்துள்ளேன். தயவுசெய்து அவற்றை மதிப்பாய்வு செய்து பரிசோதனை செய்து கொள்ளவும்.`;
        } else if (hasEmergency) {
          responseText = offerCare
            ? `உங்கள் அறிகுறிகளைப் பார்க்கும்போது, இது ${condTa} ஆக இருக்க வாய்ப்புள்ளது (${score}% பொருத்தம்). இது அவசர கவனிப்பு தேவைப்படலாம் என்பதால், உடனடியாக அவசர சிகிச்சை மையத்தை அணுகுமாறு பரிந்துரைக்கிறேன். உங்களுக்கு அருகில் உள்ள அவசர மருத்துவமனையை வரைபடத்தில் காட்டவா?`
            : `உங்கள் அறிகுறிகளைப் பார்க்கும்போது, இது ${condTa} ஆக இருக்க வாய்ப்புள்ளது (${score}% பொருத்தம்). இது அவசர கவனிப்பு தேவைப்படலாம் என்பதால், உடனடியாக அவசர சிகிச்சை மையத்தை அணுகுமாறு பரிந்துரைக்கிறேன். தேவைப்பட்டால் அவசர உதவி எண் 108-ஐ அழைக்கவும்.`;
        } else if (isKnee) {
          responseText = `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${condTa} நிலையுடன் ${score}% ஒத்துப்போகிறது. முழங்காலில் வீக்கம் உள்ளதா, உங்களால் சாதாரணமாக நடக்க முடிகிறதா என்பதைத் தெரிந்து கொள்ள விரும்புகிறேன். மூட்டுக்கு அதிக சிரமம் கொடுக்காமல் ஓய்வெடுங்கள்.`;
        } else if (isVomit) {
          responseText = `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${condTa} நிலையுடன் ${score}% ஒத்துப்போகிறது. நீரிழப்பைத் தவிர்க்க அவ்வப்போது சிறிது சிறிதாக தண்ணீர் அருந்துங்கள். காய்ச்சல் அல்லது கடுமையான வயிற்று வலி உள்ளதா?`;
        } else {
          responseText = `உங்கள் அறிகுறிகளை ஆராய்ந்ததில், இது ${condTa} நிலையுடன் ${score}% ஒத்துப்போகிறது. இது ஒரு சாத்தியக்கூறு மட்டுமே, மருத்துவக் கணிப்பு அல்ல. போதுமான ஓய்வெடுத்து நீர் அருந்துங்கள்.`;
        }
      } else if (lang === 'hi') {
        const condHi = HINDI_CONDITION_NAMES[top.condition] || top.condition;
        if (isExplicitCare) {
          responseText = `आपके लक्षणों के अनुसार, यह ${condHi} से ${score}% मेल खाता है। मैंने आपके पास के चिकित्सा केंद्रों को मानचित्र पर दिखा दिया है। कृपया विवरण देखें और आवश्यकतानुसार परामर्श लें।`;
        } else if (hasEmergency) {
          responseText = offerCare
            ? `आपके लक्षणों के आधार पर, यह ${condHi} का संकेत हो सकता है (${score}% मिलान)। यह गंभीर स्थिति हो सकती है, इसलिए तुरंत आपातकालीन चिकित्सा सहायता लेने की सलाह दी जाती है। क्या मैं आपके नजदीकी अस्पताल की जानकारी दिखाऊँ?`
            : `आपके लक्षणों के आधार पर, यह ${condHi} का संकेत हो सकता है (${score}% मिलान)। यह गंभीर स्थिति हो सकती है, इसलिए तुरंत आपातकालीन चिकित्सा सहायता लेने की सलाह दी जाती है।`;
        } else if (isKnee) {
          responseText = `आपके लक्षणों के अनुसार, यह ${condHi} से ${score}% मेल खाता है। क्या घुटने में सूजन है, और क्या आप सामान्य रूप से चल पा रहे हैं? इस समय जोड़ पर अधिक दबाव न डालें और आराम करें।`;
        } else if (isVomit) {
          responseText = `आपके लक्षणों के अनुसार, यह ${condHi} का संकेत हो सकता है (${score}% मिलान)। कृपया निर्जलीकरण से बचने के लिए थोड़ा-थोड़ा पानी या ओआरएस पिएं। यदि सुधार न हो तो मुझे बताएं।`;
        } else {
          responseText = `आपके लक्षणों के अनुसार, यह ${condHi} से ${score}% मेल खाता है। ध्यान दें कि यह केवल लक्षणों का मिलान है, कोई अंतिम निदान नहीं। कृपया पर्याप्त आराम करें और पानी पिएं।`;
        }
      } else {
        if (isExplicitCare) {
          responseText = `Based on your symptoms, the pattern shows a ${score}% match with ${top.condition}. I have identified recommended nearby healthcare facilities on the care map for you. Pattern match only — not a clinical diagnosis.`;
        } else if (hasEmergency) {
          responseText = offerCare
            ? `Based on what you've described, this shows a ${score}% match with ${top.condition}. Because these symptoms can be serious, I strongly recommend seeking medical evaluation right away or going to an urgent care clinic. Would you like me to find the nearest emergency-capable clinic for you?`
            : `Based on what you've described, this shows a ${score}% match with ${top.condition}. Because these symptoms can be serious, I strongly recommend seeking medical evaluation right away or going to an urgent care clinic.`;
        } else if (isKnee) {
          responseText = `Based on your symptoms, the triage analysis points towards ${top.condition}. To better evaluate this, could you let me know if you notice any swelling, whether one or both knees hurt, and if you are able to walk normally? For now, rest the joint and avoid putting excess weight on it.`;
        } else if (isVomit) {
          responseText = `Based on your symptoms, the triage analysis points towards ${top.condition}. It is important to stay hydrated with small sips of water or electrolyte solution. Are you able to keep any fluids down, and do you also have a fever?`;
        } else if (second) {
          const secondScore = second.patternMatchScore ?? Math.round((second.confidence || 0.4) * 100);
          responseText = `Based on your reported symptoms, the pattern shows a ${score}% match with ${top.condition}, and a ${secondScore}% match with ${second.condition}. Pattern match only — not a clinical diagnosis. In the meantime, rest and stay well-hydrated.`;
        } else {
          responseText = `Based on what you've shared, this looks consistent with ${top.condition}. I suggest resting and drinking plenty of fluids. If things don't improve over the next day or two, please consult with a doctor.`;
        }
      }
    } else {
      if (lang === 'ta') {
        responseText = "ஓய்வெடுத்து தேவையான அளவு தண்ணீர் குடிப்பது நல்லது. அறிகுறிகள் அதிகமானால் மருத்துவரை அணுகவும்.";
      } else if (lang === 'hi') {
        responseText = "इस समय आराम करना और पर्याप्त पानी पीना उचित रहेगा। यदि लक्षण बढ़ें तो कृपया चिकित्सा पेशेवर से संपर्क करें।";
      } else {
        responseText = "Based on your description, it's a good idea to rest and stay well hydrated. If your symptoms persist or worsen, please consult a medical professional.";
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
