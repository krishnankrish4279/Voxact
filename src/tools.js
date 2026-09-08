/**
 * VoxAct — Simulated Medical Tools
 * Synthetic medical analysis tools for the triage assistant.
 * Uses de-identified, synthetic data only — NOT for real medical advice.
 * 
 * Each tool has a configurable artificial delay to simulate real-world latency
 * and enable stress testing of the conversation continuity system.
 */

// Synthetic symptom → condition mapping
const SYMPTOM_CONDITIONS = {
  headache: [
    { condition: 'Tension Headache', confidence: 0.7, urgency: 'low' },
    { condition: 'Migraine', confidence: 0.5, urgency: 'medium' },
    { condition: 'Dehydration', confidence: 0.4, urgency: 'low' },
  ],
  fever: [
    { condition: 'Common Cold', confidence: 0.5, urgency: 'low' },
    { condition: 'Flu', confidence: 0.6, urgency: 'medium' },
    { condition: 'Viral Infection', confidence: 0.55, urgency: 'medium' },
  ],
  'chest pain': [
    { condition: 'Muscle Strain', confidence: 0.3, urgency: 'medium' },
    { condition: 'Acid Reflux', confidence: 0.4, urgency: 'medium' },
    { condition: 'Cardiac Event', confidence: 0.2, urgency: 'emergency' },
  ],
  nausea: [
    { condition: 'Food Poisoning', confidence: 0.5, urgency: 'medium' },
    { condition: 'Gastritis', confidence: 0.4, urgency: 'low' },
    { condition: 'Motion Sickness', confidence: 0.3, urgency: 'low' },
  ],
  dizziness: [
    { condition: 'Low Blood Pressure', confidence: 0.4, urgency: 'medium' },
    { condition: 'Inner Ear Issue', confidence: 0.45, urgency: 'low' },
    { condition: 'Dehydration', confidence: 0.5, urgency: 'low' },
  ],
  'sore throat': [
    { condition: 'Pharyngitis', confidence: 0.6, urgency: 'low' },
    { condition: 'Strep Throat', confidence: 0.4, urgency: 'medium' },
    { condition: 'Tonsillitis', confidence: 0.35, urgency: 'medium' },
  ],
  cough: [
    { condition: 'Common Cold', confidence: 0.6, urgency: 'low' },
    { condition: 'Bronchitis', confidence: 0.4, urgency: 'medium' },
    { condition: 'Allergies', confidence: 0.35, urgency: 'low' },
  ],
  'stomach pain': [
    { condition: 'Indigestion', confidence: 0.5, urgency: 'low' },
    { condition: 'Gastritis', confidence: 0.45, urgency: 'medium' },
    { condition: 'Appendicitis', confidence: 0.15, urgency: 'emergency' },
  ],
  fatigue: [
    { condition: 'Sleep Deficit', confidence: 0.5, urgency: 'low' },
    { condition: 'Anemia', confidence: 0.35, urgency: 'medium' },
    { condition: 'Thyroid Issue', confidence: 0.25, urgency: 'medium' },
  ],
  'back pain': [
    { condition: 'Muscle Strain', confidence: 0.6, urgency: 'low' },
    { condition: 'Disc Issue', confidence: 0.3, urgency: 'medium' },
    { condition: 'Poor Posture', confidence: 0.5, urgency: 'low' },
  ],
  'shortness of breath': [
    { condition: 'Acute Respiratory Distress / Asthma', confidence: 0.85, patternMatchScore: 0.85, urgency: 'emergency' },
    { condition: 'Cardiac / Respiratory Compromise', confidence: 0.75, patternMatchScore: 0.75, urgency: 'emergency' },
    { condition: 'Asthma Exacerbation', confidence: 0.65, patternMatchScore: 0.65, urgency: 'high' },
  ],
  shortness_of_breath: [
    { condition: 'Acute Respiratory Distress / Asthma', confidence: 0.85, patternMatchScore: 0.85, urgency: 'emergency' },
    { condition: 'Cardiac / Respiratory Compromise', confidence: 0.75, patternMatchScore: 0.75, urgency: 'emergency' },
    { condition: 'Asthma Exacerbation', confidence: 0.65, patternMatchScore: 0.65, urgency: 'high' },
  ],
  'eye pain': [
    { condition: 'Corneal Abrasion / Conjunctivitis', confidence: 0.70, patternMatchScore: 0.70, urgency: 'medium' },
    { condition: 'Eye Strain / Dry Eye', confidence: 0.55, patternMatchScore: 0.55, urgency: 'low' },
    { condition: 'Acute Glaucoma / Ocular Emergency', confidence: 0.30, patternMatchScore: 0.30, urgency: 'emergency' },
  ],
  toothache: [
    { condition: 'Dental Caries / Pulpitis', confidence: 0.75, patternMatchScore: 0.75, urgency: 'low' },
    { condition: 'Dental Abscess', confidence: 0.45, patternMatchScore: 0.45, urgency: 'medium' },
  ],
  rash: [
    { condition: 'Contact Dermatitis', confidence: 0.5, patternMatchScore: 0.5, urgency: 'low' },
    { condition: 'Allergic Reaction', confidence: 0.45, patternMatchScore: 0.45, urgency: 'medium' },
    { condition: 'Eczema', confidence: 0.4, patternMatchScore: 0.4, urgency: 'low' },
  ],
  'knee pain': [
    { condition: 'Knee Osteoarthritis / Strain', confidence: 0.70, patternMatchScore: 0.70, urgency: 'low' },
    { condition: 'Patellofemoral Pain Syndrome', confidence: 0.55, patternMatchScore: 0.55, urgency: 'low' },
    { condition: 'Ligament or Meniscus Strain', confidence: 0.45, patternMatchScore: 0.45, urgency: 'medium' },
  ],
  vomiting: [
    { condition: 'Gastroenteritis', confidence: 0.72, patternMatchScore: 0.72, urgency: 'medium' },
    { condition: 'Food Poisoning', confidence: 0.60, patternMatchScore: 0.60, urgency: 'medium' },
    { condition: 'Gastritis', confidence: 0.45, patternMatchScore: 0.45, urgency: 'low' },
  ],
  weakness: [
    { condition: 'Dehydration / Fatigue', confidence: 0.65, patternMatchScore: 0.65, urgency: 'low' },
    { condition: 'Viral Illness Recovery', confidence: 0.50, patternMatchScore: 0.50, urgency: 'low' },
    { condition: 'Electrolyte Imbalance', confidence: 0.42, patternMatchScore: 0.42, urgency: 'medium' },
  ],
};

