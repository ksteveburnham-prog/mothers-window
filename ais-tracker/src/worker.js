// ais-tracker/src/worker.js
//
// A separate Cloudflare Worker whose only job is to hold the AisTracker
// Durable Object. Cloudflare Pages cannot host a Durable Object directly, so
// this Worker exists purely to be deployed on its own and then bound into
// the Pages project (see ../../wrangler.toml).
//
// AisTracker keeps one persistent WebSocket connection open to aisstream.io
// (a free AIS — Automatic Identification System — feed of ship positions),
// filtered to a bounding box around her window, and serves the current
// snapshot of nearby vessels over plain HTTP whenever
// functions/api/vessels.js asks for it.

// A Worker's fetch()-based WebSocket client requires an http(s) URL — the
// `Upgrade: websocket` header below is what actually switches protocols.
// fetch() has no wss:// support at all; using it here silently fails with
// "Fetch API cannot load: wss://...".
const AIS_STREAM_URL = 'https://stream.aisstream.io/v0/stream';

// Generously covers both of her sectors out to maxDistanceMiles, with
// margin. Duplicated here rather than imported, since this Worker is a
// separate deployment from the Pages project and doesn't share a module
// graph with config.js. If config.js's sectors or maxDistanceMiles change
// meaningfully, widen this box to match.
const BOUNDING_BOX = [[47.42, -122.65], [47.64, -122.34]];

// A vessel we haven't heard from in this long is dropped from the snapshot —
// otherwise the vessel table would only ever grow across the many days this
// Worker may stay running.
const STALE_MS = 10 * 60 * 1000;

// How often the alarm checks the connection and prunes old vessels.
const ALARM_INTERVAL_MS = 60 * 1000;

export class AisTracker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.vessels = new Map(); // MMSI -> vessel record
    this.socket = null;
    this.connecting = false;

    // Make sure the keepalive alarm is always scheduled, even the very
    // first time this Durable Object is created.
    this.state.blockConcurrencyWhile(async () => {
      const existingAlarm = await this.state.storage.getAlarm();
      if (!existingAlarm) {
        await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
      }
    });
  }

  async fetch(request) {
    await this.ensureConnected();
    this.pruneStale();

    const snapshot = Array.from(this.vessels.values());
    return new Response(JSON.stringify(snapshot), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      }
    });
  }

  // Cloudflare calls this automatically when the alarm set above fires.
  // It's what keeps the connection alive and self-healing even when nothing
  // is polling /api/vessels for a while.
  async alarm() {
    await this.ensureConnected();
    this.pruneStale();
    await this.state.storage.setAlarm(Date.now() + ALARM_INTERVAL_MS);
  }

  pruneStale() {
    const cutoff = Date.now() - STALE_MS;
    for (const [mmsi, vessel] of this.vessels) {
      if (!vessel.lastUpdate || vessel.lastUpdate < cutoff) {
        this.vessels.delete(mmsi);
      }
    }
  }

  async ensureConnected() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connecting) return;
    this.connecting = true;

    try {
      const response = await fetch(AIS_STREAM_URL, {
        headers: { Upgrade: 'websocket' }
      });

      const socket = response.webSocket;
      if (!socket) throw new Error('aisstream.io did not upgrade to a websocket');

      socket.accept();
      // Without this, binary frames arrive as Blob objects (with an async
      // .text()/.arrayBuffer() API), not the plain ArrayBuffer handleMessage
      // expects — that mismatch was silently dropping every message.
      socket.binaryType = 'arraybuffer';
      this.socket = socket;

      // Per aisstream.io's protocol, this subscription message must be sent
      // within 3 seconds of connecting or the socket gets closed.
      socket.send(JSON.stringify({
        APIKey: this.env.AISSTREAM_API_KEY,
        BoundingBoxes: [BOUNDING_BOX]
      }));
      console.log('AisTracker: connected and subscribed to', JSON.stringify(BOUNDING_BOX));

      socket.addEventListener('message', (event) => {
        this.handleMessage(event.data);
      });

      // On any disconnect, just clear the socket. We never throw or crash
      // here — the next fetch() or alarm() tick will call ensureConnected()
      // again and reconnect on its own.
      socket.addEventListener('close', (event) => {
        console.log('AisTracker: socket closed', event.code, event.reason);
        this.socket = null;
      });
      socket.addEventListener('error', (event) => {
        console.log('AisTracker: socket error', event.message || event);
        this.socket = null;
      });
    } catch (err) {
      console.log('AisTracker: connect failed', err && err.message);
      this.socket = null;
    } finally {
      this.connecting = false;
    }
  }

  handleMessage(raw) {
    // aisstream.io's messages arrive as JSON, but this Workers runtime
    // delivers them as binary frames (ArrayBuffer), not text frames — so a
    // raw JSON.parse(raw) silently threw and dropped every message. Decode
    // first, whichever form it comes in as.
    const text = raw instanceof ArrayBuffer ? new TextDecoder().decode(raw) : raw;
    if (typeof text !== 'string') {
      console.log('AisTracker: could not decode message to text');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      console.log('AisTracker: failed to parse message:', text.slice(0, 200));
      return;
    }

    const mmsi = parsed.MetaData && parsed.MetaData.MMSI;
    if (!mmsi) return;

    const vessel = this.vessels.get(mmsi) || { mmsi };

    // Class A vessels (big commercial/cargo/tanker traffic) send
    // "PositionReport"/"ShipStaticData". Class B (common on smaller and
    // pleasure craft) send differently-named messages with the same shape.
    // Reading Message[MessageType] dynamically, rather than hardcoding two
    // specific keys, covers both without listing every variant by hand.
    const isPositionType = /PositionReport$/.test(parsed.MessageType);
    const isStaticType = /StaticData(Report)?$/.test(parsed.MessageType);
    const body = parsed.Message && parsed.Message[parsed.MessageType];

    if (isPositionType && body) {
      vessel.lat = body.Latitude;
      vessel.lon = body.Longitude;
      vessel.speedKnots = body.Sog;
      vessel.course = body.Cog;
      vessel.heading = body.TrueHeading;
      vessel.lastUpdate = Date.now();
    } else if (isStaticType && body) {
      if (body.Type !== undefined) vessel.shipType = body.Type;
      if (body.CallSign) vessel.callSign = body.CallSign.trim();
      if (body.Destination) vessel.destination = body.Destination.replace(/@+$/, '').trim();
      if (body.Dimension) {
        vessel.lengthMeters = body.Dimension.A + body.Dimension.B;
        vessel.beamMeters = body.Dimension.C + body.Dimension.D;
      }
    }

    if (parsed.MetaData.ShipName) {
      vessel.name = parsed.MetaData.ShipName.trim();
    }

    this.vessels.set(mmsi, vessel);
  }
}

export default {
  async fetch(request, env) {
    const id = env.AIS_TRACKER.idFromName('puget-sound');
    const stub = env.AIS_TRACKER.get(id);
    return stub.fetch(request);
  }
};
