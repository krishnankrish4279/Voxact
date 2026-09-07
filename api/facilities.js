/**
 * VoxAct — Healthcare Facilities Search (Vercel Serverless)
 */
const { searchHealthcareFacilities } = require('../src/care-navigator');

module.exports = async function handler(req, res) {
  try {
    const rawLat = req.query.lat;
    const rawLon = req.query.lon !== undefined ? req.query.lon : req.query.lng;
    const lat = (rawLat !== undefined && rawLat !== null && rawLat !== '') ? parseFloat(rawLat) : NaN;
    const lon = (rawLon !== undefined && rawLon !== null && rawLon !== '') ? parseFloat(rawLon) : NaN;

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        error: 'location_required',
        facilities: []
      });
    }

    const urgencyLevel = req.query.urgency || req.query.urgencyLevel || 'medium';
    const careType = req.query.type || req.query.careType || null;
    const locationName = req.query.city || req.query.location || null;
    const language = req.query.lang || req.query.language || 'en';

    const results = await searchHealthcareFacilities({
      lat,
      lon,
      urgencyLevel,
      careType,
      locationName,
      language
    });
    res.status(200).json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
