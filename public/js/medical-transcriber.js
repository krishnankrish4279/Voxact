/**
 * VoxAct — Client Medical Speech Normalizer
 * Browser mirror of src/medical-transcriber.js
 */

(function(root) {
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
        'vanthi', 'vaanthi', 'vaanthi varudhu', 'kumattal'
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

  const TAMIL_AMBIGUOUS_PATTERNS = [
    {
      regex: /(?:உடம்பு\s*சரியில்ல(?:ை)?|உடம்பு\s*ஒரு\s*மாதிரி\s*இருக்கு|ஒடம்பு\s*சரியில்ல|odambu\s*sariyilla|udambu\s*sariyillai)/i,
      prompt: 'உங்களுக்கு என்ன செய்கிறது என்று கொஞ்சம் விளக்கமாக கூற முடியுமா? காய்ச்சல் அல்லது வலி உள்ளதா?'
    },
    {
      regex: /(?:வலியா\s*இருக்கு|வலிகுது|வலிக்கிறது|valiya\s*irukku|valikkudhu)/i,
      excludeIfMatches: /(?:நெஞ்சு|மார்பு|தலை|வயிறு|Nenju|Marbu|Thala|Vayiru)/i,
      prompt: 'உடலில் எந்தப் பகுதியில் வலிக்கிறது என்று சொல்ல முடியுமா?'
    },
    {
      regex: /(?:ஒரு\s*மாதிரியா\s*இருக்கு|அசதியா\s*இருக்கு|tired\s*ஆ\s*இருக்கு)/i,
      prompt: 'அசதியாக உள்ளதா அல்லது மயக்கமாக உள்ளதா என்பதை தெளிவுபடுத்த முடியுமா?'
    }
  ];

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
      variants: ['पेट में दर्द', 'पेट खराब', 'pet dard', 'pet me dard']
    },
    {
      canonical: 'बुखार',
      category: 'infectious',
      severity: 'medium',
      variants: ['तेज बुखार', 'तप रहा है', 'ताप', 'bukhar', 'tez bukhar']
    },
    {
      canonical: 'खून बहना',
      category: 'trauma_vascular',
      severity: 'high',
      variants: ['खून निकल रहा है', 'रक्तस्त्राव', 'khoon nikalna', 'khoon behna']
    }
  ];

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

    if (lang === 'ta' || /[\u0B80-\u0BFF]/.test(raw)) {
      // Restore common Tamil ASR pronoun drops
      normalized = normalized
        .replace(/(?:^|\s)எனகக(?:\s|$)/g, (m) => m.replace('எனகக', 'எனக்கு'))
        .replace(/(?:^|\s)உஙகளுகக(?:\s|$)/g, (m) => m.replace('உஙகளுகக', 'உங்களுக்கு'));

      for (const amb of TAMIL_AMBIGUOUS_PATTERNS) {
        if (amb.regex.test(raw)) {
          if (!amb.excludeIfMatches || !amb.excludeIfMatches.test(raw)) {
            isAmbiguous = true;
            clarificationPrompt = amb.prompt;
            break;
          }
        }
      }

      for (const entry of TAMIL_MEDICAL_DICTIONARY) {
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
    } else if (lang === 'hi' || /[\u0900-\u097F]/.test(raw)) {
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
    } else {
      const englishAmbiguous = [
        {
          regex: /(?:i\s*feel\s*sick|i\s*don't\s*feel\s*well|not\s*feeling\s*well|something\s*is\s*wrong)/i,
          prompt: 'Can you describe specifically what symptoms you are experiencing, such as pain, nausea, or fever?'
        },
        {
          regex: /(?:it\s*hurts|i\s*have\s*pain)/i,
          excludeIfMatches: /(?:chest|head|stomach|arm|leg|back|abdomen|throat|ear)/i,
          prompt: 'Where specifically in your body are you experiencing the pain?'
        }
      ];

      for (const amb of englishAmbiguous) {
        if (amb.regex.test(raw)) {
          if (!amb.excludeIfMatches || !amb.excludeIfMatches.test(raw)) {
            isAmbiguous = true;
            clarificationPrompt = amb.prompt;
            break;
          }
        }
      }

      const EN_DICTIONARY = [
        { canonical: 'chest pain', category: 'cardiovascular', severity: 'emergency', variants: ['chest hurts', 'chest ache', 'pain in chest', 'tightness in chest'] },
        { canonical: 'shortness of breath', category: 'respiratory', severity: 'emergency', variants: ['hard to breathe', 'cannot breathe', "can't breathe", 'trouble breathing', 'breathless'] },
        { canonical: 'headache', category: 'neurological', severity: 'medium', variants: ['head hurts', 'head ache', 'migraine', 'pounding head'] },
        { canonical: 'abdominal pain', category: 'gastrointestinal', severity: 'medium', variants: ['stomach pain', 'stomach ache', 'belly pain', 'tummy ache'] },
        { canonical: 'dizziness', category: 'neurological_cardiac', severity: 'high', variants: ['lightheaded', 'feeling dizzy', 'fainted', 'passed out'] },
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

  root.MedicalTranscriber = {
    normalizeMedicalSpeech,
    TAMIL_MEDICAL_DICTIONARY,
    HINDI_MEDICAL_DICTIONARY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
