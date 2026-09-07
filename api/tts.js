/**
 * VoxAct — Speech Synthesis API Endpoint
 * Provides high-clarity native audio streaming for Tamil, Hindi, and English.
 */

const { synthesizeClearAudio, cleanTamilTextForSpeech, cleanHindiTextForSpeech } = require('../src/tts-synthesizer');

module.exports = async function handler(req, res) {
  // Support both GET and POST
  const text = req.query.text || req.body?.text || '';
  const lang = req.query.lang || req.body?.lang || 'en';

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text parameter is required' });
  }

  try {
    const audioResult = await synthesizeClearAudio(text, { language: lang });
    if (!audioResult || !audioResult.buffer) {
      return res.status(502).json({ error: 'Failed to synthesize audio' });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioResult.buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.setHeader('X-Voice-Language', audioResult.language);
    return res.status(200).end(audioResult.buffer);
  } catch (err) {
    console.error('[api/tts] Synthesis error:', err.message);
    return res.status(500).json({ error: 'Internal TTS synthesis error', details: err.message });
  }
};