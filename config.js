// config.js — where she is and what she can see.
//
// Everything in here was measured, not guessed. If the page starts showing
// boats she can't see (or missing ones she can), this is the only file you
// should need to change.
//
// NOTE: no API key in this file. The WSDOT access code lives in a Cloudflare
// environment variable and is only ever read by functions/api/ferries.js.

const WINDOW = {
  // Averaged from four iPhone EXIF fixes taken 3-25 July 2026.
  // All four agreed to within a few metres, so this is solid.
  lat: 47.560742,
  lon: -122.386503,

  // GPS-reported elevation, roughly 315 ft. Only used for display/sanity;
  // her horizon is ~22 miles either way, so nothing depends on this.
  elevationFt: 315,

  // The sectors of open water she can actually see, in degrees true.
  // Her view is NOT one continuous wedge - a large deciduous tree and a
  // conifer block the middle. Measured from a wide-angle balcony photo
  // (heading 265.78 deg, 69.4 deg field of view) by overlaying a
  // one-degree grid and reading off where the water was.
  //
  // A vessel must fall inside ONE OF THESE, not inside a single range.
  sectors: [
    // South window. Southworth ferry terminal sits at 236.8 deg, 6.1 miles,
    // right in the middle of this. The Vashon-Southworth leg sweeps ~228-237.
    // CAUTION: the photo's frame ended at 231 deg and there was still water,
    // so the true southern limit is unknown and may be lower. Her building
    // appears to start cutting in around here. Calibrate this edge first.
    { from: 231, to: 245, name: 'south window' },

    // West window. Main basin, Kitsap shore (Manchester) behind at 267.5 deg.
    // The north-south shipping lane crosses here at about 269 deg.
    { from: 266, to: 280, name: 'west window' }
  ],

  // Everything above is accurate to roughly +/- 5 degrees. Earlier telephoto
  // photos taken through a window disagreed with the outdoor wide-angle shot
  // by about 6 degrees, almost certainly magnetometer interference from the
  // building's steel frame.
  //
  // So we widen every sector by this much on both sides. Erring wide is
  // deliberate: a false positive costs her a glance out the window; a false
  // negative means the page missed the ferry, which is the only real failure.
  //
  // If she reports missing boats, INCREASE this. Do not decrease it to cut
  // noise without doing the calibration in SPEC.md first.
  bearingTolerance: 5,

  // Past this, a vessel is a speck even if geometrically visible.
  maxDistanceMiles: 10
};

// Known blocked directions, kept for reference so nobody "fixes" the gap
// by merging the two sectors:
//   245-266 deg  trees (deciduous + conifer)
//   280+    deg  buildings and the West Seattle ridge; confirmed by a
//                second photo shot at heading 326 deg with no water in frame
//   304     deg  Alki Point - NOT visible
//   310-325 deg  Seattle-Bainbridge ferry route - NOT visible
