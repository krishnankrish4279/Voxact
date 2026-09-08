/**
 * VoxAct — Medical Speech Normalizer
 * 
 * Clinical normalization layer placed AFTER SpeechRecognition and BEFORE triage/LLM.
 * Preserves rawTranscript and generates normalizedTranscript separately.
 * 
 * Safety Rules:
 * 1. Never silently replace or destroy the user's original raw transcript.
 * 2. Normalizes colloquial speech variants and ASR errors to canonical clinical terms.
 * 3. Ambiguous phrases must NOT be aggressively rewritten into acute emergencies;
 *    instead, flag ambiguity and propose clinical clarification prompts.
 */

// Canonical Tamil clinical phrases and their spoken/phonetic/colloquial variants
const TAMIL_MEDICAL_DICTIONARY = [
  {
    canonical: 'நெஞ்சு வலி',
    category: 'cardiovascular',
    severity: 'emergency',
    variants: [
      'நெஞ்சுவலி', 'நெஞ்சில வலி', 'நெஞ்சுல வலி', 'நெஞ்சு நோவு', 'நெஞ்சு அடைக்குது',
      'மார்பு வலி', 'மார்புவலி', 'மார்பில வலி', 'மார்புல வலி',
      'நஞச வல', 'நஞ்ச வல', 'நஞ்ச வலி', 'நஞ்சவலி', 'நெஞ்ச வல', 'நெஞ்ச வலி', 'எனகக நஞச வல',
      'nenju vali', 'nenjuvali', 'nenjula vali', 'nenjila vali', 'nenju novu',
      'marbu vali', 'marbuvali', 'marbula vali', 'marbila vali'
    ]
  },
  {
    canonical: 'மூச்சுத்திணறல்',
    category: 'respiratory',
    severity: 'emergency',
    variants: [
      'மூச்சு திணறல்', 'மூச்சுத்திணறலா இருக்கு', 'மூச்சு திணறலா இருக்கு',
      'மூச்சு விட கஷ்டம்', 'மூச்சுவிட கஷ்டம்', 'மூச்சு விட கஷ்டமா இருக்கு',
      'மூச்சு விட முடியல', 'மூச்சுவிட முடியல', 'மூச்சு வாங்க முடியல', 'மூச்சு திணறுது',
      'moochu thinarthal', 'moochu thinaral', 'moochu vida kashtam', 'moochu vida mudiyala',
      'moochu vaanga mudiyala', 'moochu vida kashtama irukku'
    ]
  },
  {
    canonical: 'தலைவலி',
    category: 'neurological',
    severity: 'medium',
    variants: [
      'தலவலி', 'தலை வலி', 'தலையில வலி', 'தலைல வலி', 'தல நோவு',
      'தலை சுத்துது', 'தலை சுற்றல்', 'தலை சுத்துற மாதிரி இருக்கு',
      'thala vali', 'thalavali', 'thalaivali', 'thalaila vali', 'thala suthudhu', 'thala suthal'
    ]
  },
  {
    canonical: 'வயிற்று வலி',
    category: 'gastrointestinal',
    severity: 'medium',
    variants: [
      'வயிறு வலி', 'வயித்து வலி', 'வயித்துல வலி', 'வயிறு நோவு', 'வயித்து நோவு',
      'வயிறு பிடிக்குது', 'வயித்து எரிச்சல்', 'வயிறு எரியுது',
      'vayiru vali', 'vayithu vali', 'vayithula vali', 'vayiru novu', 'vayithu erichal'
    ]
  },
  {
    canonical: 'மயக்கம்',
    category: 'neurological_cardiac',
    severity: 'high',
    variants: [
      'மயக்கமா இருக்கு', 'மயக்கம் வருது', 'மயங்கிட்டேன்', 'மயங்கி விழுந்துட்டேன்',
      'கண் இருட்டுது', 'கண் இருண்டு போகுது',
      'mayakkam', 'mayakkama irukku', 'mayangi vizhundhutten', 'kan iruttudhu'
    ]
  },
  {
    canonical: 'வாந்தி',
    category: 'gastrointestinal',
    severity: 'medium',
    variants: [
      'வாந்தியா இருக்கு', 'வாந்தி வருது', 'வாந்தி எடுத்தேன்', 'வாந்தி குமட்டல்', 'குமட்டல்',
      'vanthi', 'vaanthi', 'vaanthi varudhu', 'vaanthi varugiradhu', 'vaanthi irukku', 'kumattal',
      'enaku vomit aagudhu', 'vomit aagudhu', 'vomit aaguthu', 'vomit', 'vomiting'
    ]
  },
  {
    canonical: 'முழங்கால் வலி',
    category: 'musculoskeletal',
    severity: 'low',
    variants: [
      'முழங்கால்வலி', 'முழங்கால் வலி', 'முழங்கால்ல வலி', 'முழங்காலில் வலி', 'முழங்கால்', 'முழங்கால் வலிக்குது',
      'முட்டி வலி', 'முட்டில வலி', 'முட்டில பெயின்', 'முட்டி நோவு', 'முட்டில pain',
      'கால் வலி', 'கால்வலி', 'காலில் வலி', 'கால்ல வலி',
      'muzhang kaal vali', 'muzhangal vali', 'muthangal vali', 'muthaangal vali', 'muzhang kaal', 'muzhangaal',
      'mutti vali', 'muttile pain', 'muttila pain', 'mutti pain', 'mutti novu',
      'knee la romba pain', 'knee pain', 'full knee pain', 'kaal vali', 'kaalvali'
    ]
  },
  {
    canonical: 'பலவீனம்',
    category: 'general',
    severity: 'low',
    variants: [
      'சோர்வு', 'களைப்பு', 'உடம்பு பலவீனம்', 'உடம்பு முடியல', 'உடம்பு ரொம்ப முடியல', 'முடியல', 'ரொம்ப முடியல',
      'உடம்பு பலவீனமா இருக்கு', 'உடம்பு அசதியா இருக்கு', 'அசதி',
      'weakness', 'weak', 'weak-aa irukku', 'weak aa irukku', 'weak ah irukku',
      'udambu romba weak aa irukku', 'udambu romba weak-aa irukku', 'udambu weak aa irukku',
      'udambu romba mudiyala', 'udambu mudiyala', 'romba mudiyala', 'balaveenam'
    ]
  },
  {
    canonical: 'மூக்கடைப்பு',
    category: 'respiratory',
    severity: 'low',
    variants: [
      'மூக்கு அடைச்சிருக்கு', 'மூக்கு அடைப்பு', 'மூக்கு அடைசல்',
      'mooku adachirukku', 'mooku adapu'
    ]
  },
  {
    canonical: 'காய்ச்சல்',
    category: 'infectious',
    severity: 'medium',
    variants: [
      'ஜுரம்', 'சுரம்', 'காய்ச்சலா இருக்கு', 'ஜுரமா இருக்கு', 'சூடா இருக்கு உடம்பு',
      'உடம்பு கொதிக்குது', 'குளிர் நடுக்கம்',
      'kaichal', 'juram', 'suram', 'kaichala irukku', 'jurama irukku', 'kulir nadukkam'
    ]
  },
  {
    canonical: 'இரத்தம்',
    category: 'trauma_vascular',
    severity: 'high',
    variants: [
      'ரத்தம்', 'இரத்தம் போகுது', 'ரத்தம் வருது', 'ரத்தம் கசியுது', 'ரத்தப்போக்கு',
      'ratham', 'iratham', 'raththam', 'ratham pogudhu', 'ratham varudhu'
    ]
  },
  {
    canonical: 'இதயத் துடிப்பு',
    category: 'cardiovascular',
    severity: 'high',
    variants: [
      'நெஞ்சு படபடப்பு', 'படபடப்பா இருக்கு', 'இதய துடிப்பு', 'இதய படபடப்பு', 'இதயம் வேகமா அடிக்குது',
      'nenju padapadappu', 'padapadappa irukku', 'idhaya thudippu', 'idhayam vegama adikudhu'
    ]
  },
  {
    canonical: 'இரத்த அழுத்தம்',
    category: 'cardiovascular',
    severity: 'medium',
    variants: [
      'பிபி', 'பிரஷர்', 'உயர் இரத்த அழுத்தம்', 'லோ பிபி', 'ஹை பிபி',
      'bp', 'high bp', 'low bp', 'pressure', 'high pressure'
    ]
  }
];

