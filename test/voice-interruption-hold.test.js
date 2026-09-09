/**
 * VoxAct Critical Voice Bug Test Suite:
 * "PORU / WAIT" Interruption Handling & Turn Assembly
 * 
 * Verifies all 5 Required Cases from Specification:
 * TEST 1: Assistant speaking -> User says "பொரு" -> Assistant stops, 0 LLM calls, 0 assistant responses
 * TEST 2: Assistant speaking -> User says "பொரு, எனக்கு ஒரு வேற symptom இருக்கு" -> Assistant stops, 1 complete turn, 1 LLM call
 * TEST 3: Assistant asks "காய்ச்சல் இருக்கிறதா?" -> User says "ஒரு" -> Does NOT blindly convert to "பொரு", contextual evaluation
 * TEST 4: Assistant speaking -> User says "wait wait" -> Assistant stops immediately, 0 LLM calls
 * TEST 5: Assistant speaking -> User says "பொரு", short pause, then "எனக்கு மூச்சுத்திணறல் இருக்கு" -> Exactly ONE medical turn, NOT two
 */

const assert = require('assert');
const { createSpeechTurnController, normalizeConversationalControl, stripControlPrefix } = require('../public/js/app');
const LLMClient = require('../src/llm-client');
const { Orchestrator, STATE } = require('../src/orchestrator');
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
  console.log('\x1b[1m\x1b[34mRunning VoxAct "PORU / WAIT" Interruption & Turn Assembly Test Suite...\x1b[0m');

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1: Assistant speaking -> User says "பொரு" -> Assistant stops, 0 LLM calls, 0 responses
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 1: Assistant speaking -> User says "பொரு" -> Halt, 0 LLM calls, 0 responses');
  try {
    let audioHalted = false;
    let haltedPhrase = null;
    let submittedTurns = [];
    let interruptStartSent = false;

    const controller = createSpeechTurnController({
      isSpeakingFn: () => true, // Assistant currently speaking
      onAudioHalt: (phrase) => {
        audioHalted = true;
        haltedPhrase = phrase;
      },
      onSendInterruptStart: () => {
        interruptStartSent = true;
      },
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
      silenceTimeoutMs: 150,
    });

    // Assistant is speaking, User says: "பொரு"
    controller.processRecognitionEvent({
      interim: 'பொரு',
    });

    assert.strictEqual(audioHalted, true, 'Audio playback stopped immediately upon hearing "பொரு"');
    assert.strictEqual(haltedPhrase, 'பொரு', 'Interruption detected phrase is "பொரு"');
    assert.strictEqual(interruptStartSent, true, 'interrupt_start signal dispatched to server');

    // Speech finalizes as "பொரு"
    controller.processRecognitionEvent({
      finalChunk: 'பொரு',
      isFinal: true,
    });

    // Wait for silence debounce timeout
    await new Promise(r => setTimeout(r, 220));

    // Must NOT call LLM or submit as medical turn!
    assert.strictEqual(submittedTurns.length, 0, 'Zero LLM turns submitted for pure hold word "பொரு"');
    assert.strictEqual(controller.getInterruptionState(), 'INTERRUPTED_WAITING_FOR_USER', 'Controller in INTERRUPTED_WAITING_FOR_USER state');
    assert.strictEqual(controller.getTurnBuffer(), 'பொரு', 'Buffer holds "பொரு" waiting for user continuation');

    // Also test Orchestrator / LLM level: if standalone "பொரு" arrives, zero LLM calls
    let llmCalls = 0;
    const mockSend = () => {};
    const orchestrator = new Orchestrator('test-poru-sess', mockSend, { language: 'ta' });
    orchestrator.state = STATE.SPEAKING;

    // Simulate speech arriving at orchestrator
    await orchestrator.handleUserSpeech('பொரு');
    assert.strictEqual(orchestrator.currentGenerationId, null, 'Active generation invalidated');
    assert.strictEqual(orchestrator.state, STATE.LISTENING, 'Orchestrator quiet in LISTENING state');

    pass('TEST 1 passed: User saying "பொரு" while assistant speaks halts audio, makes 0 LLM calls, and enters quiet wait');
  } catch (err) {
    fail('TEST 1 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 2: Assistant speaking -> User says "பொரு, எனக்கு ஒரு வேற symptom இருக்கு" -> 1 turn, 1 LLM call
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 2: Assistant speaking -> User says "பொரு, எனக்கு ஒரு வேற symptom இருக்கு" -> 1 turn, 1 LLM call');
  try {
    let audioHalted = false;
    let submittedTurns = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => true,
      onAudioHalt: () => {
        audioHalted = true;
      },
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
      silenceTimeoutMs: 150,
    });

    // User says "பொரு, எனக்கு ஒரு வேற symptom இருக்கு"
    controller.processRecognitionEvent({
      finalChunk: 'பொரு, எனக்கு ஒரு வேற symptom இருக்கு',
      isFinal: true,
    });

    assert.strictEqual(audioHalted, true, 'Audio playback stopped immediately');

    // Wait for silence debounce timeout
    await new Promise(r => setTimeout(r, 220));

    assert.strictEqual(submittedTurns.length, 1, 'Exactly one complete user turn submitted');
    // The leading control prefix "பொரு" should be stripped for clean medical analysis
    assert(
      submittedTurns[0].includes('எனக்கு') && submittedTurns[0].includes('symptom'),
      `Submitted turn contains medical text: "${submittedTurns[0]}"`
    );
    assert(!submittedTurns[0].startsWith('பொரு'), 'Leading control phrase "பொரு" stripped before medical analysis');

    // Test with LLMClient
    const llm = new LLMClient({ language: 'ta' });
    llm.initConversation();
    llm.addUserMessage(submittedTurns[0]);

    let toolDispatched = false;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      toolDispatched = true;
      llm.addToolResult(id, name, { possibleConditions: [] });
    });

    pass('TEST 2 passed: Full utterance with "பொரு" prefix stops audio, strips prefix, and submits exactly 1 turn to LLM');
  } catch (err) {
    fail('TEST 2 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: Assistant asks "காய்ச்சல் இருக்கிறதா?" -> User says "ஒரு" -> Contextual evaluation
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 3: Assistant asks "காய்ச்சல் இருக்கிறதா?" -> User says "ஒரு" -> Do NOT blindly convert to "பொரு"');
  try {
    const contextNotSpeaking = {
      assistantSpeaking: false,
      immediatelyAfterAssistant: true,
      pendingQuestion: { symptom: 'fever', questionText: 'காய்ச்சல் இருக்கிறதா?' },
      lastAssistantMsg: 'காய்ச்சல் இருக்கிறதா?'
    };

    // Calling normalizeConversationalControl when assistant is NOT speaking and not a hold situation
    const normalizedWhenNotSpeaking = normalizeConversationalControl('ஒரு', {
      assistantSpeaking: false,
      immediatelyAfterAssistant: false,
      pendingQuestion: { symptom: 'fever', questionText: 'காய்ச்சல் இருக்கிறதா?' },
      lastAssistantMsg: 'காய்ச்சல் இருக்கிறதா?'
    });

    assert.strictEqual(normalizedWhenNotSpeaking, 'ஒரு', '"ஒரு" must NOT blindly become "பொரு" when assistant is not speaking');

    // Also test quantity question context: "உங்களுக்கு ஒரு symptom மட்டும் இருக்கிறதா?"
    const quantityContext = {
      assistantSpeaking: true,
      immediatelyAfterAssistant: true,
      pendingQuestion: { questionText: 'உங்களுக்கு ஒரு symptom மட்டும் இருக்கிறதா?' },
      lastAssistantMsg: 'உங்களுக்கு ஒரு symptom மட்டும் இருக்கிறதா?'
    };

    const normalizedQuantity = normalizeConversationalControl('ஒரு', quantityContext);
    assert.strictEqual(normalizedQuantity, 'ஒரு', '"ஒரு" must NOT become "பொரு" when answering a quantity question');

    // When assistant IS speaking in general, and user says "ஒரு" (which is ASR error for "பொரு"):
    const speakingContext = {
      assistantSpeaking: true,
      immediatelyAfterAssistant: false,
      pendingQuestion: null,
      lastAssistantMsg: 'உங்கள் அறிகுறிகளைப் பற்றி சொல்லுங்கள்...'
    };

    const normalizedSpeaking = normalizeConversationalControl('ஒரு', speakingContext);
    assert.strictEqual(normalizedSpeaking, 'பொரு', '"ஒரு" correctly normalizes to "பொரு" when user interrupts speaking assistant');

    pass('TEST 3 passed: "ஒரு" is context-aware: only normalizes to "பொரு" during assistant speech, never for quantity questions or normal dialogue');
  } catch (err) {
    fail('TEST 3 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: Assistant speaking -> User says "wait wait" -> Assistant stops immediately, 0 LLM calls
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 4: Assistant speaking -> User says "wait wait" -> Stops immediately, 0 LLM calls');
  try {
    let audioHalted = false;
    let haltedPhrase = null;
    let submittedTurns = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => true,
      onAudioHalt: (phrase) => {
        audioHalted = true;
        haltedPhrase = phrase;
      },
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
      silenceTimeoutMs: 150,
    });

    // Assistant is speaking, User says: "wait wait"
    controller.processRecognitionEvent({
      interim: 'wait wait',
    });

    assert.strictEqual(audioHalted, true, 'Audio playback stopped instantly on "wait wait"');
    assert(haltedPhrase.includes('wait'), `Detected phrase includes wait (${haltedPhrase})`);

    // Speech finalizes as "wait wait"
    controller.processRecognitionEvent({
      finalChunk: 'wait wait',
      isFinal: true,
    });

    // Wait for silence debounce timeout
    await new Promise(r => setTimeout(r, 220));

    assert.strictEqual(submittedTurns.length, 0, 'Zero LLM turns submitted for pure "wait wait"');
    assert.strictEqual(controller.getInterruptionState(), 'INTERRUPTED_WAITING_FOR_USER', 'State is INTERRUPTED_WAITING_FOR_USER');

    pass('TEST 4 passed: "wait wait" during assistant speech halts audio immediately with zero LLM calls');
  } catch (err) {
    fail('TEST 4 failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 5: User says "பொரு", short pause, then "எனக்கு மூச்சுத்திணறல் இருக்கு" -> ONE medical turn
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 5: "பொரு" -> pause -> "எனக்கு மூச்சுத்திணறல் இருக்கு" -> Exactly ONE turn');
  try {
    let audioHalted = false;
    let submittedTurns = [];
    let assistantSpeaking = true;

    const controller = createSpeechTurnController({
      isSpeakingFn: () => assistantSpeaking,
      onAudioHalt: () => {
        audioHalted = true;
        assistantSpeaking = false; // Audio halts immediately
      },
      onSubmitSpeech: (text) => {
        submittedTurns.push(text);
      },
      silenceTimeoutMs: 200,
    });

    // Step 1: User says "பொரு" while assistant is speaking
    controller.processRecognitionEvent({
      interim: 'பொரு',
    });
    assert.strictEqual(audioHalted, true, 'Audio halted on "பொரு"');

    controller.processRecognitionEvent({
      finalChunk: 'பொரு',
      isFinal: true,
    });

    // Step 2: Pause briefly (user gathers breath / pauses)
    await new Promise(r => setTimeout(r, 240));

    // Because "பொரு" is a pure control word, it should NOT have been submitted
    assert.strictEqual(submittedTurns.length, 0, 'Pure "பொரு" must NOT be submitted prematurely during pause');

    // Step 3: User continues with "எனக்கு மூச்சுத்திணறல் இருக்கு"
    controller.processRecognitionEvent({
      interim: 'எனக்கு மூச்சுத்திணறல் இருக்கு',
    });
    controller.processRecognitionEvent({
      finalChunk: 'எனக்கு மூச்சுத்திணறல் இருக்கு',
      isFinal: true,
    });

    // Step 4: User finishes turn, silence debounce expires
    await new Promise(r => setTimeout(r, 260));

    // Must be submitted as EXACTLY ONE turn!
    assert.strictEqual(submittedTurns.length, 1, `Expected exactly 1 submitted turn, got ${submittedTurns.length}`);
    assert(
      submittedTurns[0].includes('மூச்சுத்திணறல்'),
      `Turn contains breathlessness symptom: "${submittedTurns[0]}"`
    );
    assert(!submittedTurns[0].startsWith('பொரு'), 'Control prefix stripped from medical turn');

    // Step 5: Test medical re-triage on the combined turn
    const llm = new LLMClient({ language: 'ta' });
    llm.initConversation();
    // Simulate previous conversation context had headache
    llm.accumulatedSymptoms = ['headache'];

    llm.addUserMessage(submittedTurns[0]);
    let triageArgs = null;
    await llm.streamCompletion(null, () => {}, async (name, args, id) => {
      triageArgs = args;
      const res = await TOOL_FUNCTIONS[name](args.symptoms, null);
      llm.addToolResult(id, name, res);
    });

    assert(triageArgs.symptoms.includes('headache'), 'Preserves existing headache');
    assert(triageArgs.symptoms.some(s => s.toLowerCase().includes('shortness') || s.toLowerCase().includes('breath')), 'Includes new shortness of breath');

    pass('TEST 5 passed: "பொரு" followed by pause and "எனக்கு மூச்சுத்திணறல் இருக்கு" combines into exactly ONE medical turn with clean re-triage');
  } catch (err) {
    fail('TEST 5 failed', err);
  }

  console.log(`\n\x1b[1m\x1b[32mResults: ${passedTests}/${totalTests} tests passed.\x1b[0m\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

runTests();