// Synthetic clinic data
const CLINICS = [
  {
    id: 'clinic_001',
    name: 'MedFirst Urgent Care',
    address: '123 Health Street',
    distance: '0.8 miles',
    rating: 4.7,
    capabilities: ['emergency', 'medium', 'low'],
    waitTime: '15 minutes',
    phone: '555-0101',
  },
  {
    id: 'clinic_002',
    name: 'CarePoint Family Medicine',
    address: '456 Wellness Avenue',
    distance: '1.2 miles',
    rating: 4.9,
    capabilities: ['medium', 'low'],
    waitTime: '25 minutes',
    phone: '555-0102',
  },
  {
    id: 'clinic_003',
    name: 'QuickCare Walk-In Clinic',
    address: '789 Recovery Road',
    distance: '2.1 miles',
    rating: 4.5,
    capabilities: ['medium', 'low'],
    waitTime: '10 minutes',
    phone: '555-0103',
  },
  {
    id: 'clinic_004',
    name: 'City General Emergency Room',
    address: '100 Emergency Drive',
    distance: '3.5 miles',
    rating: 4.3,
    capabilities: ['emergency', 'medium', 'low'],
    waitTime: '45 minutes',
    phone: '555-0104',
  },
];

const { searchHealthcareFacilities, VERIFIED_FACILITIES } = require('./care-navigator');

