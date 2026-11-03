// Relays public plane positions to the flights page, which browsers can't fetch directly.
// Only answers for Southwest callsigns, keeps no logs of its own and caches briefly to go easy on the sources.
const SOURCES = [
  "https://api.adsb.lol/v2/callsign/",
  "https://opendata.adsb.fi/api/v2/callsign/",
];
const ALLOWED_ORIGIN = "https://rashad-j83.github.io";
const CACHE_SECONDS = 20;

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": ALLOWED_ORIGIN,
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
    },
  });

async function lookUp(callsign) {
  for (const source of SOURCES) {
    try {
      const res = await fetch(source + callsign, { headers: { "user-agent": "family-flight-page" } });
      if (!res.ok) continue;
      const data = await res.json();
      const plane = (data.ac || []).find((a) => a.lat != null && a.lon != null);
      if (!plane) return { found: false, checkedAt: Date.now() };
      return {
        found: true,
        checkedAt: Date.now(),
        lat: plane.lat,
        lon: plane.lon,
        onGround: plane.alt_baro === "ground",
        altitudeFt: typeof plane.alt_baro === "number" ? plane.alt_baro : null,
        speedKnots: plane.gs ?? null,
        heading: plane.track ?? null,
        secondsOld: plane.seen_pos ?? plane.seen ?? null,
      };
    } catch (e) {
      continue;
    }
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const callsign = (url.searchParams.get("flight") || "").toUpperCase();
    if (!/^SWA\d{1,4}$/.test(callsign)) return reply({ error: "Unknown flight" }, 400);

    const cache = caches.default;
    const key = new Request(`${url.origin}/?flight=${callsign}`);
    const cached = await cache.match(key);
    if (cached) return cached;

    const result = await lookUp(callsign);
    if (!result) return reply({ error: "Flight data is unavailable right now" }, 502);
    const response = reply(result);
    ctx.waitUntil(cache.put(key, response.clone()));
    return response;
  },
};
