/**
 * VoxAct — Strict User-Intent Router
 * 
 * Classifies the latest user message into EXACTLY ONE primary intent
 * to ensure conversation-routing continuity without cross-turn leakage:
 * 
 * 1. emergency (acute red flags: crushing chest pain, breathing failure, severe trauma)
 * 2. facility_confirmation_no (declining pending facility question)
 * 3. facility_confirmation_yes (confirming pending facility question)
 * 4. named_facility_search (explicit search for a named hospital/clinic)
 * 5. nearby_hospital (explicit request for a hospital / emergency room)
 * 6. nearby_clinic (explicit request for a walk-in clinic / urgent care)
 * 7. medicine_request (request for medication / tablets / what to take)
 * 8. self_care (request for home remedies, self-care, or "don't suggest doctor")
 * 9. symptom_triage (asking for assessment / differential analysis)
 * 10. symptom_information (describing symptoms or answering triage questions)
 * 11. clarification (ambiguous input, hold commands, greetings, pleasantries)
 */const INTENTS = {
  EMERGENCY: 'emergency',
  WAIT_INTERRUPTION: 'wait_interruption',
  FACILITY_SELECTION: 'facility_selection',
  MAP_REQUEST: 'map_request',
  DIRECTIONS_REQUEST: 'directions_request',
  FACILITY_CONFIRMATION_NO: 'facility_confirmation_no',
  FACILITY_CONFIRMATION_YES: 'facility_confirmation_yes',
  NAMED_FACILITY_SEARCH: 'named_facility_search',
  NEARBY_HOSPITAL: 'nearby_hospital',
  NEARBY_CLINIC: 'nearby_clinic',
  MEDICINE_REQUEST: 'medicine_request',
  SELF_CARE: 'self_care',
  SYMPTOM_TRIAGE: 'symptom_triage',
  SYMPTOM_INFORMATION: 'symptom_information',
  CLARIFICATION: 'clarification',
};

/**
 * Normalize colloquial conversational controls and tolerate ASR variants (e.g. "ஒரு" -> "பொரு")
 * ONLY when context indicates conversational hold/interruption, never for quantity questions.
 */
function normalizeConversationalControl(rawText, context = {}) {
  if (!rawText || typeof rawText !== 'string') return rawText;
  const trimmed = rawText.trim();
  const lower = trimmed.toLowerCase();

  const {
    assistantSpeaking = false,
    immediatelyAfterAssistant = false,
    pendingQuestion = null,
    lastAssistantMsg = ''
  } = context;

  // Check if assistant asked a quantity question (e.g. "how many", "ஒரு symptom மட்டும்", "ஒன்றா அல்லது பலவா")
  const combinedContext = ((pendingQuestion?.questionText || '') + ' ' + (lastAssistantMsg || '')).toLowerCase();
  const isQuantityQuestion = /(?:^|\s|[.,!?])(?:how\s+many|how\s+much|எத்தனை|ஒன்றா|ஒரு\s*symptom\s*மட்டும்|ஒரு\s*அறிகுறி\s*மட்டும்|ஒன்று\s*மட்டுமா|ஒரு\s*மட்டும்)(?:$|\s|[.,!?])/i.test(combinedContext);

  // If ASR produced "ஒரு" or colloquial "போறு", "பொற", "போரு"
  if (trimmed === 'ஒரு' || trimmed === 'ஒரு ' || lower === 'oru') {
    // Only interpret as "பொரு" (wait/hold) if assistant is speaking or right after assistant, AND NOT answering a quantity question
    if ((assistantSpeaking || immediatelyAfterAssistant) && !isQuantityQuestion) {
      return 'பொரு';
    }
  }

  // Common colloquial variants of poru
  if (/^(?:போறு|பொற|போரு)$/i.test(trimmed)) {
    return 'பொரு';
  }

  return rawText;
}

/**
 * Strip leading conversational hold / control prefixes before clinical medical triage.
 * E.g. "பொரு, எனக்கு வேற ஒரு symptom இருக்கு" -> "எனக்கு வேற ஒரு symptom இருக்கு"
 */
