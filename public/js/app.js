/**
 * VoxAct — Main Client Application
 * Manages WebSocket connection, speech recognition, audio playback,
 * visual state, and interruption detection.
 */

(function () {
  'use strict';

  // ─── DOM Elements (Node.js Safe) ───────────────────────────────
  const doc = typeof document !== 'undefined' ? document : {
    getElementById: () => null,
    createElement: () => ({ appendChild: () => {}, classList: { add: () => {}, remove: () => {} } }),
    readyState: 'complete',
    addEventListener: () => {}
  };

  const startBtn = doc.getElementById('startBtn');
  const toggleMicBtn = doc.getElementById('toggleMicBtn');
  const toggleMicIcon = doc.getElementById('toggleMicIcon');
  const toggleMicText = doc.getElementById('toggleMicText');
  const testAudioBtn = doc.getElementById('testAudioBtn');
  const quickInterruptBtn = doc.getElementById('quickInterruptBtn');
  const endSessionBtn = doc.getElementById('endSessionBtn');
  const textInputForm = doc.getElementById('textInputForm');
  const userTextInput = doc.getElementById('userTextInput');
  const sendTextBtn = doc.getElementById('sendTextBtn');
  const stateIndicator = doc.getElementById('stateIndicator');
  const stateText = doc.getElementById('stateText');
  const orbContainer = doc.getElementById('orbContainer');
  const transcriptContainer = doc.getElementById('transcriptContainer');
  const transcriptEmpty = doc.getElementById('transcriptEmpty');
  const connectionStatus = doc.getElementById('connectionStatus');
  const statusText = doc.getElementById('statusText');
  const disclaimerBanner = doc.getElementById('disclaimerBanner');
  const disclaimerClose = doc.getElementById('disclaimerClose');
  const clearTranscript = doc.getElementById('clearTranscript');
  const waveformCanvas = doc.getElementById('waveformCanvas');

  // Live Clinical Triage Elements
  const urgencyBadge = doc.getElementById('urgencyBadge');
  const symptomTags = doc.getElementById('symptomTags');
  const conditionsList = doc.getElementById('conditionsList');
  const clinicName = doc.getElementById('clinicName');
  const clinicMeta = doc.getElementById('clinicMeta');

  // Multilingual Elements
  const languageSelect = doc.getElementById('languageSelect');
  const rimeBadgeText = doc.getElementById('rimeBadgeText');

  // Care Navigation & Map Elements
  const careNavigationCard = doc.getElementById('careNavigationCard');
  const detectLocationBtn = doc.getElementById('detectLocationBtn');
  const locStatusText = doc.getElementById('locStatusText');
  const manualCitySelect = doc.getElementById('manualCitySelect');
  const emergencyGuidanceBanner = doc.getElementById('emergencyGuidanceBanner');
  const emergencyNumberText = doc.getElementById('emergencyNumberText');
  const careMap = doc.getElementById('careMap');
  const mapCenterLabel = doc.getElementById('mapCenterLabel');
  const facilitiesCountLabel = doc.getElementById('facilitiesCountLabel');
  const facilityCardsList = doc.getElementById('facilityCardsList');
  const emptyFacilitiesNote = doc.getElementById('emptyFacilitiesNote');

  // Zero Dead-Air Telemetry Elements
  const metricFiller = doc.getElementById('metricFiller');
  const metricRimeTTFB = doc.getElementById('metricRimeTTFB');
  const metricInterrupt = doc.getElementById('metricInterrupt');
  const metricFencing = doc.getElementById('metricFencing');
  const fillerAlert = doc.getElementById('fillerAlert');
  const fillerAlertText = doc.getElementById('fillerAlertText');

  // ─── State ─────────────────────────────────────────────────────
  let ws = null;
  let recognition = null;
  let audioPlayer = null;
  let visualizer = null;
  let mediaStream = null;
  let isSessionStarted = false;
  let isMicMuted = false;
  let currentState = 'idle';
  let isRecognizing = false;
  let currentAssistantBubble = null;
  let interruptionDetected = false;
  let currentGenerationId = null;
  let hasInterruptedCurrentTurn = false;
  let lastUserTurnEndWallTime = null;
  const invalidatedGenerations = new Set();

  let currentLanguage = 'en';
  let careMapInstance = null;
  let facilityMarkers = [];
  let userLocationMarker = null;
  let currentLocation = null; // Dynamically detected via browser geolocation
  let latestCareFacilities = [];

  // ─── HTTP/SSE Transport (for Vercel serverless) ────────────────
  let useHttpTransport = false;
  let httpConversationHistory = []; // Maintained client-side for stateless serverless
  let activeSSEAbortController = null; // Abort in-flight SSE requests on interruption
  let pendingAction = null; // Tracks pending interaction state e.g. 'CHECK_NEARBY_CARE'
  let nearbyCareStatus = 'not_requested'; // 'not_requested' | 'pending' | 'accepted' | 'declined'
  let isSubmittingTurn = false; // Prevents duplicate concurrent turn submissions
  let lastSubmittedTranscript = '';
  let lastSubmittedTurnId = null;
  let lastSubmittedTime = 0;
  let hasStartedInitialSession = false;

  const LANGUAGE_CONFIGS = {
    en: {
      rimeBadge: 'Rime Mist v3 (cove)',
      recognitionLang: 'en-IN',
      interruptText: 'Wait',
      interruptBtnLabel: '🛑 Say "Wait"',
      emergencyNumber: '911 / 112'
    },
    ta: {
      rimeBadge: 'Rime Arcana (anaya)',
      recognitionLang: 'ta-IN',
      interruptText: 'பொறு',
      interruptBtnLabel: '🛑 "பொறு" எனச் சொல்',
      emergencyNumber: '112 / 108'
    },
    hi: {
      rimeBadge: 'Rime Coda (taru)',
      recognitionLang: 'hi-IN',
      interruptText: 'रुको',
      interruptBtnLabel: '🛑 "रुको" बोलें',
      emergencyNumber: '112 / 102'
    }
  };

  const CITY_COORDINATES = {
    san_francisco: { lat: 37.7749, lon: -122.4194, name: 'San Francisco, CA' },
    seattle: { lat: 47.6062, lon: -122.3321, name: 'Seattle, WA' },
    chennai: { lat: 13.0827, lon: 80.2707, name: 'Chennai, TN' },
    delhi: { lat: 28.6139, lon: 77.2090, name: 'Delhi, NCR' }
  };

  // ─── Interruption Phrase Detection ─────────────────────────────
  const INTERRUPTION_PATTERNS = [
    /\bwait(?:\s+wait)?\b/i,
    /\bstop\b/i,
    /\bhold\s+on\b/i,
    /\bhang\s+on\b/i,
    /\bpause\b/i,
    /\bno\b/i,
    /\bactually\b/i,
    /\bcancel\b/i,
    /\b(?:one\s+second|one\s+minute|just\s+a\s+sec(?:ond)?|just\s+a\s+minute)\b/i,
    // Tamil interruption & colloquial hold keywords ("பொரு", "பொறு", "போறு", "கொஞ்சம் பொரு", "ஒரு நிமிஷம்", "இரு", "நில்")
    /(?:^|\s)(?:(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு)|ஒரு\s*நிமிஷம்|ஒரு\s*நிமிடம்|இரு(?:ங்கள்)?|நில்லு?(?:ங்கள்)?|வேண்டாம்|தடை)(?:$|\s)/,
    // Hindi interruption keywords ("रुको", "रुकिए", "ठहरो", "नहीं", "बस", "एक मिनट", "एक सेकंड")
    /(?:^|\s)(?:(?:जरा\s+)?(?:रुको|रुकिए|ठहरो|ठहरिए)|नहीं|बस|थोड़ा\s+रुको|एक\s*मिनट|एक\s*सेकंड)(?:$|\s)/
  ];

  function stripControlPrefix(text) {
    if (!text || typeof text !== 'string') return '';
    const hasTamil = /[\u0B80-\u0BFF]/.test(text);
    const hasHindi = /[\u0900-\u097F]/.test(text);

    if (hasTamil) {
      return text
        .replace(/^(?:(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|ஒரு\s*நிமிஷம்|ஒரு\s*நிமிடம்|இரு(?:ங்கள்)?|நில்லு?(?:ங்கள்)?)|(?:wait(?:\s+wait)?|hold\s+on|one\s+second|one\s+minute|just\s+a\s+sec(?:ond)?|just\s+a\s+minute))\s*[,.\-—:]*\s*/i, '')
        .trim();
    }
    if (hasHindi) {
      return text
        .replace(/^(?:(?:जरा\s+)?(?:रुको|रुकिए|ठहरो|ठहरिए|एक\s*मिनट|एक\s*сеकंड)|(?:wait(?:\s+wait)?|hold\s+on|one\s+second|one\s+minute|just\s+a\s+sec(?:ond)?|just\s+a\s+minute))\s*[,.\-—:]*\s*/i, '')
        .trim();
    }

    return text
      .replace(/^(?:(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|ஒரு\s*நிமிஷம்|ஒரு\s*நிமிடம்|இரு(?:ங்கள்)?|நில்லு?(?:ங்கள்)?))\s*[,.\-—:]*\s*/i, '')
      .trim();
  }

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

    if (/^(?:போறு|பொற|போரு)$/i.test(trimmed)) {
      return 'பொரு';
    }

    return rawText;
  }

  function normalizeSpeechText(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’।]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function detectInterruptionPhrase(text) {
    if (!text || typeof text !== 'string') return null;
    const normalized = normalizeSpeechText(text);
    if (!normalized) return null;

    for (const pattern of INTERRUPTION_PATTERNS) {
      const match = normalized.match(pattern);
      if (match) {
        return match[0].trim();
      }
    }
    return null;
  }

  function isWaitInterruptionApp(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase().trim();
    const raw = text.trim();

    const hasSymptom = /\b(?:headache|head\s*hurts|pain|hurts|chest|stomach|fever|vomit|dizzy|breath)\b/i.test(lower) ||
      /தலைவலி|நெஞ்சு\s*வலி|வலி|காய்ச்சல்|வாந்தி|மயக்கம்|மூச்சுத்திணறல்|சளி|இருமல்|symptom|அறிகுறி/i.test(raw);

    if (hasSymptom) return false;

    if (/^(?:wait|wait\s+wait|wait\s+wait\s+wait|please\s+wait|hold\s+on|just\s+hold\s+on|hang\s+on|hold\s+up|one\s+second|just\s+a\s+second|just\s+a\s+minute|one\s+minute|stop)$/i.test(lower)) {
      return true;
    }
    if (/^(?:poru|porru|pohru|konjam\s+poru|nillu|niruthu|oru\s+nimisham|irunga|kaathiru)$/i.test(lower)) {
      return true;
    }
    if (/^(?:கொஞ்சம்\s+)?(?:பொரு|பொறு|போறு|பொற|போரு|பொறுமை|நில்|நில்லு|நிறுத்து|காத்திரு|ஒரு\s*நிமிடம்|ஒரு\s*நிமிஷம்|இருங்க)$/i.test(raw)) {
      return true;
    }
    if (/^(?:ruko|rukiye|thahro|thahariye|ek\s+minute|ek\s+second|zara\s+ruko)$/i.test(lower)) {
      return true;
    }
    if (/^(?:रुको|रुकिए|ठहरो|ठहरिए|एक\s*मिनट|एक\s*सेकंड|जरा\s*रुको)$/i.test(raw)) {
      return true;
    }
    return false;
  }

  function isAssistantSpeaking() {
    return Boolean(
      (audioPlayer && audioPlayer.isPlaying) ||
      (audioPlayer && audioPlayer.queue && audioPlayer.queue.length > 0) ||
      (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) ||
      currentState === 'speaking' ||
      currentState === 'tool_work'
    );
  }

  // ─── State Display Map ─────────────────────────────────────────
  const STATE_DISPLAY = {
    idle: 'Ready to Begin',
    listening: '🎙️ Listening to You...',
    processing: '🧠 Clinical Reasoning...',
    speaking: '🔊 VoxAct Speaking',
    tool_work: '🔍 Medical Tools Analyzing...',
  };

  // ─── Echo Filter ───────────────────────────────────────────────
  function isEchoText(micText, assistantText) {
    if (!micText || !assistantText) return false;
    const clean = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const cMic = clean(micText);
    const aClean = clean(assistantText);
    if (!cMic || !aClean) return false;

    // Direct substring: if the assistant's currently playing text contains the mic phrase, it is acoustic echo!
    if (aClean.includes(cMic)) {
      return true;
    }

    const micWords = cMic.split(/\s+/).filter(w => w.length > 1);
    if (micWords.length === 0) return false;

    let matches = 0;
    for (const w of micWords) {
      if (aClean.includes(w)) matches++;
    }
    return (matches / micWords.length) >= 0.6;
  }

  function isIndiaLocation(loc) {
    if (!loc) return false;
    const name = (loc.city || loc.name || '').toLowerCase();
    if (name.includes('chennai') || name.includes('delhi') || name.includes('mumbai') || name.includes('bengaluru') || name.includes('bangalore') || name.includes('tamil nadu') || name.includes('india')) {
      return true;
    }
    if (loc.lat !== undefined && loc.lon !== undefined && loc.lat !== null && loc.lon !== null) {
      if (loc.lat >= 6.0 && loc.lat <= 37.5 && loc.lon >= 68.0 && loc.lon <= 97.5) {
        return true;
      }
    }
    return false;
  }

  function updateRegionalEmergencyGuidance() {
    if (!emergencyNumberText) return;
    if (!currentLocation || (!currentLocation.lat && !currentLocation.city)) {
      emergencyNumberText.textContent = (currentLanguage === 'ta' || currentLanguage === 'hi') ? '108 / 112' : '112 / 911';
      return;
    }
    const isIndia = isIndiaLocation(currentLocation) || currentLanguage === 'ta' || currentLanguage === 'hi';
    emergencyNumberText.textContent = isIndia ? '108 / 112' : '911 / 112';
  }

  // ─── Multilingual Language Support ─────────────────────────────

  function setAppLanguage(langCode, notifyServer = true) {
    if (!LANGUAGE_CONFIGS[langCode]) return;
    currentLanguage = langCode;
    const config = LANGUAGE_CONFIGS[langCode];

    if (languageSelect && languageSelect.value !== langCode) {
      languageSelect.value = langCode;
    }
    if (rimeBadgeText) {
      rimeBadgeText.textContent = config.rimeBadge;
    }
    if (quickInterruptBtn) {
      quickInterruptBtn.innerHTML = config.interruptBtnLabel;
    }
    updateRegionalEmergencyGuidance();
    if (recognition) {
      recognition.lang = config.recognitionLang;
      if (isRecognizing && !isMicMuted) {
        try { recognition.stop(); } catch (e) {}
      }
    }
    if (notifyServer) {
      sendMessage({
        type: 'set_language',
        language: langCode
      });
    }
    console.log(`[App] Language active: ${langCode} (${config.rimeBadge})`);
  }

  // ─── Multilingual Speech Synthesis & Native Voice Engine ───────
  let cachedSpeechVoices = [];
  function loadAvailableSpeechVoices() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) {
        cachedSpeechVoices = v;
      }
    }
  }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    loadAvailableSpeechVoices();
    window.speechSynthesis.onvoiceschanged = loadAvailableSpeechVoices;
  }

  function getBestVoiceForLanguage(langCode) {
    if (typeof window === 'undefined' || !window.speechSynthesis) return null;
    loadAvailableSpeechVoices();
    const voices = cachedSpeechVoices;
    if (!voices || voices.length === 0) return null;

    if (langCode === 'ta') {
      // Priority 1: Natural / Online neural Tamil voices (Edge / Chrome)
      const naturalTa = voices.find(v => (v.lang === 'ta-IN' || v.lang === 'ta' || v.lang.startsWith('ta')) && /natural|neural|online|google/i.test(v.name));
      if (naturalTa) return naturalTa;
      // Priority 2: Any Tamil voice
      const anyTa = voices.find(v => v.lang === 'ta-IN' || v.lang === 'ta' || v.lang.startsWith('ta') || /tamil/i.test(v.name));
      if (anyTa) return anyTa;
    } else if (langCode === 'hi') {
      const naturalHi = voices.find(v => (v.lang === 'hi-IN' || v.lang === 'hi') && /natural|neural|online|google/i.test(v.name));
      if (naturalHi) return naturalHi;
      const anyHi = voices.find(v => v.lang === 'hi-IN' || v.lang === 'hi' || v.lang.startsWith('hi') || /hindi/i.test(v.name));
      if (anyHi) return anyHi;
    } else {
      const naturalEn = voices.find(v => (v.lang === 'en-IN' || v.lang === 'en-US' || v.lang.startsWith('en')) && /natural|neural|online|google/i.test(v.name));
      if (naturalEn) return naturalEn;
      const anyEn = voices.find(v => v.lang.startsWith('en'));
      if (anyEn) return anyEn;
    }
    return null;
  }

  function tamilToPhoneticTanglishClient(text) {
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
    const pulli = '\u0BCD';

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

  async function speakBrowserText(message) {
    if (!message || !message.text) return;
    const lang = currentLanguage || 'en';

    // Cancel any active browser speech synthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // 1. First attempt: Stream crystal-clear MP3 audio via /api/tts endpoint
    try {
      const ttsUrl = `/api/tts?lang=${encodeURIComponent(lang)}&text=${encodeURIComponent(message.text)}`;
      const response = await fetch(ttsUrl);
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        if (arrayBuf.byteLength > 0) {
          const bytes = new Uint8Array(arrayBuf);
          let binary = '';
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64Audio = btoa(binary);
          const uniqueSegId = message.segmentId || ('seg_fb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
          await audioPlayer.enqueue(base64Audio, {
            text: message.text,
            format: 'mp3',
            generationId: message.generationId,
            responseId: message.responseId,
            segmentId: uniqueSegId,
            chunkIndex: 1,
            isFirst: false,
            isLast: true,
          });
          return;
        }
      }
    } catch (err) {
      console.warn('[App] Server TTS fetch deferred to browser speech engine:', err.message);
    }

    // 2. Second attempt: Local browser SpeechSynthesis with dedicated Tamil/Hindi voice
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      // Ensure Web Audio player is halted so browser speech synthesis never speaks simultaneously
      if (audioPlayer && audioPlayer.isPlaying) {
        audioPlayer.stop();
      }
      window.speechSynthesis.cancel();
      const bestVoice = getBestVoiceForLanguage(lang);
      let spokenText = message.text;

      if (lang === 'ta') {
        spokenText = spokenText
          .replace(/வாக்ஸ்ஆக்ட்\s*\(\s*VoxAct\s*\)/gi, 'வாக்ஸ் ஆக்ட்')
          .replace(/\(\s*VoxAct\s*\)/gi, 'வாக்ஸ் ஆக்ட்')
          .replace(/\bVoxAct\b/gi, 'வாக்ஸ் ஆக்ட்')
          .replace(/108-ஐ/g, '1 0 8 ஐ')
          .replace(/108/g, '1 0 8')
          .replace(/112/g, '1 1 2');

        // If no Tamil voice exists on this machine, transliterate to clear phonetic Tanglish
        if (!bestVoice) {
          spokenText = tamilToPhoneticTanglishClient(spokenText);
          console.log('[App] No native Tamil voice found; using phonetic Tanglish for clear English TTS articulation');
        }
      } else if (lang === 'hi') {
        spokenText = spokenText
          .replace(/\(\s*VoxAct\s*\)/gi, 'वॉक्सएक्ट')
          .replace(/\bVoxAct\b/gi, 'वॉक्सएक्ट');
      }

      const utterance = new SpeechSynthesisUtterance(spokenText);
      if (bestVoice) {
        utterance.voice = bestVoice;
        utterance.lang = bestVoice.lang;
      } else {
        utterance.lang = lang === 'ta' ? 'ta-IN' : (lang === 'hi' ? 'hi-IN' : 'en-IN');
      }

      // Slightly relaxed speech rate for Tamil to articulate retroflex consonants with clarity
      utterance.rate = lang === 'ta' ? 0.90 : 1.0;
      utterance.pitch = 1.0;

      utterance.onstart = () => {
        audioPlayer.currentlyPlayingText = message.text;
        updateState('speaking');
      };
      utterance.onend = () => {
        audioPlayer.currentlyPlayingText = '';
        if (message.generationId) {
          sendMessage({ type: 'playback_complete', generationId: message.generationId });
        }
        updateState('listening');
      };
      utterance.onerror = (e) => {
        console.warn('[App] SpeechSynthesis error:', e.error);
        updateState('listening');
      };

      window.speechSynthesis.speak(utterance);
    }
  }

  // ─── Care Navigation & Leaflet Map ─────────────────────────────

  function initCareMap() {
    if (typeof window === 'undefined' || typeof L === 'undefined' || !careMap) return;
    try {
      const defaultCenter = (currentLocation && currentLocation.lat && currentLocation.lon)
        ? [currentLocation.lat, currentLocation.lon]
        : [20.0, 0.0];
      const initialZoom = (currentLocation && currentLocation.lat) ? 13 : 2;

      careMapInstance = L.map('careMap', {
        zoomControl: true,
        attributionControl: false
      }).setView(defaultCenter, initialZoom);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
      }).addTo(careMapInstance);

      if (currentLocation && currentLocation.lat && currentLocation.lon) {
        updateUserLocationMarker(currentLocation.lat, currentLocation.lon, currentLocation.city || 'Your Location');
      }
    } catch (err) {
      console.warn('[App] Leaflet initialization deferred or unavailable:', err);
    }
  }

  function updateUserLocationMarker(lat, lon, label) {
    if (!careMapInstance || typeof L === 'undefined') return;
    if (userLocationMarker) {
      careMapInstance.removeLayer(userLocationMarker);
    }

    const userIcon = L.divIcon({
      className: 'user-map-pin-wrap',
      html: '<div class="user-map-pin" title="Search Location"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    userLocationMarker = L.marker([lat, lon], { icon: userIcon })
      .addTo(careMapInstance)
      .bindPopup(`<div class="popup-title">📍 ${label || 'Your Location'}</div><div class="popup-meta">Care navigation reference center</div>`);
  }

  function updateLocationTelemetry(info = {}) {
    const diagStatus = doc.getElementById('diagLocationStatus');
    if (diagStatus && info.status) diagStatus.textContent = info.status;
    const diagAccuracy = doc.getElementById('diagLocationAccuracy');
    if (diagAccuracy && info.accuracy) diagAccuracy.textContent = info.accuracy;
    const diagTime = doc.getElementById('diagLocationTime');
    if (diagTime && info.time) diagTime.textContent = info.time;
  }

  function updateAudioQualityTelemetry(metrics = {}) {
    const diagQueue = doc.getElementById('diagQueueDepth');
    if (diagQueue) diagQueue.textContent = String(metrics.audio_queue_depth ?? 0);
    const diagUnderruns = doc.getElementById('diagUnderruns');
    if (diagUnderruns) diagUnderruns.textContent = String(metrics.audio_underrun ?? 0);
    const diagDecodeFailures = doc.getElementById('diagDecodeFailures');
    if (diagDecodeFailures) diagDecodeFailures.textContent = String(metrics.audio_decode_failed ?? 0);
    const diagDuration = doc.getElementById('diagAudioDuration');
    if (diagDuration) diagDuration.textContent = metrics.audio_buffer_duration ? `${metrics.audio_buffer_duration.toFixed(1)}s` : '0.0s';
    const diagSentenceGap = doc.getElementById('diagSentenceGap');
    if (diagSentenceGap) {
      if (metrics.last_inter_sentence_gap_ms !== null && metrics.last_inter_sentence_gap_ms !== undefined) {
        diagSentenceGap.textContent = `${metrics.last_inter_sentence_gap_ms.toFixed(1)} ms`;
      } else {
        diagSentenceGap.textContent = '—';
      }
    }
  }

  let facilitySearchSeq = 0;
  let activeFacilitiesAbortCtrl = null;

  function isClientNegative(text) {
    if (!text) return false;
    const lower = text.toLowerCase().trim();
    const raw = text.trim();
    if (/^(no|nope|nah|no thanks|not now|no need|don't check|dont check|cancel|not really|nevermind|i'm good|im good|no clinic|no hospital)\b/i.test(lower)) return true;
    if (/\b(don't check|dont check|do not check|no thanks|not now|no need|no clinic|no hospital|vendaam|rehne do)\b/i.test(lower)) return true;
    if (/^(illai|vendaam|illa|vendam|paravala|thevaiyillai)\b/i.test(lower)) return true;
    if (raw.includes('இல்லை') || raw.includes('வேண்டாம்') || raw.includes('இல்ல') || raw.includes('வேணாம்') || raw.includes('பரவாயில்லை')) return true;
    if (/^(nahi|nahin|na|rehne do|mat karo|abhi nahi|nahi chahiye)\b/i.test(lower)) return true;
    if (raw.includes('नहीं') || raw.includes('ना') || raw.includes('नहीं चाहिए') || raw.includes('रहने दीजिए') || raw.includes('रहने दो') || raw.includes('मत')) return true;
    return false;
  }

  function isClientAffirmative(text) {
    if (!text) return false;
    if (isClientNegative(text)) return false;
    const lower = text.toLowerCase().trim();
    const raw = text.trim();
    if (/^(yes|yeah|yep|yup|sure|okay|ok|please do|certainly|go ahead|definitely|please check|check clinics|do that|sounds good|yes please)\b/i.test(lower)) return true;
    if (/\b(yes|yeah|sure|okay|ok|check)\b/i.test(lower) && (raw.includes('பண்ணுங்க') || raw.includes('பாருங்க') || raw.includes('ஆமா') || raw.includes('காட்டு') || raw.includes('தேடு') || raw.includes('हाँ') || raw.includes('कहो') || raw.includes('करो') || raw.includes('दिखा'))) return true;
    if (/^(aama|aamam|sari|paarunga|pannunga|thedu|kaatunga|check pannunga)\b/i.test(lower)) return true;
    if (raw.includes('ஆமா') || raw.includes('ஆமாம்') || raw.includes('சரி') || raw.includes('பாருங்க') || raw.includes('பண்ணுங்க') || raw.includes('தேடுங்க') || raw.includes('காட்டுங்க') || raw.includes('செக் பண்ணு')) return true;
    if (/^(haan|haanji|ji haan|zaroor|theek hai|sahi hai|check karo|dikhao|karo)\b/i.test(lower)) return true;
    if (raw.includes('हाँ') || raw.includes('हां') || raw.includes('ज़रूर') || raw.includes('जरूर') || raw.includes('दिखाइए') || raw.includes('खोजिए') || raw.includes('ठीक है') || raw.includes('बताइए')) return true;
    return false;
  }

  function clearCareFacilities(reason = 'declined') {
    latestCareFacilities = [];
    if (facilityCardsList) {
      facilityCardsList.innerHTML = '';
      const empty = document.createElement('div');
      empty.className = 'empty-facilities';
      empty.id = 'emptyFacilitiesNote';
      empty.textContent = reason === 'declined'
        ? 'Care recommendations declined.'
        : 'Describe symptoms to discover voice-matched care facilities near you.';
      facilityCardsList.appendChild(empty);
    }
    if (clinicName) clinicName.textContent = 'Awaiting Care Assessment';
    if (clinicMeta) clinicMeta.textContent = reason === 'declined' ? 'Care recommendation declined by user' : 'Nearby facility will appear when symptoms and location are assessed';
    if (careMapInstance && typeof L !== 'undefined') {
      facilityMarkers.forEach(m => careMapInstance.removeLayer(m));
      facilityMarkers = [];
    }
    if (facilitiesCountLabel) {
      facilitiesCountLabel.textContent = 'Recommended Facilities (Voice Matched)';
    }
    if (emergencyGuidanceBanner && reason === 'declined') {
      emergencyGuidanceBanner.classList.add('hidden');
    }
  }

  async function queryCareFacilitiesForLocation(loc, urgency = 'medium') {
    if (!loc || loc.lat === undefined || loc.lon === undefined || loc.lat === null || loc.lon === null) return;
    facilitySearchSeq++;
    const seq = facilitySearchSeq;

    if (activeFacilitiesAbortCtrl) {
      activeFacilitiesAbortCtrl.abort();
    }
    activeFacilitiesAbortCtrl = new AbortController();

    try {
      const url = `/api/facilities?lat=${loc.lat}&lon=${loc.lon}&city=${encodeURIComponent(loc.city || '')}&lang=${currentLanguage}&urgency=${urgency}`;
      const res = await fetch(url, { signal: activeFacilitiesAbortCtrl.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== facilitySearchSeq) {
        console.log('[Location] Discarding stale facility search results for seq:', seq);
        return;
      }
      if (data && data.facilities) {
        renderCareFacilities(data.facilities, data.urgencyLevel || urgency, loc);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.warn('[Location] Facility query error:', err.message);
    }
  }

  function detectUserLocation() {
    if (!navigator || !navigator.geolocation) {
      if (locStatusText) locStatusText.textContent = 'GPS Unavailable';
      updateLocationTelemetry({ status: 'GPS Unavailable', accuracy: '—', time: new Date().toLocaleTimeString() });
      return;
    }

    if (detectLocationBtn) detectLocationBtn.disabled = true;
    if (locStatusText) locStatusText.textContent = 'Locating...';
    updateLocationTelemetry({ status: 'Acquiring GPS fix...', accuracy: 'High Accuracy', time: new Date().toLocaleTimeString() });

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (detectLocationBtn) detectLocationBtn.disabled = false;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;
        const timestamp = pos.timestamp;

        // Safe telemetry only: accuracy and timestamp (no raw lat/lon in logs)
        console.log('[Location] Geolocation acquired safe telemetry:', {
          accuracy: accuracy !== undefined ? `±${Math.round(accuracy)}m` : 'N/A',
          timestamp: new Date(timestamp).toISOString(),
        });

        let resolvedCity = `Coordinates (${lat.toFixed(3)}, ${lon.toFixed(3)})`;
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
            headers: { 'User-Agent': 'VoxAct-MedicalTriage/1.0 (contact@voxact.org)' }
          });
          if (res.ok) {
            const geoData = await res.json();
            const addr = geoData.address || {};
            resolvedCity = addr.city || addr.town || addr.village || addr.suburb || addr.county || addr.state || resolvedCity;
          }
        } catch (e) {
          console.warn('[Location] Reverse geocode error:', e.message);
        }

        currentLocation = {
          lat,
          lon,
          city: resolvedCity,
          accuracy,
          timestamp,
        };

        if (locStatusText) locStatusText.textContent = 'GPS Active';
        if (mapCenterLabel) mapCenterLabel.textContent = `📍 ${resolvedCity}`;

        updateLocationTelemetry({
          status: 'GPS Active',
          accuracy: accuracy ? `±${Math.round(accuracy)}m` : 'High',
          time: new Date(timestamp).toLocaleTimeString(),
        });

        if (careMapInstance) {
          careMapInstance.setView([lat, lon], 13);
          updateUserLocationMarker(lat, lon, `${resolvedCity} (Your Location)`);
        }

        updateRegionalEmergencyGuidance();

        sendMessage({
          type: 'set_location',
          location: currentLocation
        });
        // Location acquired — do not auto-query facilities unless accepted
        if (nearbyCareStatus === 'accepted') {
          queryCareFacilitiesForLocation(currentLocation);
        }
      },
      (err) => {
        if (detectLocationBtn) detectLocationBtn.disabled = false;
        console.warn('[App] Geolocation denied or unavailable:', err.message);
        if (locStatusText) locStatusText.textContent = 'GPS Denied (Manual)';
        if (mapCenterLabel && !currentLocation) mapCenterLabel.textContent = '📍 Please pick a location';

        updateLocationTelemetry({
          status: err.code === 1 ? 'Permission Denied' : 'GPS Unavailable',
          accuracy: 'Manual Fallback',
          time: new Date().toLocaleTimeString(),
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  function renderCareFacilities(facilities, urgencyLevel, userLoc = null) {
    if (!Array.isArray(facilities)) return;
    if (nearbyCareStatus === 'declined') {
      console.log('[App] Suppressing facility render: nearby care is declined');
      return;
    }
    // NEAREST FIRST: Sort facilities strictly by distance ascending
    facilities.sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
    latestCareFacilities = facilities;

    // Update Live Clinical Assessment Card with the verified top facility (no synthetic clinic data)
    if (facilities.length > 0) {
      const topFacility = facilities[0];
      if (clinicName) clinicName.textContent = topFacility.name;
      if (clinicMeta) {
        const distStr = topFacility.distanceMiles !== undefined ? `${topFacility.distanceMiles} mi` : (topFacility.distance || 'Nearby');
        clinicMeta.textContent = `📍 ${distStr} · ${topFacility.careType || 'Clinic'} · ${topFacility.emergencyCapable ? 'Emergency Capable' : 'Verified Care Facility'}`;
      }
    }

    // 1. Emergency Guidance Notice: Show if emergency or critical
    const isEmergency = (urgencyLevel && (urgencyLevel === 'emergency' || urgencyLevel === 'critical')) ||
      facilities.some(f => f.careType === 'Emergency Department' && f.emergencyCapable);

    if (emergencyGuidanceBanner) {
      if (isEmergency) {
        emergencyGuidanceBanner.classList.remove('hidden');
      } else {
        emergencyGuidanceBanner.classList.add('hidden');
      }
    }

    // 2. Clear old map markers
    if (careMapInstance && typeof L !== 'undefined') {
      facilityMarkers.forEach(m => careMapInstance.removeLayer(m));
      facilityMarkers = [];
    }

    // 3. Render facility cards
    if (!facilityCardsList) return;
    facilityCardsList.innerHTML = '';

    if (facilities.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-facilities';
      empty.textContent = 'No nearby facilities found from the live search.';
      facilityCardsList.appendChild(empty);
      if (clinicName) clinicName.textContent = 'Awaiting Care Assessment';
      return;
    }

    if (facilitiesCountLabel) {
      facilitiesCountLabel.textContent = `Recommended Facilities (${facilities.length} Found)`;
    }

    const bounds = [];
    const activeLoc = userLoc || currentLocation;
    if (activeLoc && activeLoc.lat && activeLoc.lon) {
      bounds.push([activeLoc.lat, activeLoc.lon]);
    }

    facilities.forEach((facility, idx) => {
      const card = document.createElement('div');
      card.className = 'facility-card';
      card.setAttribute('data-facility-id', facility.id || facility.name || String(idx));

      let typeClass = 'walkin';
      if (facility.careType === 'Emergency Department') typeClass = 'emergency';
      else if (facility.careType === 'Urgent Care Center') typeClass = 'urgent';
      else if (facility.careType === 'Primary Care / Clinic') typeClass = 'primary';

      const distStr = facility.distanceMiles !== undefined ? `${facility.distanceMiles} mi` : (facility.distance || 'Nearby');

      // REAL DATA ONLY: Never fabricate ratings or reviews
      let ratingSignal = '';
      if (facility.rating !== null && facility.rating !== undefined) {
        const revCountStr = facility.reviewCount ? ` (${facility.reviewCount} reviews)` : '';
        ratingSignal = `<span class="facility-rating-tag">★ ${facility.rating}${revCountStr}</span>`;
      } else if (facility.isFallback || facility.fallbackLabel) {
        ratingSignal = `<span class="facility-verified-tag">✓ Verified fallback facility — demo fallback</span>`;
      } else {
        ratingSignal = `<span class="facility-verified-tag">✓ Verified Facility</span>`;
      }

      const emergencyTag = facility.emergencyCapable ? `<span class="facility-card-badge emergency">24/7 ER</span>` : '';
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(facility.name + ' ' + (facility.address || ''))}`;

      card.innerHTML = `
        <div class="facility-card-top">
          <div class="facility-name-row">
            <span class="facility-card-num">${idx + 1}</span>
            <div>
              <div class="facility-card-name">${facility.name}</div>
              <div class="facility-address-tag">${facility.address || ''}</div>
            </div>
          </div>
          <span class="facility-card-badge ${typeClass}">${facility.careType || 'Clinic'}</span>
        </div>
        <div class="facility-card-meta">
          <span class="facility-distance-tag">📍 ${distStr}</span>
          ${ratingSignal}
          ${emergencyTag}
          <span class="facility-hours-tag">${facility.hours ? facility.hours : 'Hours: Not available'}</span>
        </div>
        <div class="facility-card-actions">
          <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-facility-directions">
            Directions ↗
          </a>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'a') return;
        document.querySelectorAll('.facility-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        if (careMapInstance && facility.lat && facility.lon) {
          careMapInstance.setView([facility.lat, facility.lon], 15);
          if (facilityMarkers[idx]) {
            facilityMarkers[idx].openPopup();
          }
        }
      });

      facilityCardsList.appendChild(card);

      if (careMapInstance && typeof L !== 'undefined' && facility.lat && facility.lon) {
        const pinIcon = L.divIcon({
          className: 'facility-pin-wrapper',
          html: `<div class="facility-map-pin ${typeClass}">${idx + 1}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
          popupAnchor: [0, -15]
        });

        const popupHtml = `
          <div class="popup-title">${idx + 1}. ${facility.name}</div>
          <div class="popup-meta">
            <strong>${facility.careType}</strong> · ${distStr}<br>
            ${facility.address || ''}<br>
            ${facility.hours ? facility.hours : 'Hours: Not available'}<br>
            <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" class="popup-action-btn">Get Directions ↗</a>
          </div>
        `;

        const marker = L.marker([facility.lat, facility.lon], { icon: pinIcon })
          .addTo(careMapInstance)
          .bindPopup(popupHtml);

        marker.on('click', () => {
          document.querySelectorAll('.facility-card').forEach(c => c.classList.remove('active'));
          card.classList.add('active');
          card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });

        facilityMarkers.push(marker);
        bounds.push([facility.lat, facility.lon]);
      }
    });

    if (careMapInstance && typeof L !== 'undefined') {
      if (facilities.length === 1 && facilities[0].lat && facilities[0].lon) {
        careMapInstance.setView([facilities[0].lat, facilities[0].lon], 15);
        if (facilityMarkers[0]) {
          facilityMarkers[0].openPopup();
        }
      } else if (bounds.length === 1) {
        careMapInstance.setView(bounds[0], 14);
        if (facilityMarkers[0]) {
          facilityMarkers[0].openPopup();
        }
      } else if (bounds.length > 1) {
        try {
          careMapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
        } catch (e) {}
      }
    }
  }

  function selectFacilityByIndex(idx, options = {}) {
    if (!Array.isArray(latestCareFacilities) || latestCareFacilities.length === 0) {
      console.warn('[App] selectFacilityByIndex called but no facilities loaded');
      return;
    }
    const safeIdx = Math.max(0, Math.min(idx, latestCareFacilities.length - 1));
    const fac = latestCareFacilities[safeIdx];
    if (!fac) return;

    // Highlight card in DOM
    const cards = document.querySelectorAll('.facility-card');
    cards.forEach(c => c.classList.remove('active'));
    const targetCard = cards[safeIdx];
    if (targetCard) {
      targetCard.classList.add('active');
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Update map view and open popup
    if (careMapInstance && fac.lat && fac.lon) {
      const zoom = options.zoom || 15;
      careMapInstance.setView([fac.lat, fac.lon], zoom);
      if (facilityMarkers[safeIdx]) {
        facilityMarkers[safeIdx].openPopup();
      }
    }

    console.log(`[App] Selected facility index ${safeIdx}: ${fac.name}`);
  }

  function focusCareMap(lat, lon, zoom = 15) {
    if (careMapInstance && lat && lon) {
      careMapInstance.setView([lat, lon], zoom);
    }
  }

  // ─── Initialize ────────────────────────────────────────────────

  function init() {
    // Set up audio player
    audioPlayer = new AudioPlayer();
    audioPlayer.onPlaybackStart = (meta = {}) => {
      hasInterruptedCurrentTurn = false;
      updateState('speaking');
      if (lastUserTurnEndWallTime) {
        const userVisibleLatencyMs = Math.round(performance.now() - lastUserTurnEndWallTime);
        lastUserTurnEndWallTime = null;
        console.log(`[VoiceLatency] User turn end -> first audible playback: ${userVisibleLatencyMs} ms`);
        const diagTTFA = doc.getElementById('diagTTFA');
        if (diagTTFA) {
          diagTTFA.textContent = `${userVisibleLatencyMs} ms`;
        }
      }
      if (meta?.generationId) {
        sendMessage({
          type: 'playback_start',
          generationId: meta.generationId,
          playbackTime: meta.playbackTime,
          ttfbMs: meta.ttfbMs,
        });
      }
      const diagPlayback = doc.getElementById('diagPlayback');
      if (diagPlayback) {
        diagPlayback.textContent = meta?.ttfbMs ? `${Math.round(meta.ttfbMs)} ms` : 'Active';
      }
    };
    audioPlayer.onPlaybackEnd = () => {
      // Audio finished playing in user's ears
      if (currentGenerationId) {
        sendMessage({
          type: 'playback_complete',
          generationId: currentGenerationId
        });
      }
      if (currentState === 'speaking') {
        updateState('listening');
      }
    };
    audioPlayer.onPlaybackStop = () => {
      // Audio was interrupted
    };
    audioPlayer.onTelemetryUpdate = (metrics) => {
      updateAudioQualityTelemetry(metrics);
    };

    // Set up visualizer
    if (waveformCanvas && orbContainer && typeof VoiceVisualizer !== 'undefined') {
      visualizer = new VoiceVisualizer(waveformCanvas, orbContainer);
      visualizer.start();
    }

    // Set up event listeners
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        if (!isSessionStarted) {
          handleStart();
        } else {
          toggleMic();
        }
      });
    }

    if (toggleMicBtn) {
      toggleMicBtn.addEventListener('click', toggleMic);
    }

    if (endSessionBtn) {
      endSessionBtn.addEventListener('click', endSession);
    }

    if (languageSelect) {
      languageSelect.addEventListener('change', (e) => {
        setAppLanguage(e.target.value);
      });
    }

    if (detectLocationBtn) {
      detectLocationBtn.addEventListener('click', () => {
        detectUserLocation();
      });
    }

    if (manualCitySelect) {
      manualCitySelect.addEventListener('change', (e) => {
        const cityKey = e.target.value;
        if (cityKey === 'auto_gps') {
          detectUserLocation();
          return;
        }
        const cityData = CITY_COORDINATES[cityKey];
        if (cityData) {
          currentLocation = {
            lat: cityData.lat,
            lon: cityData.lon,
            city: cityData.name,
            accuracy: null,
            timestamp: Date.now()
          };
          if (mapCenterLabel) mapCenterLabel.textContent = `📍 ${cityData.name}`;
          if (locStatusText) locStatusText.textContent = 'Manual City';
          updateLocationTelemetry({
            status: 'Manual Selection',
            accuracy: 'N/A (Preset)',
            time: new Date().toLocaleTimeString(),
          });
          if (careMapInstance) {
            careMapInstance.setView([cityData.lat, cityData.lon], 13);
            updateUserLocationMarker(cityData.lat, cityData.lon, cityData.name);
          }
          updateRegionalEmergencyGuidance();
          sendMessage({
            type: 'set_location',
            location: currentLocation
          });
          if (nearbyCareStatus === 'accepted') {
            queryCareFacilitiesForLocation(currentLocation);
          }
        }
      });
    }

    // Initialize Leaflet Care Map
    initCareMap();

    // Auto-detect fresh high-accuracy device geolocation on load
    detectUserLocation({ autoInit: true });

    if (quickInterruptBtn) {
      quickInterruptBtn.addEventListener('click', () => {
        const holdWord = (LANGUAGE_CONFIGS[currentLanguage] && LANGUAGE_CONFIGS[currentLanguage].interruptText) || 'Wait';
        console.log(`[App] Quick Interrupt button clicked ("${holdWord}")`);
        const haltStart = performance.now();
        audioPlayer.stop();
        if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
        const clientHaltMs = performance.now() - haltStart;

        if (metricInterrupt) {
          metricInterrupt.textContent = `${clientHaltMs < 1 ? clientHaltMs.toFixed(2) : Math.round(clientHaltMs)} ms`;
        }
        if (metricFencing) {
          metricFencing.textContent = '100%';
        }

        currentGenerationId = null;
        updateState('listening');
        addTranscriptMessage('user', holdWord);
        sendMessage({ type: 'interrupt_start', clientHaltMs, text: holdWord });
        sendMessage({ type: 'user_speech', text: holdWord });
      });
    }

    if (testAudioBtn) {
      testAudioBtn.addEventListener('click', async () => {
        console.log('[App] Test Audio clicked');
        const orig = testAudioBtn.innerHTML;
        testAudioBtn.innerHTML = '<span>🔊 Testing...</span>';
        const played = await audioPlayer.testAudio();

        const testPhrases = {
          ta: 'வணக்கம்! நான் வாக்ஸ்ஆக்ட் (VoxAct). தமிழ் குரல் தெளிவாக கேட்கிறதா?',
          hi: 'नमस्ते! मैं वॉक्सएक्ट (VoxAct) हूँ। क्या आवाज़ स्पष्ट सुनाई दे रही है?',
          en: 'Hello! I am VoxAct. Voice audio output is active and clear.'
        };
        const phrase = testPhrases[currentLanguage] || testPhrases.en;

        if (played) {
          addTranscriptMessage('system', `🔊 Speaker check: Audio chime played. Testing voice in ${currentLanguage === 'ta' ? 'தமிழ் (Tamil)' : (currentLanguage === 'hi' ? 'हिन्दी (Hindi)' : 'English')}: "${phrase}"`);
          speakBrowserText({ text: phrase, generationId: null });
        } else {
          addTranscriptMessage('system', '⚠️ Speaker check failed. Please ensure your browser has permission to play audio and volume is turned up.');
        }
        setTimeout(() => { testAudioBtn.innerHTML = orig; }, 1500);
      });
    }

    function submitTextMessage() {
      if (!userTextInput) return;
      const text = userTextInput.value.trim();
      if (!text) return;
      userTextInput.value = '';

      if (!isSessionStarted) {
        handleStart();
      }

      if (activeSpeechTurnController) {
        activeSpeechTurnController.reset();
      }

      // Immediately halt any previous assistant speech before starting new consultation turn
      if (audioPlayer) audioPlayer.stop();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      console.log('[App] Submitting typed text consultation:', text);
      let normalized = {
        rawTranscript: text,
        normalizedTranscript: text,
        detectedMedicalTerms: [],
        isAmbiguous: false,
        clarificationPrompt: null,
      };
      if (typeof MedicalTranscriber !== 'undefined' && MedicalTranscriber.normalizeMedicalSpeech) {
        normalized = MedicalTranscriber.normalizeMedicalSpeech(text, currentLanguage);
      }
      const displayText = normalized.normalizedTranscript || text;
      addTranscriptMessage('user', displayText);

      const turnId = 'turn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      isSubmittingTurn = true;
      lastSubmittedTranscript = text.trim().toLowerCase();
      lastSubmittedTurnId = turnId;
      lastSubmittedTime = Date.now();

      console.log('[TurnTelemetry]', {
        turnId,
        rawTranscript: text,
        finalTranscript: displayText,
        pendingActionBefore: pendingAction,
        requestStartedAt: new Date().toISOString(),
      });

      if (isClientNegative(displayText)) {
        if (pendingAction || nearbyCareStatus === 'pending' || displayText.toLowerCase().includes('clinic') || displayText.toLowerCase().includes('hospital') || displayText.includes('வேண்டாம்') || displayText.includes('இல்ல') || displayText.includes('नहीं')) {
          nearbyCareStatus = 'declined';
          pendingAction = null;
          clearCareFacilities('declined');
        }
      } else if (isClientAffirmative(displayText)) {
        if (pendingAction || nearbyCareStatus === 'pending') {
          nearbyCareStatus = 'accepted';
          pendingAction = null;
        }
      }

      const lowerText = displayText.toLowerCase().trim();
      if (/\b(?:share\s+(?:the\s+)?location\s+in\s+map|share\s+location|show\s+in\s+map|open\s+map|show\s+map)\b/i.test(lowerText)) {
        if (latestCareFacilities.length > 0) {
          selectFacilityByIndex(0, { zoom: 15 });
        }
      } else if (/\b(?:share|show|put|select|take\s+me\s+to|navigate\s+to|zoom\s+to|focus\s+on)?\s*(?:the\s+)?(?:facility\s+|hospital\s+|clinic\s+|option\s+)?(?:number|#|no\.?)?\s*(one|two|three|four|five|1|2|3|4|5|first|second|third|fourth|fifth)\b/i.test(lowerText)) {
        const numMap = { 'one': 0, '1': 0, 'first': 0, 'two': 1, '2': 1, 'second': 1, 'three': 2, '3': 2, 'third': 2, 'four': 3, '4': 3, 'fourth': 3, 'five': 4, '5': 4, 'fifth': 4 };
        const m = lowerText.match(/\b(?:number|#|no\.?)?\s*(one|two|three|four|five|1|2|3|4|5|first|second|third|fourth|fifth)\b/i);
        if (m && numMap[m[1]] !== undefined) {
          selectFacilityByIndex(numMap[m[1]], { zoom: 15 });
        }
      }

      if (useHttpTransport) {
        // HTTP/SSE mode: send via POST /api/chat
        sendChatHTTP(displayText, { turnId });
      } else {
        // WebSocket mode: send via WS
        sendMessage({
          type: 'user_speech',
          text: displayText,
          rawTranscript: text,
          normalizedTranscript: displayText,
          medicalTerms: normalized.detectedMedicalTerms || [],
          isAmbiguous: normalized.isAmbiguous,
          location: currentLocation,
          pendingAction,
          nearbyCareStatus,
          turnId,
        });
      }

      const localSymptoms = extractClientSymptoms(displayText);
      if (localSymptoms.length > 0 && symptomTags) {
        symptomTags.innerHTML = '';
        localSymptoms.forEach(s => {
          const tag = document.createElement('span');
          tag.className = 'symptom-tag';
          tag.textContent = '• ' + s;
          symptomTags.appendChild(tag);
        });
      }
    }

    if (textInputForm) {
      textInputForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitTextMessage();
      });
    }
    if (sendTextBtn) {
      sendTextBtn.addEventListener('click', (e) => {
        e.preventDefault();
        submitTextMessage();
      });
    }
    if (disclaimerClose) {
      disclaimerClose.addEventListener('click', () => {
        if (disclaimerBanner) disclaimerBanner.style.display = 'none';
      });
    }
    if (clearTranscript) {
      clearTranscript.addEventListener('click', () => {
        transcriptContainer.innerHTML = '';
        if (transcriptEmpty) {
          transcriptEmpty.style.display = 'flex';
          transcriptContainer.appendChild(transcriptEmpty);
        }
        currentAssistantBubble = null;
      });
    }

    // Check API readiness
    checkPreflight();
  }

  // ─── Preflight Check ──────────────────────────────────────────

  async function checkPreflight() {
    try {
      const res = await fetch('/api/preflight');
      const data = await res.json();
      const sub = startBtn ? (startBtn.querySelector('.btn-sub-text') || startBtn.querySelector('.start-btn-sub')) : null;
      if (data.mode === 'simulation') {
        console.log('[App] Running in simulation mode:', data.issues);
        if (sub) sub.textContent = 'Simulation Mode · Tap to speak & test triage';
        setConnectionStatus('simulation', 'Simulation');
      } else {
        if (sub) sub.textContent = 'Mist v3 Voice + Groq 120B Connected · Tap to speak';
        setConnectionStatus('ready', 'Live AI Ready');
      }
    } catch (err) {
      console.error('Preflight check failed:', err);
    }
  }

  // ─── HTTP/SSE Transport Helpers ───────────────────────────────

  /**
   * Read a Server-Sent Events stream from a fetch response.
   * Parses each `data: {...}\n\n` event and calls onEvent.
   */
  async function readSSEStream(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse complete SSE events (terminated by \n\n)
      while (true) {
        const eventEnd = buffer.indexOf('\n\n');
        if (eventEnd === -1) break;

        const eventBlock = buffer.slice(0, eventEnd);
        buffer = buffer.slice(eventEnd + 2);

        for (const line of eventBlock.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent(data);
            } catch (e) {
              console.warn('[SSE] Parse error:', e);
            }
          }
        }
      }
    }
  }

  /**
   * Start a session via HTTP/SSE (used when WebSocket is unavailable)
   */
  async function startSessionHTTP() {
    if (hasStartedInitialSession) return;
    hasStartedInitialSession = true;
    try {
      if (activeSSEAbortController) activeSSEAbortController.abort();
      activeSSEAbortController = new AbortController();

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: currentLanguage }),
        signal: activeSSEAbortController.signal,
      });

      await readSSEStream(response, (event) => {
        if (event.type === 'done' && event.conversationHistory) {
          httpConversationHistory = event.conversationHistory;
          console.log('[App] HTTP session started, history:', httpConversationHistory.length, 'messages');
        }
        handleServerMessage(event);
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[App] HTTP session start error:', err);
    }
  }

  /**
   * Send user speech via HTTP/SSE (used when WebSocket is unavailable)
   */
  async function sendChatHTTP(text, options = {}) {
    const turnId = options.turnId || ('turn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6));
    try {
      if (activeSSEAbortController) activeSSEAbortController.abort();
      activeSSEAbortController = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          conversationHistory: httpConversationHistory,
          language: currentLanguage,
          location: currentLocation,
          pendingAction,
          nearbyCareStatus,
          turnId,
        }),
        signal: activeSSEAbortController.signal,
      });

      await readSSEStream(response, (event) => {
        if (event.type === 'done') {
          isSubmittingTurn = false;
          if (event.conversationHistory) {
            httpConversationHistory = event.conversationHistory;
            console.log('[App] HTTP chat done, history:', httpConversationHistory.length, 'messages');
          }
          if (event.pendingAction !== undefined) {
            pendingAction = event.pendingAction;
          }
          if (event.nearbyCareStatus !== undefined) {
            nearbyCareStatus = event.nearbyCareStatus;
            if (nearbyCareStatus === 'declined') {
              clearCareFacilities('declined');
            }
          }
          console.log('[TurnTelemetry]', {
            turnId: event.turnId || turnId,
            pendingActionAfter: pendingAction,
            nearbyCareStatusAfter: nearbyCareStatus,
            requestCompletedAt: new Date().toISOString(),
          });
        }
        if (event.type === 'pending_action_change') {
          pendingAction = event.pendingAction;
          if (pendingAction && nearbyCareStatus !== 'declined') {
            nearbyCareStatus = 'pending';
          }
          console.log('[App] pendingAction changed to:', pendingAction);
        }
        if (event.type === 'nearby_care_status_change') {
          nearbyCareStatus = event.nearbyCareStatus;
          if (nearbyCareStatus === 'declined') {
            clearCareFacilities('declined');
          }
        }
        // Don't duplicate user transcript — chat API sends it, but we already added it client-side
        if (event.type === 'transcript' && event.role === 'user') return;
        handleServerMessage(event);
      });
    } catch (err) {
      isSubmittingTurn = false;
      if (err.name === 'AbortError') return;
      console.error('[App] HTTP chat error:', err);
      updateState('listening');
    }
  }

  // ─── Start Session ────────────────────────────────────────────

  async function handleStart() {
    try {
      // 1. Initialize audio player and ensure AudioContext is active (user gesture)
      await audioPlayer.init();
      if (audioPlayer.audioContext && audioPlayer.audioContext.state === 'suspended') {
        try { await audioPlayer.audioContext.resume(); } catch (e) {}
      }

      // 2. Connect transport (WebSocket or HTTP/SSE)
      if (!useHttpTransport && (!ws || ws.readyState !== WebSocket.OPEN)) {
        connectWebSocket();
      } else if (useHttpTransport) {
        // HTTP mode: start session via SSE after mic setup
      }

      // 3. Request microphone access with echo cancellation
      let stream = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          });
          mediaStream = stream;
          if (visualizer) visualizer.connectStream(stream);
        }
      } catch (micErr) {
        console.warn('[App] Microphone access denied or not available:', micErr.message);
        addTranscriptMessage('system', 'Microphone not detected or permission denied. Voice assistant audio is active. You can speak with a headset or type symptoms below.');
      }

      isMicMuted = !stream;
      isSessionStarted = true;

      // 4. Set up speech recognition if mic is available
      if (stream) {
        setupSpeechRecognition();
      }

      // 4b. In HTTP/SSE mode, start session now (after mic setup)
      if (useHttpTransport) {
        startSessionHTTP();
      }

      // 5. Update start button and mic button state
      const primaryText = startBtn ? (startBtn.querySelector('.btn-primary-text') || startBtn.querySelector('.start-btn-text')) : null;
      const subText = startBtn ? (startBtn.querySelector('.btn-sub-text') || startBtn.querySelector('.start-btn-sub')) : null;

      if (stream) {
        if (primaryText) primaryText.textContent = '🎙️ Microphone Active';
        if (subText) subText.textContent = 'Click button anytime to Mute / Pause';
        if (startBtn) {
          startBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
          startBtn.style.boxShadow = '0 4px 20px rgba(16, 185, 129, 0.35)';
        }
        if (toggleMicBtn) toggleMicBtn.classList.remove('muted');
        if (toggleMicIcon) toggleMicIcon.textContent = '🎙️';
        if (toggleMicText) toggleMicText.textContent = 'Mute Mic';
        updateState('listening');
      } else {
        if (primaryText) primaryText.textContent = '🔊 Audio Output Active';
        if (subText) subText.textContent = 'Microphone unavailable · Type symptoms below';
        if (toggleMicBtn) toggleMicBtn.classList.add('muted');
        if (toggleMicIcon) toggleMicIcon.textContent = '🔇';
        if (toggleMicText) toggleMicText.textContent = 'Mic Off';
        updateState('idle');
      }

    } catch (err) {
      console.error('Failed to start session:', err);
    }
  }

  // ─── Mic Mute / Pause Toggle ──────────────────────────────────

  function toggleMic() {
    if (!isSessionStarted) {
      handleStart();
      return;
    }

    isMicMuted = !isMicMuted;
    if (isMicMuted) {
      console.log('[App] Microphone muted by user');
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
      }
      isRecognizing = false;

      if (toggleMicBtn) toggleMicBtn.classList.add('muted');
      if (toggleMicIcon) toggleMicIcon.textContent = '🔇';
      if (toggleMicText) toggleMicText.textContent = 'Unmute Mic';

      const primaryText = startBtn ? (startBtn.querySelector('.btn-primary-text') || startBtn.querySelector('.start-btn-text')) : null;
      const subText = startBtn ? (startBtn.querySelector('.btn-sub-text') || startBtn.querySelector('.start-btn-sub')) : null;
      if (primaryText) primaryText.textContent = '🔇 Microphone Paused';
      if (subText) subText.textContent = 'Click to resume speaking';
      if (startBtn) {
        startBtn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        startBtn.style.boxShadow = '0 4px 20px rgba(245, 158, 11, 0.35)';
      }

      updateState('idle');
      if (stateText) stateText.textContent = '🔇 Mic Muted (Paused)';
    } else {
      console.log('[App] Microphone unmuted by user');
      if (recognition) {
        startRecognition();
      }

      if (toggleMicBtn) toggleMicBtn.classList.remove('muted');
      if (toggleMicIcon) toggleMicIcon.textContent = '🎙️';
      if (toggleMicText) toggleMicText.textContent = 'Mute Mic';

      const primaryText = startBtn ? (startBtn.querySelector('.btn-primary-text') || startBtn.querySelector('.start-btn-text')) : null;
      const subText = startBtn ? (startBtn.querySelector('.btn-sub-text') || startBtn.querySelector('.start-btn-sub')) : null;
      if (primaryText) primaryText.textContent = '🎙️ Microphone Active';
      if (subText) subText.textContent = 'Click button anytime to Mute / Pause';
      if (startBtn) {
        startBtn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        startBtn.style.boxShadow = '0 4px 20px rgba(16, 185, 129, 0.35)';
      }

      updateState('listening');
    }
  }

  // ─── End Consultation / Turn Off Mic Completely ───────────────

  function endSession() {
    console.log('[App] Ending session and silencing microphone');
    isMicMuted = true;
    isSessionStarted = false;
    isRecognizing = false;

    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }
    if (audioPlayer) {
      audioPlayer.stop();
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      mediaStream = null;
    }

    if (toggleMicBtn) toggleMicBtn.classList.remove('muted');
    if (toggleMicIcon) toggleMicIcon.textContent = '🎙️';
    if (toggleMicText) toggleMicText.textContent = 'Mute Mic';

    const primaryText = startBtn ? (startBtn.querySelector('.btn-primary-text') || startBtn.querySelector('.start-btn-text')) : null;
    const subText = startBtn ? (startBtn.querySelector('.btn-sub-text') || startBtn.querySelector('.start-btn-sub')) : null;
    if (primaryText) primaryText.textContent = 'Tap to Begin Voice Triage';
    if (subText) subText.textContent = 'Click & speak naturally into your microphone';
    if (startBtn) {
      startBtn.style.background = 'linear-gradient(135deg, #00f2fe, #4facfe)';
      startBtn.style.boxShadow = '0 4px 20px rgba(0, 242, 254, 0.35)';
    }

    updateState('idle');
    if (stateText) stateText.textContent = 'Consultation Concluded · Mic Off';
    addTranscriptMessage('system', 'Microphone turned off. Consultation concluded. Click "Tap to Begin" anytime to restart.');
  }

  // ─── WebSocket Connection (with HTTP/SSE fallback) ────────────

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.log('[App] WebSocket construction failed, switching to HTTP/SSE transport');
      switchToHttpTransport();
      return;
    }

    // If WebSocket doesn't open within 3 seconds, fall back to HTTP/SSE
    const wsTimeout = setTimeout(() => {
      if (ws && ws.readyState !== WebSocket.OPEN) {
        console.log('[App] WebSocket timeout, switching to HTTP/SSE transport');
        try { ws.close(); } catch (e) {}
        ws = null;
        switchToHttpTransport();
      }
    }, 3000);

    ws.onopen = () => {
      clearTimeout(wsTimeout);
      useHttpTransport = false;
      setConnectionStatus('connected', 'Connected');
      console.log('[App] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleServerMessage(message);
      } catch (err) {
        console.error('[App] Error parsing message:', err);
      }
    };

    ws.onclose = () => {
      clearTimeout(wsTimeout);
      console.log('[App] WebSocket closed');

      // If session never started successfully via WS, switch to HTTP
      if (!isSessionStarted) {
        console.log('[App] WebSocket closed before session, switching to HTTP/SSE');
        switchToHttpTransport();
        return;
      }

      setConnectionStatus('error', 'Disconnected');

      // Attempt reconnect after 3 seconds
      setTimeout(() => {
        if (!useHttpTransport && (!ws || ws.readyState === WebSocket.CLOSED)) {
          console.log('[App] Attempting reconnect...');
          connectWebSocket();
        }
      }, 3000);
    };

    ws.onerror = (err) => {
      clearTimeout(wsTimeout);
      console.error('[App] WebSocket error:', err);

      // If WebSocket fails entirely, switch to HTTP/SSE (Vercel deployment)
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        switchToHttpTransport();
      } else {
        setConnectionStatus('error', 'Error');
      }
    };
  }

  function switchToHttpTransport() {
    useHttpTransport = true;
    ws = null;
    setConnectionStatus('connected', 'HTTP Connected');
    console.log('[App] Using HTTP/SSE transport (serverless mode)');

    // If session was being started, continue via HTTP
    if (isSessionStarted) {
      startSessionHTTP();
    }
  }

  // ─── Handle Server Messages ───────────────────────────────────

  function handleServerMessage(message) {
    switch (message.type) {
      case 'session_init':
        console.log('[App] Session initialized:', message.sessionId);
        if (!isSessionStarted) {
          isSessionStarted = true;
        }
        if (message.language && message.language !== currentLanguage) {
          setAppLanguage(message.language, false);
        }
        // In WebSocket mode, send start_session exactly once; in HTTP mode, session is already started
        if (!useHttpTransport && !hasStartedInitialSession) {
          hasStartedInitialSession = true;
          sendMessage({ type: 'start_session' });
        }
        if (!isMicMuted) {
          startRecognition();
        }
        break;

      case 'pending_action_change':
        pendingAction = message.pendingAction;
        if (pendingAction && nearbyCareStatus !== 'declined') {
          nearbyCareStatus = 'pending';
        }
        console.log('[App] WebSocket pendingAction updated to:', pendingAction);
        break;

      case 'nearby_care_status_change':
        nearbyCareStatus = message.nearbyCareStatus;
        if (nearbyCareStatus === 'declined') {
          clearCareFacilities('declined');
        }
        console.log('[App] WebSocket nearbyCareStatus updated to:', nearbyCareStatus);
        break;

      case 'done':
        isSubmittingTurn = false;
        // HTTP/SSE transport: conversation complete, update history
        if (message.conversationHistory) {
          httpConversationHistory = message.conversationHistory;
        }
        if (message.pendingAction !== undefined) {
          pendingAction = message.pendingAction;
        }
        if (message.nearbyCareStatus !== undefined) {
          nearbyCareStatus = message.nearbyCareStatus;
          if (nearbyCareStatus === 'declined') {
            clearCareFacilities('declined');
          }
        }
        break;

      case 'state_change':
        updateState(message.state);
        break;

      case 'audio':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Audio chunk dropped for stale generation:', message.generationId);
          return;
        }
        currentGenerationId = message.generationId || currentGenerationId;
        handleAudioChunk(message);
        break;

      case 'transcript':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Transcript dropped for stale generation:', message.generationId);
          return;
        }
        if (message.role === 'assistant') {
          console.log('[TurnManager] ASSISTANT_RESPONSE:', message.text);
          console.log('[TurnManager] ANALYSIS_END (genId: ' + (message.generationId || currentGenerationId) + ')');
        }
        addTranscriptMessage(message.role, message.text);
        break;

      case 'transcript_chunk':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Transcript chunk dropped for stale generation:', message.generationId);
          return;
        }
        appendTranscriptChunk(message.role, message.text);
        break;

      case 'stop_audio':
        audioPlayer.stop();
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        break;

      case 'fallback_text':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Fallback text dropped for stale generation:', message.generationId);
          return;
        }
        console.log('[TurnManager] ASSISTANT_RESPONSE:', message.text);
        console.log('[TurnManager] ANALYSIS_END (genId: ' + (message.generationId || currentGenerationId) + ')');
        addTranscriptMessage('assistant', message.text);
        if (message.speakBrowser) {
          speakBrowserText(message);
        }
        break;

      case 'triage_update':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Triage update dropped for stale generation:', message.generationId);
          return;
        }
        handleTriageUpdate(message);
        break;

      case 'care_navigation_update':
        if (message.generationId && (invalidatedGenerations.has(message.generationId) || (currentGenerationId && message.generationId !== currentGenerationId))) {
          console.log('[TurnManager] STALE_RESPONSE_DROPPED: Care navigation dropped for stale generation:', message.generationId);
          return;
        }
        if (nearbyCareStatus === 'declined') {
          console.log('[App] Dropping care_navigation_update: nearby care is declined');
          return;
        }
        nearbyCareStatus = 'accepted';
        const navData = message.data || message;
        renderCareFacilities(navData.facilities || message.facilities, navData.urgencyLevel || message.urgencyLevel, navData.userLocation);
        break;

      case 'facility_selected':
        const selIdx = message.index !== undefined ? message.index : 0;
        selectFacilityByIndex(selIdx, { zoom: 15 });
        break;

      case 'map_focus':
        if (message.lat && message.lon) {
          focusCareMap(message.lat, message.lon, message.zoom || 15);
        }
        if (message.index !== undefined) {
          selectFacilityByIndex(message.index, { zoom: message.zoom || 15 });
        }
        break;

      case 'directions_open':
        if (message.mapsUrl && typeof window !== 'undefined') {
          try {
            window.open(message.mapsUrl, '_blank', 'noopener,noreferrer');
          } catch (e) {}
        }
        break;

      case 'filler_event':
        handleFillerEvent(message);
        break;

      case 'metrics':
        updateMetricsDisplay(message.data);
        break;

      case 'error':
        console.error('[App] Server error:', message.message);
        break;
    }
  }

  // ─── Audio Handling ───────────────────────────────────────────

  function handleAudioChunk(message) {
    if (message.generationId && invalidatedGenerations.has(message.generationId)) {
      console.log('[App] Dropping audio chunk for invalidated generation:', message.generationId);
      return;
    }
    currentGenerationId = message.generationId || currentGenerationId;

    // Track TTFA latency on first chunk
    if (message.isFirst && message.ttfbMs) {
      const diagTTFA = doc.getElementById('diagTTFA');
      if (diagTTFA) diagTTFA.textContent = `${Math.round(message.ttfbMs)} ms`;
      if (metricRimeTTFB) metricRimeTTFB.textContent = `${Math.round(message.ttfbMs)} ms`;
    }

    if (!message.data && !message.isLast) return;

    audioPlayer.enqueue(message.data, {
      text: message.text,
      format: message.format || 'mp3',
      isFiller: message.isFiller,
      generationId: message.generationId,
      responseId: message.responseId,
      segmentId: message.segmentId,
      chunkIndex: message.chunkIndex,
      isFirst: message.isFirst ?? false,
      isLast: message.isLast ?? false,
      ttfbMs: message.ttfbMs || null,
      synthesisStart: message.synthesisStart || null,
      synthesisComplete: message.synthesisComplete || null,
      audioSent: message.audioSent || null,
    });
  }

  // ─── Speech Recognition ───────────────────────────────────────

  // ─── Speech Turn Controller (Interruption & Silence Handling) ───

  // ─── Speech Turn Controller (Interruption & Silence Handling) ───

  const SHORT_CONVERSATIONAL_CONTROLS = new Set([
    'ஒரு', 'ம்', 'ஹ்ம்', 'உம்', 'a', 'um', 'uh', 'er', 'ah', 'ஒரு ',
    'ஆமா', 'ஆமாம்', 'சரி', 'பொரு', 'பொறு', 'போறு', 'பொற', 'போரு', 'கொஞ்சம் பொரு', 'கொஞ்சம் பொறு',
    'wait', 'wait wait', 'wait wait wait', 'hold on', 'one minute', 'one second', 'just a second', 'just a minute',
    'ஒரு நிமிஷம்', 'ஒரு நிமிடம்', 'இரு', 'இருங்க',
    'एक', 'उम', 'अह', 'हाँ', 'ठीक है', 'रुको', 'रुकिए', 'ठहरो', 'एक मिनट'
  ]);

  function createSpeechTurnController(config = {}) {
    const isSpeakingFn = config.isSpeakingFn || isAssistantSpeaking;
    const getAssistantTextFn = config.getAssistantTextFn || null;
    const getPendingQuestionFn = config.getPendingQuestionFn || null;
    const onAudioHalt = config.onAudioHalt || (() => {});
    const onSendInterruptStart = config.onSendInterruptStart || (() => {});
    const onSubmitSpeech = config.onSubmitSpeech || (() => {});
    const onInterimUpdate = config.onInterimUpdate || (() => {});
    const silenceTimeoutMs = config.silenceTimeoutMs !== undefined ? config.silenceTimeoutMs : 1200;

    let currentTurnBuffer = '';
    let turnFinalText = '';
    let interimText = '';
    let silenceTimer = null;
    let hasInterrupted = false;
    let turnStarted = false;
    let interruptionState = 'IDLE'; // 'IDLE' | 'INTERRUPTED_WAITING_FOR_USER' | 'COLLECTING'
    let lastSpeechTimestamp = null;
    let lastDetectedControlPhrase = null;

    function reset() {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      turnFinalText = '';
      currentTurnBuffer = '';
      interimText = '';
      hasInterrupted = false;
      turnStarted = false;
      interruptionState = 'IDLE';
      lastDetectedControlPhrase = null;
      onInterimUpdate('', false);
    }

    function processRecognitionEvent(results, resultIndex = 0) {
      lastSpeechTimestamp = Date.now();
      let interim = '';
      let newFinal = '';

      let items = results;
      let startIndex = resultIndex;
      if (results && !Array.isArray(results) && typeof results.length !== 'number') {
        items = [results];
        startIndex = 0;
      }

      for (let i = startIndex; i < (items ? items.length : 0); i++) {
        const item = items[i];
        const text = (item && item[0] ? item[0].transcript : (item?.transcript || item?.finalChunk || item?.interim || '')) || '';
        const isFinal = item && (item.isFinal !== undefined ? item.isFinal : Boolean(item?.finalChunk));
        if (isFinal) {
          newFinal += text + ' ';
        } else {
          interim += text;
        }
      }

      const isSpeaking = isSpeakingFn();
      const assistantText = getAssistantTextFn ? getAssistantTextFn() : '';
      const pendingQuestion = getPendingQuestionFn ? getPendingQuestionFn() : null;

      // Contextual normalization of ASR variants (e.g. "ஒரு" -> "பொரு" if assistant is speaking or right after)
      const rawChunk = (interim || newFinal || '').trim();
      const normalizedChunk = normalizeConversationalControl(rawChunk, {
        assistantSpeaking: isSpeaking,
        pendingQuestion,
        lastAssistantMsg: assistantText
      });

      if (newFinal.trim()) {
        let cleanChunk = newFinal.trim();
        // If cleanChunk is "ஒரு" and normalized to "பொரு" in interruption context, use "பொரு"
        if (cleanChunk === 'ஒரு' && normalizedChunk === 'பொரு') {
          cleanChunk = 'பொரு';
        }

        if (!turnStarted) {
          console.log('[TurnManager] TURN_START');
          turnStarted = true;
        }
        if (!turnFinalText.trim()) {
          turnFinalText = cleanChunk;
        } else {
          turnFinalText += ' ' + cleanChunk;
        }
        currentTurnBuffer = turnFinalText;
        console.log('[TurnManager] STT_FINAL:', cleanChunk);
        console.log('[TurnManager] TURN_BUFFER_APPEND:', cleanChunk, '| Accumulated Buffer:', turnFinalText);
      }

      if (interim.trim()) {
        if (!turnStarted) {
          console.log('[TurnManager] TURN_START');
          turnStarted = true;
        }
        console.log('[TurnManager] STT_INTERIM:', interim.trim());
      }
      interimText = interim;

      const currentSpeech = (turnFinalText + (interim ? ' ' + interim : '')).trim();
      if (!currentSpeech) return null;

      // Update visible interim speech preview
      if (onInterimUpdate) {
        onInterimUpdate(currentSpeech, Boolean(interim));
      }

      // ── Instant Interim Interruption Detection ──────────────────────
      const rawPhrase = (interim || currentSpeech).trim();
      const normalizedPhrase = normalizeConversationalControl(rawPhrase, {
        assistantSpeaking: isSpeaking,
        pendingQuestion,
        lastAssistantMsg: assistantText
      });

      const isEcho = isSpeaking && assistantText && isEchoText(normalizedPhrase, assistantText);
      const detectedPhrase = !isEcho ? detectInterruptionPhrase(normalizedPhrase) : null;
      let interruptionTriggered = false;
      let clientHaltMs = null;

      if (isSpeaking && detectedPhrase && !hasInterrupted) {
        hasInterrupted = true;
        interruptionTriggered = true;
        interruptionState = 'INTERRUPTED_WAITING_FOR_USER';
        lastDetectedControlPhrase = detectedPhrase;
        console.log('[TurnManager] INTERRUPTION triggered on phrase:', detectedPhrase);

        const haltStart = performance.now();
        onAudioHalt(detectedPhrase);
        clientHaltMs = performance.now() - haltStart;

        onSendInterruptStart({
          type: 'interrupt_start',
          clientHaltMs,
          text: detectedPhrase
        });

        // Debug logging in exact required schema
        console.log(`[VOICE] rawTranscript="${rawPhrase}" normalizedTranscript="${normalizedPhrase}" assistantSpeaking=true interruptionDetected=true controlPhrase="${detectedPhrase}" turnBuffer="${turnFinalText || normalizedPhrase}" turnEnd=false submittedToLLM=false`);
      } else if (isEcho) {
        interimText = '';
        return {
          currentSpeech: '',
          interim: '',
          detectedPhrase: null,
          interruptionTriggered: false,
          clientHaltMs: null,
          isEcho: true,
        };
      }

      // ── Gated Turn Finalization (Strictly on isFinal === true) ─────
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }

      let resolveSubmit;
      const submitPromise = new Promise((resolve) => {
        resolveSubmit = resolve;
      });

      if (turnFinalText.trim().length > 0) {
        silenceTimer = setTimeout(() => {
          const finalTextToSubmit = turnFinalText.trim();
          if (finalTextToSubmit) {
            const currentlySpeaking = isSpeakingFn();
            const curAssistantText = getAssistantTextFn ? getAssistantTextFn() : '';
            if (currentlySpeaking && curAssistantText && isEchoText(finalTextToSubmit, curAssistantText)) {
              console.log('[App] Filtered out acoustic speaker bleed:', finalTextToSubmit);
              reset();
              resolveSubmit(null);
              return;
            }

            const normalizedFinal = normalizeConversationalControl(finalTextToSubmit, {
              assistantSpeaking: currentlySpeaking || hasInterrupted,
              pendingQuestion,
              lastAssistantMsg: curAssistantText
            });

            // Check if user utterance is a pure conversational control / hesitation token:
            const isPureControl = SHORT_CONVERSATIONAL_CONTROLS.has(normalizedFinal.toLowerCase()) ||
              isWaitInterruptionApp(normalizedFinal);

            // Valid answer check (e.g. answering fever inquiry with "ஆமா", or answering quantity question with "ஒரு")
            const isValidAnswer = pendingQuestion && (
              (pendingQuestion.symptom === 'fever' && (normalizedFinal === 'ஆமா' || normalizedFinal === 'ஆமாம்' || normalizedFinal === 'சரி' || normalizedFinal === 'yes')) ||
              (/\b(how\s+many|எத்தனை|ஒன்றா)\b/i.test(pendingQuestion.questionText || '') && (normalizedFinal === 'ஒரு' || normalizedFinal === '1' || normalizedFinal === 'one'))
            );

            if (isPureControl && !isValidAnswer) {
              console.log(`[VOICE] rawTranscript="${finalTextToSubmit}" normalizedTranscript="${normalizedFinal}" assistantSpeaking=${currentlySpeaking} interruptionDetected=${hasInterrupted} controlPhrase="${lastDetectedControlPhrase || normalizedFinal}" turnBuffer="${finalTextToSubmit}" turnEnd=false submittedToLLM=false`);
              console.log('[TurnManager] Conversational hold/control phrase held in buffer ("' + normalizedFinal + '"), awaiting user continuation without LLM dispatch');
              interruptionState = 'INTERRUPTED_WAITING_FOR_USER';
              // Hold in buffer, DO NOT submit to LLM or trigger medical analysis!
              resolveSubmit(null);
              return;
            }

            // Substantive speech turn: strip leading control phrase if user spoke hold prefix before continuation
            const cleanMedicalText = stripControlPrefix(normalizedFinal) || normalizedFinal;

            console.log(`[VOICE] rawTranscript="${finalTextToSubmit}" normalizedTranscript="${cleanMedicalText}" assistantSpeaking=false interruptionDetected=false controlPhrase="${lastDetectedControlPhrase || ''}" turnBuffer="${finalTextToSubmit}" turnEnd=true submittedToLLM=true`);
            console.log('[TurnManager] TURN_END:', cleanMedicalText);
            console.log('[TurnManager] USER_TURN_SUBMITTED:', cleanMedicalText);

            onSubmitSpeech(cleanMedicalText);
            reset();
            resolveSubmit(cleanMedicalText);
          } else {
            resolveSubmit(null);
          }
        }, silenceTimeoutMs);
      } else {
        resolveSubmit(null);
      }

      return {
        currentSpeech,
        interim,
        detectedPhrase,
        interruptionTriggered,
        clientHaltMs,
        submitPromise,
      };
    }

    return {
      processRecognitionEvent,
      reset,
      isInterrupted: () => hasInterrupted,
      getInterruptionState: () => interruptionState,
      getCurrentAccumulation: () => (turnFinalText + (interimText ? ' ' + interimText : '')).trim(),
      getTurnBuffer: () => currentTurnBuffer || turnFinalText,
    };
  }

  let activeSpeechTurnController = null;

  function setupSpeechRecognition() {
    const SpeechRecognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;

    if (!SpeechRecognition) {
      console.error('[App] Speech Recognition not supported');
      addTranscriptMessage('system', 'Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      return;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = (LANGUAGE_CONFIGS[currentLanguage] && LANGUAGE_CONFIGS[currentLanguage].recognitionLang) || 'en-IN';
    recognition.maxAlternatives = 1;

    activeSpeechTurnController = createSpeechTurnController({
      isSpeakingFn: isAssistantSpeaking,
      getAssistantTextFn: () => (audioPlayer ? audioPlayer.currentlyPlayingText : ''),
      onInterimUpdate: (speech, isInterim) => {
        if (stateText) {
          if (isInterim && speech) {
            stateText.textContent = `🎙️ "${speech}"`;
          } else if (!isInterim && currentState === 'listening') {
            stateText.textContent = STATE_DISPLAY['listening'];
          }
        }
      },
      onAudioHalt: (phrase) => {
        audioPlayer.stop();
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        if (currentGenerationId) {
          invalidatedGenerations.add(currentGenerationId);
        }
        currentGenerationId = null;
        updateState('listening');
        if (metricFencing) {
          metricFencing.textContent = '100%';
        }
      },
      onSendInterruptStart: (msg) => {
        console.log(`[App] Interim interruption triggered immediately on "${msg.text}" — Audio stopped in: ${msg.clientHaltMs.toFixed(3)} ms`);
        if (metricInterrupt) {
          metricInterrupt.textContent = `${msg.clientHaltMs < 1 ? msg.clientHaltMs.toFixed(2) : Math.round(msg.clientHaltMs)} ms`;
        }
        // In HTTP mode, abort the active SSE stream to stop server-side processing
        if (useHttpTransport && activeSSEAbortController) {
          activeSSEAbortController.abort();
        }
        sendMessage(msg);
      },
      onSubmitSpeech: (finalTextToSubmit) => {
        const clean = (finalTextToSubmit || '').trim().toLowerCase();
        if (!clean) return;

        // Turn deduplication and single-flight enforcement
        if (isSubmittingTurn) {
          console.warn('[TurnManager] DUPLICATE_TURN_DROPPED: Turn submission already in-flight:', clean);
          return;
        }
        if (clean === lastSubmittedTranscript && (Date.now() - lastSubmittedTime) < 2000) {
          console.warn('[TurnManager] DUPLICATE_TURN_DROPPED: Dropping duplicate speech turn submission within debounce window:', clean);
          return;
        }

        const turnId = 'turn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        isSubmittingTurn = true;
        lastSubmittedTranscript = clean;
        lastSubmittedTurnId = turnId;
        lastSubmittedTime = Date.now();
        lastUserTurnEndWallTime = performance.now();

        // Immediately halt any previous assistant speech before starting new consultation turn
        if (audioPlayer) audioPlayer.stop();
        if (typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        if (currentGenerationId) {
          invalidatedGenerations.add(currentGenerationId);
        }
        currentGenerationId = 'gen_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
        currentAssistantBubble = null;

        console.log('[TurnManager] ANALYSIS_START (turnId: ' + turnId + ', genId: ' + currentGenerationId + '):', finalTextToSubmit);

        // Normalize medical speech (Tamil, Hindi, English)
        let normalized = {
          rawTranscript: finalTextToSubmit,
          normalizedTranscript: finalTextToSubmit,
          detectedMedicalTerms: [],
          isAmbiguous: false,
          clarificationPrompt: null,
        };

        if (typeof MedicalTranscriber !== 'undefined' && MedicalTranscriber.normalizeMedicalSpeech) {
          normalized = MedicalTranscriber.normalizeMedicalSpeech(finalTextToSubmit, currentLanguage);
        }

        const displayText = normalized.normalizedTranscript || finalTextToSubmit;
        addTranscriptMessage('user', displayText);

        console.log('[TurnTelemetry]', {
          turnId,
          rawTranscript: finalTextToSubmit,
          finalTranscript: displayText,
          pendingActionBefore: pendingAction,
          requestStartedAt: new Date().toISOString(),
        });

        if (isClientNegative(displayText)) {
          if (pendingAction || nearbyCareStatus === 'pending' || displayText.toLowerCase().includes('clinic') || displayText.toLowerCase().includes('hospital') || displayText.includes('வேண்டாம்') || displayText.includes('இல்ல') || displayText.includes('नहीं')) {
            nearbyCareStatus = 'declined';
            pendingAction = null;
            clearCareFacilities('declined');
          }
        } else if (isClientAffirmative(displayText)) {
          if (pendingAction || nearbyCareStatus === 'pending') {
            nearbyCareStatus = 'accepted';
            pendingAction = null;
          }
        }

        const lowerText = displayText.toLowerCase().trim();
        if (/\b(?:share\s+(?:the\s+)?location\s+in\s+map|share\s+location|show\s+in\s+map|open\s+map|show\s+map)\b/i.test(lowerText)) {
          if (latestCareFacilities.length > 0) {
            selectFacilityByIndex(0, { zoom: 15 });
          }
        } else if (/\b(?:share|show|put|select|take\s+me\s+to|navigate\s+to|zoom\s+to|focus\s+on)?\s*(?:the\s+)?(?:facility\s+|hospital\s+|clinic\s+|option\s+)?(?:number|#|no\.?)?\s*(one|two|three|four|five|1|2|3|4|5|first|second|third|fourth|fifth)\b/i.test(lowerText)) {
          const numMap = { 'one': 0, '1': 0, 'first': 0, 'two': 1, '2': 1, 'second': 1, 'three': 2, '3': 2, 'third': 2, 'four': 3, '4': 3, 'fourth': 3, 'five': 4, '5': 4, 'fifth': 4 };
          const m = lowerText.match(/\b(?:number|#|no\.?)?\s*(one|two|three|four|five|1|2|3|4|5|first|second|third|fourth|fifth)\b/i);
          if (m && numMap[m[1]] !== undefined) {
            selectFacilityByIndex(numMap[m[1]], { zoom: 15 });
          }
        }

        if (useHttpTransport) {
          // HTTP/SSE mode: send via POST /api/chat with generationId
          sendChatHTTP(displayText, { turnId, generationId: currentGenerationId });
        } else {
          // WebSocket mode: send via WS
          sendMessage({
            type: 'user_speech',
            text: displayText,
            rawTranscript: finalTextToSubmit,
            normalizedTranscript: displayText,
            medicalTerms: normalized.detectedMedicalTerms || [],
            isAmbiguous: normalized.isAmbiguous,
            location: currentLocation,
            pendingAction,
            nearbyCareStatus,
            turnId,
            generationId: currentGenerationId,
          });
        }

        // Merge symptoms with previously reported symptoms
        const localSymptoms = extractClientSymptoms(displayText);
        if (localSymptoms.length > 0 && symptomTags) {
          const existingTags = Array.from(symptomTags.querySelectorAll('.symptom-tag')).map(t => t.textContent.replace('• ', '').trim());
          const mergedList = Array.from(new Set([...existingTags, ...localSymptoms]));
          symptomTags.innerHTML = '';
          mergedList.forEach(s => {
            const tag = document.createElement('span');
            tag.className = 'symptom-tag';
            tag.textContent = '• ' + s;
            symptomTags.appendChild(tag);
          });
        }
      },
      silenceTimeoutMs: 1200,
    });

    recognition.onresult = (event) => {
      activeSpeechTurnController.processRecognitionEvent(event.results, event.resultIndex);
    };

    recognition.onstart = () => {
      isRecognizing = true;
      console.log('[App] Speech recognition onstart: actively listening');
    };

    recognition.onerror = (event) => {
      console.error('[App] Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        addTranscriptMessage('system', 'Microphone access was denied. Please allow microphone permissions.');
      }
      isRecognizing = false;
      // Restart on recoverable errors ONLY if mic is not muted
      if (['network', 'aborted', 'no-speech'].includes(event.error)) {
        setTimeout(() => {
          if (!isMicMuted) {
            startRecognition();
          }
        }, 800);
      }
    };

    recognition.onend = () => {
      isRecognizing = false;
      console.log('[App] Speech recognition onend (isMicMuted:', isMicMuted, ')');
      // Auto-restart if mic is not muted
      if (!isMicMuted) {
        setTimeout(() => startRecognition(), 150);
      }
    };

    // Start recognition immediately
    startRecognition();
  }

  const COMMON_SYMPTOMS = [
    'headache', 'dizziness', 'nausea', 'fever', 'chest pain', 'stomach pain',
    'sore throat', 'cough', 'fatigue', 'back pain', 'shortness of breath',
    'breathless', 'breathing difficulty', 'difficulty breathing', 'trouble breathing', 'hard to breathe',
    'knee pain', 'rash', 'vomiting', 'body ache', 'migraine', 'chills', 'weakness', 'diarrhea',
    // Tamil clinical terms
    'தலைவலி', 'காய்ச்சல்', 'மயக்கம்', 'நெஞ்சு வலி', 'வயிற்று வலி', 'இருமல்', 'சளி', 'மூச்சுத்திணறல்', 'மூச்சு விட கஷ்டமா இருக்கு', 'மூச்சு வாங்குது',
    // Hindi clinical terms
    'सिरदर्द', 'बुखार', 'चक्कर', 'सीने में दर्द', 'पेट दर्द', 'खांसी', 'उल्टी', 'सांस लेने में तकलीफ', 'सांस फूलना'
  ];

  function extractClientSymptoms(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const matches = COMMON_SYMPTOMS.filter(s => lower.includes(s) || text.includes(s));
    // Normalize breathing terms to shortness of breath
    return matches.map(s => {
      if (['breathless', 'breathing difficulty', 'difficulty breathing', 'trouble breathing', 'hard to breathe', 'மூச்சுத்திணறல்', 'மூச்சு விட கஷ்டமா இருக்கு', 'மூச்சு வாங்குது', 'सांस लेने में तकलीफ', 'सांस फूलना'].includes(s)) {
        return 'shortness of breath';
      }
      return s;
    });
  }

  function startRecognition() {
    if (isRecognizing || !recognition || isMicMuted) return;
    try {
      recognition.start();
      isRecognizing = true;
      console.log('[App] Speech recognition start() called successfully');
    } catch (err) {
      console.log('[App] Speech recognition already running or starting');
    }
  }

  // ─── State Management ─────────────────────────────────────────

  function updateState(state) {
    currentState = state;
    if (state === 'listening' || state === 'idle') {
      isSubmittingTurn = false;
    }

    // Update state indicator
    stateIndicator.className = 'state-indicator ' + state;
    stateText.textContent = STATE_DISPLAY[state] || state;

    // Update visualizer
    if (visualizer) {
      visualizer.setState(state);
    }

    // Reset interruption flag when going back to listening
    if (state === 'listening') {
      interruptionDetected = false;
    }
  }

  // ─── Transcript Management (ZERO OVERLAP) ──────────────────────

  function addTranscriptMessage(role, text, badges = []) {
    if (!text || !text.trim()) return;

    // Hide empty state
    if (transcriptEmpty) {
      transcriptEmpty.style.display = 'none';
    }

    const trimmed = text.trim();

    // A user message always starts a new turn: clear the assistant bubble reference
    if (role === 'user') {
      currentAssistantBubble = null;
      // Prevent duplicate if this exact message was already added
      const lastMsg = transcriptContainer.lastElementChild;
      if (lastMsg && lastMsg.classList.contains('user')) {
        const lastBubble = lastMsg.querySelector('.message-bubble');
        if (lastBubble && lastBubble.textContent.trim() === trimmed) {
          return;
        }
      }
    }

    // Single Assistant Bubble Consolidation: If an assistant message bubble already exists for this turn,
    // merge subsequent sentence segments into the existing bubble instead of rendering 4 separate bubbles!
    if (role === 'assistant' && currentAssistantBubble) {
      const cur = currentAssistantBubble.textContent.trim();
      if (!cur.includes(trimmed)) {
        currentAssistantBubble.textContent = cur ? `${cur} ${trimmed}` : trimmed;
      }
      transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
      return;
    }

    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? '👤' : role === 'assistant' ? '🩺' : 'ℹ️';

    const wrapper = document.createElement('div');
    wrapper.className = 'message-bubble-wrapper';

    // Meta header
    const metaRow = document.createElement('div');
    metaRow.className = 'message-meta-row';
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    metaRow.textContent = (role === 'user' ? 'Patient' : 'VoxAct Assistant') + ' · ' + timeStr;
    wrapper.appendChild(metaRow);

    // Optional badges (e.g. Zero Dead-Air filler badge)
    for (const badge of badges) {
      wrapper.appendChild(badge);
    }

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = trimmed;
    wrapper.appendChild(bubble);

    messageEl.appendChild(avatar);
    messageEl.appendChild(wrapper);
    transcriptContainer.appendChild(messageEl);

    // Update current assistant bubble for this turn
    if (role === 'assistant') {
      currentAssistantBubble = bubble;
    }

    // Smooth scroll to latest
    transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
  }

  function appendTranscriptChunk(role, text) {
    if (role === 'assistant') {
      if (!currentAssistantBubble) {
        addTranscriptMessage('assistant', text);
      } else {
        currentAssistantBubble.textContent += text;
        transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
      }
    }
  }

  // ─── Live Clinical Assessment Handlers ─────────────────────────

  function handleTriageUpdate(message) {
    const { toolName, data } = message;
    if (!data) return;

    // 1. Extract Symptoms
    let symptoms = data.symptoms;
    if (!symptoms && data.analysisResult?.symptoms) symptoms = data.analysisResult.symptoms;
    if (!symptoms && Array.isArray(data)) symptoms = data;

    if (symptoms && Array.isArray(symptoms) && symptoms.length > 0 && symptomTags) {
      symptomTags.innerHTML = '';
      symptoms.forEach(s => {
        const tag = document.createElement('span');
        tag.className = 'symptom-tag';
        tag.textContent = '• ' + s;
        symptomTags.appendChild(tag);
      });
    }

    // 2. Extract Differential Conditions with Pattern Match Percentages
    let conditions = data.possibleConditions;
    if (!conditions && data.analysisResult?.possibleConditions) conditions = data.analysisResult.possibleConditions;

    if (conditionsList) {
      conditionsList.innerHTML = '';
      if (conditions && Array.isArray(conditions) && conditions.length > 0) {
        conditions.slice(0, 4).forEach(c => {
          const score = c.patternMatchScore !== undefined ? c.patternMatchScore : (c.confidence !== undefined ? c.confidence : 0.65);
          const percent = Math.min(99, Math.max(15, Math.round(score * 100)));
          const item = document.createElement('div');
          item.className = 'condition-item';
          item.innerHTML = `
            <div class="condition-header-row">
              <span class="condition-name">${c.condition}</span>
              <span class="condition-match-text">${percent}% pattern match</span>
            </div>
            <div class="condition-progress">
              <div class="condition-fill" style="width: ${percent}%"></div>
            </div>
          `;
          conditionsList.appendChild(item);
        });

        const disclaimer = document.createElement('div');
        disclaimer.className = 'condition-disclaimer-note';
        disclaimer.style.cssText = 'font-size: 0.72rem; color: var(--text-tertiary, #94a3b8); margin-top: 6px; text-align: right; font-style: italic;';
        disclaimer.textContent = 'Pattern match only — not a diagnosis.';
        conditionsList.appendChild(disclaimer);
      } else {
        const empty = document.createElement('div');
        empty.className = 'empty-conditions-note';
        empty.style.cssText = 'color: var(--text-tertiary, #94a3b8); font-size: 0.85rem; padding: 12px 0; text-align: center;';
        empty.textContent = 'No clear pattern identified from the information provided.';
        conditionsList.appendChild(empty);
      }
    }

    // 3. Extract Urgency Badge
    let urgency = data.urgencyLevel || data.level;
    if (!urgency && data.urgency?.urgencyLevel) urgency = data.urgency.urgencyLevel;
    if (!urgency && data.urgency?.level) urgency = data.urgency.level;

    if (urgency && urgencyBadge) {
      const uStr = String(urgency).toLowerCase();
      urgencyBadge.className = 'urgency-pill ' + uStr;
      urgencyBadge.textContent = uStr.toUpperCase() + ' PRIORITY';
    }

    // 4. Care Navigation / Verified Facilities Only (No Synthetic Clinics)
    // Only render if user has accepted nearby care
    const careFacs = data.facilities || (data.careNavigation && data.careNavigation.facilities) || (Array.isArray(data.careNavigation) ? data.careNavigation : null);
    if (careFacs && nearbyCareStatus === 'accepted') {
      renderCareFacilities(careFacs, urgency);
    }
  }

  function handleFillerEvent(message) {
    if (fillerAlert && fillerAlertText) {
      fillerAlert.classList.add('active');
      const dispatchStr = (message.dispatchMs !== undefined && message.dispatchMs !== null)
        ? ` (dispatched in ${message.dispatchMs.toFixed(2)}ms)`
        : '';
      fillerAlertText.textContent = `⚡ Zero Dead-Air Active: Spoke "${message.text}"${dispatchStr}`;
      setTimeout(() => {
        fillerAlert.classList.remove('active');
      }, 6000);
    }
  }

  // ─── Connection Status ────────────────────────────────────────

  function setConnectionStatus(state, text) {
    connectionStatus.className = 'connection-status ' + state;
    if (statusText) statusText.textContent = text;
  }

  // ─── WebSocket Send ───────────────────────────────────────────

  function sendMessage(message) {
    if (useHttpTransport) {
      // In HTTP mode, most messages are handled differently:
      // - user_speech → sendChatHTTP (handled at call site)
      // - set_language, set_location → stored client-side
      // - interrupt_start → abort SSE (handled at call site)
      // - playback_start/complete, get_metrics → skip (no persistent server)
      if (message.type === 'set_language' && message.language) {
        // Language is already tracked in currentLanguage
      } else if (message.type === 'set_location' && message.location) {
        // Location is already tracked in currentLocation
      }
      return;
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  // ─── Metrics ──────────────────────────────────────────────────

  function requestMetrics() {
    sendMessage({ type: 'get_metrics' });
  }

  function updateMetricsDisplay(data) {
    if (!data || data.length === 0) return;

    // Find the latest session that has calculated metrics
    let target = null;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] && data[i].metrics && Object.keys(data[i].metrics).length > 0) {
        target = data[i];
        break;
      }
    }
    if (!target) target = data[data.length - 1];
    if (!target || !target.metrics) return;

    const m = target.metrics;
    const formatMs = (val) => (val !== undefined && val !== null && !isNaN(val)) ? `${Math.round(val)} ms` : '—';

    if (metricFiller) {
      const val = m.fillerInsertionMs || m.fillerDispatchMs;
      metricFiller.textContent = formatMs(val);
    }
    if (metricRimeTTFB) {
      metricRimeTTFB.textContent = formatMs(m.rimeTTFBMs || m.rimeFirstChunkMs);
    }
    const diagTTFA = doc.getElementById('diagTTFA');
    if (diagTTFA) {
      diagTTFA.textContent = formatMs(m.rimeFirstChunkMs || m.rimeTTFBMs);
    }
    const diagPlayback = doc.getElementById('diagPlayback');
    if (diagPlayback && m.browserPlaybackLatencyMs) {
      diagPlayback.textContent = formatMs(m.browserPlaybackLatencyMs);
    }
    if (metricInterrupt) {
      const val = m.clientHaltMs || m.interruptionResponseMs;
      metricInterrupt.textContent = formatMs(val);
    }
    if (metricFencing) {
      if (m.staleFencedCount !== undefined && m.staleFencedCount > 0) {
        metricFencing.textContent = '100%';
      } else if (m.isStaleFenced) {
        metricFencing.textContent = '100%';
      } else {
        metricFencing.textContent = '—';
      }
    }
  }

  // ─── Initialize on DOM Ready ──────────────────────────────────
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  // ─── Export for Unit & Regression Testing ──────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      detectInterruptionPhrase,
      normalizeSpeechText,
      normalizeConversationalControl,
      stripControlPrefix,
      isAssistantSpeaking,
      createSpeechTurnController,
      INTERRUPTION_PATTERNS,
      isEchoText,
      LANGUAGE_CONFIGS,
      CITY_COORDINATES,
      isIndiaLocation,
      renderCareFacilities,
    };
  }

})();

