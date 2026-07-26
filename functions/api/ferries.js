// functions/api/ferries.js
//
// A Cloudflare Pages Function. It runs on Cloudflare's servers, never in the
// browser, so this is the only place the WSDOT access code is allowed to
// exist. Its job is narrow on purpose: fetch WSDOT's ferry data and hand it
// back. It does not filter by sector or track direction of travel — that
// needs to persist for days in one open browser tab, and this Function does
// not persist anything between requests.
//
// WSDOT_ACCESS_CODE is set as a Cloudflare environment variable (or, for
// local testing, in .dev.vars — see CLAUDE.md's Testing section). It is
// never written in this file or any other file in the repo.

const WSDOT_URL =
  'https://www.wsdot.wa.gov/Ferries/API/Vessels/rest/vessellocations';

export async function onRequestGet({ env }) {
  const url = `${WSDOT_URL}?apiaccesscode=${env.WSDOT_ACCESS_CODE}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    return jsonError('Could not reach WSDOT.');
  }

  if (!response.ok) {
    return jsonError('WSDOT did not respond.');
  }

  const body = await response.text();

  // Vessel positions change every few seconds, so this response must never
  // be cached — by Cloudflare, by the browser, or by anything in between.
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
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