// Ambiguous phrases in Tamil that must NOT be rewritten into acute emergencies
const TAMIL_AMBIGUOUS_PATTERNS = [
  {
    regex: /(?:உடம்பு\s*சரியில்ல(?:ை)?|உடம்பு\s*ஒரு\s*மாதிரி\s*இருக்கு|ஒடம்பு\s*சரியில்ல|odambu\s*sariyilla|udambu\s*sariyillai)/i,
    prompt: 'உங்களுக்கு என்ன செய்கிறது என்று கொஞ்சம் விளக்கமாக கூற முடியுமா? காய்ச்சல் அல்லது வலி உள்ளதா?'
  },
  {
    regex: /(?:வலியா\s*இருக்கு|வலிகுது|வலிக்கிறது|valiya\s*irukku|valikkudhu)/i,
    excludeIfMatches: /(?:நெஞ்சு|மார்பு|தலை|வயிறு|முழங்கால்|முட்டி|கால்|Nenju|Marbu|Thala|Vayiru|Muzhang|Mutti|Kaal|Knee)/i,
    prompt: 'உடலில் எந்தப் பகுதியில் வலிக்கிறது என்று சொல்ல முடியுமா?'
  },
  {
    regex: /(?:ஒரு\s*மாதிரியா\s*இருக்கு|அசதியா\s*இருக்கு|tired\s*ஆ\s*இருக்கு)/i,
    excludeIfMatches: /(?:வாந்தி|பலவீனம்|weak|mudiyala|முடியல)/i,
    prompt: 'அசதியாக உள்ளதா அல்லது மயக்கமாக உள்ளதா என்பதை தெளிவுபடுத்த முடியுமா?'
  }
];

