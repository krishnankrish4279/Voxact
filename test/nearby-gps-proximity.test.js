/**
 * VoxAct — True Nearest GPS Facility Search & Proximity Pipeline Test Suite
 * 
 * Tests:
 * 1. Proximity-first sorting: distanceKm strictly ascending.
 * 2. Ambattur/Ayapakkam GPS test: 0.8-1.2 km facilities rank before 2.6+ km facilities.
 * 3. Clinical relevance filtering: Eye hospitals (even with OSM emergency tag) excluded for breathlessness/chest emergency.
 * 4. Orthopaedic hospitals excluded for breathlessness.
 * 5. General symptoms (headache/fever) prioritize closest general hospital/clinic.
 * 6. Eye symptoms allow eye hospitals.
 * 7. Orthopedic symptoms allow orthopedic hospitals.
 * 8. Overpass POI element parser creates valid canonical facility records.
 * 9. Live search does not inject synthetic fallbacks when allowFallback is false.
 * 10. Named facility search computes real distance from current user GPS.
 */
const assert = require('assert');
const {
  searchHealthcareFacilities,
  calculateDistanceKm,
  calculateDistanceMiles,
  classifyFacilitySpecialty,
  determineUserCareNeed,
  isFacilityRelevant,
  calculateFacilityRelevanceScore,
  parseOverpassElement,
} = require('../src/care-navigator');

console.log('\nRunning VoxAct True Nearest GPS Proximity Test Suite...\n');