// Configurable delays for stress testing (ms)
const TOOL_DELAYS = {
  analyzeSymptoms: 1500,
  calculateUrgency: 800,
  findNearestClinics: 1000,
  checkAvailability: 700,
  findNearbyCareFacilities: 900,
};

/**
 * Simulate async delay
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Analyze symptoms and return possible conditions
 * @param {string[]} symptoms - Array of symptom strings
 * @param {AbortSignal} signal - For cancellation support
 */
async function analyzeSymptoms(symptoms, signal) {
  await delay(TOOL_DELAYS.analyzeSymptoms);

  if (signal?.aborted) {
    throw new Error('Tool execution cancelled');
  }

  let symptomList = [];
  if (Array.isArray(symptoms)) {
    symptomList = symptoms;
  } else if (typeof symptoms === 'string') {
    symptomList = symptoms.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  } else if (symptoms && typeof symptoms === 'object') {
    symptomList = symptoms.symptoms || [];
  }

  const results = [];
  const normalizedSymptoms = symptomList.map(s => String(s).toLowerCase().trim());

  // Fever alone is non-specific and does not justify a premature Flu diagnosis or differential percentages
  const isOnlyFever = normalizedSymptoms.length === 1 && (
    normalizedSymptoms[0] === 'fever' ||
    normalizedSymptoms[0] === 'காய்ச்சல்' ||
    normalizedSymptoms[0] === 'बुखार'
  );

  if (isOnlyFever) {
    return {
      symptoms: normalizedSymptoms,
      symptomCount: 1,
      possibleConditions: [],
      isOnlyFever: true,
      timestamp: new Date().toISOString(),
      notice: 'Fever can occur with several different infections and conditions. Additional symptom details are required before evaluating differential patterns.',
      disclaimer: 'This is a synthetic analysis for demonstration purposes only. Not medical advice.',
    };
  }

  for (const symptom of normalizedSymptoms) {
    // Find exact or partial matches
    for (const [key, conditions] of Object.entries(SYMPTOM_CONDITIONS)) {
      if (symptom.includes(key) || key.includes(symptom)) {
        for (const cond of conditions) {
          const existing = results.find(r => r.condition === cond.condition);
          if (existing) {
            // Boost confidence if multiple symptoms point to same condition
            existing.confidence = Math.min(0.95, existing.confidence + 0.15);
            existing.patternMatchScore = existing.confidence;
            existing.matchedSymptoms.push(symptom);
          } else {
            results.push({
              ...cond,
              patternMatchScore: cond.patternMatchScore || cond.confidence,
              matchedSymptoms: [symptom],
            });
          }
        }
      }
    }
  }

  // If unknown symptoms provided that matched zero known patterns, provide heuristic evaluation;
  // If no symptoms provided, leave results empty so UI renders the clean empty state
  if (results.length === 0 && normalizedSymptoms.length > 0 && normalizedSymptoms.some(s => s.trim().length > 0)) {
    results.push({
      condition: 'Awaiting Further Evaluation',
      confidence: 0.35,
      patternMatchScore: 0.35,
      urgency: 'low',
      matchedSymptoms: normalizedSymptoms,
    });
  }

  // Sort by urgency ('emergency' > 'high' > 'medium' > 'low') then patternMatchScore/confidence descending
  const urgencyWeight = { emergency: 4, high: 3, medium: 2, low: 1 };
  results.sort((a, b) => {
    const uwA = urgencyWeight[a.urgency] || 1;
    const uwB = urgencyWeight[b.urgency] || 1;
    if (uwA !== uwB) return uwB - uwA;
    return (b.patternMatchScore || b.confidence) - (a.patternMatchScore || a.confidence);
  });

  return {
    symptoms: normalizedSymptoms,
    symptomCount: normalizedSymptoms.length,
    possibleConditions: results.slice(0, 5),
    timestamp: new Date().toISOString(),
    disclaimer: 'This is a synthetic analysis for demonstration purposes only. Not medical advice.',
  };
}

