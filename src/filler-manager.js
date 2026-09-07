/**
 * VoxAct — Context-Aware Filler Speech Manager
 * Generates appropriate filler phrases based on conversation context and current tool.
 * Written following Rime's "writing for the ear" guidelines:
 * - Short sentences, one thought per sentence
 * - Natural conversational rhythm
 * - Punctuation for pacing
 * - Warm, reassuring tone for medical context
 */

const FILLER_CATEGORIES_EN = {
  // When starting to process symptoms
  symptom_analysis: [
    "Okay, let me look into that for you.",
    "Got it. I'm reviewing your symptoms now.",
    "Thanks for sharing that. Let me check a few things.",
    "Alright, I'm looking into what might be going on.",
    "Okay... let me think about this for a moment.",
    "I hear you. Let me analyze those symptoms.",
  ],

  // When calculating urgency
  urgency_check: [
    "I want to make sure we handle this properly.",
    "Let me check how quickly you should be seen.",
    "One moment... I'm assessing the priority level.",
    "I'm making sure we get the right level of care for you.",
    "Just checking something important here.",
  ],

  // When looking up clinics or care navigation
  clinic_search: [
    "Let me find the right place for you.",
    "I'm searching for nearby options now.",
    "One sec... looking for available clinics.",
    "Let me see what's close to you.",
    "Checking availability near you now.",
  ],

  // When checking appointment slots
  scheduling: [
    "Let me check what times are open.",
    "Looking at the schedule for you.",
    "One moment... checking available slots.",
    "I'll find a time that works.",
  ],

  // General acknowledgment when tool type is unknown
  general: [
    "Okay, one moment.",
    "Let me look into that.",
    "Sure, give me just a second.",
    "Working on that for you now.",
    "Alright... let me check.",
    "One moment please.",
  ],

  // Empathetic fillers for when the user has described discomfort
  empathy: [
    "I understand that must be uncomfortable. Let me help.",
    "I hear you, and I want to make sure you get the right care.",
    "That sounds tough. Let me see what we can do.",
    "I appreciate you telling me all of that. Let me look into it.",
  ],

  // Transition fillers for between tool results
  transition: [
    "Okay, so...",
    "Alright, here's what I found.",
    "Good news, I have some information.",
    "Okay, let me share what I've found.",
  ],
};

const FILLER_CATEGORIES_TA = {
  symptom_analysis: [
    "சரி, நான் இதை பார்க்கிறேன்.",
    "உங்கள் அறிகுறிகளை இப்போது ஆராய்கிறேன்.",
    "ஒரு நிமிடம்... சரிபார்க்கிறேன்.",
    "சரி, என்ன பிரச்சனை என்று பார்க்கிறேன்.",
    "புரிந்தது, இதை உடனே கவனிக்கிறேன்.",
  ],
  urgency_check: [
    "உங்களுக்கு எவ்வளவு விரைவில் சிகிச்சை தேவை என்று பார்க்கிறேன்.",
    "முன்னுரிமை நிலையை மதிப்பிடுகிறேன்.",
    "சிகிச்சையின் அவசரத்தை சரிபார்க்கிறேன்.",
    "முறையான சிகிச்சையை உறுதி செய்கிறேன்.",
  ],
  clinic_search: [
    "உங்களுக்கு அருகில் உள்ள சிகிச்சை மையங்களைத் தேடுகிறேன்.",
    "அருகில் உள்ள கிளினிக்குகளைப் பார்க்கிறேன்.",
    "சரியான மருத்துவ இடத்தை தேடுகிறேன்.",
    "அருகில் இருக்கும் வசதிகளைப் பார்க்கிறேன்.",
  ],
  scheduling: [
    "நேரங்களை சரிபார்க்கிறேன்.",
    "கிடைக்கும் நேரங்களைப் பார்க்கிறேன்.",
  ],
  general: [
    "சரி, ஒரு நிமிடம்.",
    "இதை சரிபார்க்கிறேன்.",
    "ஒரு கணம் பொறுங்கள்.",
  ],
  empathy: [
    "உங்களின் சிரமத்தை புரிந்து கொள்கிறேன், உதவுகிறேன்.",
    "கவலைப்படாதீர்கள், சரியான சிகிச்சையை கண்டுபிடிப்போம்.",
  ],
  transition: [
    "சரி, விவரங்கள் கிடைத்துள்ளன.",
    "நான் கண்டறிந்த தகவலைப் பகிர்கிறேன்.",
  ],
};

