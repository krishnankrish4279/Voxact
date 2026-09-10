/**
 * VoxAct Isolated STT & Microphone Pipeline Debug Suite
 * 
 * Verifies SpeechRecognition & Turn Buffer in complete isolation
 * with ZERO submissions to LLM.
 * 
 * Tests exact inputs requested:
 * 1. English: "I have a bad headache and fever"
 * 2. Tamil: "எனக்கு தலைவலி இருக்கு"
 * 3. Tamil colloquial interruption: "பொரு"
 * 4. Long Tamil across session boundary: "எனக்கு நேற்றிலிருந்து தலைவலி இருக்கு, இப்போ கொஞ்சம் மூச்சுத்திணறலும் இருக்கு"
 */

const assert = require('assert');
const { createSpeechTurnController, DEBUG_STT_ONLY } = require('../public/js/app');

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

// Mock SpeechRecognitionResultList helper matching W3C Web Speech API specs
function createMockResultList(items) {
  const resultList = items.map(item => {
    const entry = [{ transcript: item.transcript, confidence: 0.95 }];
    entry.isFinal = Boolean(item.isFinal);
    return entry;
  });
  return resultList;
}

async function runSTTTests() {
  console.log('\x1b[1m\x1b[34mRunning VoxAct Isolated STT & Microphone Pipeline Verification...\x1b[0m');

  // ══════════════════════════════════════════════════════════════════════
  // TEST 1: English - "I have a bad headache and fever"
  // Proves that multi-chunk continuous STT receives full sentence without fragmentation
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 1: English - "I have a bad headache and fever"');
  try {
    let capturedFinal = '';
    let submittedTurns = [];
    let liveInterimHistory = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => false,
      onInterimUpdate: (speech, isInterim) => {
        liveInterimHistory.push({ speech, isInterim });
      },
      onSubmitSpeech: (finalText) => {
        capturedFinal = finalText;
        submittedTurns.push(finalText);
      },
      silenceTimeoutMs: 50,
    });

    // 1. User says "I have" (interim)
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'I have', isFinal: false }
    ]), 0, 'en-IN');

    // 2. User says "I have a bad headache" (interim)
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'I have a bad headache', isFinal: false }
    ]), 0, 'en-IN');

    // 3. First clause finalized: "I have a bad headache" (final)
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'I have a bad headache', isFinal: true }
    ]), 0, 'en-IN');

    // 4. User continues without pause: "and fever" (interim in continuous mode)
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'I have a bad headache', isFinal: true },
      { transcript: 'and fever', isFinal: false }
    ]), 1, 'en-IN');

    // 5. Second clause finalized: "and fever" (final in continuous mode)
    const result = controller.processRecognitionEvent(createMockResultList([
      { transcript: 'I have a bad headache', isFinal: true },
      { transcript: 'and fever', isFinal: true }
    ]), 1, 'en-IN');

    // Wait for silence timeout
    await result.submitPromise;

    assert.strictEqual(capturedFinal, 'I have a bad headache and fever',
      `Expected complete sentence "I have a bad headache and fever", but received: "${capturedFinal}"`);
    assert.strictEqual(submittedTurns.length, 1,
      `Expected exactly 1 submitted turn, but received: ${submittedTurns.length}`);

    pass('Full English sentence captured reliably with 100% words: "I have a bad headache and fever"');
  } catch (err) {
    fail('TEST 1 Failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 2: Tamil - "எனக்கு தலைவலி இருக்கு"
  // Proves that Tamil Unicode speech recognition accumulates cleanly
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 2: Tamil - "எனக்கு தலைவலி இருக்கு"');
  try {
    let capturedFinal = '';
    let submittedTurns = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => false,
      onSubmitSpeech: (finalText) => {
        capturedFinal = finalText;
        submittedTurns.push(finalText);
      },
      silenceTimeoutMs: 50,
    });

    // Interim 1: "எனக்கு"
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'எனக்கு', isFinal: false }
    ]), 0, 'ta-IN');

    // Interim 2: "எனக்கு தலைவலி"
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'எனக்கு தலைவலி', isFinal: false }
    ]), 0, 'ta-IN');

    // Final: "எனக்கு தலைவலி இருக்கு"
    const result = controller.processRecognitionEvent(createMockResultList([
      { transcript: 'எனக்கு தலைவலி இருக்கு', isFinal: true }
    ]), 0, 'ta-IN');

    await result.submitPromise;

    assert.strictEqual(capturedFinal, 'எனக்கு தலைவலி இருக்கு',
      `Expected "எனக்கு தலைவலி இருக்கு", got "${capturedFinal}"`);
    assert.strictEqual(submittedTurns.length, 1,
      `Expected 1 turn, got ${submittedTurns.length}`);

    pass('Full Tamil sentence captured reliably: "எனக்கு தலைவலி இருக்கு"');
  } catch (err) {
    fail('TEST 2 Failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 3: Tamil colloquial interruption - "பொரு"
  // Proves that colloquial hold phrase halts audio and holds in buffer without LLM submission
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 3: Tamil colloquial interruption - "பொரு"');
  try {
    let audioHalted = false;
    let submittedTurns = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => true, // Assistant is speaking
      onAudioHalt: (phrase) => {
        audioHalted = true;
      },
      onSubmitSpeech: (finalText) => {
        submittedTurns.push(finalText);
      },
      silenceTimeoutMs: 50,
    });

    // User speaks colloquial "பொரு"
    const result = controller.processRecognitionEvent(createMockResultList([
      { transcript: 'பொரு', isFinal: true }
    ]), 0, 'ta-IN');

    await result.submitPromise;

    assert.strictEqual(audioHalted, true, 'Audio should halt immediately on "பொரு"');
    assert.strictEqual(submittedTurns.length, 0,
      `Isolated hold phrase "பொரு" must NOT be submitted to LLM (submitted count: ${submittedTurns.length})`);
    assert.strictEqual(controller.getTurnBuffer(), 'பொரு',
      'Hold phrase must be retained in buffer awaiting continuation');

    pass('Colloquial Tamil interruption "பொரு" stops audio and holds in buffer with ZERO LLM calls');
  } catch (err) {
    fail('TEST 3 Failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 4: Long Tamil across Chrome onend boundary:
  // "எனக்கு நேற்றிலிருந்து தலைவலி இருக்கு, இப்போ கொஞ்சம் மூச்சுத்திணறலும் இருக்கு"
  // Proves that when Chrome fires onend after a brief pause, the second clause is NOT lost
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 4: Long Tamil across session onend boundary');
  try {
    let capturedFinal = '';
    let submittedTurns = [];

    const controller = createSpeechTurnController({
      isSpeakingFn: () => false,
      onSubmitSpeech: (finalText) => {
        capturedFinal = finalText;
        submittedTurns.push(finalText);
      },
      silenceTimeoutMs: 100,
    });

    // Session 1: User says first clause
    controller.processRecognitionEvent(createMockResultList([
      { transcript: 'எனக்கு நேற்றிலிருந்து தலைவலி இருக்கு', isFinal: true }
    ]), 0, 'ta-IN');

    // Chrome briefly disconnects / fires onend during natural 400ms pause!
    controller.onSessionEnd();

    // Session 2 starts automatically at index 0 after restart: User says second clause
    const result = controller.processRecognitionEvent(createMockResultList([
      { transcript: 'இப்போ கொஞ்சம் மூச்சுத்திணறலும் இருக்கு', isFinal: true }
    ]), 0, 'ta-IN');

    // Wait for silence timeout
    await result.submitPromise;

    const expectedMerged = 'எனக்கு நேற்றிலிருந்து தலைவலி இருக்கு இப்போ கொஞ்சம் மூச்சுத்திணறலும் இருக்கு';
    assert.strictEqual(capturedFinal, expectedMerged,
      `Expected merged full transcript "${expectedMerged}", but got: "${capturedFinal}"`);
    assert.strictEqual(submittedTurns.length, 1,
      `Expected exactly 1 complete accumulated turn, but got: ${submittedTurns.length}`);

    pass('Long Tamil sentence across Chrome onend restart captures 100% of words without drops: "' + capturedFinal + '"');
  } catch (err) {
    fail('TEST 4 Failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // TEST 5: Verify DEBUG_STT_ONLY Flag is disabled
  // Proves that submissions to LLM are enabled for production consultation
  // ══════════════════════════════════════════════════════════════════════
  section('TEST 5: Verify DEBUG_STT_ONLY Flag');
  try {
    assert.strictEqual(DEBUG_STT_ONLY, false, 'DEBUG_STT_ONLY must be false so turns reach LLM');
    pass('DEBUG_STT_ONLY = false verified: LLM submissions enabled');
  } catch (err) {
    fail('TEST 5 Failed', err);
  }

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log(`\n\x1b[1mResults: ${passedTests}/${totalTests} tests passed.\x1b[0m\n`);
  if (failedTests > 0) {
    process.exit(1);
  }
}

runSTTTests();
