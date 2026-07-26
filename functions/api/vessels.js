// functions/api/vessels.js
//
// Pages Function that hands the page live AIS (Automatic Identification
// System) vessel data. Unlike ferries.js, there's no outbound call to a
// third party happening here — the AisTracker Durable Object
// (ais-tracker/src/worker.js) already maintains the connection to
// aisstream.io continuously, in the background. This Function's only job is
// to ask that Durable Object for its current snapshot and pass it through.

export async function onRequestGet({ env }) {
  try {
    const id = env.AIS_TRACKER.idFromName('puget-sound');
    const stub = env.AIS_TRACKER.get(id);

    const response = await stub.fetch('https://ais-tracker/vessels');

    if (!response.ok) {
      return jsonError('AIS tracker did not respond.');
    }

    const body = await response.text();

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  } catch (err) {
    return jsonError('Could not reach the AIS tracker.');
  }
}

function jsonError(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 502,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}