/**
 * Calculate urgency level based on symptoms and analysis
 * @param {object} analysisResult - Result from analyzeSymptoms
 * @param {AbortSignal} signal - For cancellation support
 */
async function calculateUrgency(analysisResult, signal) {
  await delay(TOOL_DELAYS.calculateUrgency);

  if (signal?.aborted) {
    throw new Error('Tool execution cancelled');
  }

  const safeResult = analysisResult || {};
  const conditions = safeResult.possibleConditions || [];

  // Check for emergency-level conditions and symptoms
  const reportedSymptoms = Array.isArray(safeResult.symptoms) ? safeResult.symptoms.map(s => String(s).toLowerCase()) : [];
  const hasAcuteSymptom = reportedSymptoms.some(s =>
    s.includes('shortness') || s.includes('breath') || s.includes('chest') || s.includes('மூச்சு') || s.includes('நெஞ்சு') || s.includes('सांस') || s.includes('सीने')
  );

  const hasEmergency = hasAcuteSymptom || conditions.some(c => (c.urgency === 'emergency' || c.urgency === 'high') && c.confidence > 0.15);
  const hasMedium = conditions.some(c => c.urgency === 'medium' && c.confidence > 0.3);
  const symptomCount = safeResult.symptomCount || conditions.reduce((acc, c) => acc + (c.matchedSymptoms?.length || 0), 0) || 0;

  let level, reasoning, timeframe;

  if (hasEmergency) {
    level = 'high';
    reasoning = hasAcuteSymptom
      ? 'Shortness of breath or cardiovascular symptoms can be serious and require immediate medical evaluation.'
      : 'Some of your symptoms could indicate a condition that needs prompt attention.';
    timeframe = 'You should be evaluated immediately or within the hour.';
  } else if (hasMedium || symptomCount >= 3) {
    level = 'medium';
    reasoning = 'Your symptoms suggest you should see a healthcare provider soon.';
    timeframe = 'I would recommend being seen today if possible.';
  } else {
    level = 'low';
    reasoning = 'Your symptoms appear manageable, but it is good you are checking in.';
    timeframe = 'You could schedule a visit within the next day or two.';
  }

  return {
    urgencyLevel: level,
    level, // alias
    reasoning,
    recommendedTimeframe: timeframe,
    symptomCount,
    topCondition: conditions[0]?.condition || 'Unknown',
    disclaimer: 'This urgency assessment is for demonstration only. If you feel this is an emergency, contact emergency medical services (108 / 112 in India, 911 / 112 in US, or your local emergency number).',
  };
}

/**
 * Find nearest clinics based on urgency level
 * @param {string} urgencyLevel - low, medium, or high
 * @param {AbortSignal} signal - For cancellation support
 */
async function findNearestClinics(urgencyLevel, signal) {
  await delay(TOOL_DELAYS.findNearestClinics);

  if (signal?.aborted) {
    throw new Error('Tool execution cancelled');
  }

  const level = typeof urgencyLevel === 'string' ? urgencyLevel.toLowerCase() : 'medium';

  // Filter clinics by capability
  const capable = CLINICS.filter(c => {
    if (level === 'high' || level === 'emergency') {
      return c.capabilities.includes('emergency');
    }
    return c.capabilities.includes(level) || c.capabilities.includes('low');
  });

  // Sort by distance (for simplicity, parse the numeric value)
  capable.sort((a, b) => {
    const distA = parseFloat(a.distance);
    const distB = parseFloat(b.distance);
    return distA - distB;
  });

  return {
    clinics: capable.slice(0, 3),
    urgencyLevel: level,
    searchRadius: '5 miles',
    disclaimer: 'These are synthetic clinic listings for demonstration purposes.',
  };
}

/**
 * Check appointment availability at a clinic
 * @param {string} clinicId - Clinic identifier
 * @param {AbortSignal} signal - For cancellation support
 */
