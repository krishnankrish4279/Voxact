/**
 * VoxAct — Health Check (Vercel Serverless)
 */
module.exports = function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rime: {
      configured: !!process.env.RIME_API_KEY,
      model: process.env.RIME_MODEL_ID || 'mist',
      speaker: process.env.RIME_SPEAKER || 'cove',
    },
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
  });
};
