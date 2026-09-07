# VoxAct — Voice-Native Medical Triage Assistant

> **Rime Hackathon Submission**  
> Hard Voice Problem: **Conversation Continuity During Tool Work**

## Overview

VoxAct is a voice-native medical triage assistant that helps patients describe their symptoms by speaking and receive spoken health guidance in return. The assistant runs symptom analysis, urgency scoring, and clinic lookups in the background — and keeps the conversation alive with contextual filler speech throughout, ensuring **zero dead-air gaps**.

**Why voice is essential:** The target user — someone feeling unwell, potentially dizzy, in pain, or visually impaired — cannot effectively use a text-based interface. Removing voice makes the product broken, not just worse.

## Hard Voice Problem

**Conversation Continuity During Tool Work** — VoxAct solves conversation continuity during medical tool execution by combining zero-dead-air filler speech with interruption-aware generation fencing. When the assistant runs background tools (symptom analysis, urgency scoring, clinic lookup), the system eliminates silence and handles barge-in cleanly via:

1. **Contextual Filler Speech**: Natural bridge phrases dispatched within milliseconds of tool invocation
2. **Generation-ID Stale-Result Fencing**: Every generation cycle gets an isolated UUID. Late-arriving tool results from interrupted turns are discarded before producing audio
3. **Sub-millisecond Client Audio Interruption**: Web Audio teardown immediately stops speaker output upon user speech detection
4. **State Truncation**: Conversation memory reflects strictly what was *audibly spoken* before interruption, preventing hallucinated context

## Setup Instructions

### Prerequisites
- Node.js 18+
- A modern browser (Chrome or Edge recommended for Web Speech API)
- API keys for Rime and OpenAI

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd Voxact

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Configuration

Edit `.env` with your credentials:

```env
RIME_API_KEY=your_rime_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

### Running

```bash
# Start the server
npm start

# Or with auto-reload during development
npm run dev
```

Open `http://localhost:3000` in Chrome or Edge.

## Architecture

```
Browser (Client)                    Node.js Server
┌─────────────────┐               ┌─────────────────────────────┐
│ Web Speech API  │               │  Conversation Orchestrator  │
│ (STT)           │──WebSocket──▶│  ├── State Machine          │
│                 │               │  ├── Generation ID Fence    │
│ Audio Player    │◀──WebSocket──│  ├── Filler Speech Manager  │
│ (Streaming MP3) │               │  └── Latency Tracker        │
│                 │               │         │        │          │
│ Voice Visualizer│               │    ┌────┘   ┌────┘          │
│ (Canvas)        │               │    ▼        ▼               │
└─────────────────┘               │  OpenAI   Rime TTS         │
                                  │  GPT-4o   (Mist v3/ws3)    │
                                  │    │                        │
                                  │    ▼                        │
                                  │  Medical Tools              │
                                  │  (Synthetic Data)           │
                                  └─────────────────────────────┘
```

## Third-Party Services

| Service | Purpose | Configuration |
|---|---|---|
| **Rime TTS** | Spoken audio output across English, Tamil, and Hindi | See Rime Multilingual Configuration below |
| **Groq / OpenAI** | Clinical LLM triage reasoning and tool calling | `GROQ_API_KEY` (120B LPU) or `OPENAI_API_KEY` (GPT-4o) in `.env` |
| **OpenStreetMap & Nominatim** | Real-world healthcare facility geographic lookup | Free OpenStreetMap API + verified fallback directory |
| **Leaflet.js** | Interactive dark-mode care navigation map rendering | CDN Leaflet 1.9.4 |
| **Web Speech API** | Browser-native continuous speech recognition | Configured for `en-US`, `ta-IN`, `hi-IN` |

## Rime Multilingual Configuration

VoxAct integrates real multilingual speech models for true conversational voice triage:

| Language | Model ID | Speaker | Language Code | Endpoint | Format | Characteristics |
|---|---|---|---|---|---|---|
| **English (Default)** | `mist` (Mist v3) | `cove` | `eng` | `wss://users-ws.rime.ai/ws3` | `mp3` | Professional empathetic clinician persona |
| **Tamil (தமிழ்)** | `arcana` | `anaya` | `tam` | `wss://users-ws.rime.ai/ws3` | `mp3` | Natural South Indian cadence and proper Tamil phonology |
| **Hindi (हिन्दी)** | `coda` | `taru` | `hin` | `wss://users-ws.rime.ai/ws3` | `mp3` | Expressive, warm North Indian conversational delivery |

> **Live Dynamic Language Switching**: Selecting a language from the UI header dropdown instantly updates the Web Speech recognition language (`en-US`, `ta-IN`, `hi-IN`), LLM system prompts, zero-dead-air filler dictionaries, and Rime TTS connection without reloading the page or losing triage context.

## Nearby Healthcare Care Navigation & Interactive Map

VoxAct includes an intelligent, voice-driven care navigation feature:
1. **Clinical Pathway Matching**: Automatically maps patient symptoms and calculated triage urgency to appropriate facility types (Emergency Department, Urgent Care Center, Walk-In Clinic, or Primary Care).
2. **Medical Safety Guarantees**:
   - Recommends facility types and nearest centers only.
   - **NEVER** diagnoses definitively or claims to assign the "exact doctor" for a patient.
   - Prominently displays Emergency Guidance notices (`108 / 112` for India, `911` for US) whenever acute symptoms (chest pain, shortness of breath, severe bleeding) are detected.
