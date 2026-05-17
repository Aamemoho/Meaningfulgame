import {
  PIECE_W, PIECE_H, PARTICLE_COUNT, NODES_PER_PIECE,
  GEM_CHANCE, PIECE_NODE_CHANCE, GEM_HUES, GEM_NAMES,
  THEMES, STAR_AMBIENT, rand,
  SHARED_PIECE_CHANCE, SHARED_POOL_SIZE, // ← 추가
} from "./constants.js";

// ─── 노드 생성 ────────────────────────────────────────────────────────────────
export function generatePieceNodes(themeId){
  return Array.from({length:NODES_PER_PIECE},(_,i)=>{
    const roll=Math.random();
    const isPiece=roll<PIECE_NODE_CHANCE;
    const isGem=!isPiece&&roll<PIECE_NODE_CHANCE+GEM_CHANCE;
    const gemIdx=Math.floor(Math.random()*GEM_HUES.length);
    const pieceTheme=Math.floor(Math.random()*THEMES.length);
    return{
      id:`${themeId}-${i}-${Math.random().toString(36).slice(2,6)}`,
      x:rand(180,PIECE_W-180), y:rand(180,PIECE_H-180),
      baseSize:isPiece?rand(7,12):isGem?rand(5,9):rand(2.5,5.5),
      visits:0, brightness:0, pulsePhase:Math.random()*Math.PI*2,
      satellites:[], rangeReveal:0, hapticPlayed:false, visited:false,
      sparkPhase:Math.random()*Math.PI*2,
      isGem, gemHue:isGem?GEM_HUES[gemIdx]:null, gemName:isGem?GEM_NAMES[gemIdx]:null,
      gemCollected:false,
      isPiece, pieceTheme, pieceCollected:false,
      pieceOrbitTimer:0,
    };
  });
}

export function makeParticle(themeId){
  const layer=Math.random(), r=layer<0.6?rand(1.2,2.8):layer<0.9?rand(2.5,5):rand(5,9);
  const h=THEMES[themeId].partHue;
  return{
    x:rand(0,PIECE_W), y:rand(0,PIECE_H), r, blurR:r*rand(2.5,4),
    vx:rand(-0.06,0.06), vy:rand(0.04,0.28), drift:rand(-0.015,0.015),
    hue:h+rand(-20,20), sat:rand(8,25), lightness:rand(50,72),
    opacity:rand(0.06,0.18), wobble:rand(0,Math.PI*2), wobbleSpeed:rand(0.005,0.025),
    isSmall:r<3
  };
}

export function spawnSat(node){
  return{
    angle:Math.random()*Math.PI*2, dist:rand(20,38), brightness:0,
    size:node.baseSize*rand(0.3,0.55), pulsePhase:Math.random()*Math.PI*2,
    orbitSpeed:rand(0.003,0.008)*(Math.random()>.5?1:-1),
    soundPlayed:false, hapticPlayed:false
  };
}

// ─── 인벤토리 조각 생성 ───────────────────────────────────────────────────────
// globalSeed: null → 개인 조각 / 1~SHARED_POOL_SIZE → 공유 조각
export function makeInventoryPiece(themeId, idx){
  // 25% 확률로 공유 씨앗 배정
  const isShared = Math.random() < SHARED_PIECE_CHANCE;
  const globalSeed = isShared
    ? Math.floor(Math.random() * SHARED_POOL_SIZE) + 1 // 1~200
    : null;

  return{
    id:`inv-${idx}-${Math.random().toString(36).slice(2,6)}`, themeId,
    globalSeed,   // ← 추가: null=개인, 숫자=공유
    scatterAngle:(idx/8)*Math.PI*2+rand(-0.3,0.3),
    scatterDist:rand(0.72,0.92),
    rotation:rand(-0.25,0.25),
  };
}

// ─── 시드 기반 난수 ───────────────────────────────────────────────────────────
export function seededRng(seed){
  let s=seed|0;
  return()=>{s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);s^=s>>>16;return(s>>>0)/0xffffffff;};
}

function pieceKeySeed(key){
  let h=2166136261;
  for(let i=0;i<key.length;i++){h^=key.charCodeAt(i);h=Math.imul(h,16777619);}
  return h>>>0;
}

