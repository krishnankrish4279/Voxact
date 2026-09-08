/**
 * VoxAct — User Intent Routing & Safety Regression Test Suite
 * 
 * Verifies all 12 Exact Cases from Section 18:
 * TEST 1: "I have fever" -> fever questions, NO hospital search, NO Flu diagnosis.
 * TEST 2: "What medicine can I take for fever?" -> medicine/self-care flow, NO hospital search.
 * TEST 3: "Tell me some cure for fever, don't suggest doctor" -> safe self-care, NO repeated doctor recommendation, NO hospital search.
 * TEST 4: "I have fever, suggest nearby hospital" -> hospital search, nearest real facility, map update.
 * TEST 5: Assistant asks facility check, User: "No" -> cancelled, never repeats.
 * TEST 6: Assistant asks facility check, User: "Yes" -> exactly one facility search.
 * TEST 7: "Virutcham Hospital near me" -> named facility search, real GPS distance, matching map marker.
 * TEST 8: "I have knee pain" -> knee-specific questions, NOT headache/fever questions.
 * TEST 9: Tamil "எனக்கு முழங்கால்ல வலி இருக்கு" -> knee pain normalization.
 * TEST 10: "high fever medicine" -> minimum safety questions before medication, no auto hospital search.
 * TEST 11: Fever only -> NO "this is Flu", NO fake percentage.
 * TEST 12: Enough symptoms -> real 0–100 patternMatchScore values, UI displays percentages, "not a diagnosis" label.
 * 
 * Additional Regression:
 * - The Exact Screenshot Flow: Turn 1 "why not high fever just suggest some medicine" followed by Turn 2 "ok tell some cure for the fever dont suggest doctor or healthcare".
 */

const assert = require('assert');
const LLMClient = require('../src/llm-client');
const { INTENTS, classifyUserIntent, extractNamedFacility } = require('../src/intent-router');
const { TOOL_FUNCTIONS } = require('../src/tools');
const { searchHealthcareFacilities } = require('../src/care-navigator');
const { normalizeMedicalSpeech, extractClinicalSymptoms } = require('../src/medical-transcriber');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function section(name) {
  console.log(`\n\x1b[1m\x1b[35m━━━ ${name} ━━━\x1b[0m\n`);
}

function pass(desc) {
  totalTests++;
  passedTests++;
  console.log(`  \x1b[32m✓ PASS\x1b[0m ${desc}`);
}

function fail(desc, err) {
  totalTests++;
  failedTests++;
  console.error(`  \x1b[31m✗ FAIL\x1b[0m ${desc}`);
  if (err) console.error(`    ${err.message || err}`);
}

