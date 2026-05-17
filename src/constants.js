// ─── World constants ──────────────────────────────────────────────────────────
export const PIECE_W = 7200;
export const PIECE_H = 7200;
export const LIGHT_RADIUS = 200;
export const SPHERE_SPEED = 1.8;
export const LONG_PRESS_MS = 550;
export const DOUBLE_TAP_MS = 260;
export const SINGLE_TAP_DELAY = 290;
export const DRAG_THRESHOLD = 12;
export const STEER_STRENGTH = 0.032;
export const ZOOM_NORMAL = 1.0;
export const ZOOM_OUT = 0.12;
export const PARTICLE_COUNT = 180;
export const NODES_PER_PIECE = 100;
export const GEM_CHANCE = 0.09;
export const PIECE_NODE_CHANCE = 0.03;
export const ORBIT_COLLECT_MS = 3800;
export const MAX_GEM_FRAGS = 14;
export const NODES_PER_PUZZLE_FRAG = 10;
export const SAVE_KEY = "sphere-v9-save";
export const SAVE_VERSION = 4; // 멀티플레이 도입으로 버전 올림

// ─── 멀티플레이 / 공유 조각 ───────────────────────────────────────────────────
// 새로 수집되는 조각의 25%가 전 플레이어 공유 조각
export const SHARED_PIECE_CHANCE = 0.25;
// 공유 씨앗 풀 크기: 1~SHARED_POOL_SIZE 사이의 정수
// 이 안에서 globalSeed가 배정됨 → 같은 번호 = 같은 공유 조각
export const SHARED_POOL_SIZE = 200;

// ─── 보석 ─────────────────────────────────────────────────────────────────────
export const GEM_HUES  = [0,22,42,165,185,260,295,325];
export const GEM_NAMES = ["루비","앰버","토파즈","에메랄드","아쿠아","사파이어","자수정","로즈쿼츠"];

// ─── 테마 ─────────────────────────────────────────────────────────────────────
export const THEMES = [
  {id:0, name:"암흑",  bg:[4,4,12],    nodeHue:220, partHue:220, boardColor:"rgba(120,100,255,0.8)"},
  {id:1, name:"황혼",  bg:[10,5,2],    nodeHue:28,  partHue:30,  boardColor:"rgba(255,140,60,0.8)"},
  {id:2, name:"심해",  bg:[2,8,14],    nodeHue:185, partHue:190, boardColor:"rgba(60,200,220,0.8)"},
  {id:3, name:"새벽",  bg:[8,4,14],    nodeHue:295, partHue:290, boardColor:"rgba(200,100,255,0.8)"},
  {id:4, name:"황금",  bg:[10,8,2],    nodeHue:48,  partHue:45,  boardColor:"rgba(255,210,60,0.8)"},
];

// ─── 항성 ─────────────────────────────────────────────────────────────────────
export const STAR_AMBIENT = 0.12;
export const STAR_LIGHT_RADIUS = 900;

// ─── 유틸 ─────────────────────────────────────────────────────────────────────
export const pk = (col,row) => `${col},${row}`;
export const DIRS = [
  {dc:1, dr:0, wall:"right",  entry:"left",   ax:"x", sign:1},
  {dc:-1,dr:0, wall:"left",   entry:"right",  ax:"x", sign:-1},
  {dc:0, dr:1, wall:"bottom", entry:"top",    ax:"y", sign:1},
  {dc:0, dr:-1,wall:"top",    entry:"bottom", ax:"y", sign:-1},
];
export const rand = (a,b) => a + Math.random()*(b-a);