// ─── 조각별 항성 생성 ─────────────────────────────────────────────────────────
export function generateStarForPiece(pieceKey){
  const rng=seededRng(pieceKeySeed(pieceKey));
  const rs=(a,b)=>a+rng()*(b-a);
  const count=rng()<0.28?2:1;
  return Array.from({length:count},(_,i)=>({
    id:`star-${pieceKey}-${i}`,
    x:rs(1200,PIECE_W-1200), y:rs(1200,PIECE_H-1200),
    hue:rs(40,65), phase:rng()*Math.PI*2, size:rs(13,19),
    brightness:STAR_AMBIENT, discovered:false,
  }));
}

// ─── 퍼즐 판 항성 타입 ────────────────────────────────────────────────────────
export const BOARD_STAR_TYPES=[
  {name:"차가운", h0:198, h1:218, rayN:6, raySpd:0.30, rayLen:3.8, rayW:0.14, pulseSpd:1.9, glowMult:1.3, glowAlpha:0.52, coreAlpha:0.95},
  {name:"따뜻한", h0:30,  h1:50,  rayN:4, raySpd:0.10, rayLen:2.8, rayW:0.18, pulseSpd:0.85, glowMult:2.0, glowAlpha:0.45, coreAlpha:0.90},
  {name:"깊은",   h0:258, h1:278, rayN:4, raySpd:0.06, rayLen:2.2, rayW:0.22, pulseSpd:0.55, glowMult:2.8, glowAlpha:0.38, coreAlpha:0.85},
  {name:"가벼운", h0:55,  h1:75,  rayN:8, raySpd:0.40, rayLen:4.5, rayW:0.10, pulseSpd:2.6, glowMult:1.1, glowAlpha:0.48, coreAlpha:0.88},
  {name:"강렬한", h0:8,   h1:25,  rayN:6, raySpd:0.20, rayLen:4.2, rayW:0.16, pulseSpd:1.4, glowMult:1.7, glowAlpha:0.60, coreAlpha:0.98},
];

export function generateBoardStars(){
  const rng=seededRng(0xB0A2D5F1);
  const rs=(a,b)=>a+rng()*(b-a);
  const PIECE_COORDS=[
    {c:2,r:-2},{c:-2,r:2},{c:2,r:2},{c:-2,r:-2},
    {c:4,r:-1},{c:-4,r:1},{c:1,r:4},{c:-1,r:-4},{c:4,r:3},{c:-4,r:-3},
    {c:6,r:-2},{c:-6,r:2},{c:2,r:6},{c:-2,r:-6},{c:5,r:5},{c:-5,r:-5},
  ];
  return PIECE_COORDS.map(({c,r},i)=>({
    id:`bs-${i}`,
    col:c+rs(0.18,0.82), row:r+rs(0.18,0.82),
    typeIdx:Math.floor(rng()*BOARD_STAR_TYPES.length),
    size:rs(9,17), phase:rng()*Math.PI*2, discovered:false,
  }));
}

export const BOARD_STARS = generateBoardStars();

// ─── 균열 패턴 ────────────────────────────────────────────────────────────────
export function generateShatterPattern(seed){
  const rng=seededRng(seed);
  const shards=[];
  const numCracks=Math.floor(rng()*6)+5;
  const angles=[];
  for(let i=0;i<numCracks;i++) angles.push(rng()*Math.PI*2);
  angles.sort((a,b)=>a-b);
  for(let i=0;i<angles.length;i++){
    const a1=angles[i], a2=angles[(i+1)%angles.length];
    const span=((a2-a1)+Math.PI*2)%(Math.PI*2);
    if(span>0.38&&rng()<0.68){
      const splitR=0.28+rng()*0.40;
      shards.push(_buildWedge(a1,a2,0,splitR,rng));
      shards.push(_buildWedge(a1,a2,splitR,0.97,rng));
    }else{
      shards.push(_buildWedge(a1,a2,0,0.97,rng));
    }
  }
  return shards;
}

function _buildWedge(a1,a2,r1,r2,rng){
  const pts=[];
  const span=((a2-a1)+Math.PI*2)%(Math.PI*2);
  const steps=Math.max(3,Math.ceil(span/(Math.PI/5)));
  if(r1<0.01){pts.push([0,0]);}
  else{for(let i=0;i<=steps;i++){const a=a1+span*i/steps;pts.push([Math.cos(a)*r1,Math.sin(a)*r1]);}}
  for(let i=steps;i>=0;i--){
    const a=a1+span*i/steps,rv=r2*(1+(rng()-0.5)*0.035);
    pts.push([Math.cos(a)*rv,Math.sin(a)*rv]);
  }
  return pts;
}