async function checkAvailability(clinicId, signal) {
  await delay(TOOL_DELAYS.checkAvailability);

  if (signal?.aborted) {
    throw new Error('Tool execution cancelled');
  }

  const targetId = String(clinicId || 'clinic_001').toLowerCase();
  let clinic = CLINICS.find(c => c.id.toLowerCase() === targetId || c.name.toLowerCase().includes(targetId));
  if (!clinic) {
    clinic = CLINICS[0];
  }

  // Generate synthetic availability
  const now = new Date();
  const slots = [];
  for (let i = 1; i <= 4; i++) {
    const slotTime = new Date(now.getTime() + i * 60 * 60 * 1000);
    slots.push({
      time: slotTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      available: Math.random() > 0.3,
    });
  }

  return {
    clinic: clinic.name,
    clinicId,
    address: clinic.address,
    phone: clinic.phone,
    slots: slots.filter(s => s.available),
    currentWaitTime: clinic.waitTime,
    disclaimer: 'These are synthetic appointment slots for demonstration purposes.',
  };
}

/**
 * Find nearby healthcare facilities based on symptoms/urgency/care type
 * @param {object|string} params - Search criteria (careType, urgencyLevel, lat, lon, locationName, language)
 * @param {AbortSignal} signal - For cancellation support
 */
async function findNearbyCareFacilities(params = {}, signal = null) {
  await delay(TOOL_DELAYS.findNearbyCareFacilities);

  if (signal?.aborted) {
    throw new Error('Tool execution cancelled');
  }

  let options = {};
  if (typeof params === 'string') {
    options = { careType: params };
  } else if (params && typeof params === 'object') {
    options = { ...params };
  }

  return await searchHealthcareFacilities(options, signal);
}

// Tool definitions for OpenAI function calling
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'analyzeSymptoms',
      description: 'Analyze the patient\'s reported symptoms and identify possible conditions. Call this after the patient has described their symptoms.',
      parameters: {
        type: 'object',
        properties: {
          symptoms: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of symptoms the patient has reported, e.g. ["headache", "fever", "nausea"]',
          },
        },
        required: ['symptoms'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculateUrgency',
      description: 'Calculate how urgently the patient should be seen based on analyzed symptoms. Call this after analyzeSymptoms.',
      parameters: {
        type: 'object',
        properties: {
          analysisResult: {
            type: 'object',
            description: 'The result from analyzeSymptoms tool',
          },
        },
        required: ['analysisResult'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findNearestClinics',
      description: 'Find the nearest clinics that can handle the patient\'s urgency level.',
      parameters: {
        type: 'object',
        properties: {
          urgencyLevel: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'The urgency level from calculateUrgency',
          },
        },
        required: ['urgencyLevel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findNearbyCareFacilities',
      description: 'Search for recommended nearby healthcare facilities (emergency department, urgent care, walk-in clinic, primary care) based on urgency level, desired facility type, and location. Dispatches asynchronous lookup with real facility data.',
      parameters: {
        type: 'object',
        properties: {
          careType: {
            type: 'string',
            description: 'The type of facility, e.g. "urgent_care", "hospital", "walk_in_clinic", "primary_care", or "emergency"',
          },
          urgencyLevel: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'emergency'],
            description: 'Urgency level from triage',
          },
          locationName: {
            type: 'string',
            description: 'City or neighborhood if specified by user',
          }
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkAvailability',
      description: 'Check appointment availability at a specific clinic.',
      parameters: {
        type: 'object',
        properties: {
          clinicId: {
            type: 'string',
            description: 'The ID of the clinic to check, e.g. "clinic_001"',
          },
        },
        required: ['clinicId'],
      },
    },
  },
];

// Map of tool names to functions
const TOOL_FUNCTIONS = {
  analyzeSymptoms,
  calculateUrgency,
  findNearestClinics,
  findNearbyCareFacilities,
  checkAvailability,
};

module.exports = {
  TOOL_DEFINITIONS,
  TOOL_FUNCTIONS,
  TOOL_DELAYS,
  analyzeSymptoms,
  calculateUrgency,
  findNearestClinics,
  findNearbyCareFacilities,
  checkAvailability,
  searchHealthcareFacilities,
  VERIFIED_FACILITIES,
};
