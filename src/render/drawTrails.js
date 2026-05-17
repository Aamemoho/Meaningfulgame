// ─── render/drawTrails.js ─────────────────────────────────────────────────────
// 다른 플레이어의 흔적을 게임 세계와 퍼즐 판 위에 그린다

import { playerColor } from "../multiplay.js";
import { PIECE_W, PIECE_H } from "../constants.js";

// ─── 게임 뷰: 현재 공유 조각 위의 흔적 선 ────────────────────────────────────
// wx, wy: 월드→스크린 변환 함수
export function drawWorldTrails(ctx, trails, pieceCol, pieceRow, wx, wy, time) {
  if (!trails || trails.length === 0) return;

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  trails.forEach(entry => {
    if (!entry.trail || entry.trail.length < 2) return;
    const { hue } = playerColor(entry.playerId);

    // 흔적 전체 나이 (0=오늘, 1=30일)
    const lastT = entry.trail[entry.trail.length - 1]?.t || now;
    const ageRatio = Math.min(1, (now - lastT) / (ONE_DAY * 30));
    const baseAlpha = 0.08 + (1 - ageRatio) * 0.32; // 오래될수록 희미

    ctx.save();

    // ── 별자리 선 ──────────────────────────────────────────────────────────
    const pts = entry.trail.map(p => ({
      sx: wx(pieceCol * PIECE_W + p.x),
      sy: wy(pieceRow * PIECE_H + p.y),
      t: p.t,
    }));

    // 점선 패턴 (플레이어마다 달리)
    const hash = entry.playerId.charCodeAt(1) || 1;
    const dashLen = 4 + (hash % 5);   // 4~8
    const gapLen = 3 + (hash % 4);    // 3~6

    for (let i = 1; i < pts.length; i++) {
      const segAge = Math.min(1, (now - pts[i].t) / (ONE_DAY * 30));
      const segAlpha = baseAlpha * (1 - segAge * 0.5);

      ctx.beginPath();
      ctx.setLineDash([dashLen, gapLen]);
      ctx.lineDashOffset = time * 0.3 + i * 2; // 천천히 흐르는 효과
      ctx.moveTo(pts[i - 1].sx, pts[i - 1].sy);
      ctx.lineTo(pts[i].sx, pts[i].sy);
      ctx.strokeStyle = `hsla(${hue},60%,70%,${segAlpha})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    ctx.setLineDash([]);

    // ── 포인트 점 ──────────────────────────────────────────────────────────
    pts.forEach((p, i) => {
      const isLast = i === pts.length - 1;
      const dotAlpha = baseAlpha * (isLast ? 1.8 : 0.7);
      const r = isLast ? 2.8 : 1.6;

      ctx.beginPath();
      ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue},65%,72%,${Math.min(1, dotAlpha)})`;
      ctx.fill();
    });

    // ── 마지막 포인트 타임스탬프 (상대 시간) ──────────────────────────────
    const lastPt = pts[pts.length - 1];
    const elapsed = now - lastT;
    const label = formatElapsed(elapsed);
    ctx.font = "8px 'Courier New', monospace";
    ctx.fillStyle = `hsla(${hue},50%,75%,${Math.min(0.6, baseAlpha * 2)})`;
    ctx.fillText(label, lastPt.sx + 5, lastPt.sy - 4);

    ctx.restore();
  });
}

// ─── 게임 뷰: 실시간 근처 플레이어 빛 번짐 ───────────────────────────────────
// nearbyPlayers: [{playerId, x, y, hue, t}] (2분 이내 활동)
export function drawNearbyGlows(ctx, nearbyPlayers, pieceCol, pieceRow, wx, wy, time) {
  if (!nearbyPlayers || nearbyPlayers.length === 0) return;

  const now = Date.now();
  nearbyPlayers.forEach(p => {
    const sx = wx(pieceCol * PIECE_W + p.x);
    const sy = wy(pieceRow * PIECE_H + p.y);
    const age = (now - p.t) / (2 * 60 * 1000); // 0~1 (2분)
    const pulse = 0.4 + Math.sin(time * 1.2 + p.hue) * 0.2;
    const alpha = (1 - age) * 0.35 * pulse;

    // 형태 없는 빛 번짐 (신호처럼)
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, 28);
    grd.addColorStop(0, `hsla(${p.hue},70%,75%,${alpha})`);
    grd.addColorStop(0.5, `hsla(${p.hue},60%,65%,${alpha * 0.4})`);
    grd.addColorStop(1, `hsla(${p.hue},50%,60%,0)`);

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, 28, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.restore();
  });
}

