/**
 * VoxAct — Preflight / API Key Validation (Vercel Serverless)
 */
module.exports = function handler(req, res) {
  const rimeConfigured = !!process.env.RIME_API_KEY && process.env.RIME_API_KEY !== 'your_rime_api_key_here';
  const openaiConfigured = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';

  const issues = [];
  if (!rimeConfigured) {
    issues.push('RIME_API_KEY is not set (using browser speech fallback)');
  }
  if (!openaiConfigured) {
    issues.push('OPENAI_API_KEY is not set (using simulated medical triage reasoning)');
  }

  const isLive = rimeConfigured && openaiConfigured;

  res.status(200).json({
    ok: true,
    mode: isLive ? 'live' : 'simulation',
    issues,
    message: isLive ? 'All API keys configured' : 'Running in simulation mode',
    rime: { configured: rimeConfigured },
    openai: { configured: openaiConfigured },
  });
};
