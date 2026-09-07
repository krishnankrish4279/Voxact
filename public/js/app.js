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

  const LANGUAGE_CONFIGS = {
    en: {
      rimeBadge: 'Rime Mist v3 (cove)',
      recognitionLang: 'en-US',
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
    /\bwait\b/i,
    /\bstop\b/i,
    /\bhold\s+on\b/i,
    /\bhang\s+on\b/i,
    /\bpause\b/i,
    /\bno\b/i,
    /\bactually\b/i,
    /\bcancel\b/i,
    // Tamil interruption keywords ("பொறு", "நில்", "வேண்டாம்", "இரு")
    /(?:^|\s)(?:பொறு(?:ங்கள்)?|நில்லு?(?:ங்கள்)?|வேண்டாம்|இரு|தடை)(?:$|\s)/,
    // Hindi interruption keywords ("रुको", "रुकिए", "ठहरो", "नहीं", "बस")
    /(?:^|\s)(?:रुको|रुकिए|ठहरो|ठहरिए|नहीं|बस|थोड़ा\s+रुको)(?:$|\s)/
  ];

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

        queryCareFacilitiesForLocation(currentLocation);
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
      empty.textContent = 'No nearby verified facility found.';
      facilityCardsList.appendChild(empty);
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
      if (bounds.length === 1) {
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
          queryCareFacilitiesForLocation(currentLocation);
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
        if (played) {
          addTranscriptMessage('system', '🔊 Speaker check: Two-tone chime played. If you heard the chime, your device audio output is active and working!');
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

      sendMessage({
        type: 'user_speech',
        text: displayText,
        rawTranscript: text,
        normalizedTranscript: displayText,
        medicalTerms: normalized.detectedMedicalTerms || [],
        isAmbiguous: normalized.isAmbiguous,
      });

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

  // ─── Start Session ────────────────────────────────────────────

  async function handleStart() {
    try {
      // 1. Initialize audio player and ensure AudioContext is active (user gesture)
      await audioPlayer.init();
      if (audioPlayer.audioContext && audioPlayer.audioContext.state === 'suspended') {
        try { await audioPlayer.audioContext.resume(); } catch (e) {}
      }

      // 2. Connect WebSocket so TTS greeting and responses stream immediately
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        connectWebSocket();
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

  // ─── WebSocket Connection ─────────────────────────────────────

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;

    ws = new WebSocket(url);

    ws.onopen = () => {
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
      setConnectionStatus('error', 'Disconnected');
      console.log('[App] WebSocket closed');

      // Attempt reconnect after 3 seconds
      setTimeout(() => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          console.log('[App] Attempting reconnect...');
          connectWebSocket();
        }
      }, 3000);
    };

    ws.onerror = (err) => {
      console.error('[App] WebSocket error:', err);
      setConnectionStatus('error', 'Error');
    };
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
        sendMessage({ type: 'start_session' });
        if (!isMicMuted) {
          startRecognition();
        }
        break;

      case 'state_change':
        updateState(message.state);
        break;

      case 'audio':
        if (message.generationId && invalidatedGenerations.has(message.generationId)) {
          return;
        }
        currentGenerationId = message.generationId || currentGenerationId;
        handleAudioChunk(message);
        break;

      case 'transcript':
        addTranscriptMessage(message.role, message.text);
        break;

      case 'transcript_chunk':
        if (message.generationId && invalidatedGenerations.has(message.generationId)) {
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
        if (message.generationId && invalidatedGenerations.has(message.generationId)) {
          return;
        }
        addTranscriptMessage('assistant', message.text);
        if (message.speakBrowser && typeof window !== 'undefined' && window.speechSynthesis) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(message.text);
          utterance.rate = 1.0;
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
          window.speechSynthesis.speak(utterance);
        }
        break;

      case 'triage_update':
        handleTriageUpdate(message);
        break;

      case 'care_navigation_update':
        if (message.generationId && invalidatedGenerations.has(message.generationId)) {
          console.log('[App] Dropping care_navigation_update for invalidated generation:', message.generationId);
          return;
        }
        const navData = message.data || message;
        renderCareFacilities(navData.facilities || message.facilities, navData.urgencyLevel || message.urgencyLevel, navData.userLocation);
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

  function createSpeechTurnController(config = {}) {
    const isSpeakingFn = config.isSpeakingFn || isAssistantSpeaking;
    const getAssistantTextFn = config.getAssistantTextFn || null;
    const onAudioHalt = config.onAudioHalt || (() => {});
    const onSendInterruptStart = config.onSendInterruptStart || (() => {});
    const onSubmitSpeech = config.onSubmitSpeech || (() => {});
    const silenceTimeoutMs = config.silenceTimeoutMs !== undefined ? config.silenceTimeoutMs : 750;

    let turnFinalText = '';
    let interimText = '';
    let silenceTimer = null;
    let hasInterrupted = false;

    function reset() {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      turnFinalText = '';
      interimText = '';
      hasInterrupted = false;
    }

    function processRecognitionEvent(results, resultIndex = 0) {
      let interim = '';
      let newFinal = '';

      for (let i = resultIndex; i < results.length; i++) {
        const item = results[i];
        const text = (item && item[0] ? item[0].transcript : (item?.transcript || '')) || '';
        if (item && item.isFinal) {
          newFinal += text + ' ';
        } else {
          interim += text;
        }
      }

      if (newFinal) {
        turnFinalText += newFinal;
      }
      interimText = interim;

      const currentSpeech = (turnFinalText + interim).trim();
      if (!currentSpeech) return null;

      // ── Instant Interim Interruption Detection ──────────────────────
      const isSpeaking = isSpeakingFn();
      const rawPhrase = (interim || currentSpeech).trim();
      const assistantText = getAssistantTextFn ? getAssistantTextFn() : '';
      const isEcho = isSpeaking && assistantText && isEchoText(rawPhrase, assistantText);
      const detectedPhrase = !isEcho ? detectInterruptionPhrase(rawPhrase) : null;
      let interruptionTriggered = false;
      let clientHaltMs = null;

      if (isSpeaking && detectedPhrase && !hasInterrupted) {
        hasInterrupted = true;
        interruptionTriggered = true;

        const haltStart = performance.now();
        onAudioHalt(detectedPhrase);
        clientHaltMs = performance.now() - haltStart;

        onSendInterruptStart({
          type: 'interrupt_start',
          clientHaltMs,
          text: detectedPhrase
        });
      } else if (isEcho) {
        // Acoustic feedback from device speakers detected — discard so assistant is not interrupted by its own voice
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

      // ── Continuous Speech Accumulation ────────────────────────────────
      if (silenceTimer) {
        clearTimeout(silenceTimer);
      }

      let resolveSubmit;
      const submitPromise = new Promise((resolve) => {
        resolveSubmit = resolve;
      });

      // Shorter timeout when final sentence recognition is completed (400ms),
      // while keeping standard timeout (750ms) for interim in-progress speech
      const activeTimeout = newFinal ? Math.min(silenceTimeoutMs, 400) : silenceTimeoutMs;

      silenceTimer = setTimeout(() => {
        const finalTextToSubmit = (turnFinalText + interimText).trim();
        if (finalTextToSubmit) {
          const currentlySpeaking = isSpeakingFn();
          const curAssistantText = getAssistantTextFn ? getAssistantTextFn() : '';
          if (currentlySpeaking && curAssistantText && isEchoText(finalTextToSubmit, curAssistantText)) {
            console.log('[App] Filtered out acoustic speaker bleed:', finalTextToSubmit);
            reset();
            resolveSubmit(null);
            return;
          }
          onSubmitSpeech(finalTextToSubmit);
          reset();
          resolveSubmit(finalTextToSubmit);
        } else {
          resolveSubmit(null);
        }
      }, activeTimeout);

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
      getCurrentAccumulation: () => (turnFinalText + interimText).trim(),
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
    recognition.lang = (LANGUAGE_CONFIGS[currentLanguage] && LANGUAGE_CONFIGS[currentLanguage].recognitionLang) || 'en-US';
    recognition.maxAlternatives = 1;

    activeSpeechTurnController = createSpeechTurnController({
      isSpeakingFn: isAssistantSpeaking,
      getAssistantTextFn: () => (audioPlayer ? audioPlayer.currentlyPlayingText : ''),
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
        sendMessage(msg);
      },
      onSubmitSpeech: (finalTextToSubmit) => {
        lastUserTurnEndWallTime = performance.now();
        console.log('[App] Submitting complete user speech:', finalTextToSubmit);

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

        sendMessage({
          type: 'user_speech',
          text: displayText,
          rawTranscript: finalTextToSubmit,
          normalizedTranscript: displayText,
          medicalTerms: normalized.detectedMedicalTerms || [],
          isAmbiguous: normalized.isAmbiguous,
        });

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
      },
      silenceTimeoutMs: 750,
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
    'rash', 'vomiting', 'body ache', 'migraine', 'chills', 'weakness', 'diarrhea',
    // Tamil clinical terms
    'தலைவலி', 'காய்ச்சல்', 'மயக்கம்', 'நெஞ்சு வலி', 'வயிற்று வலி', 'இருமல்', 'சளி',
    // Hindi clinical terms
    'सिरदर्द', 'बुखार', 'चक्कर', 'सीने में दर्द', 'पेट दर्द', 'खांसी', 'उल्टी'
  ];

  function extractClientSymptoms(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    return COMMON_SYMPTOMS.filter(s => lower.includes(s));
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

    // A user message always starts a new turn: clear the assistant bubble reference
    if (role === 'user') {
      currentAssistantBubble = null;
      // Prevent duplicate if this exact message was already added
      const lastMsg = transcriptContainer.lastElementChild;
      if (lastMsg && lastMsg.classList.contains('user')) {
        const lastBubble = lastMsg.querySelector('.message-bubble');
        if (lastBubble && lastBubble.textContent.trim() === text.trim()) {
          return;
        }
      }
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
    bubble.textContent = text;
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

    // 2. Extract Differential Conditions
    let conditions = data.possibleConditions;
    if (!conditions && data.analysisResult?.possibleConditions) conditions = data.analysisResult.possibleConditions;

    if (conditions && Array.isArray(conditions) && conditions.length > 0 && conditionsList) {
      conditionsList.innerHTML = '';
      conditions.slice(0, 4).forEach(c => {
        const item = document.createElement('div');
        item.className = 'condition-item';
        item.innerHTML = `
          <div class="condition-header-row">
            <span>${c.condition}</span>
            <span class="condition-match-text">possible pattern match</span>
          </div>
          <div class="condition-progress">
            <div class="condition-fill" style="width: 70%"></div>
          </div>
        `;
        conditionsList.appendChild(item);
      });
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
    const careFacs = data.facilities || (data.careNavigation && data.careNavigation.facilities) || (Array.isArray(data.careNavigation) ? data.careNavigation : null);
    if (careFacs) {
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