// ─── 퍼즐 판: 공유 조각 위에 미니 흔적 오버레이 ──────────────────────────────
// sx, sy: 화면상 조각 중심, pSize: 조각 픽셀 크기
export function drawPuzzleTrailOverlay(ctx, trails, sx, sy, pSize, time) {
  if (!trails || trails.length === 0) return;

  const now = Date.now();
  const scale = pSize / PIECE_W;
  const scale2 = pSize / PIECE_H;

  ctx.save();
  ctx.beginPath();
  ctx.rect(sx - pSize / 2, sy - pSize / 2, pSize, pSize);
  ctx.clip(); // 조각 범위 밖으로 삐져나오지 않게

  trails.forEach(entry => {
    if (!entry.trail || entry.trail.length < 2) return;
    const { hue } = playerColor(entry.playerId);
    const lastT = entry.trail[entry.trail.length - 1]?.t || now;
    const ageRatio = Math.min(1, (now - lastT) / (24 * 60 * 60 * 1000 * 30));
    const alpha = 0.12 + (1 - ageRatio) * 0.45;

    const toSX = x => sx - pSize / 2 + x * scale;
    const toSY = y => sy - pSize / 2 + y * scale2;

    // 선
    ctx.beginPath();
    ctx.setLineDash([2, 3]);
    ctx.lineDashOffset = time * 0.15;
    entry.trail.forEach((p, i) => {
      const px = toSX(p.x), py = toSY(p.y);
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.strokeStyle = `hsla(${hue},60%,70%,${alpha * 0.8})`;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.setLineDash([]);

    // 시작점 · 끝점
    const first = entry.trail[0], last = entry.trail[entry.trail.length - 1];
    [[first, 0.6], [last, 1.0]].forEach(([p, mult]) => {
      ctx.beginPath();
      ctx.arc(toSX(p.x), toSY(p.y), 1.4, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue},65%,72%,${alpha * mult})`;
      ctx.fill();
    });
  });

  ctx.restore();
}

// ─── 공유 조각 배지 (퍼즐 판에서 공유 조각임을 표시) ─────────────────────────
export function drawSharedBadge(ctx, sx, sy, pSize, hasTrails, time) {
  const r = pSize * 0.12;
  const bx = sx + pSize * 0.38, by = sy - pSize * 0.38;
  const pulse = 0.7 + Math.sin(time * 1.5) * 0.3;

  ctx.save();
  // 원형 배지
  const grd = ctx.createRadialGradient(bx, by, 0, bx, by, r);
  if (hasTrails) {
    grd.addColorStop(0, `rgba(120,200,255,${0.9 * pulse})`);
    grd.addColorStop(1, `rgba(80,150,220,0)`);
  } else {
    grd.addColorStop(0, `rgba(180,180,220,${0.4 * pulse})`);
    grd.addColorStop(1, `rgba(100,100,180,0)`);
  }
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();

  // 작은 심볼 (두 점이 연결된 모양)
  if (hasTrails) {
    ctx.strokeStyle = `rgba(200,230,255,${0.8 * pulse})`;
    ctx.lineWidth = 0.8;
    ctx.setLineDash([1.5, 1.5]);
    ctx.beginPath();
    ctx.moveTo(bx - r * 0.5, by);
    ctx.lineTo(bx + r * 0.5, by);
    ctx.stroke();
    ctx.setLineDash([]);
    [bx - r * 0.5, bx + r * 0.5].forEach(px => {
      ctx.beginPath();
      ctx.arc(px, by, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200,230,255,${0.9 * pulse})`;
      ctx.fill();
    });
  }
  ctx.restore();
}

// ─── 유틸: 경과 시간 텍스트 ──────────────────────────────────────────────────
function formatElapsed(ms) {
  if (ms < 60000) return "방금";
  if (ms < 3600000) return `${Math.floor(ms / 60000)}분 전`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}시간 전`;
  return `${Math.floor(ms / 86400000)}일 전`;
}
