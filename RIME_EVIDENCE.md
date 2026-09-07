# RIME_EVIDENCE.md — Hard Voice Claim & Empirical Evidence

## Hard Voice Problem

> **Conversation continuity during tool work & low-latency multilingual voice streaming.**

VoxAct maintains conversation continuity during background medical tool execution by combining zero-dead-air filler speech, sentence-level pipelining, and interruption-aware generation fencing. When clinical diagnostic tools (symptom analysis, triage urgency scoring, clinic lookups) run in the background, conversational filler speech bridges the latency gap. When a patient barges in or interrupts, active audio immediately halts, the old generation is invalidated, delayed tool outputs are fenced, and the system responds strictly to the new request.

---

## Acceptance Test

> **During a deliberately delayed tool call, the user interrupts the assistant and changes the request. The application must stop obsolete speech, invalidate the old generation, fence the delayed tool result, and produce speech corresponding only to the updated request.**

### Verification Procedure:
1. Generation 1 is initiated with a deliberately slow background diagnostic tool (`analyzeSymptoms`, 1500ms delay).
2. Assistant immediately dispatches natural bridge filler speech within milliseconds to maintain continuity.
3. Patient interrupts mid-flight: *"Wait, check the emergency facility instead."*
4. **Client Audio Halt**: Web Audio buffer playback immediately halts (`audioPlayer.stop()`), cutting sound in < 1ms.
5. **Generation Switch**: Generation 1 is invalidated and Generation 2 is initialized with the updated emergency request.
6. **Delayed Tool Arrival**: When the 1500ms tool finishes, the Generation Fence checks `genId === currentGenerationId`. Because Generation 1 is stale, the old result is discarded with **zero audio leakage**.
7. **Updated Speech**: Spoken response and clinical card correspond strictly to the updated emergency request.

---

## Exact Rime Configuration

| Language | Model ID | Speaker | Language Code | HTTP Endpoint | WebSocket Endpoint | Audio Format | Tested Status |
|---|---|---|---|---|---|---|---|
| **English (Default)** | `mist` (Mist v3) | `cove` | `eng` | `https://users.rime.ai/v1/rime-tts` | `wss://users-ws.rime.ai/ws3` | `mp3` | **Verified Live** |
| **Tamil (தமிழ்)** | `arcana` | `anaya` | `tam` | `https://users.rime.ai/v1/rime-tts` | `wss://users-ws.rime.ai/ws3` | `mp3` | **Verified Live** |
| **Hindi (हिन्दी)** | `coda` | `taru` | `hin` | `https://users.rime.ai/v1/rime-tts` | `wss://users-ws.rime.ai/ws3` | `mp3` | **Verified Live** |

> **Dynamic Language Switching**: The client selector dynamically reconfigures Rime's `modelId`, `speaker`, and `language` on the fly without reloading the page or dropping conversation state. The active WebSocket connection cleanly resets and re-establishes with the target language model within milliseconds.

---

## Audio Architecture & Sentence Pipelining (Truth in Advertising)

1. **Complete-MP3 Sentence Playback (Option B)**:
   - Rather than feeding partial MP3 chunks to the browser's `decodeAudioData` (which causes decoder state errors and truncated frames), VoxAct packages each complete clause or sentence as an integral, decodable MP3 audio segment.
   - This ensures 100% clean, click-free, and natural voice output across English, Tamil, and Hindi without decoder frame artifacts.

2. **Sentence-Level Pipelining (Inter-Sentence Latency Mitigation)**:
   - While Sentence 1 is being played by the browser (average playback duration: 2.5–4.5s), Sentence 2 is synthesized in the background concurrently.
   - Primary streaming leverages Rime's low-latency WebSocket endpoint for the initial turn, while concurrent background prefetching uses Rime's HTTP REST synthesis to avoid WebSocket frame collision.
   - The browser schedules Sentence 2 at audio timeline boundaries (`nextStartTime = Math.max(currentTime, nextStartTime) + buffer.duration`). When prefetch completes before the current sentence finishes, timeline scheduling is continuous; live telemetry on the HUD measures any actual playback boundary gap.

3. **Segment Deduplication & Generation Isolation**:
   - Each audio segment is tagged with unique identifiers: `generationId`, `responseId`, and `segmentId`.
   - The server suppresses duplicate sentence synthesis, and the client's `AudioPlayer` maintains an active set of scheduled segments (`generationId:responseId:segmentId`), guaranteeing that identical phrases are never queued or played twice.

