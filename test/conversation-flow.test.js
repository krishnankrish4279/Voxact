/**
 * VoxAct — Multi-Turn Conversation Flow & Map Synchronization Test Suite
 * 
 * Tests the complete production requirements:
 * 1. Multi-turn dialogue continuity (headache -> shortness of breath -> hospital -> map -> number one)
 * 2. Facility search returns up to 10 results (no 3-facility cap)
 * 3. Clinical relevance ranking (general vs eye/ortho)
 * 4. Map synchronization (map_focus and facility_selected events)
 * 5. Facility decline persistence ("no" never repeats facility question)
 * 6. Interruption handling ("wait" / "பொறு" / "रुको")
 * 7. Directions request handling
 */

const assert = require('assert');
const { classifyUserIntent, INTENTS, extractFacilitySelection } = require('../src/intent-router');
const LLMClient = require('../src/llm-client');
const { Orchestrator, STATE } = require('../src/orchestrator');
const { searchHealthcareFacilities, TOOL_FUNCTIONS } = require('../src/tools');

let totalTests = 0;
let passedTests = 0;

function pass(name) {
  totalTests++;
  passedTests++;
  console.log(`  ✓ PASS ${name}`);
}

function fail(name, err) {
  totalTests++;
  console.error(`  ✗ FAIL ${name}`);
  console.error('   ', err.message || err);
}

function section(name) {
  console.log(`\n━━━ ${name} ━━━\n`);
}

