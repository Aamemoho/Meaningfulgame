import { SAVE_KEY, SAVE_VERSION, PARTICLE_COUNT, ZOOM_NORMAL } from "./constants.js";
import { makeParticle, generateStarForPiece, BOARD_STARS } from "./generators.js";

// ─── 직렬화 ───────────────────────────────────────────────────────────────────
export function serializeState(s){
  const placedMapArr=[];
  s.placedMap.forEach((v,k)=>placedMapArr.push([k,{
    themeId:v.themeId, explored:v.explored, gemCount:v.gemCount,
    globalSeed:v.globalSeed??null, // ← 추가
  }]));
  const pieceNodesObj={};
  s.pieceNodes.forEach((nodes,k)=>{
    pieceNodesObj[k]=nodes.map(n=>({
      id:n.id,x:n.x,y:n.y,baseSize:n.baseSize,
      isGem:n.isGem,gemHue:n.gemHue,gemName:n.gemName,gemCollected:n.gemCollected,
      isPiece:n.isPiece,pieceTheme:n.pieceTheme,pieceCollected:n.pieceCollected,
      visited:n.visited,visits:n.visits,brightness:n.brightness,
      pulsePhase:n.pulsePhase,sparkPhase:n.sparkPhase,
      pieceOrbitTimer:n.pieceOrbitTimer||0,gemTimer:n.gemTimer||0,
      hapticPlayed:n.hapticPlayed,rangeReveal:n.rangeReveal,
      satellites:n.satellites.map(sat=>({
        angle:sat.angle,dist:sat.dist,brightness:sat.brightness,size:sat.size,
        pulsePhase:sat.pulsePhase,orbitSpeed:sat.orbitSpeed,
        soundPlayed:sat.soundPlayed,hapticPlayed:sat.hapticPlayed
      })),
    }));
  });
  const pieceStarsDisc={};
  if(s.pieceStars)s.pieceStars.forEach((stars,k)=>{pieceStarsDisc[k]=stars.map(st=>st.discovered);});
  return{
    version:SAVE_VERSION, savedAt:Date.now(),
    sphere:{...s.sphere}, vel:{...s.vel}, targetAngle:s.targetAngle,
    currentPieceKey:s.currentPieceKey,
    placedMap:placedMapArr,
    // globalSeed도 함께 저장 ↓
    inventoryPieces:s.inventoryPieces.map(inv=>({...inv})),
    puzzleFragments:s.puzzleFragments, nodesForNextFrag:s.nodesForNextFrag,
    collectedGems:[...s.collectedGems], pieceNodes:pieceNodesObj,
    pieceStarsDisc, boardStarsDisc:BOARD_STARS.map(st=>st.discovered),
    shardSeed:s.shardSeed, cam:{...s.cam},
  };
}

// ─── 역직렬화 ─────────────────────────────────────────────────────────────────
export function deserializeState(data,s){
  if(!data||data.version!==SAVE_VERSION)return false;
  try{
    s.sphere={...data.sphere}; s.vel={...data.vel};
    s.targetAngle=data.targetAngle??Math.atan2(data.vel.y,data.vel.x);
    s.currentPieceKey=data.currentPieceKey;
    s.puzzleFragments=data.puzzleFragments||0; s.nodesForNextFrag=data.nodesForNextFrag||0;
    s.collectedGems=[...(data.collectedGems||[])];
    // globalSeed 포함하여 복원 ↓
    s.inventoryPieces=(data.inventoryPieces||[]).map(inv=>({...inv, globalSeed:inv.globalSeed??null}));
    s.cam=data.cam?{...data.cam}:{x:data.sphere.lx+data.sphere.col*7200,y:data.sphere.ly+data.sphere.row*7200};
    s.shardSeed=data.shardSeed??Math.floor(Math.random()*0xffffff);
    s.placedMap=new Map();
    (data.placedMap||[]).forEach(([k,v])=>s.placedMap.set(k,{
      themeId:v.themeId, explored:v.explored||0, gemCount:v.gemCount||0,
      globalSeed:v.globalSeed??null, // ← 복원
    }));
    s.pieceNodes=new Map();
    Object.entries(data.pieceNodes||{}).forEach(([k,nodes])=>{
      s.pieceNodes.set(k,nodes.map(n=>({...n,satellites:(n.satellites||[]).map(sat=>({...sat}))})));
    });
    s.pieceParticles=new Map();
    s.placedMap.forEach((v,k)=>{s.pieceParticles.set(k,Array.from({length:PARTICLE_COUNT},()=>makeParticle(v.themeId)));});
    s.pieceStars=new Map();
    s.placedMap.forEach((_,k)=>{
      const stars=generateStarForPiece(k);
      const disc=data.pieceStarsDisc?.[k];
      if(disc)stars.forEach((st,i)=>{if(disc[i]!==undefined)st.discovered=disc[i];});
      s.pieceStars.set(k,stars);
    });
    if(data.boardStarsDisc)data.boardStarsDisc.forEach((d,i)=>{if(BOARD_STARS[i])BOARD_STARS[i].discovered=d;});
    // UI/런타임 상태 초기화
    s.orbit=null; s.orbitPreview=null; s.zoomedOut=false;
    s.zoom=ZOOM_NORMAL; s.zoomTarget=ZOOM_NORMAL;
    s.puzzleView=false; s.puzzleAlpha=0; s.detailView=false; s.detailAlpha=0;
    s.trail=[]; s.time=0; s.pressStart=null; s.pressProgress=0; s.pressWorld=null;
    s.pressScreenStart=null; s.isDragging=false; s.revealMode=false;
    s.prevOrbitActive=false; s.wallFlash=null; s.lastTapTime=0; s.lastTapPos={x:0,y:0};
    s.selectedInventoryId=null; s._nearestGem=null;
    s.shardPattern=null; s.shatterPhase='none'; s.shatterT=0; s.shatterTimer=0;
    s.boardCam={x:0,y:0}; s.boardZoom=1.0;
    s.boardIsDragging=false; s.boardDragLast=null; s.boardDragTotal=0;
    return true;
  }catch(e){console.error("deserialize error",e);return false;}
}

// ─── 영속성 ───────────────────────────────────────────────────────────────────
export async function persistSave(s){
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(serializeState(s)));return true;}
  catch(e){return false;}
}
export async function persistLoad(){
  try{const r=localStorage.getItem(SAVE_KEY);if(!r)return null;return JSON.parse(r);}
  catch(e){return null;}
}
export async function persistDelete(){
  try{localStorage.removeItem(SAVE_KEY);}catch(e){}
}
