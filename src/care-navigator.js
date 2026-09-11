/**
 * VoxAct — Healthcare Care Navigator
 * 
 * Provides recommended care facilities based on reported symptoms,
 * clinical urgency / care pathway, distance, and verified facility attributes.
 * 
 * MEDICAL SAFETY RULES:
 * 1. Recommends a CARE TYPE / FACILITY, never assigns a specific doctor.
 * 2. Never claims to diagnose or pick the "exact doctor" for a patient.
 * 3. Never fabricates ratings, review counts, wait times, opening hours, or appointment availability.
 * 4. Prioritizes emergency facilities and 911 guidance for high-urgency conditions.
 */

// Verified real healthcare facility catalog for reliable fallback / baseline across key regions
// REAL facilities with verified coordinates, addresses, and care capabilities. NO fake ratings/reviews.
const VERIFIED_FACILITIES = [
  // San Francisco Bay Area (default demo region)
  {
    id: 'fac_sf_01',
    name: 'Zuckerberg San Francisco General Hospital and Trauma Center',
    careType: 'Emergency Department',
    category: 'emergency',
    address: '1001 Potrero Ave, San Francisco, CA 94110',
    lat: 37.7558,
    lon: -122.4048,
    phone: '(628) 206-8000',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'San Francisco'
  },
  {
    id: 'fac_sf_02',
    name: 'Dignity Health-GoHealth Urgent Care',
    careType: 'Urgent Care',
    category: 'urgent_care',
    address: '2288 Market St, San Francisco, CA 94114',
    lat: 37.7645,
    lon: -122.4335,
    phone: '(415) 964-4858',
    emergencyCapable: false,
    capabilities: ['medium', 'low'],
    region: 'San Francisco'
  },
  {
    id: 'fac_sf_03',
    name: 'UCSF Medical Center at Parnassus',
    careType: 'Emergency Department',
    category: 'emergency',
    address: '505 Parnassus Ave, San Francisco, CA 94143',
    lat: 37.7631,
    lon: -122.4578,
    phone: '(415) 476-1000',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'San Francisco'
  },
  {
    id: 'fac_sf_04',
    name: 'Carbon Health Urgent Care Hayes Valley',
    careType: 'Urgent Care',
    category: 'urgent_care',
    address: '412 Gough St, San Francisco, CA 94102',
    lat: 37.7774,
    lon: -122.4231,
    phone: '(415) 612-3275',
    emergencyCapable: false,
    capabilities: ['medium', 'low'],
    region: 'San Francisco'
  },
  {
    id: 'fac_sf_05',
    name: 'Mission Neighborhood Health Center',
    careType: 'Community Walk-In Clinic',
    category: 'walk_in_clinic',
    address: '240 Shotwell St, San Francisco, CA 94110',
    lat: 37.7648,
    lon: -122.4168,
    phone: '(415) 552-3870',
    emergencyCapable: false,
    capabilities: ['low', 'primary_care'],
    region: 'San Francisco'
  },
  {
    id: 'fac_sf_06',
    name: 'One Medical Castro Clinic',
    careType: 'Primary Care & Family Medicine',
    category: 'primary_care',
    address: '593 Castro St, San Francisco, CA 94114',
    lat: 37.7597,
    lon: -122.4350,
    phone: '(415) 529-4567',
    emergencyCapable: false,
    capabilities: ['low', 'primary_care'],
    region: 'San Francisco'
  },

  // Seattle Region
  {
    id: 'fac_sea_01',
    name: 'Harborview Medical Center',
    careType: 'Emergency Department',
    category: 'emergency',
    address: '325 9th Ave, Seattle, WA 98104',
    lat: 47.6042,
    lon: -122.3243,
    phone: '(206) 744-3000',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Seattle'
  },
  {
    id: 'fac_sea_02',
    name: 'Indigo Urgent Care Wallingford',
    careType: 'Urgent Care',
    category: 'urgent_care',
    address: '1050 NE 45th St, Seattle, WA 98105',
    lat: 47.6613,
    lon: -122.3160,
    phone: '(206) 420-2273',
    emergencyCapable: false,
    capabilities: ['medium', 'low'],
    region: 'Seattle'
  },

  // Chennai (Tamil Region)
  {
    id: 'fac_chn_01',
    name: 'Apollo Hospitals Greams Road',
    careType: 'Emergency Department / Multi-Specialty Hospital',
    category: 'emergency',
    address: '21 Greams Lane, Thousand Lights, Chennai, Tamil Nadu 600006',
    lat: 13.0604,
    lon: 80.2496,
    phone: '+91 44 2829 0200',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Chennai'
  },
  {
    id: 'fac_chn_02',
    name: 'Kauvery Hospital Urgent & Family Care',
    careType: 'Urgent Care & Clinic',
    category: 'urgent_care',
    address: '199 Luz Church Rd, Mylapore, Chennai, Tamil Nadu 600004',
    lat: 13.0336,
    lon: 80.2628,
    phone: '+91 44 4000 6000',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Chennai'
  },
  {
    id: 'fac_chn_03',
    name: 'Virutcham Hospital',
    careType: 'Emergency & Multi-Specialty Hospital',
    category: 'emergency',
    address: 'Ayappakkam Main Rd, TNHB Colony, Ambattur, Chennai, Tamil Nadu 600077',
    lat: 13.1090,
    lon: 80.1440,
    phone: '+91 44 2625 3333',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Chennai'
  },

  // Delhi (Hindi Region)
  {
    id: 'fac_del_01',
    name: 'All India Institute of Medical Sciences (AIIMS)',
    careType: 'Emergency Department / Apex Hospital',
    category: 'emergency',
    address: 'Sri Aurobindo Marg, Ansari Nagar East, New Delhi 110029',
    lat: 28.5672,
    lon: 77.2100,
    phone: '+91 11 2658 8500',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Delhi'
  },
  {
    id: 'fac_del_02',
    name: 'Max Super Speciality Hospital Saket',
    careType: 'Emergency & Urgent Care Hospital',
    category: 'emergency',
    address: '1 2 Press Enclave Marg, Saket, New Delhi 110017',
    lat: 28.5284,
    lon: 77.2117,
    phone: '+91 11 2651 5050',
    emergencyCapable: true,
    capabilities: ['emergency', 'high', 'medium', 'low'],
    region: 'Delhi'
  }
];

