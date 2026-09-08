/**
 * VoxAct Urgent Bug Fix Regression Tests:
 * 1. Symptom merging & re-analysis across turns (Headache -> Shortness of breath)
 * 2. High-risk symptom priority (Emergency overrides lower-risk care)
 * 3. Shortness of breath normalization & Tamil variants
 * 4. Facility medical relevance filtering before distance sorting (No eye hospital for fever/general medical)
 * 5. Eye hospital allowed only for eye-related needs
 * 6. Named facility search permitted
 * 7. Stale response invalidation and zero cross-turn leakage
 */

const assert = require('assert');
const LLMClient = require('../src/llm-client');
const { TOOL_FUNCTIONS } = require('../src/tools');
const { classifyFacilitySpecialty, determineUserCareNeed, isFacilityRelevant, searchHealthcareFacilities } = require('../src/care-navigator');
const { normalizeMedicalSpeech, extractClinicalSymptoms } = require('../src/medical-transcriber');

function section(name) {
  console.log(`\n━━━ ${name} ━━━\n`);
}

function pass(msg) {
  console.log(`  ✓ PASS ${msg}`);
}

function fail(msg, err) {
  console.error(`  ✗ FAIL ${msg}`);
  if (err) console.error('   ', err.message || err);
}

let passed = 0;
let failed = 0;