function stripControlPrefix(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .refunction isWaitInterruption(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();

  // If there is substantive speech remaining after stripping conversational control prefixes,
  // this is a full utterance with a control prefix (e.g. "Wait, I want a hospital instead", "பொரு, எனக்கு ஒரு வேற symptom இருக்கு"), NOT a pure hold command.
  const stripped = stripControlPrefix(text);
  if (stripped && stripped.length > 0) {
    return false;
  }

  // Pure English wait phrases
  if (/^(?:wait|wait\s+wait|wait\s+wait\s+wait|please\s+wait|hold\s+on|just\s+hold\s+on|hang\s+on|hold\s+up|one\s+second|just\s+a\s+second|just\s+a\s+minute|one\s+minute|stop|i'm\s+still\s+talking|im\s+still\s+talking|give\s+me\s+a\s+sec(?:ond)?)$/i.test(lower)) {
    return true;
  }

  // Tamil wait phrases (colloquial and formal)
  if (/^(?:poru|porru|pohru|konjam\s+poru|nillu|niruthu|oru\s+nimisham|irunga|kaathiru)$/i.test(lower)) {
    return true;
  }
  if (/^(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|பொறுமை|நில்|நில்லு|நில்லுங்க|நிறுத்து|காத்திரு|ஒரு\s*நிமிடம்|ஒரு\s*நிமிஷம்|இரு|இருங்க)$/i.test(raw)) {
    return true;
  }

  // Hindi wait phrases
  if (/^(?:ruko|rukiye|thahro|thahariye|ek\s+minute|ek\s+second|zara\s+ruko)$/i.test(lower)) {
    return true;
  }
  if (/^(?:रुको|रुकिए|ठहरो|ठहरिए|एक\s*मिनट|एक\s*सेकंड|जरा\s*रुको)$/i.test(raw)) {
    return true;
  }

  return false;
}�சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|பொறுமை|நில்|நில்லு|நிறுத்து|காத்திரு|ஒரு\s*நிமிடம்|ஒரு\s*நிமிஷம்|இருங்க)$/i.test(raw) ||
      (/^(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|பொறுமை|நில்|நில்லு|நிறுத்து|காத்திரு|ஒரு\s*நிமிடம்|ஒரு\s*நிமிஷம்|இருங்க)(?:\s|$|[.,!?])/i.test(raw) && !hasSymptom)) {
    return true;
  }

  // Hindi wait phrases
  if (/^(?:ruko|rukiye|thahro|thahariye|ek\s+minute|ek\s+second|zara\s+ruko)$/i.test(lower) ||
      (/^(?:ruko|rukiye|thahro|thahariye|ek\s+minute|ek\s+second|zara\s+ruko)\b/i.test(lower) && !hasSymptom)) {
    return true;
  }
  if (/^(?:रुको|रुकिए|ठहरो|ठहरिए|एक\s*मिनट|एक\s*सेकंड|जरा\s*रुको)$/i.test(raw) ||
      (/^(?:रुको|रुकिए|ठहरो|ठहरिए|एक\s*मिनट|एक\s*सेकंड|जरा\s*रुको)(?:\s|$|[.,!?])/i.test(raw) && !hasSymptom)) {
    return true;
  }

  return false;
}

/**
 * Extract facility selection index if present (e.g. "show number one", "share number one", "put number one on map", "select option three")
 */