/**
 * Calculate Great-Circle distance using Haversine formula (in kilometers)
 * Earth radius = 6371.0088 km
 */
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 999;
  const nLat1 = Number(lat1);
  const nLon1 = Number(lon1);
  const nLat2 = Number(lat2);
  const nLon2 = Number(lon2);
  if (isNaN(nLat1) || isNaN(nLon1) || isNaN(nLat2) || isNaN(nLon2)) return 999;

  const R = 6371.0088; // Earth radius in km
  const toRad = Math.PI / 180;
  const dLat = (nLat2 - nLat1) * toRad;
  const dLon = (nLon2 - nLon1) * toRad;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(nLat1 * toRad) * Math.cos(nLat2 * toRad) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Calculate Great-Circle distance using Haversine formula (in miles)
 */
function calculateDistanceMiles(lat1, lon1, lat2, lon2) {
  const distKm = calculateDistanceKm(lat1, lon1, lat2, lon2);
  return Math.round(distKm * 0.621371 * 10) / 10;
}

/**
 * Format metric distance clearly (e.g. "850 metres" or "1.2 km")
 */
function formatDistanceMetric(distKmOrMiles) {
  if (distKmOrMiles === null || distKmOrMiles === undefined) return '';
  // If passed value looks like km
  let distKm = Number(distKmOrMiles);
  if (distKm < 1.0) {
    const metres = Math.round(distKm * 1000);
    return `${metres} metres`;
  }
  return `${distKm.toFixed(1)} km`;
}

/**
 * Classify a facility's medical specialty based on its name, tags, and description.
 * @param {object} facility - { name, careType, address, type, display_name }
 * @returns {object} { specialty: string, isGeneral: boolean, isEmergencyVerified: boolean }
 */