// Canonical Hindi medical dictionary
const HINDI_MEDICAL_DICTIONARY = [
  {
    canonical: 'सीने में दर्द',
    category: 'cardiovascular',
    severity: 'emergency',
    variants: [
      'छाती में दर्द', 'सीने में भारीपन', 'दिल में दर्द',
      'seene me dard', 'seene mein dard', 'chhati me dard', 'dil me dard'
    ]
  },
  {
    canonical: 'सांस लेने में तकलीफ',
    category: 'respiratory',
    severity: 'emergency',
    variants: [
      'सांस फूलना', 'सांस फूल रही है', 'दम घुट रहा है', 'सांस नहीं आ रही',
      'saans lene me taklif', 'saans phoolna', 'dam ghutna', 'saans nahi aa rahi'
    ]
  },
  {
    canonical: 'सिरदर्द',
    category: 'neurological',
    severity: 'medium',
    variants: [
      'सिर में दर्द', 'सर दर्द', 'सर में दर्द', 'चक्कर आ रहा है',
      'sirdard', 'sir dard', 'sir me dard', 'chakkar'
    ]
  },
  {
    canonical: 'पेट दर्द',
    category: 'gastrointestinal',
    severity: 'medium',
    variants: [
      'पेट में दर्द', 'पेट खराब', 'pet dard', 'pet me dard'
    ]
  },
  {
    canonical: 'बुखार',
    category: 'infectious',
    severity: 'medium',
    variants: [
      'तेज बुखार', 'तप रहा है', 'ताप', 'bukhar', 'tez bukhar'
    ]
  },
  {
    canonical: 'खून बहना',
    category: 'trauma_vascular',
    severity: 'high',
    variants: [
      'खून निकल रहा है', 'रक्तस्त्राव', 'khoon nikalna', 'khoon behna'
    ]
  }
];

