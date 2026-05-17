// ─── multiplay.js ─────────────────────────────────────────────────────────────
// 플레이어 ID 관리, 흔적 기록/전송, 다른 플레이어 흔적 수신

const PLAYER_ID_KEY = "sphere-player-id";
const API_BASE = "/api"; // Cloudflare Pages Function 경로

// ─── 플레이어 ID (익명 UUID, 첫 실행 시 생성) ─────────────────────────────────
function initPlayerId() {
  try {
    let id = localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      // 간단한 고유 ID 생성
      id =
        "p" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2, 8) +
        "-" +
        Math.random().toString(36).slice(2, 8);
      localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return "p-anon-" + Math.random().toString(36).slice(2, 10);
  }
}

// ─── 플레이어 색상 (ID 해시 기반) ────────────────────────────────────────────
export function playerColor(playerId) {
  let h = 0;
  for (let i = 0; i < playerId.length; i++) {
    h = (h * 31 + playerId.charCodeAt(i)) & 0xffffff;
  }
  const hue = (h % 300) + 20; // 20~320, 초록 계열 약간 피함
  return { hue, css: `hsl(${hue},70%,65%)` };
}

// ─── MultiplayEngine ──────────────────────────────────────────────────────────
export class MultiplayEngine {
  constructor() {
    this.playerId = initPlayerId();

    // 현재 공유 조각 상태
    this._currentSeed = null;     // 현재 있는 공유 조각의 globalSeed
    this._buffer = [];            // 기록 중인 포인트 버퍼
    this._lastRecordAt = 0;       // 마지막 기록 시각

    // 캐시: globalSeed → [{playerId, trail, exitFace, savedAt}]
    this._cache = new Map();
    this._fetchingSeeds = new Set(); // 중복 요청 방지
    this._lastFetchAt = new Map();   // seed → 마지막 fetch 시각

    // 현재 조각에 있는 다른 플레이어의 "실시간" 위치 (최근 2분 이내)
    // {playerId, x, y, hue, t}
    this.nearbyPlayers = [];

    this.RECORD_INTERVAL = 2000;  // ms: 포인트 기록 간격
    this.FETCH_COOLDOWN = 30000;  // ms: 같은 조각 재조회 쿨다운
    this.LIVE_THRESHOLD = 2 * 60 * 1000; // 2분 이내 = "근처"
  }

  // ── 매 프레임 호출: 현재 위치 기록 ──────────────────────────────────────────
  tick(worldX, worldY, globalSeed) {
    if (!globalSeed) {
      // 개인 조각으로 이동 → 이전 흔적 flush
      if (this._currentSeed !== null) {
        this._flush(this._currentSeed);
        this._currentSeed = null;
        this._buffer = [];
        this.nearbyPlayers = [];
      }
      return;
    }

    // 공유 조각 바뀜
    if (globalSeed !== this._currentSeed) {
      if (this._currentSeed !== null) {
        this._flush(this._currentSeed);
      }
      this._currentSeed = globalSeed;
      this._buffer = [];
      this._lastRecordAt = 0;
      this.nearbyPlayers = [];
      // 새 조각의 다른 플레이어 흔적 즉시 조회
      this._fetchAndUpdateNearby(globalSeed, worldX, worldY);
    }

    // 포인트 기록 (2초마다)
    const now = Date.now();
    if (now - this._lastRecordAt >= this.RECORD_INTERVAL) {
      this._buffer.push({ x: Math.round(worldX), y: Math.round(worldY), t: now });
      this._lastRecordAt = now;
      if (this._buffer.length > 80) this._buffer.shift();
    }

    // 30초마다 중간 flush (자동 저장)
    if (this._buffer.length >= 15 &&
        now - (this._buffer[0]?.t || 0) >= 30000) {
      this._flush(globalSeed, false); // exitFace 없이 중간 저장
    }
  }

  // ── 조각을 벗어날 때 호출 ────────────────────────────────────────────────────
  onExit(globalSeed, exitFace) {
    if (globalSeed) this._flush(globalSeed, exitFace);
    this._currentSeed = null;
    this._buffer = [];
    this.nearbyPlayers = [];
  }

  // ── 특정 공유 조각의 흔적 가져오기 (캐시 우선) ───────────────────────────────
  getTrails(globalSeed) {
    return this._cache.get(globalSeed) || [];
  }

  // ── 퍼즐 뷰 열릴 때: 보이는 공유 조각들 일괄 prefetch ────────────────────────
  prefetchSeeds(seeds) {
    seeds.forEach(seed => {
      const last = this._lastFetchAt.get(seed) || 0;
      if (Date.now() - last >= this.FETCH_COOLDOWN) {
        this._fetch(seed);
      }
    });
  }

  // ── 내부: API 조회 ───────────────────────────────────────────────────────────
  async _fetch(seed) {
    if (this._fetchingSeeds.has(seed)) return;
    this._fetchingSeeds.add(seed);
    this._lastFetchAt.set(seed, Date.now());
    try {
      const res = await fetch(`${API_BASE}/trail?seed=${seed}`);
      if (!res.ok) return;
      const data = await res.json();
      // 내 흔적 제외
      const others = data.filter(e => e.playerId !== this.playerId);
      this._cache.set(seed, others);
    } catch {
      // 네트워크 실패 시 조용히 무시
    } finally {
      this._fetchingSeeds.delete(seed);
    }
  }

  // ── 내부: 조회 후 nearbyPlayers 갱신 ─────────────────────────────────────────
  async _fetchAndUpdateNearby(seed, myX, myY) {
    await this._fetch(seed);
    this._updateNearby(seed);
  }

  _updateNearby(seed) {
    const trails = this._cache.get(seed) || [];
    const now = Date.now();
    this.nearbyPlayers = trails
      .filter(e => {
        // 마지막 포인트가 2분 이내인 경우
        const lastT = e.trail[e.trail.length - 1]?.t || 0;
        return now - lastT < this.LIVE_THRESHOLD;
      })
      .map(e => {
        const last = e.trail[e.trail.length - 1];
        const { hue } = playerColor(e.playerId);
        return { playerId: e.playerId, x: last.x, y: last.y, hue, t: last.t };
      });
  }

  // ── 내부: 흔적 서버에 전송 ───────────────────────────────────────────────────
  async _flush(seed, exitFace = null) {
    const trail = [...this._buffer];
    if (trail.length < 2 || !seed) return;
    this._buffer = [];
    try {
      await fetch(`${API_BASE}/trail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          globalSeed: seed,
          playerId: this.playerId,
          trail,
          exitFace,
        }),
      });
    } catch {
      // 조용히 무시
    }
  }
}