4. **Sub-Millisecond Multilingual Barge-in & Audio Halting**:
   - English: `"Wait"` / `"Stop"` halts client Web Audio playback in **< 1 ms** (typically 0.01 – 0.05 ms measured via `performance.now()`).
   - Tamil: `"பொறு"` / `"நில்"` halts client Web Audio playback in **< 1 ms**.
   - Hindi: `"रुको"` / `"रुकिए"` halts client Web Audio playback in **< 1 ms**.
   - Instant synchronous teardown via `AudioBufferSourceNode.stop()` ensures zero audio overhang upon interruption.

5. **Medical Speech-to-Text Normalization (Tamil / Hindi / English)**:
   - Built-in clinical normalizer placed between SpeechRecognition and Triage/LLM layers.
   - Preserves `rawTranscript` and produces `normalizedTranscript` mapping spoken variants (e.g. `நெஞ்சுவலி` / `nenju vali` → `நெஞ்சு வலி`, `மூச்சு விட கஷ்டம்` → `மூச்சுத்திணறல்`, `chhati me dard` → `सीने में दर्द`).
   - Ambiguity protection flags non-specific phrases (e.g. `உடம்பு சரியில்லை` / "feeling unwell", `tabiyat kharab hai`) and returns clinical clarification prompts rather than assuming high-risk emergencies.

6. **Dynamic Geolocation & Care Navigation Continuity (`findNearbyCareFacilities`)**:
   - Uses fresh device coordinates (`enableHighAccuracy: true`, `timeout: 10000`, `maximumAge: 0`) with OpenStreetMap reverse-geocoding; zero hardcoding of San Francisco or Chennai.
   - Safe telemetry only: logs accuracy and timestamp without raw latitude/longitude exposure.
   - Dynamic search invalidation: when location updates, in-flight searches are aborted, stale results are fenced, markers are updated, and care facilities are re-queried.
   - Strict zero-fabrication policy: no fake hospital names, doctors, ratings, reviews, or operating hours.
   - Emergency guidance dynamically uses Indian emergency numbers (`108 / 112`) for Chennai/India and `911 / 112` for US.

---

## Empirical Benchmark Results & Telemetry

### 1. Server-Side Interruption & Generation Fencing Performance (N = 30 Runs)

Automated benchmark executed via `npm run benchmark` across 30 consecutive delayed-tool barge-in trials (logged in `benchmarks/results.json`):

| Metric | Target | Median | p95 | Min | Max | Result |
|---|---|---|---|---|---|---|
| **Server Gen Invalidation** | < 20 ms | **0.23 ms** | **0.81 ms** | 0.15 ms | 1.08 ms | **PASS** (Sub-1ms fence) |
| **Filler Dispatch Latency** | < 20 ms | **0.02 ms** | **0.11 ms** | 0.01 ms | 0.12 ms | **PASS** (Immediate trigger) |
| **Stale-Result Fencing Rate** | 100% | **30 / 30 (100%)** | **100%** | 100% | 100% | **PASS** (0 stale bytes leaked) |
| **Stale Audio Leakage** | 0% | **0 / 30 (0%)** | **0%** | 0% | 0% | **PASS** (Zero leakage) |

### 2. Client Web Audio Telemetry (Live Browser HUD)

| Metric | Target | Measured (In-Browser) | Details |
|---|---|---|---|
| **User Turn End -> First Audio** | Low latency | **Measured live on HUD** | Calculated via `performance.now() - userTurnEndTime` upon first audible playback |
| **Client Audio Halt Latency** | < 50 ms | **< 1 ms** (typically 0.01 – 0.05 ms) | Synchronous teardown of Web Audio `AudioBufferSourceNode` via `stop()` |
| **Queue Purge & State Invalidation** | Instant | **< 0.1 ms** | Increments `playbackId` to invalidate pending decode promises |
| **Inter-Sentence Playback Gap** | Low gap | **Target: Gapless; Live Telemetry on HUD** | Audio timeline scheduling target: `nextStartTime = nextStartTime + buffer.duration`. The browser HUD calculates and displays `max(0, actualPlaybackStart - previousPlaybackEnd)` live for every segment. |

---

## Reproducible Verification Commands

Run the test and benchmark suites from the command line:

```bash
# 1. Run the automated stress test suite (102 unit, orchestrator, normalizer & care navigation tests)
npm test

# 2. Run the 30-run statistical benchmark suite
npm run benchmark

# 3. Start live server
npm start
# Open http://localhost:3000 in Chrome or Edge
```