function extractFacilitySelection(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();

  const numMap = {
    'one': 0, '1': 0, 'first': 0,
    'two': 1, '2': 1, 'second': 1,
    'three': 2, '3': 2, 'third': 2,
    'four': 3, '4': 3, 'fourth': 3,
    'five': 4, '5': 4, 'fifth': 4,
    'six': 5, '6': 5,
    'seven': 6, '7': 6,
    'eight': 7, '8': 7,
    'nine': 8, '9': 8,
    'ten': 9, '10': 9,
  };

  // Tamil matches
  if (/முதல்\s*(?:மருத்துவமனை|ஒன்றை|ஒன்று)?|நம்பர்\s*(?:ஒன்று|1)|ஒன்றை\s*காட்டு|முதல்\s*வசதி|1வது\s*மருத்துவமனை/i.test(raw)) {
    return { facilityIndex: 0, facilityNumber: 1 };
  }
  if (/இரண்டாவது\s*(?:மருத்துவமனை|ஒன்றை|இரண்டு)?|நம்பர்\s*(?:இரண்டு|2)|இரண்டை\s*காட்டு|2வது\s*மருத்துவமனை/i.test(raw)) {
    return { facilityIndex: 1, facilityNumber: 2 };
  }
  if (/மூன்றாவது\s*(?:மருத்துவமனை|ஒன்றை|மூன்று)?|நம்பர்\s*(?:மூன்று|3)|3வது\s*மருத்துவமனை/i.test(raw)) {
    return { facilityIndex: 2, facilityNumber: 3 };
  }

  // Hindi matches
  if (/पहला\s*(?:अस्पताल|वाला)?|नंबर\s*(?:एक|1)|पहला\s*दिखाओ|1\s*नंबर/i.test(raw)) {
    return { facilityIndex: 0, facilityNumber: 1 };
  }
  if (/दूसरा\s*(?:अस्पताल|वाला)?|नंबर\s*(?:दो|2)|दूसरा\s*दिखाओ|2\s*नंबर/i.test(raw)) {
    return { facilityIndex: 1, facilityNumber: 2 };
  }
  if (/तीसरा\s*(?:अस्पताल|वाला)?|नंबर\s*(?:तीन|3)|3\s*नंबर/i.test(raw)) {
    return { facilityIndex: 2, facilityNumber: 3 };
  }

  // Explicit match for "option three", "choice two", "facility number one"
  const optMatch = lower.match(/\b(?:option|choice|facility|hospital|clinic)\s+(?:number\s+|#)?(one|two|three|four|five|six|seven|eight|nine|ten|10|[1-9])\b/i);
  if (optMatch && optMatch[1]) {
    const key = optMatch[1].toLowerCase();
    if (numMap[key] !== undefined) {
      return {
        facilityIndex: numMap[key],
        facilityNumber: numMap[key] + 1
      };
    }
  }

  // English Regex
  // Matches: "(show|share|put|select|take me to|go to|view|focus)? (the)? (facility|hospital|clinic|option|choice)? (number|#)? (one|two|three|four|five|1|2|3|4|5) (on map|in map)?"
  const regex = /^(?:show|share|put|select|choose|pick|take\s+me\s+to|go\s+to|focus|view)?\s*(?:the\s+)?(?:facility|hospital|clinic|option|choice)?\s*(?:number|no\.?|#)?\s*(one|two|three|four|five|six|seven|eight|nine|ten|10|[1-9])(?:\s*(?:st|nd|rd|th)?(?:\s+(?:facility|hospital|clinic|option|choice|one))?)?(?:\s*(?:on|in)\s*(?:the\s*)?map)?$/i;
  
  const m = lower.match(regex);
  if (m && m[1]) {
    const key = m[1].toLowerCase();
    if (numMap[key] !== undefined) {
      return {
        facilityIndex: numMap[key],
        facilityNumber: numMap[key] + 1
      };
    }
  }

  // Partial match inside phrases like "can you share number one", "put number one on map"
  const phraseRegex = /\b(?:show|share|put|select|choose|take\s+me\s+to|go\s+to|focus|view)\s+(?:the\s+)?(?:facility\s+|hospital\s+|clinic\s+|option\s+|choice\s+)?(?:number|no\.?|#)?\s*(one|two|three|four|five|six|seven|eight|nine|ten|10|[1-9])(?:\s*(?:on|in)\s*(?:the\s*)?map)?\b/i;
  const pm = lower.match(phraseRegex);
  if (pm && pm[1]) {
    const key = pm[1].toLowerCase();
    if (numMap[key] !== undefined) {
      return {
        facilityIndex: numMap[key],
        facilityNumber: numMap[key] + 1
      };
    }
  }

  // "first one", "first hospital", "second one", "second hospital"
  if (/\b(?:first|1st)\s*(?:one|hospital|facility|clinic)?\b/i.test(lower) && !/\b(?:first\s+time|first\s+aid)\b/i.test(lower)) {
    return { facilityIndex: 0, facilityNumber: 1 };
  }
  if (/\b(?:second|2nd)\s*(?:one|hospital|facility|clinic)?\b/i.test(lower)) {
    return { facilityIndex: 1, facilityNumber: 2 };
  }
  if (/\b(?:third|3rd)\s*(?:one|hospital|facility|clinic)?\b/i.test(lower)) {
    return { facilityIndex: 2, facilityNumber: 3 };
  }

  return null;
}

/**
 * Check if the text matches map focus request
 */
function isMapRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();

  if (
    /\b(?:share|show|view|open|focus|display|put|pinpoint)\s+(?:the\s+)?(?:location|hospital|clinic|facility)?\s*(?:in|on)\s*(?:the\s*)?map\b/i.test(lower) ||
    /\b(?:share|show)\s+(?:the\s+)?location\b/i.test(lower) ||
    /\b(?:open|show|focus|view)\s+(?:the\s+)?map\b/i.test(lower) ||
    /\bwhere\s+is\s+it\s+on\s+(?:the\s+)?map\b/i.test(lower) ||
    /\b(?:on|in)\s+(?:the\s+)?map\b/i.test(lower) ||
    /\bmap\s*la\s*kaatunga\b/i.test(lower)
  ) {
    return true;
  }

  if (/வரைபடத்தில்\s*காட்டு|மேப்பில்\s*காட்டு|வரைபடம்|இடத்தைக்\s*காட்டு|லொகேஷன்\s*காட்டு/i.test(raw)) return true;
  if (/नक्शे\s*पर\s*दिखाओ|मानचित्र\s*पर\s*दिखाएं|मानचित्र|लोकेशन\s*दिखाओ/i.test(raw)) return true;

  return false;
}

/**
 * Check if the text matches navigation / directions request
 */
function isDirectionsRequest(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();

  if (
    /\b(?:directions?|get\s+directions?|navigate|navigation|route|how\s+do\s+i\s+get\s+there|how\s+to\s+reach|way\s+to\s+(?:the\s+)?hospital|take\s+me\s+there)\b/i.test(lower)
  ) {
    return true;
  }

  if (/வழி\s*காட்டு|திசைகள்|வழிகாட்டுதல்|எப்படி\s*போவது/i.test(raw)) return true;
  if (/दिशा\s*निर्देश|रास्ता|रास्ता\s*दिखाओ|दिशाएं|कैसे\s*पहुंचे/i.test(raw)) return true;

  return false;
}

/**
 * Check if the text matches negative / decline intent
 */
function isDecline(text) {
  if (!text) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();
  if (/^(no|nope|nah|no thanks|not now|no need|don't check|dont check|cancel|not really|nevermind|i'm good|im good|no clinic|no hospital)\b/i.test(lower)) return true;
  if (/\b(don't check|dont check|do not check|no thanks|not now|no need|no clinic|no hospital|cancel search)\b/i.test(lower)) return true;
  // Tamil
  if (/^(illai|vendaam|illa|vendam|paravala|thevaiyillai)\b/i.test(lower)) return true;
  if (raw.includes('இல்லை') || raw.includes('வேண்டாம்') || raw.includes('இல்ல') || raw.includes('வேணாம்') || raw.includes('பரவாயில்லை') || raw.includes('தேவையில்லை')) return true;
  // Hindi
  if (/^(nahi|nahin|na|rehne do|mat karo|abhi nahi|nahi chahiye)\b/i.test(lower)) return true;
  if (raw.includes('नहीं') || raw.includes('ना') || raw.includes('नहीं चाहिए') || raw.includes('रहने दीजिए') || raw.includes('रहने दो') || raw.includes('मत करो')) return true;
  return false;
}

/**
 * Check if the text matches affirmative / accept intent
 */
function isAffirmative(text) {
  if (!text) return false;
  if (isDecline(text)) return false;
  const lower = text.toLowerCase().trim();
  const raw = text.trim();
  if (/^(yes|yeah|yep|yup|sure|okay|ok|please do|certainly|go ahead|definitely|please check|check clinics|do that|sounds good|yes please)\b/i.test(lower)) return true;
  // Tamil
  if (/^(aama|aamam|sari|paarunga|pannunga|thedu|kaatunga|check pannunga)\b/i.test(lower)) return true;
  if (raw.includes('ஆமா') || raw.includes('ஆமாம்') || raw.includes('சரி') || raw.includes('பாருங்க') || raw.includes('பண்ணுங்க') || raw.includes('தேடுங்க') || raw.includes('காட்டுங்க') || raw.includes('செக் பண்ணு')) return true;
  // Hindi
  if (/^(haan|haanji|ji haan|zaroor|theek hai|sahi hai|check karo|dikhao|karo)\b/i.test(lower)) return true;
  if (raw.includes('हाँ') || raw.includes('हां') || raw.includes('ज़रूर') || raw.includes('जरूर') || raw.includes('दिखाइए') || raw.includes('खोजिए') || raw.includes('ठीक है') || raw.includes('बताइए')) return true;
  return false;
}

/**
 * Check if the assistant recently offered to check clinics / hospitals
 */
function isPendingFacilityOffer(previousAssistantMsg, pendingAction, nearbyCareStatus) {
  if (pendingAction === 'CHECK_NEARBY_CARE' || pendingAction === 'CHECK_NEARBY_CLINICS') return true;
  if (nearbyCareStatus === 'pending') return true;
  if (!previousAssistantMsg) return false;
  const prevLower = previousAssistantMsg.toLowerCase();
  return (
    /would you like me to (check|find|look up).*?(hospital|clinic)/i.test(prevLower) ||
    /check nearby (hospitals|clinics)/i.test(prevLower) ||
    /find the nearest (emergency-capable|hospital|clinic)/i.test(prevLower) ||
    previousAssistantMsg.includes('வரைபடத்தில் காட்டவா') ||
    previousAssistantMsg.includes('அஸ்பத்திரிக்கு வழிகாட்டவா') ||
    previousAssistantMsg.includes('மருத்துவமனையை காட்டவா') ||
    previousAssistantMsg.includes('अस्पताल की जानकारी दिखाऊँ') ||
    previousAssistantMsg.includes('क्लिनिक की तलाश करूँ')
  );
}

/**
 * Extract named facility query if present (e.g. "Virutcham Hospital", "show Virutcham Hospital near me")
 */
function extractNamedFacility(text) {
  if (!text) return null;
  const lower = text.toLowerCase().trim();

  // Filter out generic care requests (e.g. "suggest nearby hospital", "nearby hospital", "find nearby clinic")
  if (/^(?:i have [^,]+,\s*)?(?:suggest|find|show|locate|search|where is|nearest|closest|recommend)?\s*(?:a\s+)?(?:nearby|nearest|closest|any|local)?\s*(?:hospital|clinic|emergency room|er|urgent care)$/i.test(lower)) {
    return null;
  }
  if (/\b(?:suggest|recommend)\s+(?:a\s+)?(?:nearby|nearest|closest|local)?\s*(?:hospital|clinic)\b/i.test(lower)) {
    return null;
  }

  // Known verified facilities quick lookup
  const knownFacilities = [
    { key: 'virutcham', canonical: 'Virutcham Hospital' },
    { key: 'apollo', canonical: 'Apollo Hospitals Greams Road' },
    { key: 'kauvery', canonical: 'Kauvery Hospital Urgent & Family Care' },
    { key: 'fortis', canonical: 'Fortis Hospital' },
    { key: 'manipal', canonical: 'Manipal Hospital' },
    { key: 'aiims', canonical: 'All India Institute of Medical Sciences (AIIMS)' },
    { key: 'max super', canonical: 'Max Super Speciality Hospital Saket' },
    { key: 'cpmc', canonical: 'CPMC Van Ness Campus' },
    { key: 'harborview', canonical: 'Harborview Medical Center' },
  ];

  for (const fac of knownFacilities) {
    if (lower.includes(fac.key)) {
      return fac.canonical;
    }
  }

  // Explicit patterns like "Virutcham Hospital", "City General Emergency Room"
  const namedRegex = /\b([A-Z][a-zA-Z0-9_\-]{2,20}(?:\s+[A-Za-z0-9_\-]{2,20})*\s+(?:Hospital|Clinic|Medical Center|Health Center))\b/;
  const match = text.match(namedRegex);
  if (match) {
    const rawName = match[1].trim();
    if (!/^(Nearby|Nearest|Closest|Any|The|A|An|Local|Emergency|Some|Suggest|Find|Show)\s+/i.test(rawName)) {
      return rawName;
    }
  }

  // Tamil / Hindi named facility patterns
  if (/விருட்சம்|விருச்சம்|அப்பல்லோ|காவேரி|மணிப்பால்/i.test(text)) {
    const mTa = text.match(/([^\s]+)\s*(?:மருத்துவமனை|ஹாஸ்பிடல்|கிளினிக்)/);
    if (mTa) return mTa[0].trim();
    const mTaSingle = text.match(/(விருட்சம்|விருச்சம்|அப்பல்லோ|காவேரி|மணிப்பால்)(?:\s*மருத்துவமனை)?/);
    if (mTaSingle) return mTaSingle[0].trim() + ' மருத்துவமனை';
  }

  return null;
}

/**
 * Classify a user's utterance into exactly one primary intent.
 * 
 * @param {string} userText - The current utterance transcript
 * @param {object} context - { previousAssistantMsg, pendingAction, nearbyCareStatus, conversationHistory }
 * @returns {object} { intent, details }
 */
function classifyUserIntent(userText, context = {}) {
  const text = (userText || '').trim();
  const lower = text.toLowerCase();
  const { previousAssistantMsg = '', pendingAction = null, nearbyCareStatus = 'not_requested' } = context;

  // ─────────────────────────────────────────────────────────────────
  // 1. WAIT / INTERRUPTION (Cancel/halt current generation, keep case)
  // ─────────────────────────────────────────────────────────────────
  if (isWaitInterruption(text)) {
    return {
      intent: INTENTS.WAIT_INTERRUPTION,
      details: { raw: text }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 2. FACILITY SELECTION (e.g. "show number one", "share number one", "put number one on map")
  // MUST NEVER be treated as a symptom intake or clarification message!
  // ─────────────────────────────────────────────────────────────────
  const facilitySelection = extractFacilitySelection(text);
  if (facilitySelection) {
    return {
      intent: INTENTS.FACILITY_SELECTION,
      details: facilitySelection
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. MAP FOCUS REQUEST (e.g. "share location in map", "show in map", "focus map")
  // MUST NEVER be treated as a symptom intake or clarification message!
  // ─────────────────────────────────────────────────────────────────
  if (isMapRequest(text)) {
    return {
      intent: INTENTS.MAP_REQUEST,
      details: {}
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. DIRECTIONS / NAVIGATION REQUEST (e.g. "get directions", "take me to number one")
  // ─────────────────────────────────────────────────────────────────
  if (isDirectionsRequest(text)) {
    return {
      intent: INTENTS.DIRECTIONS_REQUEST,
      details: {}
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. EMERGENCY (Safety-first priority)
  // Severe symptoms that must bypass routine self-care:
  // shortness of breath, chest pain, fainting, vomiting blood, seizure
  // ─────────────────────────────────────────────────────────────────
  const isBreathingEmergency = (
    /\b(shortness of breath|shortness_of_breath|breathless|breathing difficulty|difficulty breathing|can't breathe|cannot breathe|can't breathe properly|cannot breathe properly|trouble breathing|hard to breathe|breathing problem)\b/i.test(lower) ||
    /மூச்சுத்திணறல்|மூச்சு\s*திணறல்|மூச்சு\s*வாங்குது|மூச்சு\s*விட\s*கஷ்டமா\s*இருக்கு|மூச்சு\s*விடவே\s*முடியல|மூச்சு\s*விட\s*கஷ்டம்/i.test(text) ||
    /सांस\s*लेने\s*में\s*तकलीफ|सांस\s*फूलना|सांस\s*बिल्कुल\s*नहीं\s*आ\s*रही|सांस\s*नहीं\s*आ\s*रही|दम\s*घुट/i.test(text)
  );

  const isChestEmergency = (
    /\b(chest pain|chest pressure|crushing chest pain|chest hurts|pressure radiating|tightness in chest)\b/i.test(lower) ||
    /நெஞ்சு\s*வலி|மார்பு\s*வலி/i.test(text) ||
    /सीने\s*में\s*(?:असहनीय\s*)?दर्द/i.test(text)
  );

  const hasEmergencyRedFlags = (
    isBreathingEmergency ||
    isChestEmergency ||
    /\b(passed out|fainted|loss of consciousness|seizure|coughing up blood|vomiting blood|severe sudden bleeding|severe bleeding|stroke symptoms|face drooping|blue lips|grey lips|blue\/grey lips|severe allergic reaction|anaphylaxis)\b/i.test(lower) ||
    /மயங்கி\s*விழுந்து|ரத்தம்\s*(கக்குது|வாந்தி)|சுயநினைவு\s*இல்லை|உதடு\s*(நீல|சாம்பல்)/i.test(text) ||
    /बेहोश\s*हो\s*गया|खून\s*की\s*उल्टी/i.test(text) ||
    // Severe fever with emergency signs
    (/\b(fever|temperature|காய்ச்சல்|बुखार)\b/i.test(lower) && /\b(confusion|hallucinating|stiff neck|seizure|cannot wake|breathing trouble|blue lips)\b/i.test(lower))
  );

  if (hasEmergencyRedFlags) {
    return {
      intent: INTENTS.EMERGENCY,
      details: {
        redFlag: true,
        isBreathing: isBreathingEmergency,
        isChest: isChestEmergency,
      }
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. FACILITY CONFIRMATIONS (When an offer was pending)
  // ─────────────────────────────────────────────────────────────────
  const hasOffer = isPendingFacilityOffer(previousAssistantMsg, pendingAction, nearbyCareStatus);

  if (hasOffer && isDecline(text)) {
    return { intent: INTENTS.FACILITY_CONFIRMATION_NO, details: { previousAction: pendingAction } };
  }

  if (hasOffer && isAffirmative(text)) {
    return { intent: INTENTS.FACILITY_CONFIRMATION_YES, details: { previousAction: pendingAction } };
  }

  // Standalone decline of hospital/care (e.g. "no hospital", "don't check clinics", "no")
  if (isDecline(text)) {
    if (/\b(hospital|clinic|doctor|care|மருத்துவமனை|கிளினிக்|அஸ்பத்தால்|அஸ்பத்திரி|अस्पताल)\b/i.test(lower) || hasOffer) {
      return { intent: INTENTS.FACILITY_CONFIRMATION_NO, details: { standaloneDecline: true } };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. NAMED FACILITY SEARCH (e.g. "Virutcham Hospital near me")
  // ─────────────────────────────────────────────────────────────────
  const namedFacility = extractNamedFacility(text);
  if (namedFacility) {
    return { intent: INTENTS.NAMED_FACILITY_SEARCH, details: { facilityName: namedFacility } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. "DON'T TELL ME TO GO TO A DOCTOR" / SELF-CARE / HOME REMEDIES
  // (Check BEFORE generic care search so "don't suggest doctor" is not routed as hospital search!)
  // ─────────────────────────────────────────────────────────────────
  const isAntiDoctor = (
    /\b(?:don'?t|do\s*not|no|stop)\s+(?:tell|suggest|recommend|say|ask)\s+(?:me\s+)?(?:to\s+)?(?:go|visit|see|consult)\s+(?:a\s+)?(?:doctor|hospital|healthcare|clinic|provider)\b/i.test(lower) ||
    /\b(?:don'?t|do\s*not|no)\s+(?:suggest|recommend)\s+(?:doctor|hospital|healthcare|clinic)\b/i.test(lower) ||
    /\bcan'?t\s+(?:go|visit|see|afford)\s+(?:a\s+)?(?:doctor|hospital|clinic)\b/i.test(lower) ||
    /\bunable\s+to\s+(?:go|visit|see)\s+(?:a\s+)?(?:doctor|hospital)\b/i.test(lower) ||
    /டாக்டரிடம்\s*சொல்லாதே|மருத்துவரிடம்\s*போக\s*வேண்டாம்|மருத்துவமனை\s*வேண்டாம்|வீட்டு\s*வைத்தியம்/i.test(text) ||
    /डॉक्टर\s*के\s*पास\s*मत\s*भेजो|डॉक्टर\s*की\s*सलाह\s*मत\s*दो|घरेलू\s*इलाज|घर\s*पर\s*इलाज/i.test(text)
  );

  const isSelfCareRequest = (
    isAntiDoctor ||
    /\b(?:cure|home\s*cure|home\s*remedy|home\s*remedies|remedy|treat\s+at\s+home|what\s+can\s+i\s+do\s+at\s+home|self\s*care|care\s+at\s+home|how\s+to\s+cure|cure\s+for\s+fever)\b/i.test(lower) ||
    /வீட்டு\s*வைத்தியம்|வீட்டிலேயே\s*சரிசெய்ய|சுய\s*பராமரிப்பு/i.test(text) ||
    /घरेलू\s*नुस्खे|घरेलू\s*उपचार|घर\s*पर\s*क्या\s*करें/i.test(text)
  );

  if (isSelfCareRequest) {
    return { intent: INTENTS.SELF_CARE, details: { antiDoctor: isAntiDoctor } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 9. MEDICINE REQUEST (e.g. "what medicine can I take", "tablet for fever")
  // ─────────────────────────────────────────────────────────────────
  const isMedicine = (
    /\b(medicine|medication|tablets?|pills?|syrup|capsules?|dosage|what\s+can\s+i\s+take|take\s+for|suggest\s+(?:some\s+)?medicine|any\s+medicine|high\s+fever\s+medicine|fever\s+medicine|medicine\s+for\s+fever)\b/i.test(lower) ||
    /மருந்து|மாத்திரை|சிரப்|என்ன\s*மருந்து\s*எடுக்கலாம்|மருந்து\s*சொல்லு/i.test(text) ||
    /दवा|दवाई|गोली|सिरप|क्या\s*दवा\s*लूँ|दवा\s*बताएं/i.test(text)
  );

  if (isMedicine) {
    return { intent: INTENTS.MEDICINE_REQUEST, details: {} };
  }

  // ─────────────────────────────────────────────────────────────────
  // 10. EXPLICIT HOSPITAL / EMERGENCY ROOM SEARCH
  // ─────────────────────────────────────────────────────────────────
  const isHospitalSearch = (
    /\b(?:suggest|find|show|locate|search|nearest|closest|near\s+me|nearby)\s+(?:a\s+)?(?:nearby\s+)?(?:hospital|emergency\s*room|er)s?\b/i.test(lower) ||
    /\b(?:hospital|emergency\s*room|er)s?\s+near\s+me\b/i.test(lower) ||
    /\bnearby\s+hospitals?\b/i.test(lower) ||
    /\bsearch\s+(?:nearby\s+)?hospitals?\b/i.test(lower) ||
    /\bnear\s+me\s+hospitals?\b/i.test(lower) ||
    /\bshow\s+hospitals?\b/i.test(lower) ||
    /\bfind\s+(?:a\s+)?hospitals?\b/i.test(lower) ||
    /\bsuggest\s+(?:a\s+)?nearby\s+hospitals?\b/i.test(lower) ||
    /\bwhere\s+is\s+(?:the\s+)?(?:nearest|closest)?\s*hospital\b/i.test(lower) ||
    /அருகில்\s*உள்ள\s*மருத்துவமனை|மருத்துவமனை\s*பரிந்துரை|மருத்துவமனை\s*எங்கே|அஸ்பத்தால்\s*காட்டு|மருத்துவமனையை\s*தேடு/i.test(text) ||
    /नजदीकी\s*अस्पताल|अस्पताल\s*खोजें|पास\s*का\s*अस्पताल|अस्पताल\s*बताएं/i.test(text)
  );

  if (isHospitalSearch) {
    return { intent: INTENTS.NEARBY_HOSPITAL, details: { careType: 'emergency' } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 11. EXPLICIT CLINIC / URGENT CARE SEARCH
  // ─────────────────────────────────────────────────────────────────
  const isClinicSearch = (
    /\b(?:suggest|find|show|locate|search|nearest|closest|near\s+me|nearby)\s+(?:a\s+)?(?:nearby\s+)?(?:clinic|urgent\s*care|walk-?in\s*clinic|doctor's\s*office)s?\b/i.test(lower) ||
    /\b(?:clinic|urgent\s*care)s?\s+near\s+me\b/i.test(lower) ||
    /\bnearby\s+clinics?\b/i.test(lower) ||
    /\bsearch\s+(?:nearby\s+)?clinics?\b/i.test(lower) ||
    /\bshow\s+clinics?\b/i.test(lower) ||
    /\bfind\s+(?:a\s+)?clinics?\b/i.test(lower) ||
    /\bsuggest\s+(?:a\s+)?nearby\s+clinics?\b/i.test(lower) ||
    /அருகில்\s*உள்ள\s*கிளினிக்|கிளினிக்\s*பரிந்துரை|கிளினிக்\s*எங்கே/i.test(text) ||
    /नजदीकी\s*क्लिनिक|क्लिनिक\s*खोजें|पास\s*का\s*क्लिनिक/i.test(text)
  );

  if (isClinicSearch) {
    return { intent: INTENTS.NEARBY_CLINIC, details: { careType: 'urgent_care' } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 12. SYMPTOM TRIAGE (asking "what could this be", "diagnose me")
  // ─────────────────────────────────────────────────────────────────
  const isTriageQuery = (
    /\b(what\s+could\s+(?:this|it)\s+be|what\s+do\s+i\s+have|diagnose|is\s+this\s+serious|triage\s+this|what\s+disease|what\s+infection)\b/i.test(lower) ||
    /இது\s*என்னவா\s*இருக்கும்|என்ன\s*நோய்|கணிப்பு\s*என்ன/i.test(text) ||
    /यह\s*क्या\s*हो\s*सकता\s*है|मुझे\s*क्या\s*बीमारी\s*है|लक्षण\s*जांचें/i.test(text)
  );

  if (isTriageQuery) {
    return { intent: INTENTS.SYMPTOM_TRIAGE, details: {} };
  }

  // ─────────────────────────────────────────────────────────────────
  // 13. SYMPTOM INFORMATION (stating symptoms or answering questions)
  // ─────────────────────────────────────────────────────────────────
  const hasSymptomKeywords = (
    /\b(fever|headache|migraine|dizzy|dizziness|nausea|vomit|vomiting|cough|sore\s*throat|chest\s*pain|stomach\s*pain|abdominal|back\s*pain|knee\s*pain|knees|joint\s*pain|rash|weakness|fatigue|temperature|chills|shivering|body\s*pain|hurts|pain|shortness\s*of\s*breath|shortness_of_breath|breathing|breathless|eye\s*pain|vision|eyes?|tooth|teeth|toothache|dental)\b/i.test(lower) ||
    /காய்ச்சல்|தலைவலி|நெஞ்சு\s*வலி|வயிற்று\s*வலி|முழங்கால்\s*வலி|முட்டி\s*வலி|வாந்தி|மயக்கம்|இருமல்|தொண்டை\s*வலி|சோர்வு|உடம்பு\s*வலி|வலிக்குது|மூச்சுத்திணறல்|மூச்சு\s*வாங்குது|மூச்சு\s*திணறல்|கண்\s*வலி|பல்\s*வலி/i.test(text) ||
    /बुखार|सिरदर्द|सीने\s*में\s*दर्द|पेट\s*दर्द|घुटने\s*में\s*दर्द|उल्टी|चक्कर|खांसी|गले\s*में\s*खराश|थकान|बदन\s*दर्द|सांस|आँख|आंख|दांत/i.test(text) ||
    // Numerical temperature or age responses (e.g. "101 and 25 years old", "38 degrees", "28 years old")
    /\b(?:10[0-5]|9[7-9])(?:\.[0-9])?\s*(?:degrees|f|c)?\b/i.test(lower) ||
    /\b(?:i\s*am|age\s*is|age)\s*\d{1,3}\b/i.test(lower) ||
    /\bno\s+allergies|allergic\s+to\b/i.test(lower)
  );

  if (hasSymptomKeywords) {
    return { intent: INTENTS.SYMPTOM_INFORMATION, details: {} };
  }

  // ─────────────────────────────────────────────────────────────────
  // 14. CLARIFICATION / GREETINGS / HOLD
  // ─────────────────────────────────────────────────────────────────
  return { intent: INTENTS.CLARIFICATION, details: {} };
}

module.exports = {
  INTENTS,
  classifyUserIntent,
  isDecline,
  isAffirmative,
  extractNamedFacility,
  isPendingFacilityOffer,
  isWaitInterruption,
  normalizeConversationalControl,
  stripControlPrefix,
  extractFacilitySelection,
  isMapRequest,
  isDirectionsRequest,
};