const FILLER_CATEGORIES_HI = {
  symptom_analysis: [
    "ठीक है, मैं आपके लक्षणों की जांच कर रहा हूँ.",
    "समझ गया, मैं इसे अभी देख रहा हूँ.",
    "एक क्षण... मैं विवरण देख रहा हूँ.",
    "अच्छा, मैं देखता हूँ क्या समस्या हो सकती है.",
  ],
  urgency_check: [
    "मैं देख रहा हूँ कि आपको कितनी जल्दी डॉक्टर को दिखाना चाहिए.",
    "प्राथमिकता स्तर का आकलन कर रहा हूँ.",
    "एक क्षण... मैं ज़रूरी जानकारी जांच रहा हूँ.",
  ],
  clinic_search: [
    "मैं आपके नजदीकी स्वास्थ्य सेवा विकल्पों को खोज रहा हूँ.",
    "नजदीकी क्लिनिक देख रहा हूँ.",
    "आपके लिए सही अस्पताल तलाश रहा हूँ.",
  ],
  scheduling: [
    "उपलब्ध समय देख रहा हूँ.",
    "समय सारिणी की जांच कर रहा हूँ.",
  ],
  general: [
    "जी, एक पल रुकिए.",
    "मैं अभी देखता हूँ.",
    "कृपया एक क्षण प्रतीक्षा करें.",
  ],
  empathy: [
    "मैं आपकी तकलीफ समझ सकता हूँ, चिंता न करें.",
    "मैं पूरी कोशिश करूँगा कि आपको सही देखभाल मिले.",
  ],
  transition: [
    "अच्छा, मुझे जानकारी मिल गई है.",
    "यहाँ वह जानकारी है जो मुझे मिली है.",
  ],
};

const FILLER_CATEGORIES_BY_LANG = {
  en: FILLER_CATEGORIES_EN,
  ta: FILLER_CATEGORIES_TA,
  hi: FILLER_CATEGORIES_HI,
};

class FillerManager {
  constructor(language = 'en') {
    this.language = language;
    // Track recently used fillers to avoid repetition
    this.recentlyUsed = [];
    this.maxRecent = 10;
    this.turnCount = 0;
  }

  /**
   * Set current language for filler generation
   */
  setLanguage(lang) {
    if (lang && (lang === 'en' || lang === 'ta' || lang === 'hi')) {
      this.language = lang;
    }
  }

  /**
   * Get an appropriate filler phrase based on context and language
   * @param {string} toolName - The name of the tool being executed
   * @param {object} context - Conversation context (can include language)
   * @returns {string} A filler phrase
   */
  getFiller(toolName, context = {}) {
    let category = 'general';

    // Map tool names to filler categories
    const toolCategoryMap = {
      'analyzeSymptoms': 'symptom_analysis',
      'calculateUrgency': 'urgency_check',
      'findNearestClinics': 'clinic_search',
      'findNearbyCareFacilities': 'clinic_search',
      'checkAvailability': 'scheduling',
    };

    if (toolCategoryMap[toolName]) {
      category = toolCategoryMap[toolName];
    }

    // If the user has described pain or distress, mix in empathy
    if (context.userDistress && this.turnCount < 3) {
      // 40% chance of empathetic filler in early turns
      if (Math.random() < 0.4) {
        category = 'empathy';
      }
    }

    const lang = context.language || this.language || 'en';
    const langDict = FILLER_CATEGORIES_BY_LANG[lang] || FILLER_CATEGORIES_EN;
    const candidates = langDict[category] || langDict.general || FILLER_CATEGORIES_EN.general;

    // Filter out recently used
    let available = candidates.filter(f => !this.recentlyUsed.includes(f));
    if (available.length === 0) {
      // Reset if we've used them all
      this.recentlyUsed = [];
      available = candidates;
    }

    // Pick a random one
    const selected = available[Math.floor(Math.random() * available.length)];

    // Track usage
    this.recentlyUsed.push(selected);
    if (this.recentlyUsed.length > this.maxRecent) {
      this.recentlyUsed.shift();
    }

    return selected;
  }

  /**
   * Get a transition filler for when results are ready
   */
  getTransitionFiller(lang = null) {
    const activeLang = lang || this.language || 'en';
    const langDict = FILLER_CATEGORIES_BY_LANG[activeLang] || FILLER_CATEGORIES_EN;
    const candidates = langDict.transition || FILLER_CATEGORIES_EN.transition;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * Increment the turn counter
   */
  nextTurn() {
    this.turnCount++;
  }

  /**
   * Reset the filler manager for a new conversation
   */
  reset() {
    this.recentlyUsed = [];
    this.turnCount = 0;
  }
}

FillerManager.FILLER_CATEGORIES = FILLER_CATEGORIES_EN;
FillerManager.FILLER_CATEGORIES_BY_LANG = FILLER_CATEGORIES_BY_LANG;

module.exports = FillerManager;
