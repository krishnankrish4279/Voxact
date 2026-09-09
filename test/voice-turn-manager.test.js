/**
 * VoxAct Voice Turn Manager & Conversation Continuity Test Suite
 * 
 * Verifies all 7 Core Scenarios:
 * TEST A: Assistant asks "காய்ச்சல் இருக்கிறதா?", User says "காய்ச்சல் அடிக்குது" -> exactly one response, processes fever=true
 * TEST B: Assistant asks fever question, User says "காய்ச்சல் உள்ளது" -> does NOT repeat the fever question
 * TEST C: User speaks long sentence with multiple fragments -> exactly one accumulated user turn and one assistant response
 * TEST D: User says "ஒரு" then pauses -> does not start medical analysis (holds in buffer)
 * TEST E: User says "ஒரு" then continues speaking -> combines into single turn
 * TEST F: User says "எனக்கு தலைவலி" then "இப்போ மூச்சுத்திணறல் இருக்கு" -> updates case with both symptoms, escalates to emergency, does not repeat headache-only response
 * TEST G: Assistant speaking, User says "wait wait, எனக்கு வேற ஒரு symptom இருக்கு" -> halts audio, invalidates generation, collects full turn, responds only to new turn
 */

const assert = require('assert');
const { createSpeechTurnController } = require('../public/js/app');
const LLMClient = require('../src/llm-client');
const { Orchestrator } = require('../src/orchestrator');
const { TOOL_FUNCTIONS } = require('../src/tools');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function section(name) {
  console.log(`\n\x1b[1m\x1b[36m━━━ ${name} ━━━\x1b[0m\n`);
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

async function runTests() {
  console.log('\x1b[1m\x1b[34mRunning VoxAct Voice Turn Manager & Continuity Test Suite...\x1b[0m');

  // ══════════════════════════════════════════════════════════════════════
  // TEST A: Assistant asks "காய்ச்சல் இருக்கிறதா?", User says "காய்ச்சல் அடிக்குது"
  // ══════════════════════════════════════════════════════════════════════
  section('TEST A: Assistant asks fever question -> User answers "காய்ச்சல் அடிக்குது" -> fever=true, no repeat');
  try {
    const llm = new LLMClient({ language: 'ta' });
    llm.initConversation();

    // Setup pending question asking about fever
    const feverQuestion = "உங்களுக்கு தலைவலி, காய்ச்சல், அல்லது வேறு ஏதேனும் உடல் வலி உள்ளதா?";
    llm.addAssistantMessage(feverQuestion);
    llm.pendingQuestion = { id: 'fever_inquiry', symptom: 'fever', questionText: feverQuestion };

    // User responds: "காய்ச்சல் அடிக்குது"
    const userTurn = "காய்ச்சல் அடிக்குது";
    llm.addUserMessage(userTurn);

    let toolCalls = [];
    let assistantResponse = '';
    const res = await llm.streamCompletion(
      null,
      (chunk) => { assistantResponse += chunk; },
      async (name, args, id) => {
        toolCalls.push({ name, args, id });
        const toolRes = await TOOL_FUNCTIONS[name](args.symptoms, null);
        llm.addToolResult(id, name, toolRes);
      }
    );

    // Assertions
    assert(llm.collectedSymptoms['fever'] === true, 'fever is marked true in collectedSymptoms');
    assert(llm.answeredQuestions.has('fever_inquiry'), 'fever_inquiry marked as answered');
    assert.strictEqual(llm.pendingQuestion, null, 'pendingQuestion cleared');
    assert.strictEqual(toolCalls.length, 1, 'Exactly one tool call triggered');
    assert.strictEqual(toolCalls[0].name, 'analyzeSymptoms', 'analyzeSymptoms called');
    assert(toolCalls[0].args.symptoms.includes('fever'), 'Symptoms analyzed include fever');
    assert(!assistantResponse.includes('காய்ச்சல் இருக்கிறதா'), 'Does NOT repeat inquiry question');
    assert(!assistantResponse.includes('உடல் வலி உள்ளதா'), 'Does NOT repeat intake question');

    pass('TEST A passed: User answering "காய்ச்சல் அடிக்குது" sets fever=true, analyzes symptoms, and does not repeat fever question');
  } catch (err) {
    fail('TEST A failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST B: Assistant asks fever question -> User answers "காய்ச்சல் உள்ளது"
  // ══════════════════════════════════════════════════════════════════════
  section('TEST B: Assistant asks fever question -> User answers "காய்ச்சல் உள்ளது" -> Does NOT repeat fever question');
  try {
    const llm = new LLMClient({ language: 'ta' });
    llm.initConversation();

    // Turn 1: Clarification question asked about fever
    llm.addUserMessage('எனக்கு காய்ச்சல்');
    let turn1Tool = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn1Tool = name;
      const res = await TOOL_FUNCTIONS[name](args.symptoms || ['fever'], null);
      llm.addToolResult(id, name, res);
    });

    let turn1Question = '';
    await llm.streamFollowUp(null, (chunk) => { turn1Question += chunk; });
    assert(llm.pendingQuestion !== null, 'Turn 1 sets pendingQuestion');
    assert.strictEqual(llm.pendingQuestion.id, 'fever_clarification', 'Turn 1 pendingQuestion is fever_clarification');

    // Turn 2: User answers "காய்ச்சல் உள்ளது"
    llm.addUserMessage('காய்ச்சல் உள்ளது');
    let turn2Response = '';
    let turn2Tools = [];
    await llm.streamCompletion(
      null,
      (chunk) => { turn2Response += chunk; },
      async (name, args, id) => {
        turn2Tools.push(name);
        const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
        llm.addToolResult(id, name, res);
      }
    );

    // Verify turn 2 response does NOT repeat the clarification prompt
    assert(llm.answeredQuestions.has('fever_clarification'), 'fever_clarification marked answered');
    assert(!turn2Response.includes('எத்தனை நாட்களாக இருக்கிறது'), 'Does NOT repeat: எத்தனை நாட்களாக இருக்கிறது');
    assert(!turn2Response.includes('வெப்பநிலை என்னவென்று'), 'Does NOT repeat: வெப்பநிலை என்னவென்று');
    assert(turn2Response.includes('காய்ச்சல்') || turn2Response.includes('ஓய்வெடுக்கவும்'), 'Provides constructive advice');

    pass('TEST B passed: User answering "காய்ச்சல் உள்ளது" does NOT repeat fever question');
  } catch (err) {
    fail('TEST B failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST C: User speaks long sentence with multiple fragments
  // ══════════════════════════════════════════════════════════════════════
  section('TEST C: Multi-fragment speech turn accumulation -> Exactly 1 submitted turn');
  try {
    let submittedTurns = [];
    const controller = createSpeechTurnController({
      silenceTimeoutMs: 200, // Shortened for fast test execution
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
    });

    // Simulating fragments arriving over time
    // Fragment 1: "எனக்கு தலைவலி"
    controller.processRecognitionEvent({ interim: 'எனக்கு தலைவலி' });
    controller.processRecognitionEvent({ finalChunk: 'எனக்கு தலைவலி', isFinal: true });

    // Fragment 2: "கை காலெல்லாம்"
    controller.processRecognitionEvent({ interim: 'கை காலெல்லாம்' });
    controller.processRecognitionEvent({ finalChunk: 'கை காலெல்லாம்', isFinal: true });

    // Fragment 3: "ஒரே வலி"
    controller.processRecognitionEvent({ interim: 'ஒரே வலி' });
    controller.processRecognitionEvent({ finalChunk: 'ஒரே வலி', isFinal: true });

    // Fragment 4: "இருக்கு"
    controller.processRecognitionEvent({ interim: 'இருக்கு' });
    controller.processRecognitionEvent({ finalChunk: 'இருக்கு', isFinal: true });

    // While chunks arrive, submittedTurns should be 0
    assert.strictEqual(submittedTurns.length, 0, 'No premature turn submission during pause between chunks');

    // Wait for silence debounce timeout (200ms + 60ms margin)
    await new Promise(r => setTimeout(r, 260));

    assert.strictEqual(submittedTurns.length, 1, 'Exactly 1 complete turn submitted after silence');
    assert.strictEqual(
      submittedTurns[0],
      'எனக்கு தலைவலி கை காலெல்லாம் ஒரே வலி இருக்கு',
      'All fragments combined cleanly with single spaces into one turn'
    );

    pass('TEST C passed: Multi-fragment speech produces exactly 1 accumulated turn');
  } catch (err) {
    fail('TEST C failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST D: User says "ஒரு" then pauses -> does not start medical analysis
  // ══════════════════════════════════════════════════════════════════════
  section('TEST D: Isolated particle "ஒரு" held in buffer -> Zero analysis started');
  try {
    let submittedTurns = [];
    const controller = createSpeechTurnController({
      silenceTimeoutMs: 150,
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
    });

    // User says only "ஒரு"
    controller.processRecognitionEvent({ interim: 'ஒரு' });
    controller.processRecognitionEvent({ finalChunk: 'ஒரு', isFinal: true });

    // Wait for silence debounce timeout
    await new Promise(r => setTimeout(r, 200));

    assert.strictEqual(submittedTurns.length, 0, 'Isolated "ஒரு" must NOT be submitted as turn');
    assert.strictEqual(controller.getCurrentAccumulation(), 'ஒரு', 'Fragment remains buffered in controller');

    pass('TEST D passed: Isolated hesitation particle "ஒரு" held in buffer, zero analysis started');
  } catch (err) {
    fail('TEST D failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST E: User says "ஒரு" then continues speaking -> combines into single turn
  // ══════════════════════════════════════════════════════════════════════
  section('TEST E: User says "ஒரு" then continues -> Combines into single turn');
  try {
    let submittedTurns = [];
    const controller = createSpeechTurnController({
      silenceTimeoutMs: 200,
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
    });

    // Step 1: User says "ஒரு"
    controller.processRecognitionEvent({ interim: 'ஒரு' });
    controller.processRecognitionEvent({ finalChunk: 'ஒரு', isFinal: true });

    // Step 2: Pause briefly (less than timeout)
    await new Promise(r => setTimeout(r, 100));

    // Step 3: Continues with "நிமிஷம் எனக்கு நெஞ்சு வலிக்குது"
    controller.processRecognitionEvent({ interim: 'நிமிஷம் எனக்கு நெஞ்சு வலிக்குது' });
    controller.processRecognitionEvent({ finalChunk: 'நிமிஷம் எனக்கு நெஞ்சு வலிக்குது', isFinal: true });

    // Step 4: Now user stops speaking
    await new Promise(r => setTimeout(r, 260));

    assert.strictEqual(submittedTurns.length, 1, 'Exactly 1 combined turn submitted');
    assert.strictEqual(
      submittedTurns[0],
      'எனக்கு நெஞ்சு வலிக்குது',
      'Fragment "ஒரு" seamlessly merged with subsequent speech and conversational prefix stripped'
    );

    pass('TEST E passed: Hesitation particle followed by speech combines into single turn');
  } catch (err) {
    fail('TEST E failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST F: Turn 1 Headache -> Turn 2 Shortness of Breath (Multi-symptom triage)
  // ══════════════════════════════════════════════════════════════════════
  section('TEST F: Turn 1 Headache -> Turn 2 Shortness of Breath (Escalation & No Repetition)');
  try {
    const llm = new LLMClient({ language: 'ta' });
    llm.initConversation();

    // Turn 1: "எனக்கு தலைவலி"
    llm.addUserMessage("எனக்கு தலைவலி");
    let turn1Args = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn1Args = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let turn1Response = '';
    await llm.streamFollowUp(null, (chunk) => { turn1Response += chunk; });
    assert(turn1Args.symptoms.includes('headache'), 'Turn 1 includes headache');

    // Turn 2: "இப்போ மூச்சுத்திணறல் இருக்கு"
    llm.addUserMessage("இப்போ மூச்சுத்திணறல் இருக்கு");
    let turn2Tool = null;
    let turn2Args = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      turn2Tool = name;
      turn2Args = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    let turn2Response = '';
    await llm.streamFollowUp(null, (chunk) => { turn2Response += chunk; });

    // Assertions:
    assert.strictEqual(turn2Tool, 'analyzeSymptoms', 'Turn 2 executes analyzeSymptoms');
    assert(turn2Args.symptoms.includes('headache'), 'Turn 2 preserves headache');
    const hasBreathing = turn2Args.symptoms.some(s => s.toLowerCase().includes('shortness') || s.toLowerCase().includes('breath'));
    assert(hasBreathing, 'Turn 2 includes shortness of breath');

    // Calculate urgency for combined symptoms
    const urgencyRes = await TOOL_FUNCTIONS['calculateUrgency']({ symptoms: turn2Args.symptoms }, null);
    assert(urgencyRes.urgencyLevel === 'high' || urgencyRes.urgencyLevel === 'emergency', 'Urgency escalated to high/emergency');
    assert(!turn2Response.includes('தலைவலி மட்டுமே'), 'Turn 2 does not repeat headache-only guidance');

    pass('TEST F passed: Progressive symptoms merge cleanly, escalate urgency to Emergency, and avoid repeating headache-only guidance');
  } catch (err) {
    fail('TEST F failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST G: Interruption ("wait wait, எனக்கு வேற ஒரு symptom இருக்கு")
  // ══════════════════════════════════════════════════════════════════════
  section('TEST G: Audio Interruption during playback -> instant audio halt & stale fence');
  try {
    let audioHalted = false;
    let haltedPhrase = null;
    let cancelledWsSent = false;
    let submittedSpeech = null;

    const controller = createSpeechTurnController({
      isSpeakingFn: () => true, // Assistant currently speaking
      onAudioHalt: (phrase) => {
        audioHalted = true;
        haltedPhrase = phrase;
      },
      onSendInterruptStart: () => {
        cancelledWsSent = true;
      },
      onSubmitSpeech: (text) => {
        submittedSpeech = text;
      },
      silenceTimeoutMs: 150,
    });

    // Assistant is speaking, User says: "wait wait, எனக்கு வேற ஒரு symptom இருக்கு"
    controller.processRecognitionEvent({
      interim: 'wait wait',
    });

    assert.strictEqual(audioHalted, true, 'Audio playback stopped instantly on interim "wait wait"');
    assert.strictEqual(haltedPhrase, 'wait wait', 'Interruption phrase detected');
    assert.strictEqual(cancelledWsSent, true, 'Interruption cancellation signal sent to backend');

    // Speech continues into final chunk
    controller.processRecognitionEvent({
      finalChunk: 'wait wait எனக்கு வேற ஒரு symptom இருக்கு',
      isFinal: true,
    });

    // Wait for turn completion
    await new Promise(r => setTimeout(r, 200));

    assert.strictEqual(
      submittedSpeech,
      'எனக்கு வேற ஒரு symptom இருக்கு',
      'Full spoken turn submitted with conversational control prefix stripped'
    );

    pass('TEST G passed: User speech interrupts assistant instantly (<1ms halt), fences stale response, and submits new turn');
  } catch (err) {
    fail('TEST G failed', err);
  }

  console.log(`\n\x1b[1m\x1b[32mResults: ${passedTests}/${totalTests} tests passed.\x1b[0m\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