async function runTests() {
  console.log('Running VoxAct Production Urgent Bug Fix Suite...\n');

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1 & 2: Turn 1 Headache -> Turn 2 Shortness of breath (Re-analysis & Symptom Merging)
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 1 & 2: Turn 1 Headache -> Turn 2 Shortness of Breath (Re-analysis & Urgency Escalation)');
  try {
    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();

    // Turn 1: "I have a bad headache"
    llm.addUserMessage('I have a bad headache');
    let turn1Tools = [];
    let turn1Args = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn1Tools.push(name);
      turn1Args = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let turn1FollowUp = '';
    await llm.streamFollowUp(null, (chunk) => { turn1FollowUp += chunk; });

    assert(turn1Tools.includes('analyzeSymptoms'), 'Turn 1 dispatches analyzeSymptoms');
    assert(turn1Args.symptoms.includes('headache'), 'Turn 1 symptoms include headache');
    assert(turn1FollowUp.toLowerCase().includes('headache') || turn1FollowUp.toLowerCase().includes('tension'), 'Turn 1 responds about headache');
    pass('Turn 1 correctly analyzes headache');

    // Turn 2: "I have a shortness of breath now"
    llm.addUserMessage('I have a shortness of breath now');
    let turn2Tools = [];
    let turn2Args = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn2Tools.push(name);
      turn2Args = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let turn2FollowUp = '';
    await llm.streamFollowUp(null, (chunk) => { turn2FollowUp += chunk; });

    assert(turn2Tools.includes('analyzeSymptoms'), 'Turn 2 dispatches fresh analyzeSymptoms');
    // Symptoms MUST be merged: contains both headache and shortness_of_breath
    const symptomsMerged = turn2Args.symptoms.includes('shortness_of_breath') || turn2Args.symptoms.includes('shortness of breath');
    assert(symptomsMerged, 'Turn 2 symptoms include shortness of breath');
    assert(turn2Args.symptoms.includes('headache'), 'Turn 2 symptoms preserves previously reported headache');

    // Urgency must be recalculated to high/emergency
    const urgencyCalc = await TOOL_FUNCTIONS['calculateUrgency']({ symptoms: turn2Args.symptoms }, null);
    assert(urgencyCalc.urgencyLevel === 'high' || urgencyCalc.urgencyLevel === 'emergency', 'Urgency escalated to high/emergency');

    // Must NOT repeat old headache analysis or old tension headache scores
    assert(!turn2FollowUp.includes('0.7%') && !turn2FollowUp.includes('0.5%'), 'Turn 2 does NOT show broken 0.7% / 0.5% scores');
    assert(!turn2FollowUp.toLowerCase().includes('tension headache'), 'Turn 2 does NOT talk about tension headache');
    assert(turn2FollowUp.toLowerCase().includes('breath') || turn2FollowUp.toLowerCase().includes('emergency'), 'Turn 2 communicates emergency breathing safety guidance');

    pass('Turn 2 merges symptoms, recalculates high/emergency urgency, and does NOT repeat stale headache analysis');
    passed++;
  } catch (err) {
    fail('TEST 1 & 2 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: Emergency Red Flag Priority ("I have chest pain")
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 3: Emergency Red Flag Priority ("I have chest pain")');
  try {
    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage('I have chest pain');

    let toolsRun = [];
    let toolArgs = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      toolsRun.push(name);
      toolArgs = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let followUp = '';
    await llm.streamFollowUp(null, (c) => { followUp += c; });

    assert(toolArgs.symptoms.some(s => s.toLowerCase().includes('chest')), 'Detects chest pain symptom');
    const urgency = await TOOL_FUNCTIONS['calculateUrgency']({ symptoms: toolArgs.symptoms }, null);
    assert(urgency.urgencyLevel === 'high' || urgency.urgencyLevel === 'emergency', 'Urgency is high/emergency');
    pass('"I have chest pain" triggers high/emergency urgency and emergency care');
    passed++;
  } catch (err) {
    fail('TEST 3 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: "I have fever" -> Fever reasoning, NO automatic Flu diagnosis
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 4: "I have fever" -> Clarification, No Automatic Flu Diagnosis');
  try {
    const analysis = await TOOL_FUNCTIONS['analyzeSymptoms'](['fever'], null);
    assert.strictEqual(analysis.isOnlyFever, true, 'Flags fever as single symptom');
    assert.strictEqual(analysis.possibleConditions.length, 0, 'Does NOT fabricate Flu diagnosis for isolated fever');
    pass('Isolated fever requires clarification questions without premature Flu diagnosis');
    passed++;
  } catch (err) {
    fail('TEST 4 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 5: "I have knee pain" -> Knee-pain questions, NO headache content
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 5: "I have knee pain" -> Knee-Specific Guidance (No Stale Content)');
  try {
    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage('I have knee pain');

    let response = '';
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });
    await llm.streamFollowUp(null, (c) => { response += c; });

    assert(!response.toLowerCase().includes('headache'), 'Does NOT talk about headache');
    assert(!response.toLowerCase().includes('migraine'), 'Does NOT talk about migraine');
    assert(response.toLowerCase().includes('knee') || response.toLowerCase().includes('joint') || response.toLowerCase().includes('walk'), 'Addresses knee pain specifically');
    pass('Knee pain yields knee-specific questions without headache leakage');
    passed++;
  } catch (err) {
    fail('TEST 5 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 6: Tamil Breathing Difficulty Normalization
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 6: Tamil Breathing Difficulty Normalization');
  try {
    const rawTamil = "எனக்கு மூச்சு விட கஷ்டமா இருக்கு";
    const norm = normalizeMedicalSpeech(rawTamil, 'ta');
    assert(norm.normalizedTranscript.includes('மூச்சுத்திணறல்'), 'Normalizes spoken phrase to canonical clinical term மூச்சுத்திணறல்');

    const symptoms = extractClinicalSymptoms(rawTamil, 'ta');
    assert(symptoms.symptoms.includes('shortness_of_breath'), 'Extracts canonical shortness_of_breath');
    pass('Tamil "எனக்கு மூச்சு விட கஷ்டமா இருக்கு" normalizes to shortness_of_breath');
    passed++;
  } catch (err) {
    fail('TEST 6 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 7: Medical Relevance Filter - Fever -> General/Multispecialty, NOT Eye Hospital
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 7: Facility Relevance: Fever / General -> NOT Eye Hospital');
  try {
    const feverNeed = determineUserCareNeed({ symptoms: ['fever'] });
    assert.strictEqual(feverNeed, 'general_medical', 'Care need identified as general_medical');

    const eyeHospital = {
      name: "Dr. Agarwal's Eye Hospital - Ambattur",
      careType: "Hospital",
      address: "Ambattur, Chennai"
    };
    const generalHospital = {
      name: "Virutcham Hospital",
      careType: "Emergency & Multi-Specialty Hospital",
      address: "Ambattur, Chennai"
    };

    assert.strictEqual(isFacilityRelevant(eyeHospital, feverNeed), false, "Dr. Agarwal's Eye Hospital is NOT relevant for fever");
    assert.strictEqual(isFacilityRelevant(generalHospital, feverNeed), true, "Virutcham Hospital is relevant for fever");
    pass('Fever correctly filters out Eye Hospital and accepts General Hospital');
    passed++;
  } catch (err) {
    fail('TEST 7 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 8: Facility Relevance: Headache -> General/Multispecialty, NOT Eye Hospital
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 8: Facility Relevance: Headache -> General Hospital, NOT Eye Hospital');
  try {
    const headacheNeed = determineUserCareNeed({ symptoms: ['headache'] });
    const eyeHospital = { name: "Dr. Agarwal's Eye Hospital", careType: "Eye Hospital" };
    const generalHospital = { name: "Kauvery Hospital", careType: "General Hospital" };

    assert.strictEqual(isFacilityRelevant(eyeHospital, headacheNeed), false, 'Eye Hospital rejected for headache');
    assert.strictEqual(isFacilityRelevant(generalHospital, headacheNeed), true, 'General Hospital accepted for headache');
    pass('Headache correctly filters out Eye Hospital and accepts General Hospital');
    passed++;
  } catch (err) {
    fail('TEST 8 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 9: Emergency Breathing Difficulty -> Emergency-capable General Hospital, NOT Eye Hospital
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 9: Emergency Breathing Difficulty -> Emergency-Capable General Hospital, NOT Eye Hospital');
  try {
    const emergencyNeed = determineUserCareNeed({ symptoms: ['shortness_of_breath'], urgencyLevel: 'high' });
    assert.strictEqual(emergencyNeed, 'emergency', 'Identified as emergency need');

    const eyeHospital = { name: "Dr. Agarwal's Eye Hospital", careType: "Hospital" };
    const emergencyHospital = {
      name: "Apollo Hospital",
      careType: "Emergency Department",
      emergencyCapable: true
    };

    assert.strictEqual(isFacilityRelevant(eyeHospital, emergencyNeed), false, 'Eye hospital rejected for emergency breathing difficulty');
    assert.strictEqual(isFacilityRelevant(emergencyHospital, emergencyNeed), true, 'Apollo emergency hospital accepted');
    pass('Emergency breathing difficulty routes to emergency general hospital, never eye hospital');
    passed++;
  } catch (err) {
    fail('TEST 9 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 10: Eye Pain / Vision Problem -> Eye Hospital ALLOWED
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 10: Eye Pain -> Eye Hospital ALLOWED');
  try {
    const eyeNeed = determineUserCareNeed({ symptoms: ['eye pain', 'blurred vision'] });
    assert.strictEqual(eyeNeed, 'eye', 'Identified as eye care need');

    const eyeHospital = { name: "Dr. Agarwal's Eye Hospital", careType: "Eye Hospital" };
    assert.strictEqual(isFacilityRelevant(eyeHospital, eyeNeed), true, 'Dr. Agarwals Eye Hospital is accepted for eye symptoms');
    pass('Eye Hospital is correctly recommended when user has eye symptoms');
    passed++;
  } catch (err) {
    fail('TEST 10 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 11: Explicit Named Search -> Allowed without generic rejection
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 11: Explicit Named Facility Search ("Show Dr. Agarwal\'s Eye Hospital")');
  try {
    const namedNeed = determineUserCareNeed({ facilityName: "Dr. Agarwal's Eye Hospital" });
    assert.strictEqual(namedNeed, 'named_facility', 'Identified as named facility search');

    const eyeHospital = { name: "Dr. Agarwal's Eye Hospital", careType: "Eye Hospital" };
    assert.strictEqual(isFacilityRelevant(eyeHospital, namedNeed), true, 'Named search overrides generic specialty filter');
    pass('Explicit named search allows user to find requested specialty hospital');
    passed++;
  } catch (err) {
    fail('TEST 11 failed', err);
    failed++;
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 12: Generic "Can you suggest some hospital?" -> General Hospital
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 12: Generic "Can you suggest some hospital?" -> General Hospital');
  try {
    const generalNeed = determineUserCareNeed({ userText: "hey I am rest now can you suggest some Hospital" });
    assert.strictEqual(generalNeed, 'general_medical', 'Generic request classified as general_medical');

    const eyeHospital = { name: "Dr. Agarwal's Eye Hospital", careType: "Hospital" };
    const generalHospital = { name: "Government General Hospital", careType: "General Hospital" };

    assert.strictEqual(isFacilityRelevant(eyeHospital, generalNeed), false, 'Eye Hospital rejected for generic hospital request');
    assert.strictEqual(isFacilityRelevant(generalHospital, generalNeed), true, 'General Hospital accepted for generic hospital request');
    pass('Generic hospital suggestion filters out specialty eye hospitals');
    passed++;
  } catch (err) {
    fail('TEST 12 failed', err);
    failed++;
  }

  console.log(`\n━━━ Production Bug Fix Test Summary ━━━\n`);
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