async function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✓ PASS ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`  ✓ PASS ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL ${name}:`, err.message);
      failed++;
    }
  }

  console.log('━━━ TEST 1: Haversine Km Distance Calculation Accuracy ━━━\n');

  test('Haversine Km computes accurate distance between Ayapakkam and Chennai center', () => {
    // Ayapakkam (13.1090, 80.1440) to Chennai Central (13.0827, 80.2707) is ~14.1 km
    const dist = calculateDistanceKm(13.1090, 80.1440, 13.0827, 80.2707);
    assert(dist > 13.5 && dist < 14.5, `Expected ~14 km, got ${dist} km`);
  });

  test('Haversine Km computes accurate distance for nearby points (< 1 km)', () => {
    // Point A (13.1090, 80.1440) to Point B (13.1164, 80.1460)
    const dist = calculateDistanceKm(13.1090, 80.1440, 13.1164, 80.1460);
    assert(dist > 0.75 && dist < 0.95, `Expected ~0.85 km, got ${dist} km`);
  });

  console.log('\n━━━ TEST 2: Strict Proximity-First Sorting (No Distant Facilities Above Closer Ones) ━━━\n');

  test('Primary sort is distanceKm ascending; 2.6 km or 6.1 km never ranks above 0.4 km or 0.8 km', () => {
    const mockFacilities = [
      { name: 'Distant Hospital E', lat: 13.160, lon: 80.144, distanceKm: 6.1, careType: 'Emergency Department', emergencyCapable: true },
      { name: 'Hospital D', lat: 13.132, lon: 80.144, distanceKm: 2.6, careType: 'Orthopaedic Hospital', emergencyCapable: false },
      { name: 'Hospital C', lat: 13.120, lon: 80.144, distanceKm: 1.2, careType: 'General Hospital', emergencyCapable: true },
      { name: 'Hospital B', lat: 13.116, lon: 80.144, distanceKm: 0.8, careType: 'Walk-In Clinic', emergencyCapable: false },
      { name: 'Hospital A', lat: 13.112, lon: 80.144, distanceKm: 0.4, careType: 'Primary Health Centre', emergencyCapable: false },
    ];

    // Filter and sort general medical need
    const eligible = mockFacilities.filter(f => isFacilityRelevant(f, 'general_medical'));
    eligible.sort((a, b) => {
      const distDiff = a.distanceKm - b.distanceKm;
      if (Math.abs(distDiff) > 0.15) return distDiff;
      const scoreA = calculateFacilityRelevanceScore(a, 'general_medical');
      const scoreB = calculateFacilityRelevanceScore(b, 'general_medical');
      return scoreB - scoreA || distDiff;
    });

    assert.strictEqual(eligible[0].name, 'Hospital A', 'Closest facility (0.4 km) must be #1');
    assert.strictEqual(eligible[1].name, 'Hospital B', '0.8 km facility must be #2');
    assert.strictEqual(eligible[2].name, 'Hospital C', '1.2 km facility must be #3');
    assert(eligible[eligible.length - 1].distanceKm >= 2.6, 'Distant facilities must be at the end');
  });

  console.log('\n━━━ TEST 3: Medical Relevance Safety Filters ━━━\n');

  test('Eye hospital with OSM emergency tag is NEVER treated as emergency-capable for breathlessness', () => {
    const eyeHospWithEmergencyTag = {
      name: "Dr. Agarwal's Eye Hospital - Ambattur",
      careType: 'hospital',
      emergencyCapable: true, // tagged in OSM as emergency: yes
    };
    const spec = classifyFacilitySpecialty(eyeHospWithEmergencyTag);
    assert.strictEqual(spec.isEye, true, 'Correctly classified as eye specialty');
    assert.strictEqual(spec.isEmergencyVerified, false, 'Eye hospital MUST NOT be emergency verified for general emergency');

    const relevant = isFacilityRelevant(eyeHospWithEmergencyTag, 'emergency');
    assert.strictEqual(relevant, false, 'Eye hospital must be rejected for acute emergency / breathing symptoms');
  });

  test('Orthopaedic hospital is excluded for emergency breathlessness / chest pain', () => {
    const orthoHosp = {
      name: 'B.M.Orthopaedic Hospital',
      careType: 'hospital',
      address: 'Ambattur, Chennai'
    };
    const relevant = isFacilityRelevant(orthoHosp, 'emergency');
    assert.strictEqual(relevant, false, 'Orthopedic hospital must be rejected for emergency breathlessness');
  });

  test('Eye symptoms allow eye hospitals and rank them highly', () => {
    const eyeHosp = {
      name: 'Ashwini Eye Care',
      careType: 'hospital',
      address: 'Ambattur'
    };
    const relevant = isFacilityRelevant(eyeHosp, 'eye');
    assert.strictEqual(relevant, true, 'Eye hospital must be allowed for eye symptoms');
    const score = calculateFacilityRelevanceScore(eyeHosp, 'eye');
    assert(score >= 0.9, 'Eye hospital should have score 1.0 for eye complaint');
  });

  test('Orthopedic symptoms allow orthopedic hospitals', () => {
    const orthoHosp = {
      name: 'B.M.Orthopaedic Hospital',
      careType: 'hospital',
      address: 'Ambattur'
    };
    const relevant = isFacilityRelevant(orthoHosp, 'orthopedic');
    assert.strictEqual(relevant, true, 'Orthopedic hospital must be allowed for orthopedic symptoms');
  });

  console.log('\n━━━ TEST 4: Overpass POI Parsing & Coordinate Extraction ━━━\n');

  test('parseOverpassElement creates valid facility object with exact distanceKm and Haversine distance', () => {
    const rawElement = {
      type: 'node',
      id: 1234567,
      lat: 13.1164154,
      lon: 80.146014,
      tags: {
        name: 'Sri Vaishnavi Nursing Home',
        amenity: 'clinic',
        'addr:street': 'MTH Road',
        'addr:city': 'Ambattur'
      }
    };
    const userLat = 13.1090;
    const userLon = 80.1440;
    const parsed = parseOverpassElement(rawElement, userLat, userLon, 'urgent_care');

    assert(parsed !== null, 'Should parse valid element');
    assert.strictEqual(parsed.id, 'osm_node_1234567');
    assert.strictEqual(parsed.name, 'Sri Vaishnavi Nursing Home');
    assert(parsed.distanceKm > 0.8 && parsed.distanceKm < 0.9, `Expected ~0.85 km, got ${parsed.distanceKm}`);
    assert(parsed.distance.includes('metres'), `Expected metres format for < 1km, got ${parsed.distance}`);
    assert.strictEqual(parsed.source, 'live');
    assert.strictEqual(parsed.isFallback, false);
    assert(parsed.mapsUrl.includes('13.1164154,80.146014'));
  });

  console.log('\n━━━ TEST 5: Live Search around Ambattur/Ayapakkam GPS Coordinates ━━━\n');

  await testAsync('Live search from Ayapakkam (13.1090, 80.1440) returns real nearest facilities in order', async () => {
    const res = await searchHealthcareFacilities({
      lat: 13.1090,
      lon: 80.1440,
      urgencyLevel: 'medium',
      symptoms: ['headache', 'nausea'],
      allowFallback: false,
    });

    assert(res.facilities.length > 0, 'Should find real healthcare facilities around Ambattur/Ayapakkam');
    const first = res.facilities[0];
    console.log(`    Top facility returned: "${first.name}" at ${first.distance} (${first.distanceKm} km) [${first.type}]`);

    // Verify distance is ascending
    for (let i = 0; i < res.facilities.length - 1; i++) {
      const current = res.facilities[i];
      const next = res.facilities[i + 1];
      assert(current.distanceKm <= next.distanceKm + 0.15, `Facilities must be ordered by distance: ${current.name} (${current.distanceKm}km) vs ${next.name} (${next.distanceKm}km)`);
    }

    // Acceptance condition from user prompt:
    // If a relevant real hospital/clinic is visibly 0.5–1.5 km from user GPS, VoxAct must NOT return a 5–10 km facility as #1
    assert(first.distanceKm < 2.5, `Top facility must be within 2.5 km of user coordinates, got ${first.distanceKm} km (${first.name})`);
  });

  console.log('\n━━━ TEST 6: Emergency Breathlessness Live Search (No Eye or Orthopedic as #1) ━━━\n');

  await testAsync('Emergency search around Ambattur filters out eye and orthopedic hospitals from emergency results', async () => {
    const res = await searchHealthcareFacilities({
      lat: 13.1090,
      lon: 80.1440,
      urgencyLevel: 'emergency',
      symptoms: ['shortness of breath', 'chest pain'],
      allowFallback: false,
    });

    assert(res.facilities.length > 0, 'Should find emergency facilities');
    assert(res.isEmergency === true, 'isEmergency flag must be true');

    res.facilities.forEach(f => {
      const nameLower = f.name.toLowerCase();
      assert(!nameLower.includes('eye') && !nameLower.includes('vision') && !nameLower.includes('nethralaya'), `Eye facility "${f.name}" must not appear in emergency breathing triage`);
      assert(!nameLower.includes('orthopaedic') && !nameLower.includes('orthopedic'), `Orthopedic facility "${f.name}" must not appear in emergency breathing triage`);
    });
    console.log(`    Top emergency facility: "${res.facilities[0].name}" at ${res.facilities[0].distance}`);
  });

  console.log('\n━━━ TEST 7: Named Facility Search ("Virutcham Hospital") ━━━\n');

  await testAsync('Named search for "Virutcham Hospital" resolves facility and computes real GPS distance', async () => {
    const res = await searchHealthcareFacilities({
      lat: 13.1090,
      lon: 80.1440,
      facilityName: 'Virutcham Hospital',
      allowFallback: true,
    });

    assert(res.facilities.length > 0, 'Should find Virutcham Hospital');
    const fac = res.facilities[0];
    assert(fac.name.toLowerCase().includes('virutcham'), `Expected Virutcham Hospital, got ${fac.name}`);
    assert(typeof fac.distanceKm === 'number', 'Must calculate numeric distanceKm');
    assert(res.spokenSummary.includes('Virutcham Hospital'), 'Spoken summary must name the facility');
    console.log(`    Resolved "${fac.name}" at ${fac.distance} (${fac.distanceKm} km from user)`);
  });

  console.log('\n━━━ TEST 8: Synthetic Fallback Removal when allowFallback is false ━━━\n');

  await testAsync('When allowFallback is false and coordinates yield no results, return empty array with clean message', async () => {
    // Coordinates in the middle of the Indian Ocean
    const res = await searchHealthcareFacilities({
      lat: -20.0,
      lon: 80.0,
      allowFallback: false,
    });

    assert.strictEqual(res.facilities.length, 0, 'Must not return synthetic catalog facilities when allowFallback is false');
    assert(res.spokenSummary.includes('No nearby facilities were found'), `Expected clean not found message, got "${res.spokenSummary}"`);
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Nearby GPS Proximity Test Summary: ${passed}/${passed + failed} Passed (${Math.round((passed / (passed + failed)) * 100)}%)`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