// Ambiguous Hindi patterns
const HINDI_AMBIGUOUS_PATTERNS = [
  {
    regex: /(?:तबीयत\s*खराब\s*है|तबियत\s*ठीक\s*नहीं\s*है|अच्छा\s*नहीं\s*लग\s*रहा|tabiyat\s*kharab\s*hai)/i,
    prompt: 'क्या आप बता सकते हैं कि आपको क्या तकलीफ हो रही है? जैसे बुखार, दर्द या चक्कर?'
  },
  {
    regex: /(?:दर्द\s*हो\s*रहा\s*है|dard\s*ho\s*raha\s*hai)/i,
    excludeIfMatches: /(?:सीने|छाती|सिर|सर|पेट|seene|chhati|sir|pet)/i,
    prompt: 'शरीर के किस हिस्से में दर्द हो रहा है?'
  }
];

/**
 * Normalizes speech-to-text transcripts for clinical triage.
 * Always keeps rawTranscript untouched and returns a distinct normalizedTranscript.
 * 
 * @param {string} rawTranscript - Exact raw output from SpeechRecognition
 * @param {string} language - 'ta', 'hi', or 'en'
 * @returns {object} Normalization result with clinical metadata
 */
function normalizeMedicalSpeech(rawTranscript, language = 'en') {
  if (!rawTranscript || typeof rawTranscript !== 'string') {
    return {
      rawTranscript: '',
      normalizedTranscript: '',
      detectedMedicalTerms: [],
      isAmbiguous: false,
      clarificationPrompt: null,
      language: language || 'en',
    };
  }

  const raw = rawTranscript.trim();
  let normalized = raw;
  const detectedMedicalTerms = [];
  let isAmbiguous = false;
  let clarificationPrompt = null;

  const lang = (language || 'en').toLowerCase();

  // 1. Process Tamil
  if (lang === 'ta' || /[\u0B80-\u0BFF]/.test(raw)) {
    // Restore common Tamil ASR pronoun drops
    normalized = normalized
      .replace(/(?:^|\s)எனகக(?:\s|$)/g, (m) => m.replace('எனகக', 'எனக்கு'))
      .replace(/(?:^|\s)உஙகளுகக(?:\s|$)/g, (m) => m.replace('உஙகளுகக', 'உங்களுக்கு'));

    // Check ambiguity safety first
    for (const amb of TAMIL_AMBIGUOUS_PATTERNS) {
      if (amb.regex.test(raw)) {
        if (!amb.excludeIfMatches || !amb.excludeIfMatches.test(raw)) {
          isAmbiguous = true;
          clarificationPrompt = amb.prompt;
          break;
        }
      }
    }

    // Match medical dictionary variants and normalize
    for (const entry of TAMIL_MEDICAL_DICTIONARY) {
      let matchedVariant = null;

      // Check canonical exact match
      if (normalized.includes(entry.canonical)) {
        matchedVariant = entry.canonical;
      } else {
        // Check variants
        for (const variant of entry.variants) {
          const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(^|\\s|[.,!?])${escaped}($|\\s|[.,!?])`, 'i');
          if (regex.test(normalized)) {
            matchedVariant = variant;
            normalized = normalized.replace(regex, `$1${entry.canonical}$2`).trim();
            break;
          }
        }
      }

      if (matchedVariant) {
        detectedMedicalTerms.push({
          canonical: entry.canonical,
          category: entry.category,
          severity: entry.severity,
          matchedVariant,
        });
      }
    }
  }

  // 2. Process Hindi
  else if (lang === 'hi' || /[\u0900-\u097F]/.test(raw)) {
    for (const amb of HINDI_AMBIGUOUS_PATTERNS) {
      if (amb.regex.test(raw)) {
        if (!amb.excludeIfMatches || !amb.excludeIfMatches.test(raw)) {
          isAmbiguous = true;
          clarificationPrompt = amb.prompt;
          break;
        }
      }
    }

    for (const entry of HINDI_MEDICAL_DICTIONARY) {
      let matchedVariant = null;
      if (normalized.includes(entry.canonical)) {
        matchedVariant = entry.canonical;
      } else {
        for (const variant of entry.variants) {
          const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(^|\\s|[.,!?])${escaped}($|\\s|[.,!?])`, 'i');
          if (regex.test(normalized)) {
            matchedVariant = variant;
            normalized = normalized.replace(regex, `$1${entry.canonical}$2`).trim();
            break;
          }
        }
      }

      if (matchedVariant) {
        detectedMedicalTerms.push({
          canonical: entry.canonical,
          category: entry.category,
          severity: entry.severity,
          matchedVariant,
        });
      }
    }
  }

  // 3. Process English (common speech misrecognitions & contractions)
  else {
    // Contextual ASR correction (e.g. "please" -> "knees")
    // When preceded or followed by body-pain / medical patterns
    let hasStrongKneeContext = false;
    const testKneeContext = /\b(pain\s+in\s+(?:my\s+)?|hurts?\s+(?:in\s+)?(?:my\s+)?|swelling\s+in\s+(?:my\s+)?|trouble\s+bending\s+(?:my\s+)?|both\s+|in\s+my\s+)(?:please|place)\b|\b(?:my|both|left|right)\s+(?:please|place)\s+(?:hurt|hurts|ache|aches|swelling|sore|stiff)\b|\b(?:my\s+)(?:please|place)\s+hurts?\b/i;
    if (testKneeContext.test(normalized)) {
      hasStrongKneeContext = true;
      normalized = normalized.replace(/\b(pain\s+in\s+(?:my\s+)?)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b((?:my|both|left|right)\s+)(?:please|place)(\s+(?:hurt|hurts|ache|aches|swelling|sore|stiff))\b/gi, '$1knees$2');
      normalized = normalized.replace(/\b(hurts?\s+(?:in\s+)?(?:my\s+)?)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b(swelling\s+in\s+(?:my\s+)?)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b(trouble\s+bending\s+(?:my\s+)?)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b(both\s+)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b(in\s+my\s+)(?:please|place)\b/gi, '$1knees');
      normalized = normalized.replace(/\b(?:my\s+)(?:please|place)(\s+hurts?)\b/gi, 'my knees$1');
    }

    const englishAmbiguous = [
      {
        regex: /(?:i\s*feel\s*sick|i\s*don't\s*feel\s*well|not\s*feeling\s*well|something\s*is\s*wrong)/i,
        prompt: 'Can you describe specifically what symptoms you are experiencing, such as pain, nausea, or fever?'
      },
      {
        regex: /(?:it\s*hurts|i\s*have\s*pain)/i,
        excludeIfMatches: /(?:chest|head|stomach|arm|leg|back|abdomen|throat|ear|knee|knees)/i,
        prompt: 'Where specifically in your body are you experiencing the pain?'
      }
    ];

    for (const amb of englishAmbiguous) {
      if (amb.regex.test(raw) || amb.regex.test(normalized)) {
        const matchesExclusion = (amb.excludeIfMatches && (amb.excludeIfMatches.test(raw) || amb.excludeIfMatches.test(normalized)));
        if (!matchesExclusion) {
          isAmbiguous = true;
          clarificationPrompt = amb.prompt;
          break;
        }
      }
    }

    // If "please" was spoken in a medical query without strong contextual correction, prompt for clarification rather than storing "please"
    if (!hasStrongKneeContext && /\bplease\b/i.test(raw) && /\b(pain|hurt|hurts|ache|swelling|doctor|clinic|help|vali)\b/i.test(raw)) {
      isAmbiguous = true;
      clarificationPrompt = (lang === 'ta' || /[\u0B80-\u0BFF]/.test(raw)) ? 'நீங்க knee-la pain இருக்குன்னு சொல்றீங்களா?' : 'Did you mean pain in your knees?';
    }

    const EN_DICTIONARY = [
      { canonical: 'chest pain', category: 'cardiovascular', severity: 'emergency', variants: ['chest hurts', 'chest ache', 'pain in chest', 'tightness in chest'] },
      { canonical: 'shortness of breath', category: 'respiratory', severity: 'emergency', variants: ['hard to breathe', 'cannot breathe', "can't breathe", 'trouble breathing', 'breathless'] },
      { canonical: 'headache', category: 'neurological', severity: 'medium', variants: ['head hurts', 'head ache', 'migraine', 'pounding head'] },
      { canonical: 'abdominal pain', category: 'gastrointestinal', severity: 'medium', variants: ['stomach pain', 'stomach ache', 'belly pain', 'tummy ache'] },
      { canonical: 'dizziness', category: 'neurological_cardiac', severity: 'high', variants: ['lightheaded', 'feeling dizzy', 'fainted', 'passed out'] },
      { canonical: 'knee pain', category: 'musculoskeletal', severity: 'low', variants: ['knees hurt', 'knee hurts', 'pain in knee', 'pain in knees', 'pain in my knee', 'pain in my knees', 'knee ache', 'sore knees', 'swollen knees', 'knees pain'] },
      { canonical: 'vomiting', category: 'gastrointestinal', severity: 'medium', variants: ['throwing up', 'threw up', 'puking', 'vomit', 'vomited', 'vomiting'] },
      { canonical: 'weakness', category: 'general', severity: 'low', variants: ['feeling weak', 'very weak', 'so weak', 'exhausted', 'loss of strength'] },
    ];

    for (const entry of EN_DICTIONARY) {
      let matchedVariant = null;
      const canonicalRegex = new RegExp(`\\b${entry.canonical}\\b`, 'i');
      if (canonicalRegex.test(normalized)) {
        matchedVariant = entry.canonical;
      } else {
        for (const variant of entry.variants) {
          const regex = new RegExp(`\\b${variant}\\b`, 'i');
          if (regex.test(normalized)) {
            matchedVariant = variant;
            normalized = normalized.replace(regex, entry.canonical);
            break;
          }
        }
      }
      if (matchedVariant) {
        detectedMedicalTerms.push({
          canonical: entry.canonical,
          category: entry.category,
          severity: entry.severity,
          matchedVariant,
        });
      }
    }
  }

  normalized = normalized.replace(/\s+/g, ' ').trim();

  // If specific medical terms were detected, clear general ambiguity
  if (detectedMedicalTerms.length > 0) {
    isAmbiguous = false;
    clarificationPrompt = null;
  }

  return {
    rawTranscript: raw,
    normalizedTranscript: normalized,
    detectedMedicalTerms,
    isAmbiguous,
    clarificationPrompt,
    language: lang,
  };
}

