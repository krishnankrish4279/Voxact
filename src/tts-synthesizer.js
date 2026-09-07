/**
 * VoxAct — High-Clarity Multilingual TTS Synthesizer & Tamil Phonetic Normalizer
 * 
 * Provides crystal-clear native Tamil (and Hindi/English) audio synthesis
 * with accurate pronunciation, cadence, and medical terminology mapping.
 */

// Canonical mappings for medical conditions in Tamil and Hindi
const TAMIL_CONDITION_NAMES = {
  'Tension Headache': 'அழுத்த தலைவலி',
  'Migraine': 'ஒற்றைத் தலைவலி',
  'Dehydration': 'நீர்ச்சத்து குறைவு',
  'Common Cold': 'சாதாரண சளி',
  'Flu': 'வைரஸ் காய்ச்சல்',
  'Viral Infection': 'வைரஸ் தொற்று',
  'Muscle Strain': 'தசைப்பிடிப்பு',
  'Acid Reflux': 'நெஞ்செரிச்சல் மற்றும் அமில வீச்சு',
  'Cardiac Event': 'தீவிர இதய பாதிப்பு',
  'Cardiac Issue': 'இதய பிரச்சனை',
  'Food Poisoning': 'உணவு நச்சுத்தன்மை',
  'Gastritis': 'இரைப்பை அழற்சி',
  'Motion Sickness': 'பயணக் குமட்டல்',
  'Low Blood Pressure': 'குறைந்த ரத்த அழுத்தம்',
  'Inner Ear Issue': 'உள் காது பிரச்சனை',
  'Pharyngitis': 'தொண்டை அழற்சி',
  'Strep Throat': 'ஸ்ட்ரெப் தொண்டை தொற்று',
  'Tonsillitis': 'டான்சில் வீக்கம்',
  'Bronchitis': 'மூச்சுக்குழாய் அழற்சி',
  'Allergies': 'ஒவ்வாமை',
  'Indigestion': 'செரிமானமின்மை',
  'Appendicitis': 'குடல்வால் அழற்சி',
  'Sleep Deficit': 'தூக்கமின்மை',
  'Anemia': 'ரத்த சோகை',
  'Thyroid Issue': 'தைராய்டு பிரச்சனை',
  'Disc Issue': 'முதுகெலும்பு தண்டுவட பிரச்சனை',
  'Poor Posture': 'தவறான உடல் நிலை பழக்கம்',
  'Anxiety': 'பதட்டம் மற்றும் மன அழுத்தம்',
  'Asthma': 'ஆஸ்துமா மூச்சுத்திணறல்',
  'Contact Dermatitis': 'தோல் ஒவ்வாமை',
  'Allergic Reaction': 'ஒவ்வாமை பாதிப்பு',
  'Eczema': 'எக்ஸிமா தோல் அலர்ஜி',
  'Knee Osteoarthritis / Strain': 'முழங்கால் மூட்டு வலி மற்றும் தசைப்பிடிப்பு',
  'Patellofemoral Pain Syndrome': 'முழங்கால் சில்லு மூட்டு வலி',
  'Ligament or Meniscus Strain': 'தசைநார் பிடிப்பு',
  'Gastroenteritis': 'இரைப்பை குடல் அழற்சி',
  'Dehydration / Fatigue': 'உடல் சோர்வு மற்றும் நீர்ச்சத்து குறைவு',
  'Viral Illness Recovery': 'வைரஸ் காய்ச்சலுக்கு பிந்தைய உடல் சோர்வு',
  'Electrolyte Imbalance': 'உடலில் தாது உப்பு சமநிலையின்மை',
};

const HINDI_CONDITION_NAMES = {
  'Tension Headache': 'तनाव सिरदर्द',
  'Migraine': 'माइग्रेन',
  'Dehydration': 'शरीर में पानी की कमी',
  'Common Cold': 'सामान्य सर्दी-जुकाम',
  'Flu': 'फ्लू और बुखार',
  'Viral Infection': 'वायरल संक्रमण',
  'Muscle Strain': 'मांसपेशियों में खिंचाव',
  'Acid Reflux': 'एसिडिटी और सीने में जलन',
  'Cardiac Event': 'हृदय संबंधी गंभीर स्थिति',
  'Cardiac Issue': 'हृदय की समस्या',
  'Food Poisoning': 'फूड पॉइजनिंग',
  'Gastritis': 'पेट की सूजन व गैस',
  'Low Blood Pressure': 'निम्न रक्तचाप',
  'Asthma': 'दमा या सांस की बीमारी',
  'Knee Osteoarthritis / Strain': 'घुटने के जोड़ का दर्द या खिंचाव',
  'Gastroenteritis': 'पेट और आंतों का संक्रमण',
  'Dehydration / Fatigue': 'कमजोरी और निर्जलीकरण',
};