function classifyFacilitySpecialty(facility) {
  const nameStr = [
    facility.name || '',
    facility.careType || '',
    facility.address || '',
    facility.display_name || '',
  ].join(' ').toLowerCase();

  // 1. Eye / Ophthalmology
  const isEye = /\b(eye|ophthalmology|ophthalmic|vision|retina|cornea|netralaya|drishti|nethralaya|kann|கண்|आँख)\b/i.test(nameStr);

  // 2. Dental
  const isDental = /\b(dental|dentist|dentistry|tooth|teeth|oral|orthodontic|dento|பல்|दांत)\b/i.test(nameStr);

  // 3. Maternity / Fertility / IVF
  const isMaternity = /\b(maternity|women'?s?\s*hospital|fertility|ivf|test\s*tube|pregnancy|motherhood|birth\s*center|மகப்பேறு|प्रसूति)\b/i.test(nameStr);

  // 4. Pediatric / Children
  const isPediatric = /\b(pediatric|children'?s?\s*hospital|child\s*care|குழந்தை|बाल\s*चिकित्सा)\b/i.test(nameStr);

  // 5. Cosmetic / Plastic / Hair / Skin
  const isCosmetic = /\b(cosmetic|plastic\s*surgery|aesthetic|derma|hair\s*transplant|skin\s*clinic|laser)\b/i.test(nameStr);

  // 6. Orthopedic specialty
  const isOrthopedic = /\b(orthopedic|orthopaedic|bone|joint\s*hospital|fracture\s*hospital)\b/i.test(nameStr);

  // 7. Oncology / Cancer
  const isCancer = /\b(cancer|oncology|புற்றுநோய்|कैंसर)\b/i.test(nameStr);

  // General Hospital / Multispecialty / Trauma Center / Nursing Home / Primary Health Centre
  const hasMultispecialty = /\b(multispecialty|multi-specialty|multi\s*super\s*speciality|general\s*hospital|government\s*hospital|govt\s*hospital|district\s*hospital|medical\s*college|trauma\s*center|city\s*hospital|memorial\s*hospital|lifeline|mission\s*hospital|apollo|kauvery|fortis|manipal|aiims|max|cpmc|ucsf|zuckerberg|harborview|nursing\s*home|primary\s*health|health\s*care\s*center|health\s*centre)\b/i.test(nameStr);

  const isAnySpecialty = isEye || isDental || isMaternity || isCosmetic || isCancer || isOrthopedic;
  const isGeneral = hasMultispecialty || (!isAnySpecialty && /\b(hospital|medical\s*center|healthcare|clinic|nursing\s*home)\b/i.test(nameStr));

  // Verified emergency capability: NEVER assume just because name has "Hospital" or has an OSM emergency tag if it's an eye/dental/cosmetic/ortho specialty!
  const isRestrictedSpecialty = isEye || isDental || isCosmetic || (isOrthopedic && !hasMultispecialty);
  const isEmergencyVerified = Boolean(
    !isRestrictedSpecialty && (
      facility.emergencyCapable ||
      /\b(trauma\s*center|emergency\s*department|emergency\s*room|\b24\s*hours?\s*emergency\b|\b24x7\s*emergency\b|accident\s*&\s*emergency|casualty)\b/i.test(nameStr)
    )
  );

  let primarySpecialty = 'general';
  if (isEye) primarySpecialty = 'eye';
  else if (isDental) primarySpecialty = 'dental';
  else if (isMaternity) primarySpecialty = 'maternity';
  else if (isOrthopedic) primarySpecialty = 'orthopedic';
  else if (isCosmetic) primarySpecialty = 'cosmetic';
  else if (isCancer) primarySpecialty = 'oncology';

  return {
    specialty: primarySpecialty,
    isGeneral,
    isEye,
    isDental,
    isMaternity,
    isCosmetic,
    isOrthopedic,
    isEmergencyVerified,
  };
}

/**
 * Determine user's medical need from symptoms, urgency, and request intent.
 */
function determineUserCareNeed(options = {}) {
  const facilityName = options.facilityName || options.facility_name || options.query || null;
  if (facilityName) {
    return 'named_facility';
  }

  const symptoms = Array.isArray(options.symptoms) ? options.symptoms.map(s => String(s).toLowerCase()) : [];
  const symptomsStr = symptoms.join(' ') + ' ' + (options.userText || '').toLowerCase();

  if (/\b(eye|eyes|vision|blurred|sight|blind|cornea|retina|ophthalmology|கண்|ஆँख)\b/i.test(symptomsStr)) {
    return 'eye';
  }
  if (/\b(tooth|teeth|dental|gum|toothache|பல்|दांत)\b/i.test(symptomsStr)) {
    return 'dental';
  }
  if (/\b(pregnancy|pregnant|labor|contractions|maternity|மகப்பேறு|गर्भावस्था)\b/i.test(symptomsStr)) {
    return 'maternity';
  }
  if (/\b(knee|leg|fracture|broken\s*bone|joint\s*dislocation)\b/i.test(symptomsStr)) {
    return 'orthopedic';
  }

  const isEmergency = options.urgencyLevel === 'high' || options.urgencyLevel === 'emergency' ||
    /\b(shortness of breath|breathless|breathing|chest pain|chest pressure|heart|unconscious|fainted|seizure|bleeding|stroke|மூச்சு|நெஞ்சு|सांस|सीने)\b/i.test(symptomsStr);

  if (isEmergency) {
    return 'emergency';
  }

  return 'general_medical';
}

/**
 * Determine if a facility is medically relevant for the user's specific care need.
 * Used for filtering BEFORE sorting by distance!
 */
function isFacilityRelevant(facility, careNeed) {
  if (careNeed === 'named_facility') {
    return true; // Explicit named search always allowed
  }

  const info = classifyFacilitySpecialty(facility);

  if (careNeed === 'general_medical') {
    // General fever / headache / vomiting / weakness / generic "suggest hospital":
    // Must NOT be an eye hospital, dental clinic, maternity center, cosmetic clinic
    if (info.isEye || info.isDental || info.isCosmetic) {
      return false;
    }
    // Pure orthopedic hospital without general/multispecialty capabilities is not suited for fever/headache/nausea
    if (info.isOrthopedic && !info.isGeneral) {
      return false;
    }
    return true;
  }

  if (careNeed === 'emergency') {
    // Breathing difficulty / chest pain / acute emergency:
    // Only emergency-capable general/multispecialty hospitals or trauma centers!
    // Never an eye hospital, dental clinic, fertility center, cosmetic clinic, or pure orthopedic hospital!
    if (info.isEye || info.isDental || info.isMaternity || info.isCosmetic || (info.isOrthopedic && !info.isGeneral)) {
      return false;
    }
    // Must be a general/multispecialty hospital or emergency-capable
    return info.isGeneral || info.isEmergencyVerified;
  }

  if (careNeed === 'eye') {
    if (info.isDental || info.isMaternity || info.isCosmetic || info.isOrthopedic) return false;
    return info.isEye || info.isGeneral;
  }

  if (careNeed === 'dental') {
    if (info.isEye || info.isMaternity || info.isCosmetic || info.isOrthopedic) return false;
    return info.isDental || info.isGeneral;
  }

  if (careNeed === 'maternity') {
    if (info.isEye || info.isDental || info.isCosmetic || info.isOrthopedic) return false;
    return info.isMaternity || info.isGeneral;
  }

  if (careNeed === 'orthopedic') {
    if (info.isEye || info.isDental || info.isMaternity || info.isCosmetic) return false;
    return info.isOrthopedic || info.isGeneral;
  }

  return true;
}

/**
 * Score facility relevance (1.0 = exact match, 0.8 = general hospital capable, 0 = irrelevant)
 */
function calculateFacilityRelevanceScore(facility, careNeed) {
  if (!isFacilityRelevant(facility, careNeed)) return 0;
  const info = classifyFacilitySpecialty(facility);
  if (careNeed === 'named_facility') return 1.0;
  if (careNeed === 'emergency') {
    if (info.isEmergencyVerified) return 1.0;
    if (info.isGeneral) return 0.85;
    return 0.5;
  }
  if (careNeed === 'eye') {
    if (info.isEye) return 1.0;
    if (info.isGeneral) return 0.8;
    return 0.4;
  }
  if (careNeed === 'dental') {
    if (info.isDental) return 1.0;
    if (info.isGeneral) return 0.8;
    return 0.4;
  }
  if (careNeed === 'general_medical') {
    if (info.isGeneral) return 1.0;
    return 0.7;
  }
  return 0.8;
}

/**
 * Determine recommended care pathway / facility category based on clinical urgency
 */
function determineCareCategory(urgencyLevel, preferredCareType = null) {
  if (preferredCareType) {
    const pref = String(preferredCareType).toLowerCase();
    if (pref.includes('hospital') || pref.includes('emergency') || pref.includes('er')) {
      return 'emergency';
    }
    if (pref.includes('urgent') || pref.includes('walk')) {
      return 'urgent_care';
    }
    if (pref.includes('clinic') || pref.includes('doctor') || pref.includes('primary')) {
      return 'primary_care';
    }
  }

  const u = String(urgencyLevel || 'medium').toLowerCase();
  if (u === 'high' || u === 'emergency') {
    return 'emergency';
  }
  if (u === 'medium') {
    return 'urgent_care';
  }
  return 'primary_care';
}

/**
 * Determine if geographical coordinates or location name refer to India / South Asia region
 */
function isIndiaRegion(lat, lon, locationName = '') {
  if (lat !== null && lat !== undefined && lon !== null && lon !== undefined && !isNaN(Number(lat)) && !isNaN(Number(lon))) {
    const nLat = Number(lat);
    const nLon = Number(lon);
    if (nLat >= 6.5 && nLat <= 37.5 && nLon >= 68.0 && nLon <= 97.5) {
      return true;
    }
  }
  const locLower = String(locationName || '').toLowerCase();
  const indiaKeywords = ['chennai', 'delhi', 'mumbai', 'bangalore', 'bengaluru', 'hyderabad', 'kolkata', 'tamil nadu', 'india', 'ambattur', 'ayapakkam', 'ayappakkam'];
  return indiaKeywords.some(k => locLower.includes(k));
}

/**
 * Query Overpass API for all live healthcare POIs within circular radius
 */
async function fetchOverpassFacilities(lat, lon, radiusMeters, signal = null) {
  const query = `[out:json][timeout:8];(
    node["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lon});
    way["amenity"~"hospital|clinic|doctors"](around:${radiusMeters},${lat},${lon});
    node["healthcare"~"hospital|clinic|centre|doctor"](around:${radiusMeters},${lat},${lon});
    way["healthcare"~"hospital|clinic|centre|doctor"](around:${radiusMeters},${lat},${lon});
  );out center tags;`;

  const postData = 'data=' + encodeURIComponent(query);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  for (const endpoint of endpoints) {
    if (signal?.aborted) break;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7500);
      const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'VoxAct-MedicalTriage/1.0 (Hackathon Care Navigation; contact@voxact.org)'
        },
        body: postData,
        signal: combinedSignal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.elements)) {
          return data.elements;
        }
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      // Try next endpoint mirror
    }
  }
  return [];
}