/**
 * Deterministic clinical symptom extractor placed before LLM triage.
 * Extracts symptoms/body parts, explicitly stated severity, and timeline without hallucination.
 * 
 * @param {string} text - Raw or normalized user speech
 * @param {string} language - 'en', 'ta', or 'hi'
 * @returns {object} Extracted symptoms and clinical modifiers
 */
function extractClinicalSymptoms(text, language = 'en') {
  if (!text || typeof text !== 'string') {
    return {
      symptoms: [],
      severity: null,
      duration: null,
      associated: [],
      isAmbiguous: false,
      clarificationPrompt: null,
      normalizedTranscript: '',
      rawTranscript: ''
    };
  }

  const norm = normalizeMedicalSpeech(text, language);
  const rawLower = text.toLowerCase();
  const normLower = norm.normalizedTranscript.toLowerCase();

  const symptoms = [];

  // Severity extraction ('mild' | 'moderate' | 'severe' | 'unknown')
  let mappedSeverity = 'unknown';
  if (/ரொம்ப\s*வலி|அதிக\s*வலி|தாங்க\s*முடியாத|severe|intense|unbearable|very\s*bad|terrible|तेज\s*दर्द/i.test(rawLower) ||
      norm.detectedMedicalTerms.some(t => t.severity === 'emergency' || t.severity === 'high')) {
    mappedSeverity = 'severe';
  } else if (/moderate|medium|somewhat|கொஞ்சம்\s*வலி|மீடியம்|मध्यम/i.test(rawLower)) {
    mappedSeverity = 'moderate';
  } else if (/mild|slight|little\s*bit|லேசான|कम/i.test(rawLower)) {
    mappedSeverity = 'mild';
  }

  // Duration extraction (only if explicitly stated)
  let duration = null;
  const durationMatch = rawLower.match(/\b(since\s+[\w\s]+|for\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple of|a few|several)\s+(?:days?|hours?|weeks?|months?)|from\s+morning|since\s+morning|காலையில\s*இருந்து|காலைல\s*இருந்து|நேத்துல\s*இருந்து|ரெண்டு\s*நாளா|सुबह\s*से|दो\s*दिन\s*से)\b/i);
  if (durationMatch) {
    duration = durationMatch[0];
  }

  // Extract canonical symptoms from detected terms
  for (const term of norm.detectedMedicalTerms) {
    let name = term.canonical;
    if (term.canonical === 'நெஞ்சு வலி' || term.canonical === 'सीने में दर्द' || term.canonical === 'chest pain') {
      name = 'Chest pain';
    } else if (term.canonical === 'மூச்சுத்திணறல்' || term.canonical === 'सांस लेने में तकलीफ' || term.canonical === 'shortness of breath') {
      name = 'Shortness of breath';
    } else if (term.canonical === 'தலைவலி' || term.canonical === 'सिरदर्द' || term.canonical === 'headache') {
      name = 'Headache';
    } else if (term.canonical === 'வயிற்று வலி' || term.canonical === 'पेट दर्द' || term.canonical === 'abdominal pain') {
      name = 'Abdominal pain';
    } else if (term.canonical === 'முழங்கால் வலி' || term.canonical === 'knee pain') {
      name = 'Knee pain';
    } else if (term.canonical === 'வாந்தி' || term.canonical === 'vomiting') {
      name = 'Vomiting';
    } else if (term.canonical === 'பலவீனம்' || term.canonical === 'weakness') {
      name = 'Weakness';
    } else if (term.canonical === 'காய்ச்சல்' || term.canonical === 'बुखार' || term.canonical === 'fever') {
      name = 'Fever';
    } else if (term.canonical === 'மயக்கம்' || term.canonical === 'चक्कर' || term.canonical === 'dizziness') {
      name = 'Dizziness';
    }

    if (!symptoms.includes(name)) {
      symptoms.push(name);
    }
  }

  // Direct English/Tanglish/Tamil fallback patterns for knee pain, vomiting, weakness
  if ((/\b(knee|knees)\b/i.test(normLower) || /(?:முழங்கால்|முட்டி|muzhang|mutti)/i.test(rawLower) || /(?:முழங்கால்|முட்டி|muzhang|mutti)/i.test(normLower)) &&
      (/\b(pain|hurt|hurts|ache|aches|sore|injury|swelling)\b/i.test(normLower) || /(?:வலி|நோவு|pain|வீக்கம்)/i.test(rawLower) || /(?:வலி|நோவு|pain|வீக்கம்)/i.test(normLower))) {
    if (!symptoms.includes('Knee pain')) symptoms.push('Knee pain');
  }
  if (/\b(vomit|vomiting|threw up|throwing up)\b/i.test(normLower) || /(?:வாந்தி|உல்டி|vomit)/i.test(rawLower) || /(?:வாந்தி|உல்டி|vomit)/i.test(normLower)) {
    if (!symptoms.includes('Vomiting')) symptoms.push('Vomiting');
  }
  if (/\b(weak|weakness|exhausted|no energy|முடியல)\b/i.test(normLower) || /(?:பலவீனம்|அசதி|முடியல|weak)/i.test(rawLower) || /(?:பலவீனம்|அசதி|முடியல|weak)/i.test(normLower)) {
    if (!symptoms.includes('Weakness')) symptoms.push('Weakness');
  }

  // Ensure "please" is NEVER stored as a symptom!
  const filteredSymptoms = symptoms.filter(s => s.toLowerCase() !== 'please');

  // Body parts extraction
  const bodyParts = [];
  const addBodyPart = (bp) => {
    if (bp && !bodyParts.includes(bp) && bp.toLowerCase() !== 'please') {
      bodyParts.push(bp);
    }
  };

  if (/\b(knee|knees)\b/i.test(normLower) || /(?:முழங்கால்|முட்டி|muzhang|mutti)/i.test(rawLower) || /(?:घुटना|घुटने)/.test(rawLower)) {
    addBodyPart('knee');
  }
  if (/\b(head|headache|migraine|scalp)\b/i.test(normLower) || /(?:தலை|தல|thala)/i.test(rawLower) || /(?:सिर|सर)/.test(rawLower)) {
    addBodyPart('head');
  }
  if (/\b(chest|heart|sternum)\b/i.test(normLower) || /(?:நெஞ்சு|மார்பு|nenju|marbu)/i.test(rawLower) || /(?:सीना|सीने|छाती|दिल)/.test(rawLower)) {
    addBodyPart('chest');
  }
  if (/\b(stomach|abdomen|belly|gut|tummy)\b/i.test(normLower) || /(?:வயிறு|வயித்து|vayiru|vayithu)/i.test(rawLower) || /(?:पेट)/.test(rawLower)) {
    addBodyPart('abdomen');
  }
  if (/\b(throat)\b/i.test(normLower) || /(?:தொண்டை|thondai)/i.test(rawLower) || /(?:गला|गले)/.test(rawLower)) {
    addBodyPart('throat');
  }
  if (/\b(back|spine)\b/i.test(normLower) || /(?:முதுகு|mudhugu)/i.test(rawLower) || /(?:पीठ|कमर)/.test(rawLower)) {
    addBodyPart('back');
  }
  if (/\b(leg|legs|foot|feet|ankle)\b/i.test(normLower) || /(?:கால்|காலில்|kaal)/i.test(rawLower) || /(?:पैर|टांग)/.test(rawLower)) {
    addBodyPart('leg');
  }
  if (/\b(arm|arms|hand|hands|shoulder)\b/i.test(normLower) || /(?:கை|கையில்|kai)/i.test(rawLower) || /(?:हाथ|कंधा)/.test(rawLower)) {
    addBodyPart('arm');
  }
  if (/\b(neck)\b/i.test(normLower) || /(?:கழுத்து|kazhuthu)/i.test(rawLower) || /(?:गर्दन)/.test(rawLower)) {
    addBodyPart('neck');
  }

  // Red flags detection
  const redFlags = [];
  const checkRedFlag = (flagName, pattern) => {
    if (pattern.test(rawLower) || pattern.test(normLower)) {
      if (!redFlags.includes(flagName)) redFlags.push(flagName);
    }
  };
  checkRedFlag('Chest pain', /\b(chest pain|tightness in chest|pressure in chest)\b|நெஞ்சு\s*வலி|மார்பு\s*வலி|सीने\s*में\s*दर्द/i);
  checkRedFlag('Shortness of breath', /\b(shortness of breath|trouble breathing|hard to breathe|can't breathe|cannot breathe)\b|மூச்சுத்திணறல்|மூச்சு\s*திணறல்|सांस\s*लेने\s*में\s*तकलीफ/i);
  checkRedFlag('Loss of consciousness or severe dizziness', /\b(passed out|fainted|loss of consciousness|blackout)\b|மயங்கி|बेहोश/i);
  checkRedFlag('Severe bleeding', /\b(severe bleeding|uncontrolled bleeding|coughing blood|vomiting blood)\b|ரத்தப்போக்கு|இரத்தப்போக்கு|खून\s*बहना/i);
  checkRedFlag('Radiating chest/arm pain', /\b(radiating to (?:left\s+)?arm|jaw pain)\b/i);

  if (redFlags.length > 0 && mappedSeverity === 'unknown') {
    mappedSeverity = 'severe';
  }

  return {
    symptoms: filteredSymptoms,
    bodyParts,
    severity: mappedSeverity,
    duration,
    associatedSymptoms: filteredSymptoms.slice(1),
    associated: filteredSymptoms.slice(1),
    redFlags,
    selectedLanguage: language || 'en',
    isAmbiguous: norm.isAmbiguous,
    clarificationPrompt: norm.clarificationPrompt,
    normalizedTranscript: norm.normalizedTranscript,
    rawTranscript: norm.rawTranscript
  };
}

module.exports = {
  normalizeMedicalSpeech,
  extractClinicalSymptoms,
  TAMIL_MEDICAL_DICTIONARY,
  HINDI_MEDICAL_DICTIONARY,
};