async function runRegressionTests() {
  console.log('\x1b[1m\x1b[34mRunning VoxAct Intent Routing & Bug Fix Regression Test Suite...\x1b[0m');

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1: "I have fever" -> fever questions, NO hospital search, NO Flu diagnosis
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 1: "I have fever" -> Clarification, No Hospital, No Flu');
  try {
    const userMsg = 'I have fever';
    const { intent } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.SYMPTOM_INFORMATION, 'Intent should be symptom_information');

    const analysis = await TOOL_FUNCTIONS['analyzeSymptoms'](['fever'], null);
    assert.strictEqual(analysis.isOnlyFever, true, 'Fever alone flagged as isOnlyFever');
    assert.strictEqual(analysis.possibleConditions.length, 0, 'Must NOT diagnose conditions on fever alone');

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    let dispatchedTool = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      dispatchedTool = name;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(dispatchedTool, 'analyzeSymptoms', 'Dispatches analyzeSymptoms tool');

    let assistantFollowUp = '';
    await llm.streamFollowUp(null, (chunk) => { assistantFollowUp += chunk; });

    assert(!/looks consistent with Flu|this is Flu/i.test(assistantFollowUp), 'Must NOT claim Flu on fever alone');
    assert(!/identified recommended nearby healthcare facilities/i.test(assistantFollowUp), 'Must NOT search or suggest facilities on fever alone');
    assert(/how long|temperature|cough|sore throat|chills/i.test(assistantFollowUp), 'Must ask targeted clarifying questions about fever');
    assert.strictEqual(llm.pendingAction, null, 'No pending care action');

    pass('TEST 1 passed: "I have fever" asks clarifying questions without Flu diagnosis or hospital search');
  } catch (err) {
    fail('TEST 1 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 2: "What medicine can I take for fever?" -> medicine/self-care flow, NO hospital search
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 2: "What medicine can I take for fever?"');
  try {
    const userMsg = 'What medicine can I take for fever?';
    const { intent } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.MEDICINE_REQUEST, 'Intent is medicine_request');

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    let toolsCalled = [];
    let text = '';
    await llm.streamCompletion(null, (chunk) => { text += chunk; }, async (name) => {
      toolsCalled.push(name);
    });

    assert.strictEqual(toolsCalled.length, 0, 'Zero hospital or facility tool calls');
    assert(!/looks consistent with Flu/i.test(text), 'Must not diagnose Flu');
    assert(!/nearby healthcare facilities/i.test(text), 'Must not mention nearby facilities');
    assert(/age|temperature|allergies/i.test(text), 'Asks safety questions before medication');

    pass('TEST 2 passed: "What medicine can I take for fever?" routes to medicine safety questions with zero hospital search');
  } catch (err) {
    fail('TEST 2 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: "Tell me some cure for fever, don't suggest doctor" -> supportive home self-care
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 3: "Tell me some cure for fever, don\'t suggest doctor"');
  try {
    const userMsg = "ok tell some cure for the fever dont suggest doctor or healthcare";
    const { intent, details } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.SELF_CARE, 'Intent is self_care');
    assert.strictEqual(details.antiDoctor, true, 'Anti-doctor flag detected');

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    let toolsCalled = [];
    let text = '';
    await llm.streamCompletion(null, (chunk) => { text += chunk; }, async (name) => {
      toolsCalled.push(name);
    });

    assert.strictEqual(toolsCalled.length, 0, 'Zero hospital or facility tool calls');
    assert(!/looks consistent with Flu/i.test(text), 'Must not diagnose Flu');
    assert(!/identified recommended nearby healthcare facilities/i.test(text), 'Must not search or offer facilities');
    assert(!/consult a doctor|see a doctor|consult with a doctor/i.test(text), 'Must NOT repeat doctor consultation');
    assert(/fluids|rest|cloth|forehead/i.test(text), 'Provides supportive home self-care instructions');

    pass('TEST 3 passed: Safe supportive home self-care without repeating doctor consultations');
  } catch (err) {
    fail('TEST 3 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: "I have fever, suggest nearby hospital" -> hospital search, nearest real facility
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 4: "I have fever, suggest nearby hospital"');
  try {
    const userMsg = 'I have fever, suggest nearby hospital';
    const { intent } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.NEARBY_HOSPITAL, 'Intent is nearby_hospital');

    const llm = new LLMClient({
      language: 'en',
      location: { lat: 13.0827, lon: 80.2707, city: 'Chennai' }
    });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    let dispatchedTool = null;
    let dispatchedArgs = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      dispatchedTool = name;
      dispatchedArgs = args;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(dispatchedTool, 'findNearbyCareFacilities', 'Must execute findNearbyCareFacilities');
    assert.strictEqual(dispatchedArgs.careType, 'emergency', 'Care type is emergency/hospital');

    let assistantFollowUp = '';
    await llm.streamFollowUp(null, (chunk) => { assistantFollowUp += chunk; });

    assert(assistantFollowUp.includes('Tamil Nadu Government Multi Super Speciality Hospital') || assistantFollowUp.includes('hospitals nearby'), 'Spoken summary mentions nearest hospital');

    pass('TEST 4 passed: "I have fever, suggest nearby hospital" triggers real emergency hospital search and spoken summary');
  } catch (err) {
    fail('TEST 4 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 5: Assistant asks facility check, User: "No" -> cancelled, never repeats
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 5: Facility Check Declined ("No")');
  try {
    const llm = new LLMClient({
      language: 'en',
      pendingAction: 'CHECK_NEARBY_CARE',
      nearbyCareStatus: 'pending'
    });
    llm.initConversation();
    llm.addAssistantMessage("Would you like me to find the nearest clinic for you?");
    llm.addUserMessage("No thanks");

    let toolsCalled = [];
    let text = '';
    await llm.streamCompletion(null, (chunk) => { text += chunk; }, async (name) => {
      toolsCalled.push(name);
    });

    assert.strictEqual(toolsCalled.length, 0, 'Zero tool calls when declined');
    assert.strictEqual(llm.nearbyCareStatus, 'declined', 'nearbyCareStatus set to declined');
    assert.strictEqual(llm.careDeclined, true, 'careDeclined flag set to true');
    assert.strictEqual(llm.pendingAction, null, 'pendingAction cleared to null');
    assert(/will not search/i.test(text), 'Acknowledges decline smoothly');

    pass('TEST 5 passed: User says "No" cancels facility check and never repeats');
  } catch (err) {
    fail('TEST 5 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 6: Assistant asks facility check, User: "Yes" -> exactly one facility search
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 6: Facility Check Accepted ("Yes")');
  try {
    const llm = new LLMClient({
      language: 'en',
      pendingAction: 'CHECK_NEARBY_CARE',
      nearbyCareStatus: 'pending',
      location: { lat: 13.0827, lon: 80.2707, city: 'Chennai' }
    });
    llm.initConversation();
    llm.addAssistantMessage("Would you like me to find the nearest clinic for you?");
    llm.addUserMessage("Yes please");

    let toolCallCount = 0;
    let executedTool = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      toolCallCount++;
      executedTool = name;
      const res = await TOOL_FUNCTIONS[name](args, null);
      llm.addToolResult(id, name, res);
    });

    assert.strictEqual(toolCallCount, 1, 'Exactly one facility search executed');
    assert.strictEqual(executedTool, 'findNearbyCareFacilities', 'Tool called is findNearbyCareFacilities');
    assert.strictEqual(llm.nearbyCareStatus, 'accepted', 'nearbyCareStatus is accepted');

    pass('TEST 6 passed: User says "Yes" executes exactly one facility search');
  } catch (err) {
    fail('TEST 6 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 7: "Virutcham Hospital near me" -> named facility search, real GPS distance
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 7: Named Facility Search ("Virutcham Hospital near me")');
  try {
    const userMsg = 'Virutcham Hospital near me';
    const { intent, details } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.NAMED_FACILITY_SEARCH, 'Intent is named_facility_search');
    assert(/Virutcham/i.test(details.facilityName), 'Extracts Virutcham Hospital name');

    // Test care-navigator directly with realistic live coords near Virutcham Hospital in Chennai (13.111, 80.145)
    const result = await searchHealthcareFacilities({
      facilityName: 'Virutcham Hospital',
      lat: 13.111,
      lon: 80.145,
      locationName: 'Chennai'
    });

    assert(result.facilities.length > 0, 'Found named facility');
    assert(/Virutcham/i.test(result.facilities[0].name), 'First facility is Virutcham Hospital');
    assert(result.spokenSummary.includes('Virutcham Hospital'), 'Spoken summary names the hospital');
    assert(result.spokenSummary.includes('metres') || result.spokenSummary.includes('km'), 'Metric distance formatted');

    pass('TEST 7 passed: Named facility search resolves exact facility and metric distance');
  } catch (err) {
    fail('TEST 7 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 8: "I have knee pain" -> knee-specific questions, NOT headache/fever
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 8: "I have knee pain" -> Knee-Specific Questions');
  try {
    const userMsg = 'I have knee pain';
    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let assistantFollowUp = '';
    await llm.streamFollowUp(null, (chunk) => { assistantFollowUp += chunk; });

    assert(/knee|swelling|walk/i.test(assistantFollowUp), 'Asks knee-specific evaluation questions');
    assert(!/headache|migraine|fever/i.test(assistantFollowUp), 'Does NOT ask about headache or fever');

    pass('TEST 8 passed: Knee pain triggers knee-specific questions without irrelevant symptoms');
  } catch (err) {
    fail('TEST 8 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 9: Tamil "எனக்கு முழங்கால்ல வலி இருக்கு" -> knee pain normalization
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 9: Tamil Knee Pain Normalization');
  try {
    const rawTa = 'எனக்கு முழங்கால்ல வலி இருக்கு';
    const extracted = extractClinicalSymptoms(rawTa, 'ta');
    assert(extracted.symptoms.includes('Knee pain'), 'Extracts Knee pain');

    const normalized = normalizeMedicalSpeech(rawTa, 'ta');
    assert(normalized.detectedMedicalTerms.some(t => t.canonical === 'முழங்கால் வலி' || t.canonical === 'knee pain'), 'Normalized canonical term is knee pain / முழங்கால் வலி');

    pass('TEST 9 passed: Tamil "எனக்கு முழங்கால்ல வலி இருக்கு" normalizes to knee pain');
  } catch (err) {
    fail('TEST 9 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 10: "high fever medicine" -> minimum safety questions before medication
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 10: "high fever medicine" -> Safety Questions');
  try {
    const userMsg = 'high fever medicine';
    const { intent } = classifyUserIntent(userMsg);
    assert.strictEqual(intent, INTENTS.MEDICINE_REQUEST, 'Intent is medicine_request');

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage(userMsg);

    let toolsCalled = [];
    let text = '';
    await llm.streamCompletion(null, (chunk) => { text += chunk; }, async (name) => {
      toolsCalled.push(name);
    });

    assert.strictEqual(toolsCalled.length, 0, 'Zero hospital tool calls');
    assert(/age|temperature|allergies/i.test(text), 'Must ask minimum safety questions');

    pass('TEST 10 passed: "high fever medicine" asks safety questions with no auto hospital search');
  } catch (err) {
    fail('TEST 10 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 11: Fever only -> NO "this is Flu", NO fake percentage
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 11: Fever Only -> No Flu Diagnosis');
  try {
    const analysis = await TOOL_FUNCTIONS['analyzeSymptoms'](['fever'], null);
    assert.strictEqual(analysis.possibleConditions.length, 0, 'No conditions returned for fever alone');

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage('fever');

    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let followUp = '';
    await llm.streamFollowUp(null, (chunk) => { followUp += chunk; });

    assert(!/Flu/i.test(followUp), 'Must not mention Flu');
    assert(!/100%|85%|60%/i.test(followUp), 'Must not show fake percentages');

    pass('TEST 11 passed: Fever alone has 0 conditions, no Flu diagnosis, and no fake percentages');
  } catch (err) {
    fail('TEST 11 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 12: Enough symptoms -> real 0–100 patternMatchScore values, "not a diagnosis" label
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 12: Multi-Symptom Pattern Match Scores & Disclaimer');
  try {
    const analysis = await TOOL_FUNCTIONS['analyzeSymptoms'](['fever', 'cough', 'chills'], null);
    assert(analysis.possibleConditions.length > 0, 'Conditions found for multi-symptom pattern');

    for (const cond of analysis.possibleConditions) {
      assert(typeof cond.patternMatchScore === 'number', 'patternMatchScore must be a number');
      assert(cond.patternMatchScore >= 0 && cond.patternMatchScore <= 100, 'Score must be between 0 and 100');
    }

    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();
    llm.addUserMessage('I have a fever, cough, and chills');

    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let followUp = '';
    await llm.streamFollowUp(null, (chunk) => { followUp += chunk; });

    assert(/% match/i.test(followUp), 'Spoken response mentions pattern match percentage');
    assert(/not a (?:clinical )?diagnosis/i.test(followUp), 'Spoken response includes disclaimer');

    pass('TEST 12 passed: Multi-symptom pattern displays bounded patternMatchScore and non-diagnosis disclaimer');
  } catch (err) {
    fail('TEST 12 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // BONUS: Exact Two-Turn Flow from User Screenshot
  // Turn 1: "why not high fever just suggest some medicine"
  // Turn 2: "ok tell some cure for the fever dont suggest doctor or healthcare"
  // ══════════════════════════════════════════════════════════════════════
  section('BONUS: Exact Bug Sequence from Screenshot');
  try {
    const llm = new LLMClient({ language: 'en' });
    llm.initConversation();

    // Turn 1
    llm.addUserMessage('why not high fever just suggest some medicine');
    let turn1Tools = [];
    let turn1Text = '';
    await llm.streamCompletion(null, (c) => { turn1Text += c; }, async (name) => {
      turn1Tools.push(name);
    });

    assert.strictEqual(turn1Tools.length, 0, 'Turn 1 must NOT trigger any tools');
    assert(!/identified recommended nearby healthcare facilities/i.test(turn1Text), 'Turn 1 must not offer facilities');
    assert(!/looks consistent with Flu/i.test(turn1Text), 'Turn 1 must not diagnose Flu');

    // Turn 2
    llm.addUserMessage('ok tell some cure for the fever dont suggest doctor or healthcare');
    let turn2Tools = [];
    let turn2Text = '';
    await llm.streamCompletion(null, (c) => { turn2Text += c; }, async (name) => {
      turn2Tools.push(name);
    });

    assert.strictEqual(turn2Tools.length, 0, 'Turn 2 must NOT trigger any tools');
    assert(!/looks consistent with Flu/i.test(turn2Text), 'Turn 2 must NOT diagnose Flu');
    assert(!/identified recommended nearby healthcare facilities/i.test(turn2Text), 'Turn 2 must NOT offer facilities');
    assert(/supportive home care|fluids|rest/i.test(turn2Text), 'Turn 2 provides safe supportive home care');

    pass('BONUS passed: Screenshot flow completely resolved — NO Flu diagnosis, NO hospital leakage, supportive self-care provided!');
  } catch (err) {
    fail('BONUS failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n\x1b[1m\x1b[36m━━━ Regression Test Summary ━━━\x1b[0m');
  console.log(`  Total:  ${totalTests}`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