3. **Strict Real-Data Policy**:
   - **NEVER** fabricates ratings, review counts, wait times, or doctor names. If unavailable, fields are set to null and displayed with a neutral "Verified Facility" badge (or "Verified fallback facility" if loaded from local verified catalog within 50 miles).
   - Uses live OpenStreetMap Nominatim queries bounded to the user's coordinates, with fallback to verified hospitals and clinics in San Francisco, Seattle, Chennai, and Delhi.
4. **Interactive Leaflet Map**:
   - Displays user location marker and numbered facility pins colored by care level (Red: Emergency, Amber: Urgent, Cyan: Walk-in, Blue: Primary Care).
   - Clicking cards or pins opens full directions and metadata popups.
5. **Robust Location Handling**:
   - Uses browser Geolocation when permitted (`enableHighAccuracy: true`, `maximumAge: 0`).
   - If coordinates are missing, returns `location_required` without defaulting to any hardcoded city.
   - If geolocation is denied or unavailable, the voice assistant **does not crash or block**; it falls back seamlessly to manual city selection.
6. **Voice Continuity & Interruption Fencing**:
   - Facility search executes asynchronously via `findNearbyCareFacilities` with bridge filler speech.
   - Interrupting mid-search (*"Wait, I want a hospital instead"* or *"பொறு, மருத்துவமனை வேண்டும்"*) instantly halts audio, cancels the search, fences stale results, and re-routes triage under a fresh generation ID.

## Empirical Benchmark & Telemetry

### 1. Server-Side Orchestrator Benchmark (N = 30 Runs)

Automated benchmark executed via `npm run benchmark` across 30 consecutive delayed-tool barge-in trials (logged in `benchmarks/results.json`):

| Metric | Target | Measured (Median) | p95 | Result |
|---|---|---|---|---|
| **Server Generation Invalidation** | < 20ms | **0.23 ms** | **0.81 ms** | **PASS** (Sub-millisecond fence) |
| **Contextual Filler Dispatch Latency** | < 20ms | **0.02 ms** | **0.11 ms** | **PASS** (Sub-millisecond bridge) |
| **Stale Result Fencing Rate** | 100% | **30 / 30 (100%)** | **100%** | **PASS** (Zero stale leakage) |
| **Stale Speech Leakage** | 0% | **0 / 30 (0%)** | **0%** | **PASS** (0 bytes leaked) |

### 2. Live Client Web Audio Telemetry (Observed During Barge-In & Playback)

| Metric | Target | Measured (Shipped Build) | Mechanism |
|---|---|---|---|
| **Client Audio Halt (Local Teardown)** | < 50ms | **< 1 ms** (typically 0.01 – 0.05 ms) | Synchronous Web Audio teardown via `audioPlayer.stop()` |
| **Audio Buffer Flush & Discard** | Immediate | **< 0.1 ms** | Immediate queue flush and `playbackId` increment in browser |
| **Audio Architecture** | Clear Voice | **Complete-MP3 Pipelined** | Sentence assembled into intact MP3 buffer server-side -> decoded via `decodeAudioData` -> scheduled gaplessly on Web Audio timeline |
| **Pipelined Prefetching** | Gapless | **Concurrent synthesis** | Sentence N+1 synthesizes in background while Sentence N plays |
| **Inter-Sentence Playback Gap** | Low gap | **Measured live on UI HUD** | Calculated via `max(0, actualPlaybackStart - previousPlaybackEnd)` and logged in console |

## Medical Speech Normalization (Tamil / Hindi / English)

VoxAct incorporates an in-pipeline medical transcription normalizer (`MedicalTranscriber`) between speech recognition and clinical triage:
- **Canonical Clinical Term Mapping**: Normalizes conversational variants and Romanized colloquialisms to standard medical terms (e.g. `நெஞ்சுவலி` / `nenju vali` → `நெஞ்சு வலி`, `மூச்சு விட கஷ்டம்` → `மூச்சுத்திணறல்`, `chhati me dard` → `सीने में दर्द`).
- **Raw Transcript Preservation**: Maintains unmodified `rawTranscript` for auditability while passing `normalizedTranscript` to the triage LLM.
- **Ambiguity Protection**: Detects generic non-specific phrases (e.g., `உடம்பு சரியில்லை`, `tabiyat kharab hai`) and returns targeted clarifying questions without prematurely categorizing as acute emergencies.

## Known Limitations

1. **Synthetic Triage Demonstration**: Symptom triage recommendations are for demonstration purposes only. Not medical advice.
2. **Browser STT**: Web Speech API performs best in Google Chrome or Microsoft Edge.
3. **No Telephony**: Browser-based voice only. No PSTN/phone trunk integration.
4. **No Persistent Patient Database**: Sessions are ephemeral for privacy.

## Failure Behavior

| Scenario | Behavior |
|---|---|
| Rime TTS unavailable | Falls back to visual text display in transcript + browser synthesis |
| LLM unavailable | Speaks graceful fallback and suggests seeking emergency services |
| Microphone denied | Displays polite notice and enables manual symptom review |
| Geolocation denied | Gracefully retains manual city selection without interrupting voice session |
| WebSocket disconnect | Automatically reconnects after 3 seconds |
| Stale tool results arrive | Discarded silently via generation ID fencing with zero audio leakage |

## Running Tests & Benchmarks

```bash
# Run the automated stress test suite (102 unit, orchestrator, normalizer & care navigation tests)
npm test

# Run the 30-trial statistical benchmark
npm run benchmark

# Package clean submission zip (strictly excluding credentials)
npm run package
```

## License

MIT

