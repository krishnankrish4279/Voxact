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
 */

const INTENTS = {
  EMERGENCY: 'emergency',
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
  // 1. EMERGENCY (Safety-first priority)
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
  // 2. FACILITY CONFIRMATIONS (When an offer was pending)
  // ─────────────────────────────────────────────────────────────────
  const hasOffer = isPendingFacilityOffer(previousAssistantMsg, pendingAction, nearbyCareStatus);

  if (hasOffer && isDecline(text)) {
    return { intent: INTENTS.FACILITY_CONFIRMATION_NO, details: { previousAction: pendingAction } };
  }

  if (hasOffer && isAffirmative(text)) {
    return { intent: INTENTS.FACILITY_CONFIRMATION_YES, details: { previousAction: pendingAction } };
  }

  // Standalone decline of hospital/care (e.g. "no hospital", "don't check clinics")
  if (isDecline(text) && /\b(hospital|clinic|doctor|care|மருத்துவமனை|கிளினிக்|अस्पताल)\b/i.test(lower)) {
    return { intent: INTENTS.FACILITY_CONFIRMATION_NO, details: { standaloneDecline: true } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 3. NAMED FACILITY SEARCH (e.g. "Virutcham Hospital near me")
  // ─────────────────────────────────────────────────────────────────
  const namedFacility = extractNamedFacility(text);
  if (namedFacility) {
    return { intent: INTENTS.NAMED_FACILITY_SEARCH, details: { facilityName: namedFacility } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. "DON'T TELL ME TO GO TO A DOCTOR" / SELF-CARE / HOME REMEDIES
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
  // 5. MEDICINE REQUEST (e.g. "what medicine can I take", "tablet for fever")
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
  // 6. EXPLICIT HOSPITAL / EMERGENCY ROOM SEARCH
  // ─────────────────────────────────────────────────────────────────
  const isHospitalSearch = (
    /\b(?:suggest|find|show|locate|search|nearest|closest|near\s+me)\s+(?:a\s+)?(?:hospital|emergency\s*room|er)\b/i.test(lower) ||
    /\b(?:hospital|emergency\s*room|er)\s+near\s+me\b/i.test(lower) ||
    /\bsuggest\s+(?:a\s+)?nearby\s+hospital\b/i.test(lower) ||
    /\bwhere\s+is\s+(?:the\s+)?(?:nearest|closest)?\s*hospital\b/i.test(lower) ||
    /அருகில்\s*உள்ள\s*மருத்துவமனை|மருத்துவமனை\s*பரிந்துரை|மருத்துவமனை\s*எங்கே|அஸ்பத்தால்\s*காட்டு/i.test(text) ||
    /नजदीकी\s*अस्पताल|अस्पताल\s*खोजें|पास\s*का\s*अस्पताल|अस्पताल\s*बताएं/i.test(text)
  );

  if (isHospitalSearch) {
    return { intent: INTENTS.NEARBY_HOSPITAL, details: { careType: 'emergency' } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. EXPLICIT CLINIC / URGENT CARE SEARCH
  // ─────────────────────────────────────────────────────────────────
  const isClinicSearch = (
    /\b(?:suggest|find|show|locate|search|nearest|closest|near\s+me)\s+(?:a\s+)?(?:clinic|urgent\s*care|walk-?in\s*clinic|doctor's\s*office)\b/i.test(lower) ||
    /\b(?:clinic|urgent\s*care)\s+near\s+me\b/i.test(lower) ||
    /\bsuggest\s+(?:a\s+)?nearby\s+clinic\b/i.test(lower) ||
    /அருகில்\s*உள்ள\s*கிளினிக்|கிளினிக்\s*பரிந்துரை|கிளினிக்\s*எங்கே/i.test(text) ||
    /नजदीकी\s*क्लिनिक|क्लिनिक\s*खोजें|पास\s*का\s*क्लिनिक/i.test(text)
  );

  if (isClinicSearch) {
    return { intent: INTENTS.NEARBY_CLINIC, details: { careType: 'urgent_care' } };
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. SYMPTOM TRIAGE (asking "what could this be", "diagnose me")
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
  // 9. SYMPTOM INFORMATION (stating symptoms or answering questions)
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
  // 10. CLARIFICATION / GREETINGS / HOLD
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
};