async function runTests() {
  console.log('Running VoxAct Multi-Turn Conversation & Map Sync Test Suite...\n');

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1: Multi-Turn Conversation Sequence (The Core Reported Bug)
  // Turn 1: "I have a bad headache and nausea."
  // Turn 2: "I have a shortness of breath now"
  // Turn 3: "search nearby hospital"
  // Turn 4: "share the location in map"
  // Turn 5: "share number one"
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 1: 5-Turn Conversation Sequence (Complete Context Preservation)');
  try {
    const userLocation = { lat: 13.0827, lon: 80.2707, city: 'Chennai' };
    const llm = new LLMClient({
      language: 'en',
      location: userLocation,
    });
    llm.initConversation();

    // ─── Turn 1: Headache + Nausea ───
    console.log('  [Turn 1] User: "I have a bad headache and nausea."');
    llm.addUserMessage("I have a bad headache and nausea.");
    let turn1Tool = null;
    let turn1Args = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn1Tool = name;
      turn1Args = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(turn1Tool, 'analyzeSymptoms', 'Turn 1 dispatches analyzeSymptoms');
    assert(turn1Args.symptoms.includes('headache'), 'Turn 1 includes headache');
    assert(turn1Args.symptoms.includes('nausea'), 'Turn 1 includes nausea');
    assert.deepStrictEqual(llm.accumulatedSymptoms.sort(), ['headache', 'nausea'].sort(), 'LLM caches accumulated symptoms');

    let turn1Response = '';
    await llm.streamFollowUp(null, (chunk) => { turn1Response += chunk; });
    assert(!turn1Response.toLowerCase().includes('shortness of breath'), 'Turn 1 does not mention shortness of breath');

    // ─── Turn 2: Shortness of Breath (Escalates to Emergency, Merges Previous Symptoms) ───
    console.log('  [Turn 2] User: "I have a shortness of breath now"');
    llm.addUserMessage("I have a shortness of breath now");
    let turn2Tool = null;
    let turn2Args = null;
    let turn2Text = '';
    await llm.streamCompletion(null, (chunk) => { turn2Text += chunk; }, async (name, args, id) => {
      turn2Tool = name;
      turn2Args = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(turn2Tool, 'analyzeSymptoms', 'Turn 2 re-analyzes symptoms with emergency urgency');
    assert(turn2Args.symptoms.includes('shortness_of_breath') || turn2Args.symptoms.includes('shortness of breath'), 'Turn 2 includes shortness of breath');
    assert(turn2Args.symptoms.includes('headache'), 'Turn 2 preserves headache from Turn 1');
    assert(turn2Args.symptoms.includes('nausea'), 'Turn 2 preserves nausea from Turn 1');
    assert(/emergency|struggling to breathe|immediate/i.test(turn2Text), 'Turn 2 provides emergency guidance text');
    assert(!/0\.7% match with Tension Headache/i.test(turn2Text), 'Turn 2 does NOT repeat obsolete headache percentage');

    // ─── Turn 3: "search nearby hospital" ───
    console.log('  [Turn 3] User: "search nearby hospital"');
    llm.addUserMessage("search nearby hospital");
    let turn3Tool = null;
    let turn3Args = null;
    let turn3Facilities = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn3Tool = name;
      turn3Args = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      turn3Facilities = res.facilities;
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(turn3Tool, 'findNearbyCareFacilities', 'Turn 3 triggers findNearbyCareFacilities');
    assert(Array.isArray(turn3Facilities) && turn3Facilities.length > 0, 'Turn 3 returns facilities list');
    assert.strictEqual(llm.latestFacilityResults.length, turn3Facilities.length, 'Facilities cached in LLM client');
    assert(llm.latestFacilityResults.length >= 5, `Expected >= 5 facilities, got ${llm.latestFacilityResults.length}`);

    // ─── Turn 4: "share the location in map" ───
    console.log('  [Turn 4] User: "share the location in map"');
    llm.addUserMessage("share the location in map");
    let turn4Tool = null;
    let turn4Args = null;
    let turn4Text = '';
    await llm.streamCompletion(null, (chunk) => { turn4Text += chunk; }, async (name, args, id) => {
      turn4Tool = name;
      turn4Args = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(turn4Tool, 'focusMap', 'Turn 4 dispatches focusMap tool');
    assert(turn4Args.facility, 'Turn 4 focusMap contains facility');
    assert(!turn4Text.includes("what physical discomfort is troubling you"), 'Turn 4 does NOT ask for physical discomfort!');
    assert(/map|focused/i.test(turn4Text), 'Turn 4 confirms map focus to user');

    // ─── Turn 5: "share number one" ───
    console.log('  [Turn 5] User: "share number one"');
    llm.addUserMessage("share number one");
    let turn5Tool = null;
    let turn5Args = null;
    let turn5Text = '';
    await llm.streamCompletion(null, (chunk) => { turn5Text += chunk; }, async (name, args, id) => {
      turn5Tool = name;
      turn5Args = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert(turn5Tool === 'selectFacility' || turn5Tool === 'focusMap', 'Turn 5 dispatches selectFacility or focusMap');
    assert.strictEqual(turn5Args.index, 0, 'Turn 5 targets facility index 0 (number one)');
    assert(!turn5Text.includes("what physical discomfort is troubling you"), 'Turn 5 does NOT ask for physical discomfort!');

    pass('TEST 1 passed: 5-turn sequence fully preserves state, escalates urgency, searches hospitals, and updates map without context loss');
  } catch (err) {
    fail('TEST 1 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 2: Facility search returns up to 10 results (not capped at 3)
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 2: Progressive Facility Search (Up to 10 Facilities)');
  try {
    const res = await searchHealthcareFacilities({
      lat: 13.0827,
      lon: 80.2707,
      locationName: 'Chennai',
      careType: 'emergency',
      limit: 10,
    });

    assert(Array.isArray(res.facilities), 'facilities is an array');
    assert(res.facilities.length >= 5, `Expected >= 5 facilities, got ${res.facilities.length}`);
    assert(res.facilities.length <= 10, `Expected <= 10 facilities, got ${res.facilities.length}`);
    // Check canonical properties
    for (const fac of res.facilities) {
      assert(fac.id, 'Facility must have id');
      assert(fac.name, 'Facility must have name');
      assert(fac.lat && fac.lon, 'Facility must have coordinates');
      assert(fac.distanceKm !== undefined || fac.distanceMiles !== undefined, 'Facility must have distance');
    }
    pass(`TEST 2 passed: Returned ${res.facilities.length} facilities with full canonical metadata`);
  } catch (err) {
    fail('TEST 2 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: Clinical Relevance Filtering for General/Emergency Symptoms
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 3: Clinical Relevance Filtering');
  try {
    const res = await searchHealthcareFacilities({
      lat: 13.0827,
      lon: 80.2707,
      locationName: 'Chennai',
      careType: 'emergency',
      symptoms: ['shortness_of_breath', 'chest pain'],
    });

    for (const fac of res.facilities) {
      const lower = fac.name.toLowerCase();
      assert(!lower.includes('eye hospital') && !lower.includes('eye care'), `Specialty eye hospital ${fac.name} must not be selected for breathing/chest emergency`);
      assert(!lower.includes('dental'), `Specialty dental hospital ${fac.name} must not be selected for breathing/chest emergency`);
    }

    pass('TEST 3 passed: Specialty eye/dental hospitals excluded for emergency breathing/chest symptoms');
  } catch (err) {
    fail('TEST 3 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: Eye Symptoms ALLOW Eye Hospital
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 4: Eye Symptoms Specialty Matching');
  try {
    const res = await searchHealthcareFacilities({
      lat: 13.0827,
      lon: 80.2707,
      locationName: 'Chennai',
      careType: 'clinic',
      symptoms: ['eye pain', 'vision blur'],
    });

    const hasEye = res.facilities.some(f => /eye|ophthalmology/i.test(f.name) || /eye/i.test(f.category || ''));
    assert(hasEye, 'Eye facilities allowed when user specifically reports eye symptoms');

    pass('TEST 4 passed: Eye hospital permitted for eye symptoms');
  } catch (err) {
    fail('TEST 4 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 5: Orchestrator Map Events (map_focus and facility_selected)
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 5: Orchestrator Map & Facility Event Dispatch');
  try {
    const eventsSent = [];
    const fakeSendToClient = (msg) => { eventsSent.push(msg); };

    const orchestrator = new Orchestrator('test-map-sync', fakeSendToClient, {
      language: 'en',
      location: { lat: 13.0827, lon: 80.2707, city: 'Chennai' },
      latestFacilityResults: [
        { id: 'hosp_1', name: 'Apollo Hospital Greams Road', lat: 13.0601, lon: 80.2505, emergencyCapable: true },
        { id: 'hosp_2', name: 'Government General Hospital', lat: 13.0805, lon: 80.2780, emergencyCapable: true }
      ]
    });

    await orchestrator.handleUserSpeech("share location in map");

    const mapFocusEvt = eventsSent.find(e => e.type === 'map_focus');
    const facilitySelectedEvt = eventsSent.find(e => e.type === 'facility_selected');

    assert(mapFocusEvt, 'map_focus event sent to client');
    assert.strictEqual(mapFocusEvt.facility.name, 'Apollo Hospital Greams Road', 'map_focus targets facility #1');
    assert(facilitySelectedEvt, 'facility_selected event sent to client');
    assert.strictEqual(facilitySelectedEvt.index, 0, 'facility_selected index is 0');

    orchestrator.destroy();
    pass('TEST 5 passed: map_focus and facility_selected events dispatched to client');
  } catch (err) {
    fail('TEST 5 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 6: Facility Decline Persistence Across Turns
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 6: Facility Decline Persistence');
  try {
    const llm = new LLMClient({
      language: 'en',
      pendingAction: 'CHECK_NEARBY_CARE',
      nearbyCareStatus: 'pending'
    });
    llm.initConversation();
    llm.addAssistantMessage("Would you like me to check available clinics nearby?");

    // User says "No"
    llm.addUserMessage("No");
    let declineText = '';
    await llm.streamCompletion(null, (c) => { declineText += c; });

    assert.strictEqual(llm.careDeclined, true, 'careDeclined is true');
    assert.strictEqual(llm.nearbyCareStatus, 'declined', 'nearbyCareStatus is declined');
    assert(!/would you like me to check/i.test(declineText), 'Does not re-offer clinic check');

    // Next turn: user asks another question
    llm.addUserMessage("What should I drink for hydration?");
    let nextText = '';
    await llm.streamCompletion(null, (c) => { nextText += c; });

    assert(!/would you like me to check/i.test(nextText), 'Never repeats clinic check question in subsequent turns');
    assert(!/check nearby/i.test(nextText), 'No clinic check offered');

    pass('TEST 6 passed: Declining nearby care persists across multiple conversation turns');
  } catch (err) {
    fail('TEST 6 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 7: Wait Interruption Across Languages
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 7: Wait Interruption ("wait", "பொறு", "रुको")');
  try {
    const waitInputs = [
      { text: 'wait', expected: true },
      { text: 'wait wait wait', expected: true },
      { text: 'hold on a second', expected: true },
      { text: 'பொறு', expected: true },
      { text: 'ஒரு நிமிடம் இருங்க', expected: true },
      { text: 'रुको', expected: true },
      { text: 'जरा रुको', expected: true },
      { text: 'wait for a second my head hurts', expected: false }, // Has symptom -> not pure wait
    ];

    for (const item of waitInputs) {
      const { intent } = classifyUserIntent(item.text);
      if (item.expected) {
        assert.strictEqual(intent, INTENTS.WAIT_INTERRUPTION, `"${item.text}" must route to WAIT_INTERRUPTION`);
      } else {
        assert.notStrictEqual(intent, INTENTS.WAIT_INTERRUPTION, `"${item.text}" must NOT route to WAIT_INTERRUPTION`);
      }
    }

    pass('TEST 7 passed: Wait phrases in English, Tamil, and Hindi accurately classified');
  } catch (err) {
    fail('TEST 7 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 8: Facility Selection Number Parsing
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 8: Facility Selection Parsing');
  try {
    const testCases = [
      { text: 'share number one', expectedIdx: 0 },
      { text: 'put number one on map', expectedIdx: 0 },
      { text: 'show number two', expectedIdx: 1 },
      { text: 'select option three', expectedIdx: 2 },
      { text: 'take me to the second hospital', expectedIdx: 1 },
      { text: 'show facility #4', expectedIdx: 3 },
    ];

    for (const tc of testCases) {
      const res = extractFacilitySelection(tc.text);
      const idx = res ? res.facilityIndex : null;
      assert.strictEqual(idx, tc.expectedIdx, `"${tc.text}" must extract index ${tc.expectedIdx}, got ${idx}`);
    }

    pass('TEST 8 passed: Facility index extracted reliably across all ordinal and cardinal patterns');
  } catch (err) {
    fail('TEST 8 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 9: Directions Request
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 9: Directions Request Handling');
  try {
    const llm = new LLMClient({
      language: 'en',
      latestFacilityResults: [
        { id: 'hosp_1', name: 'Apollo Hospital', lat: 13.0601, lon: 80.2505, mapsUrl: 'https://maps.google.com/?q=13.0601,80.2505' }
      ]
    });
    llm.initConversation();
    llm.addUserMessage("get directions to number one");

    let executedTool = null;
    let dirArgs = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      executedTool = name;
      dirArgs = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(executedTool, 'getDirections', 'Directions request triggers getDirections tool');
    assert(dirArgs.facility, 'Directions args contain target facility');
    assert(dirArgs.mapsUrl, 'Directions args contain valid Google Maps URL');

    pass('TEST 9 passed: Directions tool generates navigation route and maps URL');
  } catch (err) {
    fail('TEST 9 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Conversation Flow Test Summary: ${passedTests}/${totalTests} Passed (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (passedTests === totalTests) {
    console.log('✨ All 9 multi-turn conversation and map synchronization tests PASSED!\n');
    process.exit(0);
  } else {
    console.error(`❌ ${totalTests - passedTests} tests failed.\n`);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