/**
 * Query Overpass API for named facility search around user coordinates
 */
async function fetchOverpassNamedFacility(facilityName, lat, lon, signal = null) {
  const safeName = (facilityName || '').replace(/[^\w\s]/g, '').trim();
  if (!safeName) return [];

  const query = `[out:json][timeout:8];(
    node["amenity"~"hospital|clinic|doctors"]["name"~"${safeName}",i](around:25000,${lat},${lon});
    way["amenity"~"hospital|clinic|doctors"]["name"~"${safeName}",i](around:25000,${lat},${lon});
    node["healthcare"~"hospital|clinic|centre|doctor"]["name"~"${safeName}",i](around:25000,${lat},${lon});
    way["healthcare"~"hospital|clinic|centre|doctor"]["name"~"${safeName}",i](around:25000,${lat},${lon});
  );out center tags;`;

  const postData = 'data=' + encodeURIComponent(query);
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  for (const endpoint of endpoints) {
    if (signal?.aborted) break;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7500);
      const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'VoxAct-MedicalTriage/1.0 (contact@voxact.org)'
        },
        body: postData,
        signal: combinedSignal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.elements) && data.elements.length > 0) {
          return data.elements;
        }
      }
    } catch (e) {
      if (signal?.aborted) throw e;
    }
  }
  return [];
}

/**
 * Parse an Overpass node/way element into the canonical VoxAct facility structure
 */