/**
 * Clean and phonetically optimize Tamil text for speech synthesis
 */
function cleanTamilTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text
    // Replace English brand names with proper Tamil phonetic spelling
    .replace(/வாக்ஸ்ஆக்ட்\s*\(\s*VoxAct\s*\)/gi, 'வாக்ஸ் ஆக்ட்')
    .replace(/\(\s*VoxAct\s*\)/gi, 'வாக்ஸ் ஆக்ட்')
    .replace(/\bVoxAct\b/gi, 'வாக்ஸ் ஆக்ட்')
    .replace(/\bvoxact\b/gi, 'வாக்ஸ் ஆக்ட்');

  // Replace English medical conditions inside Tamil text
  for (const [enCond, taCond] of Object.entries(TAMIL_CONDITION_NAMES)) {
    if (cleaned.includes(enCond)) {
      cleaned = cleaned.replace(new RegExp(enCond, 'g'), taCond);
    }
  }

  // Format emergency telephone numbers for natural cadence
  cleaned = cleaned
    .replace(/108-ஐ/g, '1 0 8 ஐ')
    .replace(/108/g, '1 0 8')
    .replace(/112/g, '1 1 2')
    .replace(/911/g, '9 1 1');

  // Clean brackets and markdown formatting
  cleaned = cleaned
    .replace(/பிரச்சனை/g, 'பிரச்சினை')
    .replace(/உங்களுக்கு என்ன பிரச்சனை\?/g, 'உங்களுக்கு என்ன தொந்தரவு?')
    .replace(/உங்களுக்கு என்ன பிரச்சினை\?/g, 'உங்களுக்கு என்ன தொந்தரவு?')
    .replace(/[*_#`~[\]]/g, ' ')
    .replace(/\(([^)]+)\)/g, ', $1, ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Clean and phonetically optimize Hindi text for speech synthesis
 */
function cleanHindiTextForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  let cleaned = text
    .replace(/\(\s*VoxAct\s*\)/gi, 'वॉक्सएक्ट')
    .replace(/\bVoxAct\b/gi, 'वॉक्सएक्ट')
    .replace(/\bvoxact\b/gi, 'वॉक्सएक्ट');

  for (const [enCond, hiCond] of Object.entries(HINDI_CONDITION_NAMES)) {
    if (cleaned.includes(enCond)) {
      cleaned = cleaned.replace(new RegExp(enCond, 'g'), hiCond);
    }
  }

  cleaned = cleaned
    .replace(/[*_#`~[\]]/g, ' ')
    .replace(/\(([^)]+)\)/g, ', $1, ')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned;
}

/**
 * Transliterate Tamil Unicode script to clear phonetic English (Tanglish)
 * Used as a zero-failure fallback for offline devices that only have English voices.
 */
function tamilToPhoneticTanglish(text) {
  if (!text || typeof text !== 'string') return '';

  const vowels = {
    '\u0B85': 'a', '\u0B86': 'aa', '\u0B87': 'i', '\u0B88': 'ee', '\u0B89': 'u',
    '\u0B8A': 'oo', '\u0B8E': 'e', '\u0B8F': 'ae', '\u0B90': 'ai', '\u0B92': 'o',
    '\u0B93': 'oa', '\u0B94': 'au'
  };
  const consonants = {
    '\u0B95': 'k', '\u0B99': 'ng', '\u0B9A': 'ch', '\u0B9E': 'nj', '\u0B9F': 't',
    '\u0BA3': 'n', '\u0BA4': 'th', '\u0BA8': 'n', '\u0BAA': 'p', '\u0BAE': 'm',
    '\u0BAF': 'y', '\u0BB0': 'r', '\u0BB2': 'l', '\u0BB5': 'v', '\u0BB4': 'zh',
    '\u0BB3': 'l', '\u0BB1': 'r', '\u0BA9': 'n',
    '\u0B9C': 'j', '\u0BB7': 'sh', '\u0BB8': 's', '\u0BB9': 'h'
  };
  const signs = {
    '\u0BBE': 'aa', '\u0BBF': 'i', '\u0BC0': 'ee', '\u0BC1': 'u', '\u0BC2': 'oo',
    '\u0BC6': 'e', '\u0BC7': 'ae', '\u0BC8': 'ai', '\u0BCA': 'o', '\u0BCB': 'oa',
    '\u0BCC': 'au'
  };
  const pulli = '\u0BCD'; // virama

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (vowels[ch]) {
      result += vowels[ch];
    } else if (consonants[ch]) {
      const c = consonants[ch];
      if (next === pulli) {
        result += c;
        i++;
      } else if (next && signs[next]) {
        result += c + signs[next];
        i++;
      } else {
        result += c + 'a';
      }
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Split long text into natural clauses/sentences under maxLength
 */
function splitIntoSpeechChunks(text, maxLength = 170) {
  if (!text || text.length <= maxLength) return [text];

  const sentences = text.match(/[^.!?।;,]+[.!?।;,]*/g) || [text];
  const chunks = [];
  let currentChunk = '';

  for (const s of sentences) {
    const trimmed = s.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 1 <= maxLength) {
      currentChunk = currentChunk ? `${currentChunk} ${trimmed}` : trimmed;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      if (trimmed.length > maxLength) {
        const words = trimmed.split(/\s+/);
        let subChunk = '';
        for (const w of words) {
          if (subChunk.length + w.length + 1 <= maxLength) {
            subChunk = subChunk ? `${subChunk} ${w}` : w;
          } else {
            if (subChunk) chunks.push(subChunk);
            subChunk = w;
          }
        }
        currentChunk = subChunk;
      } else {
        currentChunk = trimmed;
      }
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks.length > 0 ? chunks : [text];
}

/**
 * Synthesize crystal-clear native audio for a given language
 * 
 * @param {string} text - Raw text to speak
 * @param {object} options
 * @param {string} options.language - 'ta', 'hi', or 'en'
 * @param {AbortSignal} options.signal - For cancellation
 * @returns {Promise<{ buffer: Buffer, base64: string, format: string, durationEstimateMs: number }|null>}
 */
async function synthesizeClearAudio(text, options = {}) {
  if (!text || !text.trim()) return null;

  let lang = (options.language || 'en').toLowerCase();
  if (lang === 'tam') lang = 'ta';
  if (lang === 'hin') lang = 'hi';
  if (lang === 'eng') lang = 'en';

  if (lang === 'en') {
    if (/[\u0B80-\u0BFF]/.test(text)) lang = 'ta';
    else if (/[\u0900-\u097F]/.test(text)) lang = 'hi';
  }

  let textForSpeech = text;
  if (lang === 'ta') {
    textForSpeech = cleanTamilTextForSpeech(text);
  } else if (lang === 'hi') {
    textForSpeech = cleanHindiTextForSpeech(text);
  } else {
    textForSpeech = text.replace(/[*_#`~[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!textForSpeech) return null;

  const chunks = splitIntoSpeechChunks(textForSpeech, 170);
  const audioBuffers = [];

  for (const chunk of chunks) {
    if (options.signal?.aborted) return null;

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'audio/mpeg, audio/*',
        },
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS HTTP error: ${response.status} ${response.statusText}`);
      }

      const arrayBuf = await response.arrayBuffer();
      const chunkBuf = Buffer.from(arrayBuf);
      if (chunkBuf.length > 0) {
        audioBuffers.push(chunkBuf);
      }
    } catch (err) {
      if (err.name === 'AbortError' || options.signal?.aborted) return null;
      console.warn(`[ClearTTS] Audio fetch failed for chunk in "${lang}":`, err.message);
      return null;
    }
  }

  if (audioBuffers.length === 0) return null;

  const completeBuffer = Buffer.concat(audioBuffers);
  return {
    buffer: completeBuffer,
    base64: completeBuffer.toString('base64'),
    format: 'mp3',
    durationEstimateMs: Math.round((completeBuffer.length / 4000) * 1000),
    language: lang,
    cleanedText: textForSpeech,
  };
}

module.exports = {
  cleanTamilTextForSpeech,
  cleanHindiTextForSpeech,
  tamilToPhoneticTanglish,
  synthesizeClearAudio,
  TAMIL_CONDITION_NAMES,
  HINDI_CONDITION_NAMES,
};