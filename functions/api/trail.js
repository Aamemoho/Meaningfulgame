// ─── Cloudflare Pages Function: /api/trail ────────────────────────────────────
// KV 바인딩 필요: 대시보드 → Settings → Functions → KV namespace bindings
//   Variable name: TRAILS
//   KV namespace:  (새로 생성한 네임스페이스)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function ok(text = "ok") {
  return new Response(text, { status: 200, headers: CORS });
}

function err(msg, status = 400) {
  return new Response(msg, { status, headers: CORS });
}

export async function onRequest({ request, env }) {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(request.url);

  // ── GET /api/trail?seed=42 ─────────────────────────────────────────────────
  // 특정 공유 조각의 모든 다른 플레이어 흔적 조회
  if (request.method === "GET") {
    const seed = url.searchParams.get("seed");
    if (!seed || isNaN(Number(seed))) return err("seed required");

    const raw = await env.TRAILS.get(`piece:${seed}`);
    if (!raw) return json([]);

    let entries = [];
    try { entries = JSON.parse(raw); } catch { return json([]); }

    // 30일 지난 흔적 자동 정리
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    entries = entries.filter(e => e.savedAt > cutoff);

    return json(entries);
  }

  // ── POST /api/trail ────────────────────────────────────────────────────────
  // 플레이어의 흔적 저장
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return err("invalid json"); }

    const { globalSeed, playerId, trail, exitFace } = body;

    if (!globalSeed || !playerId || !Array.isArray(trail)) {
      return err("globalSeed, playerId, trail required");
    }

    // 최소 2개 이상의 포인트
    if (trail.length < 2) return ok("too short, skipped");

    const key = `piece:${globalSeed}`;
    const raw = await env.TRAILS.get(key);
    let entries = [];
    try { if (raw) entries = JSON.parse(raw); } catch {}

    // 같은 플레이어의 이전 흔적 교체
    entries = entries.filter(e => e.playerId !== playerId);
    entries.push({
      playerId,
      trail: trail.slice(0, 80),   // 최대 80 포인트
      exitFace: exitFace || null,
      savedAt: Date.now(),
    });

    // 조각당 최대 30명의 흔적 보관
    if (entries.length > 30) entries = entries.slice(-30);

    await env.TRAILS.put(key, JSON.stringify(entries), {
      expirationTtl: 60 * 60 * 24 * 30, // 30일 TTL
    });

    return ok();
  }

  return err("method not allowed", 405);
}