function parseOverpassElement(el, userLat, userLon, targetCategory = 'urgent_care') {
  const tags = el.tags || {};
  const cLat = el.lat || el.center?.lat;
  const cLon = el.lon || el.center?.lon;
  if (!cLat || !cLon) return null;

  const facName = tags.name || tags['name:en'] || tags['name:ta'] || tags['name:hi'] || tags.operator || 'Healthcare Facility';
  const distKm = calculateDistanceKm(userLat, userLon, cLat, cLon);
  const distMiles = calculateDistanceMiles(userLat, userLon, cLat, cLon);
  const distStr = formatDistanceMetric(distKm);

  const specInfo = classifyFacilitySpecialty({
    name: facName,
    careType: tags.amenity || tags.healthcare || '',
    address: [tags['addr:street'], tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ')
  });

  const isHospital = tags.amenity === 'hospital' || tags.healthcare === 'hospital' || /hospital/i.test(facName);
  let careTypeLabel = 'Walk-In Clinic';
  if (isHospital) {
    careTypeLabel = specInfo.isEmergencyVerified ? 'Emergency & Multi-Specialty Hospital' : 'General / Specialty Hospital';
  } else if (tags.amenity === 'clinic' || tags.healthcare === 'clinic') {
    careTypeLabel = 'Clinic / Primary Care';
  } else if (/nursing home/i.test(facName)) {
    careTypeLabel = 'Nursing Home & Clinic';
  } else if (/health center|primary health/i.test(facName)) {
    careTypeLabel = 'Primary Health Centre';
  }

  const addrParts = [tags['addr:street'], tags['addr:suburb'], tags['addr:city'], tags['addr:postcode']].filter(Boolean);
  const address = addrParts.length > 0 ? addrParts.join(', ') : `${facName}, Local Area`;

  return {
    id: `osm_${el.type || 'node'}_${el.id}`,
    name: facName,
    careType: careTypeLabel,
    category: isHospital ? 'emergency' : (targetCategory || 'urgent_care'),
    address,
    lat: cLat,
    lon: cLon,
    distanceKm: distKm,
    distanceMiles: distMiles,
    distance: distStr,
    emergencyCapable: specInfo.isEmergencyVerified,
    capabilities: specInfo.isEmergencyVerified ? ['emergency', 'high', 'medium', 'low'] : ['medium', 'low'],
    specialtyInfo: specInfo,
    source: 'live',
    isFallback: false,
    fallbackLabel: null,
    openStatus: tags.opening_hours || null,
    rating: null,
    reviewCount: null,
    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${cLat},${cLon}`
  };
}

/**
 * Search nearby healthcare facilities
 * True nearest GPS center with progressive circular radii (2 km -> 5 km -> 10 km).
 * Primary sort: distanceKm ascending.
 * 
 * @param {object} options
 * @param {number} options.lat - User latitude
 * @param {number} options.lon - User longitude
 * @param {string} options.locationName - City / locality string
 * @param {string} options.urgencyLevel - 'low', 'medium', 'high', 'emergency'
 * @param {string} options.careType - Preferred facility type e.g. 'hospital', 'urgent_care'
 * @param {AbortSignal} signal - Cancellation signal
 * @returns {Promise<object>}
 */
async function searchHealthcareFacilities(options = {}, signal = null) {
  let derivedUrgency = options.urgencyLevel || 'medium';
  if (options.symptoms && Array.isArray(options.symptoms)) {
    const sStr = options.symptoms.join(' ').toLowerCase();
    if (
      sStr.includes('chest pain') ||
      sStr.includes('heart') ||
      sStr.includes('breathing') ||
      sStr.includes('breathless') ||
      sStr.includes('unconscious') ||
      sStr.includes('severe bleeding') ||
      sStr.includes('stroke') ||
      sStr.includes('நெஞ்சு வலி') ||
      sStr.includes('சீने में दर्द')
    ) {
      derivedUrgency = 'emergency';
    }
  }

  const userLat = (options.lat !== undefined && options.lat !== null && !isNaN(Number(options.lat))) ? Number(options.lat) : null;
  const rawLon = options.lon !== undefined ? options.lon : options.lng;
  const userLon = (rawLon !== undefined && rawLon !== null && !isNaN(Number(rawLon))) ? Number(rawLon) : null;
  const locationName = options.locationName || options.city || (userLat !== null && userLon !== null ? `Lat ${userLat.toFixed(3)}, Lon ${userLon.toFixed(3)}` : 'Unknown Location');
  const urgencyLevel = options.urgencyLevel || derivedUrgency;
  const careType = options.careType || null;
  const language = options.language || 'en';

  const targetCategory = determineCareCategory(urgencyLevel, careType);
  const isEmergency = (urgencyLevel === 'high' || urgencyLevel === 'emergency' || targetCategory === 'emergency');

  // If coordinates are missing, never pretend or hardcode any default city
  if (userLat === null || userLon === null) {
    return {
      isEmergency,
      emergencyNotice: isEmergency,
      urgencyLevel,
      targetCareType: targetCategory,
      userLocation: null,
      facilities: [],
      error: 'location_required',
      spokenSummary: language === 'ta'
        ? 'சமீபத்திய மருத்துவமனைகளைக் கண்டறிய உங்கள் இருப்பிட அனுமதியை வழங்கவும்.'
        : language === 'hi'
        ? 'कृपया नजदीकी अस्पताल खोजने के लिए स्थान अनुमति सक्षम करें।'
        : 'Please enable location permissions to find nearby medical facilities.',
      disclaimer: 'Recommended nearby care options based on reported symptoms, urgency/care pathway, distance, and verified facility attributes. Does not assign a specific doctor.'
    };
  }

  let rawCandidates = [];
  let activeRadiusMeters = 2000;
  const facilityName = options.facilityName || options.facility_name || options.query || null;

  // Determine user's medical need from symptoms and urgency
  const userCareNeed = determineUserCareNeed({
    symptoms: options.symptoms,
    urgencyLevel,
    facilityName,
    userText: options.userText
  });

  // ─── 1. USER-NAMED FACILITY SEARCH ─────────────────────────────────
  if (facilityName) {
    let elements = await fetchOverpassNamedFacility(facilityName, userLat, userLon, signal);
    if (elements.length > 0) {
      rawCandidates = elements.map(el => parseOverpassElement(el, userLat, userLon, targetCategory)).filter(Boolean);
    }

    // Secondary search via Nominatim for named query if Overpass didn't resolve
    if (rawCandidates.length === 0) {
      try {
        const delta = 0.25; // ~25km
        const viewbox = `${userLon - delta},${userLat + delta},${userLon + delta},${userLat - delta}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(facilityName)}&format=json&addressdetails=1&limit=5&viewbox=${viewbox}&bounded=0`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'VoxAct-MedicalTriage/1.0 (Hackathon Care Navigation; contact@voxact.org)' },
          signal
        });
        if (res.ok) {
          const items = await res.json();
          if (Array.isArray(items)) {
            rawCandidates = items.map((item, idx) => {
              const iLat = parseFloat(item.lat);
              const iLon = parseFloat(item.lon);
              const distKm = calculateDistanceKm(userLat, userLon, iLat, iLon);
              const name = item.name || (item.display_name ? item.display_name.split(',')[0].trim() : facilityName);
              const specInfo = classifyFacilitySpecialty({ name, display_name: item.display_name });
              return {
                id: `osm_${item.osm_id || idx}`,
                name,
                careType: 'General / Specialty Hospital',
                category: 'emergency',
                address: item.display_name || `${name}, Local Area`,
                lat: iLat,
                lon: iLon,
                distanceKm: distKm,
                distanceMiles: calculateDistanceMiles(userLat, userLon, iLat, iLon),
                distance: formatDistanceMetric(distKm),
                emergencyCapable: specInfo.isEmergencyVerified,
                capabilities: ['emergency', 'high', 'medium', 'low'],
                specialtyInfo: specInfo,
                source: 'live',
                isFallback: false,
                fallbackLabel: null,
                openStatus: null,
                rating: null,
                reviewCount: null,
                mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${iLat},${iLon}`
              };
            });
          }
        }
      } catch (e) {}
    }
  } else {
    // ─── 2. PROGRESSIVE RADIUS NEARBY SEARCH (2 km -> 5 km -> 10 km) ──
    const radiiSteps = [2000, 5000, 10000];

    for (const radiusM of radiiSteps) {
      if (signal?.aborted) break;
      activeRadiusMeters = radiusM;

      // Primary engine: Overpass API POI Query
      const elements = await fetchOverpassFacilities(userLat, userLon, radiusM, signal);
      if (Array.isArray(elements) && elements.length > 0) {
        for (const el of elements) {
          const fac = parseOverpassElement(el, userLat, userLon, targetCategory);
          if (fac && !rawCandidates.some(existing => existing.id === fac.id || (Math.abs(existing.lat - fac.lat) < 0.0003 && Math.abs(existing.lon - fac.lon) < 0.0003))) {
            rawCandidates.push(fac);
          }
        }
      }

      // If Overpass returned candidates, filter and check if we have enough relevant ones (>= 3)
      const relevantFound = rawCandidates.filter(f => isFacilityRelevant(f, userCareNeed) && f.distanceKm <= (radiusM / 1000) * 1.05);
      if (relevantFound.length >= 3) {
        break; // Sufficient genuine nearby facilities found in this radius
      }

      // Secondary engine fallback: Nominatim bounded viewbox query if Overpass had 0 results
      if (rawCandidates.length === 0) {
        try {
          const deltaDeg = (radiusM / 111000);
          const viewbox = `${userLon - deltaDeg},${userLat + deltaDeg},${userLon + deltaDeg},${userLat - deltaDeg}`;
          const queryTerms = targetCategory === 'emergency' ? ['hospital', 'clinic'] : ['clinic', 'hospital'];
          
          for (const qTerm of queryTerms) {
            const nUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(qTerm)}&format=json&addressdetails=1&limit=15&viewbox=${viewbox}&bounded=1`;
            const nRes = await fetch(nUrl, {
              headers: { 'User-Agent': 'VoxAct-MedicalTriage/1.0 (Hackathon Care Navigation; contact@voxact.org)' },
              signal
            });
            if (nRes.ok) {
              const nData = await nRes.json();
              if (Array.isArray(nData)) {
                for (const item of nData) {
                  const iLat = parseFloat(item.lat);
                  const iLon = parseFloat(item.lon);
                  const distKm = calculateDistanceKm(userLat, userLon, iLat, iLon);
                  const facName = item.name || (item.display_name ? item.display_name.split(',')[0].trim() : 'Healthcare Facility');
                  const specInfo = classifyFacilitySpecialty({ name: facName, display_name: item.display_name, careType: item.type });
                  const isHosp = item.type === 'hospital' || (item.display_name && item.display_name.toLowerCase().includes('hospital'));
                  
                  const fac = {
                    id: `osm_nom_${item.osm_id || Math.random().toString(36).slice(2, 8)}`,
                    name: facName,
                    careType: isHosp ? (specInfo.isEmergencyVerified ? 'Emergency & Multi-Specialty Hospital' : 'General / Specialty Hospital') : 'Walk-In Clinic',
                    category: isHosp ? 'emergency' : targetCategory,
                    address: item.display_name || `${facName}, Local Area`,
                    lat: iLat,
                    lon: iLon,
                    distanceKm: distKm,
                    distanceMiles: calculateDistanceMiles(userLat, userLon, iLat, iLon),
                    distance: formatDistanceMetric(distKm),
                    emergencyCapable: specInfo.isEmergencyVerified,
                    capabilities: specInfo.isEmergencyVerified ? ['emergency', 'high', 'medium', 'low'] : ['medium', 'low'],
                    specialtyInfo: specInfo,
                    source: 'live',
                    isFallback: false,
                    fallbackLabel: null,
                    openStatus: null,
                    rating: null,
                    reviewCount: null,
                    mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${iLat},${iLon}`
                  };

                  if (!rawCandidates.some(existing => existing.name.toLowerCase() === fac.name.toLowerCase() || (Math.abs(existing.lat - fac.lat) < 0.0003 && Math.abs(existing.lon - fac.lon) < 0.0003))) {
                    rawCandidates.push(fac);
                  }
                }
              }
            }
          }
        } catch (e) {}

        const nomRelevant = rawCandidates.filter(f => isFacilityRelevant(f, userCareNeed));
        if (nomRelevant.length >= 3) break;
      }
    }
  }

  // ─── 3. FALLBACK HANDLING (UNIT TESTS / DEMO ONLY) ──────────────────
  // Live nearby search must NEVER inject synthetic fallbacks unless allowFallback is true AND no live candidates exist
  const allowFallback = options.allowFallback !== undefined ? Boolean(options.allowFallback) : true;

  if (rawCandidates.length === 0 && allowFallback) {
    let fallbackCandidates = [];
    if (facilityName) {
      const fnLower = facilityName.toLowerCase();
      fallbackCandidates = VERIFIED_FACILITIES.filter(f => f.name.toLowerCase().includes(fnLower) || fnLower.includes(f.name.toLowerCase()));
    } else {
      fallbackCandidates = VERIFIED_FACILITIES.filter(f => isFacilityRelevant(f, userCareNeed));
    }
    rawCandidates = fallbackCandidates
      .map(fac => {
        const distKm = calculateDistanceKm(userLat, userLon, fac.lat, fac.lon);
        const distMiles = calculateDistanceMiles(userLat, userLon, fac.lat, fac.lon);
        return {
          ...fac,
          distanceKm: distKm,
          distanceMiles: distMiles,
          distance: formatDistanceMetric(distKm),
          source: 'fallback',
          isFallback: true,
          fallbackLabel: 'Demo fallback — not live nearby data',
          openStatus: null,
          rating: null,
          reviewCount: null,
          mapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${fac.lat},${fac.lon}`
        };
      })
      .filter(fac => fac.distanceMiles <= 50); // 50-mile proximity guard for demo catalogs
  }

  // ─── 4. MEDICAL RELEVANCE FILTERING & STRICT PROXIMITY-FIRST SORT ──
  const eligibleFacilities = rawCandidates.filter(f => isFacilityRelevant(f, userCareNeed));

  // PRIMARY SORT: distanceKm ascending.
  // Secondary tie-breaker: medical relevance score when facilities are within 150m of each other.
  const ranked = [...eligibleFacilities].sort((a, b) => {
    const distDiff = (a.distanceKm ?? 999) - (b.distanceKm ?? 999);
    if (Math.abs(distDiff) > 0.15) {
      return distDiff;
    }
    const scoreA = calculateFacilityRelevanceScore(a, userCareNeed);
    const scoreB = calculateFacilityRelevanceScore(b, userCareNeed);
    return scoreB - scoreA || distDiff;
  });

  const resultLimit = options.limit !== undefined ? Number(options.limit) : 10;
  const topRecommendations = ranked.slice(0, resultLimit).map((f, index) => ({
    rank: index + 1,
    id: f.id || `fac_${index + 1}`,
    name: f.name,
    type: f.careType || f.category || 'hospital',
    careType: f.careType,
    category: f.category,
    address: f.address,
    lat: f.lat,
    lon: f.lon,
    distance: f.distance || formatDistanceMetric(f.distanceKm),
    distanceKm: f.distanceKm,
    distanceMiles: f.distanceMiles,
    phone: f.phone || null,
    emergencyCapable: Boolean(f.emergencyCapable),
    source: f.isFallback ? 'fallback' : 'live',
    isFallback: Boolean(f.isFallback),
    fallbackLabel: f.isFallback ? 'Demo fallback — not live nearby data' : null,
    openStatus: f.openStatus || null,
    rating: f.rating || null,
    reviewCount: f.reviewCount || null,
    mapsUrl: f.mapsUrl || `https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lon}`
  }));

  // ─── 5. DEVELOPMENT TELEMETRY (Requirement 18) ─────────────────────
  console.log('[FacilitySearchTelemetry]', {
    userLocation: { lat: userLat, lon: userLon, locationName },
    searchRadiusMeters: activeRadiusMeters,
    rawCandidateCount: rawCandidates.length,
    candidatesAfterDistanceFilter: rawCandidates.length,
    candidatesAfterMedicalFilter: eligibleFacilities.length,
    finalCount: topRecommendations.length,
    top5: topRecommendations.slice(0, 5).map(f => ({
      name: f.name,
      distanceKm: f.distanceKm,
      lat: f.lat,
      lon: f.lon,
      type: f.careType || f.type
    }))
  });

  // ─── 6. SPOKEN GUIDANCE ───────────────────────────────────────────
  let spokenSummary = '';
  const top = topRecommendations[0];
  const inIndia = isIndiaRegion(userLat, userLon, locationName);
  const emergencyNum = inIndia ? '108 or 112' : '911';

  const isBreathingOrChest = (options.symptoms || []).some(s => {
    const sLower = String(s).toLowerCase();
    return sLower.includes('breath') || sLower.includes('chest') || sLower.includes('மூச்சு') || sLower.includes('நெஞ்சு') || sLower.includes('सांस');
  });

  if (facilityName) {
    if (top) {
      if (language === 'ta') {
        spokenSummary = `${top.name} உங்கள் தற்போதைய இருப்பிடத்திலிருந்து சுமார் ${top.distance} தொலைவில் உள்ளது.`;
      } else if (language === 'hi') {
        spokenSummary = `${top.name} आपके वर्तमान स्थान से लगभग ${top.distance} दूर है।`;
      } else {
        spokenSummary = `I found ${top.name}, about ${top.distance} from your current location.`;
      }
    } else {
      if (language === 'ta') {
        spokenSummary = `உங்கள் தற்போதைய இருப்பிடத்திற்கு அருகில் நேரடித் தேடலில் ${facilityName} கிடைக்கவில்லை.`;
      } else if (language === 'hi') {
        spokenSummary = `मुझे आपके वर्तमान स्थान के पास लाइव खोज में ${facilityName} नहीं मिला।`;
      } else {
        spokenSummary = `No nearby facilities were found from the live search for ${facilityName}.`;
      }
    }
  } else if (isBreathingOrChest && isEmergency) {
    if (top) {
      if (language === 'ta') {
        spokenSummary = `உங்களுக்கு மூச்சுத்திணறல் அல்லது நெஞ்சு வலி இருப்பதால், உடனடியாக அவசர மருத்துவ சிகிச்சை பெற வேண்டும். வரைபடத்தில் மிக அருகில் உள்ள அவசர சிகிச்சை மருத்துவமனையான ${top.name} (${top.distance}) காட்டப்பட்டுள்ளது. உடனடியாக 108 அல்லது 112-ஐ அழைக்கவும்.`;
      } else if (language === 'hi') {
        spokenSummary = `सांस लेने में तकलीफ के कारण आपको तत्काल आपातकालीन चिकित्सा सहायता लेनी चाहिए। मैंने सबसे नजदीकी आपातकालीन अस्पताल ${top.name} (${top.distance}) मानचित्र पर दिखाया है। तुरंत 112 पर कॉल करें।`;
      } else {
        spokenSummary = `Because you're having trouble breathing, you should get urgent medical help. I can show the closest emergency-capable facility on the map: ${top.name}, about ${top.distance} away. If symptoms are severe, call ${emergencyNum} immediately.`;
      }
    } else {
      if (language === 'ta') {
        spokenSummary = `உங்களுக்கு மூச்சுத்திணறல் இருப்பதால் உடனடியாக அவசர சிகிச்சை பெற வேண்டும். நேரடித் தேடலில் பொருத்தமான மருத்துவமனை எதுவும் கிடைக்கவில்லை. உடனடியாக 108 அல்லது 112-ஐ அழைக்கவும்.`;
      } else if (language === 'hi') {
        spokenSummary = `सांस लेने में तकलीफ के कारण तत्काल आपातकालीन सहायता लें। लाइव खोज में कोई उपयुक्त अस्पताल नहीं मिला। तुरंत 112 पर कॉल करें।`;
      } else {
        spokenSummary = `Because you're having trouble breathing, you should get urgent medical help immediately. No nearby facilities were found from the live search. Please call ${emergencyNum} immediately.`;
      }
    }
  } else if (language === 'ta') {
    if (isEmergency) {
      spokenSummary = top
        ? `அருகில் ${topRecommendations.length} பொது / அவசர மருத்துவமனைகளைக் கண்டறிந்துள்ளேன். இதில் மிக அருகில் இருப்பது ${top.name}, சுமார் ${top.distance} தொலைவில் உள்ளது. அவசர நிலை என்றால் உடனடியாக 108 அல்லது 112-ஐ அழைக்கவும்.`
        : 'நேரடித் தேடலில் பொருத்தமான மருத்துவமனை எதுவும் கிடைக்கவில்லை.';
    } else if (topRecommendations.length > 0) {
      const facTypeLabel = userCareNeed === 'eye' ? 'கண் மருத்துவமனைகளை' : (userCareNeed === 'dental' ? 'பல் மருத்துவமனைகளை' : 'பொது மருத்துவமனைகளை');
      spokenSummary = `அருகில் ${topRecommendations.length} ${facTypeLabel} கண்டறிந்துள்ளேன். இதில் மிக அருகில் இருப்பது ${top.name}, சுமார் ${top.distance} தொலைவில் உள்ளது.`;
    } else {
      spokenSummary = 'நேரடித் தேடலில் பொருத்தமான மருத்துவமனை எதுவும் கிடைக்கவில்லை.';
    }
  } else if (language === 'hi') {
    if (isEmergency) {
      spokenSummary = top
        ? `मैंने पास में ${topRecommendations.length} सामान्य/आपातकालीन अस्पताल खोजे हैं। सबसे नजदीकी ${top.name} है, जो लगभग ${top.distance} दूर है। गंभीर स्थिति में तुरंत 112 पर कॉल करें।`
        : 'लाइव खोज से कोई उपयुक्त अस्पताल नहीं मिला।';
    } else if (topRecommendations.length > 0) {
      spokenSummary = `मैंने पास में ${topRecommendations.length} उपयुक्त अस्पताल खोजे हैं। सबसे नजदीकी ${top.name} (${top.distance}) है।`;
    } else {
      spokenSummary = 'लाइव खोज से आपके लक्षणों के अनुकूल कोई अस्पताल नहीं मिला।';
    }
  } else {
    if (isEmergency) {
      spokenSummary = top
        ? `I found ${topRecommendations.length} emergency-capable hospitals nearby. The closest is ${top.name}, about ${top.distance} away. If this is life-threatening, please call ${emergencyNum} immediately.`
        : `No nearby facilities were found from the live search. In an emergency, please call ${emergencyNum} immediately.`;
    } else if (topRecommendations.length > 0) {
      const facilityWord = (userCareNeed === 'eye') ? 'eye hospitals' : ((userCareNeed === 'dental') ? 'dental clinics' : 'healthcare facilities');
      spokenSummary = `I found ${topRecommendations.length} nearby ${facilityWord}. The closest is ${top.name}, about ${top.distance} away.`;
    } else {
      spokenSummary = `No nearby facilities were found from the live search.`;
    }
  }

  const inIndiaForGuidance = isIndiaRegion(userLat, userLon, locationName);
  const regionalEmergencyNum = (inIndiaForGuidance || language === 'ta') ? '108 or 112' : (language === 'hi' ? '112' : '911');

  return {
    isEmergency,
    emergencyNotice: isEmergency,
    emergencyNumber: regionalEmergencyNum,
    emergencyGuidance: spokenSummary,
    urgencyLevel,
    targetCareType: targetCategory,
    userCareNeed,
    userLocation: { lat: userLat, lon: userLon, locationName },
    facilities: topRecommendations,
    spokenSummary,
    disclaimer: 'Recommended nearby care options based on reported symptoms, urgency/care pathway, distance, and verified facility attributes. Does not assign a specific doctor or constitute medical diagnosis.'
  };
}

module.exports = {
  VERIFIED_FACILITIES,
  searchHealthcareFacilities,
  determineCareCategory,
  calculateDistanceKm,
  calculateDistanceMiles,
  isIndiaRegion,
  classifyFacilitySpecialty,
  determineUserCareNeed,
  isFacilityRelevant,
  calculateFacilityRelevanceScore,
  fetchOverpassFacilities,
  parseOverpassElement,
};

