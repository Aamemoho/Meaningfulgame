import { useState, useEffect, useRef, useCallback } from "react";

// ─── 모듈 imports ─────────────────────────────────────────────────────────────
import {
  PIECE_W, PIECE_H, LIGHT_RADIUS, SPHERE_SPEED,
  LONG_PRESS_MS, DOUBLE_TAP_MS, SINGLE_TAP_DELAY, DRAG_THRESHOLD,
  STEER_STRENGTH, ZOOM_NORMAL, ZOOM_OUT,
  PARTICLE_COUNT, NODES_PER_PIECE, ORBIT_COLLECT_MS,
  MAX_GEM_FRAGS, NODES_PER_PUZZLE_FRAG,
  THEMES, STAR_LIGHT_RADIUS, STAR_AMBIENT,
  pk, DIRS, rand,
} from "./constants.js";
import {
  generatePieceNodes, makeParticle, spawnSat, makeInventoryPiece,
  generateStarForPiece, generateShatterPattern, BOARD_STARS,
} from "./generators.js";
import { persistSave, persistLoad, persistDelete, deserializeState } from "./save.js";
import { AudioEngine, HapticEngine } from "./audio.js";
import { drawGem } from "./render/drawGem.js";
import { drawSphereDetail } from "./render/drawSphere.js";
import { drawPuzzleBoard } from "./render/drawPuzzle.js";
// ── 멀티플레이 추가 ──────────────────────────────────────────────────────────
import { MultiplayEngine } from "./multiplay.js";
import { drawWorldTrails, drawNearbyGlows, drawPuzzleTrailOverlay, drawSharedBadge } from "./render/drawTrails.js";

// ─── 토스트 컴포넌트 ──────────────────────────────────────────────────────────
function PieceToast({themeName}){
  const [visible,setVisible]=useState(true);
  useEffect(()=>{const t=setTimeout(()=>setVisible(false),2400);return()=>clearTimeout(t);},[]);
  if(!visible)return null;
  const theme=THEMES.find(t=>t.name===themeName);
  return(
    <div style={{position:"absolute",top:"42%",left:"50%",transform:"translate(-50%,-50%)",
      pointerEvents:"none",animation:"fadeUpOut 2.4s ease forwards",
      color:theme?.boardColor||"rgba(255,210,80,0.95)",fontFamily:"'Courier New',monospace",
      fontSize:"13px",letterSpacing:"0.12em",
      textShadow:`0 0 18px ${theme?.boardColor||"rgba(255,180,50,0.5)"}`,
      whiteSpace:"nowrap",textAlign:"center"}}>
      ✦ {themeName} 조각
    </div>
  );
}

// ─── 초기 상태 헬퍼 ───────────────────────────────────────────────────────────
const mkPlaced = () => { const m=new Map(); m.set("0,0",{themeId:0,explored:0,gemCount:0,globalSeed:null}); return m; };
const mkNodes  = () => { const m=new Map(); m.set("0,0",generatePieceNodes(0)); return m; };
const mkParts  = () => { const m=new Map(); m.set("0,0",Array.from({length:PARTICLE_COUNT},()=>makeParticle(0))); return m; };
const mkStars  = () => { const m=new Map(); m.set("0,0",generateStarForPiece("0,0")); return m; };

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export default function SphereV9(){
  const canvasRef    = useRef(null);
  const audio        = useRef(new AudioEngine());
  const haptic       = useRef(new HapticEngine());
  const multiplay    = useRef(new MultiplayEngine()); // ── 멀티플레이 엔진
  const pendingTapRef= useRef(null);
  const animRef      = useRef(null);
  const pressTimerRef= useRef(null);
  const pinchRef     = useRef(null);
  const saveTimerRef = useRef(null);

  const stateRef=useRef({
    sphere:{col:0,row:0,lx:PIECE_W/2,ly:PIECE_H/2},
    vel:{x:SPHERE_SPEED,y:SPHERE_SPEED*0.2},
    targetAngle:Math.atan2(0.2,1),
    trail:[],
    placedMap:mkPlaced(), pieceNodes:mkNodes(),
    pieceParticles:mkParts(), pieceStars:mkStars(),
    currentPieceKey:"0,0",
    prevPieceKey:"0,0",          // ── 조각 전환 감지용
    otherTrails:new Map(),        // ── 다른 플레이어 흔적 캐시 (pieceKey → trails)
    inventoryPieces:[], selectedInventoryId:null,
    puzzleFragments:0, nodesForNextFrag:0,
    cam:{x:PIECE_W/2,y:PIECE_H/2},
    zoom:ZOOM_NORMAL, zoomTarget:ZOOM_NORMAL,
    zoomedOut:false, orbitPreview:null,
    puzzleView:false, puzzleAlpha:0,
    detailView:false, detailAlpha:0,
    collectedGems:[], orbit:null, wallFlash:null,
    shardSeed:Math.floor(Math.random()*0xffffff),
    shardPattern:null, shatterPhase:'none', shatterT:0, shatterTimer:0,
    time:0, lastTapTime:0, lastTapPos:{x:0,y:0},
    pressStart:null, pressProgress:0, pressWorld:null,
    pressScreenStart:null, isDragging:false, revealMode:false,
    prevOrbitActive:false, _nearestGem:null,
    boardCam:{x:0,y:0}, boardZoom:1.0,
    boardIsDragging:false, boardDragLast:null, boardDragTotal:0,
  });

  const [muted,setMuted]=useState(false);
  const [hapticOn,setHapticOn]=useState(true);
  const [hapticSupported]=useState(()=>"vibrate"in navigator);
  const [toasts,setToasts]=useState([]);
  const [saveStatus,setSaveStatus]=useState(null);
  const [confirmNewGame,setConfirmNewGame]=useState(false);
  const [stats,setStats]=useState({
    col:0,row:0,orbiting:false,fragments:0,gems:0,
    puzzleView:false,themeName:"암흑",nodesLeft:NODES_PER_PUZZLE_FRAG
  });

  // ── 저장 트리거 ─────────────────────────────────────────────────────────────
  const triggerSave=useCallback(async(s)=>{
    setSaveStatus("saving");
    const ok=await persistSave(s);
    setSaveStatus(ok?"saved":"error");
    haptic.current.save();
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>setSaveStatus(null),2200);
  },[]);
  const triggerSaveRef=useRef(triggerSave);
  triggerSaveRef.current=triggerSave;

  useEffect(()=>{audio.current.setMuted(muted);},[muted]);
  useEffect(()=>{haptic.current.setMuted(!hapticOn);},[hapticOn]);
  useEffect(()=>()=>audio.current.destroy(),[]);

  // ── 저장 불러오기 ────────────────────────────────────────────────────────────
  useEffect(()=>{
    persistLoad().then(data=>{
      if(data&&deserializeState(data,stateRef.current)){
        setSaveStatus("loaded");
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current=setTimeout(()=>setSaveStatus(null),2500);
        const s=stateRef.current;
        const themeId=s.placedMap.get(s.currentPieceKey)?.themeId||0;
        setStats({col:s.sphere.col,row:s.sphere.row,orbiting:false,fragments:s.puzzleFragments,
          gems:s.collectedGems.length,puzzleView:false,themeName:THEMES[themeId].name,
          nodesLeft:Math.max(0,NODES_PER_PUZZLE_FRAG-s.nodesForNextFrag)});
      }
    });
    return()=>clearTimeout(saveTimerRef.current);
  },[]);

  // ── 새 게임 ─────────────────────────────────────────────────────────────────
  const handleNewGame=useCallback(async()=>{
    await persistDelete();
    BOARD_STARS.forEach(st=>{st.discovered=false;});
    const s=stateRef.current;
    Object.assign(s,{
      sphere:{col:0,row:0,lx:PIECE_W/2,ly:PIECE_H/2},
      vel:{x:SPHERE_SPEED,y:SPHERE_SPEED*0.2},
      targetAngle:Math.atan2(0.2,1), trail:[],
      placedMap:mkPlaced(), pieceNodes:mkNodes(), pieceParticles:mkParts(), pieceStars:mkStars(),
      currentPieceKey:"0,0", prevPieceKey:"0,0", otherTrails:new Map(),
      inventoryPieces:[], selectedInventoryId:null,
      puzzleFragments:0, nodesForNextFrag:0,
      cam:{x:PIECE_W/2,y:PIECE_H/2}, zoom:ZOOM_NORMAL, zoomTarget:ZOOM_NORMAL,
      zoomedOut:false, orbitPreview:null, puzzleView:false, puzzleAlpha:0,
      detailView:false, detailAlpha:0, collectedGems:[], orbit:null, wallFlash:null,
      time:0, lastTapTime:0, lastTapPos:{x:0,y:0},
      pressStart:null, pressProgress:0, prevOrbitActive:false, _nearestGem:null,
      shardSeed:Math.floor(Math.random()*0xffffff), shardPattern:null,
      shatterPhase:'none', shatterT:0, shatterTimer:0,
      boardCam:{x:0,y:0}, boardZoom:1.0,
      boardIsDragging:false, boardDragLast:null, boardDragTotal:0,
    });
    setConfirmNewGame(false); setSaveStatus("new");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current=setTimeout(()=>setSaveStatus(null),1800);
    setStats({col:0,row:0,orbiting:false,fragments:0,gems:0,puzzleView:false,themeName:"암흑",nodesLeft:NODES_PER_PUZZLE_FRAG});
    setToasts([]);
  },[]);

  // ── 캔버스 초기화 ────────────────────────────────────────────────────────────
  const initCanvas=useCallback(()=>{
    const c=canvasRef.current;if(!c)return;
    c.width=c.offsetWidth||window.innerWidth||360;
    c.height=c.offsetHeight||window.innerHeight||640;
  },[]);
  useEffect(()=>{
    initCanvas(); requestAnimationFrame(initCanvas);
    window.addEventListener("resize",initCanvas);
    return()=>window.removeEventListener("resize",initCanvas);
  },[initCanvas]);

  const sphereWorldX=(s)=>s.sphere.col*PIECE_W+s.sphere.lx;
  const sphereWorldY=(s)=>s.sphere.row*PIECE_H+s.sphere.ly;

  const toWorld=useCallback((cx,cy)=>{
    const s=stateRef.current,c=canvasRef.current;if(!c)return{x:0,y:0};
    const rect=c.getBoundingClientRect();
    return{x:(cx-rect.left-c.width/2)/s.zoom+s.cam.x,y:(cy-rect.top-c.height/2)/s.zoom+s.cam.y};
  },[]);

  // ── 퍼즐 판 탭 처리 ──────────────────────────────────────────────────────────
  const handleBoardTap=useCallback((cx,cy,cw,ch)=>{
    const s=stateRef.current;
    const {placedMap,inventoryPieces,selectedInventoryId,puzzleFragments}=s;
    let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
    placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);minC=Math.min(minC,c);maxC=Math.max(maxC,c);minR=Math.min(minR,r);maxR=Math.max(maxR,r);});
    const gridW=maxC-minC+1,gridH=maxR-minR+1;
    const boardAreaH=ch*0.62;
    const pieceSize=Math.min(Math.min(cw*0.82/Math.max(gridW+2,3),boardAreaH/Math.max(gridH+2,3)),120);
    const gap=pieceSize*0.12,stride=pieceSize+gap;
    const bz=s.boardZoom||1.0,psSc=pieceSize*bz;
    const boardCX=cw/2,boardCY=ch*0.36;
    const bcx=s.boardCam?.x||0,bcy=s.boardCam?.y||0;
    const toSX=(col)=>boardCX+(col-minC-(gridW-1)/2)*stride*bz+bcx;
    const toSY=(row)=>boardCY+(row-minR-(gridH-1)/2)*stride*bz+bcy;
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=cx-rect.left,sy=cy-rect.top;
    const scatterR=Math.min(cw,ch)*0.42,invCX=cw/2,invCY=ch/2;
    let tappedInvId=null;
    inventoryPieces.forEach(inv=>{
      const ix=invCX+Math.cos(inv.scatterAngle)*scatterR*inv.scatterDist+bcx;
      const iy=invCY+Math.sin(inv.scatterAngle)*scatterR*inv.scatterDist+bcy;
      const ps=psSc*(inv.id===selectedInventoryId?0.62:0.52);
      if(Math.abs(sx-ix)<ps*0.6&&Math.abs(sy-iy)<ps*0.6)tappedInvId=inv.id;
    });
    if(tappedInvId){s.selectedInventoryId=tappedInvId===selectedInventoryId?null:tappedInvId;return;}
    if(selectedInventoryId&&puzzleFragments>0){
      const validSlots=new Set();
      placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(!placedMap.has(nk))validSlots.add(nk);});});
      validSlots.forEach(k=>{
        const [c,r]=k.split(",").map(Number);
        if(Math.abs(sx-toSX(c))<psSc*0.55&&Math.abs(sy-toSY(r))<psSc*0.55){
          const inv=inventoryPieces.find(i=>i.id===selectedInventoryId);if(!inv)return;
          // ── globalSeed 포함하여 placedMap에 저장 ──────────────────────────
          placedMap.set(k,{themeId:inv.themeId,explored:0,gemCount:0,globalSeed:inv.globalSeed??null});
          s.pieceNodes.set(k,generatePieceNodes(inv.themeId));
          s.pieceParticles.set(k,Array.from({length:PARTICLE_COUNT},()=>makeParticle(inv.themeId)));
          s.pieceStars.set(k,generateStarForPiece(k));
          s.inventoryPieces=inventoryPieces.filter(i=>i.id!==selectedInventoryId);
          s.puzzleFragments=puzzleFragments-1; s.selectedInventoryId=null;
          // ── 공유 조각이면 즉시 흔적 prefetch ─────────────────────────────
          if(inv.globalSeed){
            multiplay.current._fetch(inv.globalSeed).then(()=>{
              const trails=multiplay.current.getTrails(inv.globalSeed);
              if(trails.length>0)s.otherTrails.set(k,trails);
            });
          }
          audio.current.piecePlace(); haptic.current.puzzlePiecePlace();
          triggerSaveRef.current(s);
        }
      });
    }
  },[]);

  // ── 인풋 이벤트 ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const au=audio.current,hp=haptic.current;
    const ensure=()=>{if(!au.ready)au.init();};
    const clearPending=()=>{if(pendingTapRef.current){clearTimeout(pendingTapRef.current.timer);pendingTapRef.current=null;}};

    const isSphereHit=(cx,cy)=>{
      const s=stateRef.current,c=canvasRef.current;if(!c)return false;
      const rect=c.getBoundingClientRect();
      const swx=sphereWorldX(s),swy=sphereWorldY(s);
      const scx=(swx-s.cam.x)*s.zoom+c.width/2,scy=(swy-s.cam.y)*s.zoom+c.height/2;
      return Math.hypot(cx-rect.left-scx,cy-rect.top-scy)<Math.max(30,14*s.zoom);
    };

    const fireSingleTap=(cx,cy)=>{
      const s=stateRef.current,c=canvasRef.current;if(!c)return;
      if(s.puzzleView){handleBoardTap(cx,cy,c.width,c.height);return;}
      if(s.detailView){s.detailView=false;return;}
      if(s.zoomedOut){s.zoomedOut=false;s.zoomTarget=ZOOM_NORMAL;s.orbitPreview=null;hp.zoomIn();if(au.ready)au.zoomIn();return;}
      if(isSphereHit(cx,cy)){s.detailView=true;if(au.ready)au.zoomIn();return;}
      if(s.orbit){s.orbit=null;hp.orbitRelease();return;}
      const wp=toWorld(cx,cy);
      const dx=wp.x-sphereWorldX(s),dy=wp.y-sphereWorldY(s);
      if(Math.hypot(dx,dy)<5)return;
      s.targetAngle=Math.atan2(dy,dx);hp.steer();
    };

    const fireDoubleTap=()=>{
      const s=stateRef.current;
      if(s.puzzleView){s.puzzleView=false;s.zoomTarget=ZOOM_NORMAL;hp.zoomIn();if(au.ready)au.zoomIn();return;}
      if(s.detailView){s.detailView=false;return;}
      if(!s.zoomedOut){s.zoomedOut=true;s.zoomTarget=ZOOM_OUT;hp.zoomOut();if(au.ready)au.zoomOut();}
      else{s.zoomedOut=false;s.zoomTarget=ZOOM_NORMAL;s.orbitPreview=null;hp.zoomIn();if(au.ready)au.zoomIn();}
    };

    const handlePointerEnd=(cx,cy)=>{
      const s=stateRef.current;
      clearTimeout(pressTimerRef.current);
      const wasBoardDragging=s.boardIsDragging;
      s.boardIsDragging=false;s.boardDragLast=null;s.boardDragTotal=0;
      const wasReveal=s.revealMode,wasDragging=s.isDragging;
      s.isDragging=false;s.pressStart=null;s.pressProgress=0;s.revealMode=false;s.pressScreenStart=null;
      if(au.ready)au.releasePressCharge(false);
      if(wasBoardDragging)return;
      if(wasDragging&&s.zoomedOut&&s.orbitPreview){
        const wp=toWorld(cx,cy);
        const swx=sphereWorldX(s),swy=sphereWorldY(s);
        const dx=wp.x-swx,dy=wp.y-swy,radius=Math.hypot(dx,dy);
        if(radius>15){
          const startAngle=Math.atan2(swy-wp.y,swx-wp.x);
          const cross=s.vel.x*dy-s.vel.y*dx;
          s.orbit={cx:wp.x,cy:wp.y,radius:Math.max(radius,20),angle:startAngle,
            angularSpeed:(SPHERE_SPEED/Math.max(radius,20))*(cross>=0?1:-1)};
          hp.orbitStart();
        }
        s.zoomedOut=false;s.zoomTarget=ZOOM_NORMAL;s.orbitPreview=null;return;
      }
      if(wasReveal||wasDragging)return;
      const now=performance.now(),wp=toWorld(cx,cy);
      const dt=now-s.lastTapTime,dd=Math.hypot(wp.x-s.lastTapPos.x,wp.y-s.lastTapPos.y);
      s.lastTapTime=now;s.lastTapPos={x:wp.x,y:wp.y};
      if(dt<DOUBLE_TAP_MS&&dd<100&&pendingTapRef.current){clearPending();fireDoubleTap();return;}
      clearPending();
      const sc=cx,sd=cy;
      pendingTapRef.current={timer:setTimeout(()=>{pendingTapRef.current=null;fireSingleTap(sc,sd);},SINGLE_TAP_DELAY)};
    };

    const handlePointerMove=(cx,cy,sX,sY)=>{
      const s=stateRef.current;
      if(s.puzzleView){
        if(s.pressScreenStart&&s.boardDragLast){
          const dx=cx-s.boardDragLast.x,dy=cy-s.boardDragLast.y;
          s.boardCam.x+=dx;s.boardCam.y+=dy;s.boardDragLast={x:cx,y:cy};
          s.boardDragTotal=(s.boardDragTotal||0)+Math.hypot(dx,dy);
          if(s.boardDragTotal>DRAG_THRESHOLD){s.boardIsDragging=true;s.pressStart=null;clearTimeout(pressTimerRef.current);}
        }
        return;
      }
      if(s.pressScreenStart&&!s.isDragging&&!s.revealMode){
        if(Math.hypot(sX-s.pressScreenStart.x,sY-s.pressScreenStart.y)>DRAG_THRESHOLD){
          s.isDragging=true;clearTimeout(pressTimerRef.current);s.pressProgress=0;
          clearPending();if(au.ready)au.releasePressCharge(false);
          if(s.orbit){s.orbit=null;hp.orbitRelease();}
        }
      }
      if(s.isDragging&&!s.orbit&&!s.detailView){
        const dx=cx-s.pressScreenStart.x,dy=cy-s.pressScreenStart.y;
        if(Math.hypot(dx,dy)>8)s.targetAngle=Math.atan2(dy,dx);
      }
      if(s.zoomedOut){
        const wp=toWorld(cx,cy),swx=sphereWorldX(s),swy=sphereWorldY(s);
        const r=Math.hypot(wp.x-swx,wp.y-swy);
        s.orbitPreview=r>15?{wx:wp.x,wy:wp.y,radius:r}:null;
      }
    };

    const startPress=(cx,cy,sX,sY)=>{
      ensure();const s=stateRef.current;const wp=toWorld(cx,cy);
      s.pressStart={wx:wp.x,wy:wp.y,t:performance.now()};
      s.pressWorld={wx:wp.x,wy:wp.y};s.pressScreenStart={x:sX,y:sY};
      s.pressProgress=0;s.revealMode=false;s.isDragging=false;
      s.boardDragLast={x:cx,y:cy};s.boardIsDragging=false;s.boardDragTotal=0;
      pressTimerRef.current=setTimeout(()=>{
        const ss=stateRef.current;
        if(!ss.pressStart||ss.isDragging||ss.puzzleView)return;
        ss.revealMode=true;ss.pressStart=null;ss.pressProgress=0;
        if(au.ready)au.releasePressCharge(true);hp.pressComplete();
      },LONG_PRESS_MS);
    };

    const onMD=e=>startPress(e.clientX,e.clientY,e.clientX,e.clientY);
    const onMU=e=>handlePointerEnd(e.clientX,e.clientY);
    const onMM=e=>handlePointerMove(e.clientX,e.clientY,e.clientX,e.clientY);
    const onWheel=e=>{
      const s=stateRef.current;if(!s.puzzleView)return;
      e.preventDefault();s.boardZoom=Math.max(0.06,Math.min(4.5,s.boardZoom*(e.deltaY>0?0.88:1.14)));
    };
    const onTS=e=>{
      e.preventDefault();
      if(e.touches.length===2&&stateRef.current.puzzleView){
        clearTimeout(pressTimerRef.current);clearPending();
        const s=stateRef.current;
        s.pressStart=null;s.pressProgress=0;s.pressScreenStart=null;s.boardIsDragging=false;s.boardDragTotal=0;
        const t0=e.touches[0],t1=e.touches[1];
        pinchRef.current={dist:Math.hypot(t0.clientX-t1.clientX,t0.clientY-t1.clientY),
          midX:(t0.clientX+t1.clientX)/2,midY:(t0.clientY+t1.clientY)/2,
          zoom:stateRef.current.boardZoom,bcx:stateRef.current.boardCam.x,bcy:stateRef.current.boardCam.y};
        stateRef.current.boardIsDragging=false;return;
      }
      pinchRef.current=null;const t=e.touches[0];startPress(t.clientX,t.clientY,t.clientX,t.clientY);
    };
    const onTE=e=>{
      e.preventDefault();
      if(e.touches.length===1&&pinchRef.current){
        const t=e.touches[0];pinchRef.current=null;const s=stateRef.current;
        s.boardDragLast={x:t.clientX,y:t.clientY};s.boardDragTotal=0;s.boardIsDragging=false;
        s.pressScreenStart={x:t.clientX,y:t.clientY};s.pressStart=null;s.pressProgress=0;
        clearTimeout(pressTimerRef.current);return;
      }
      if(e.touches.length<2){pinchRef.current=null;stateRef.current.boardDragLast=null;}
      if(e.touches.length===0){const t=e.changedTouches[0];handlePointerEnd(t.clientX,t.clientY);}
    };
    const onTM=e=>{
      e.preventDefault();
      if(e.touches.length===2&&pinchRef.current&&stateRef.current.puzzleView){
        const t0=e.touches[0],t1=e.touches[1];
        const newDist=Math.hypot(t0.clientX-t1.clientX,t0.clientY-t1.clientY);
        const s=stateRef.current,c=canvasRef.current;if(!c)return;
        const rect=c.getBoundingClientRect();
        const pcx=pinchRef.current.midX-rect.left,pcy=pinchRef.current.midY-rect.top;
        const boardCX=c.width/2,boardCY=c.height*0.36;
        const newZoom=Math.max(0.06,Math.min(4.0,pinchRef.current.zoom*(newDist/pinchRef.current.dist)));
        s.boardCam.x=(pinchRef.current.bcx-(pcx-boardCX))*(newZoom/pinchRef.current.zoom)+(pcx-boardCX);
        s.boardCam.y=(pinchRef.current.bcy-(pcy-boardCY))*(newZoom/pinchRef.current.zoom)+(pcy-boardCY);
        s.boardZoom=newZoom;return;
      }
      const t=e.touches[0];handlePointerMove(t.clientX,t.clientY,t.clientX,t.clientY);
    };

    canvas.addEventListener("mousedown",onMD);canvas.addEventListener("mouseup",onMU);canvas.addEventListener("mousemove",onMM);
    canvas.addEventListener("wheel",onWheel,{passive:false});
    canvas.addEventListener("touchstart",onTS,{passive:false});canvas.addEventListener("touchend",onTE,{passive:false});canvas.addEventListener("touchmove",onTM,{passive:false});
    return()=>{
      canvas.removeEventListener("mousedown",onMD);canvas.removeEventListener("mouseup",onMU);canvas.removeEventListener("mousemove",onMM);
      canvas.removeEventListener("wheel",onWheel);
      canvas.removeEventListener("touchstart",onTS);canvas.removeEventListener("touchend",onTE);canvas.removeEventListener("touchmove",onTM);
      clearTimeout(pressTimerRef.current);clearPending();
    };
  },[toWorld,handleBoardTap]);

  // ─── Draw loop ───────────────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const au=audio.current,hp=haptic.current;
    const mp=multiplay.current; // 멀티플레이 참조
    let frame=0;

    const draw=()=>{
      const s=stateRef.current;
      const cw=canvas.width,ch=canvas.height;
      if(!cw||!ch){animRef.current=requestAnimationFrame(draw);return;}
      s.time+=0.016;frame++;

      if(frame%1800===0&&frame>0)triggerSaveRef.current(s);
      if(s.pressStart&&!s.isDragging&&!s.boardIsDragging){
        s.pressProgress=Math.min(1,(performance.now()-s.pressStart.t)/LONG_PRESS_MS);
        if(au.ready)au.pressCharge(s.pressProgress);hp.pressCharge(s.pressProgress);
      }
      if(s.puzzleView)s.zoomTarget=ZOOM_OUT*0.55;
      s.zoom+=(s.zoomTarget-s.zoom)*0.06;

      // ── 이동 ────────────────────────────────────────────────────────────────
      if(s.orbit){
        s.orbit.angle+=s.orbit.angularSpeed;
        const swx2=s.orbit.cx+Math.cos(s.orbit.angle)*s.orbit.radius;
        const swy2=s.orbit.cy+Math.sin(s.orbit.angle)*s.orbit.radius;
        const tKey=pk(Math.floor(swx2/PIECE_W),Math.floor(swy2/PIECE_H));
        if(s.placedMap.has(tKey)){
          s.sphere.col=Math.floor(swx2/PIECE_W);s.sphere.row=Math.floor(swy2/PIECE_H);
          s.sphere.lx=swx2-s.sphere.col*PIECE_W;s.sphere.ly=swy2-s.sphere.row*PIECE_H;
          const tang=s.orbit.angularSpeed>0?s.orbit.angle+Math.PI/2:s.orbit.angle-Math.PI/2;
          s.vel.x=Math.cos(tang)*SPHERE_SPEED;s.vel.y=Math.sin(tang)*SPHERE_SPEED;
          s.targetAngle=Math.atan2(s.vel.y,s.vel.x);hp.orbitTick(s.orbit.angularSpeed);
        }else{
          const pCX=(s.sphere.col+0.5)*PIECE_W,pCY=(s.sphere.row+0.5)*PIECE_H;
          const curWX=s.sphere.col*PIECE_W+s.sphere.lx,curWY=s.sphere.row*PIECE_H+s.sphere.ly;
          const tc=Math.atan2(pCY-curWY,pCX-curWX);
          s.vel.x=Math.cos(tc)*SPHERE_SPEED;s.vel.y=Math.sin(tc)*SPHERE_SPEED;
          s.targetAngle=tc;s.orbit=null;
        }
      }else{
        const curA=Math.atan2(s.vel.y,s.vel.x);let diff=s.targetAngle-curA;
        while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
        const newA=curA+diff*STEER_STRENGTH;
        s.vel.x=Math.cos(newA)*SPHERE_SPEED;s.vel.y=Math.sin(newA)*SPHERE_SPEED;
        s.sphere.lx+=s.vel.x;s.sphere.ly+=s.vel.y;
        const cL=s.placedMap.has(pk(s.sphere.col-1,s.sphere.row));
        const cR=s.placedMap.has(pk(s.sphere.col+1,s.sphere.row));
        const cT=s.placedMap.has(pk(s.sphere.col,s.sphere.row-1));
        const cB=s.placedMap.has(pk(s.sphere.col,s.sphere.row+1));
        const EDGE=320;
        const resist=(d,conn)=>conn||d>EDGE?1:(d/EDGE)*0.18+0.82;
        s.vel.x*=resist(s.sphere.lx,cL)*resist(PIECE_W-s.sphere.lx,cR);
        s.vel.y*=resist(s.sphere.ly,cT)*resist(PIECE_H-s.sphere.ly,cB);
        if(s.sphere.lx>PIECE_W){const nk=pk(s.sphere.col+1,s.sphere.row);if(s.placedMap.has(nk)){s.sphere.col++;s.sphere.lx-=PIECE_W;}else{s.sphere.lx=PIECE_W-1;s.vel.x=Math.min(s.vel.x,-0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
        if(s.sphere.lx<0){const nk=pk(s.sphere.col-1,s.sphere.row);if(s.placedMap.has(nk)){s.sphere.col--;s.sphere.lx+=PIECE_W;}else{s.sphere.lx=1;s.vel.x=Math.max(s.vel.x,0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
        if(s.sphere.ly>PIECE_H){const nk=pk(s.sphere.col,s.sphere.row+1);if(s.placedMap.has(nk)){s.sphere.row++;s.sphere.ly-=PIECE_H;}else{s.sphere.ly=PIECE_H-1;s.vel.y=Math.min(s.vel.y,-0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
        if(s.sphere.ly<0){const nk=pk(s.sphere.col,s.sphere.row-1);if(s.placedMap.has(nk)){s.sphere.row--;s.sphere.ly+=PIECE_H;}else{s.sphere.ly=1;s.vel.y=Math.max(s.vel.y,0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
      }

      const newKey=pk(s.sphere.col,s.sphere.row);
      if(newKey!==s.currentPieceKey&&s.placedMap.has(newKey)){
        // ── 조각 전환: 이전 조각 흔적 flush ─────────────────────────────────
        const prevData=s.placedMap.get(s.prevPieceKey);
        if(prevData?.globalSeed){
          const [pc,pr]=s.prevPieceKey.split(",").map(Number);
          const dc=s.sphere.col-pc,dr=s.sphere.row-pr;
          const exitFace=dc===1?"right":dc===-1?"left":dr===1?"bottom":"top";
          mp.onExit(prevData.globalSeed,exitFace);
        }
        s.currentPieceKey=newKey;
        s.prevPieceKey=newKey;
        // ── 새 조각 흔적 fetch ───────────────────────────────────────────────
        const newData=s.placedMap.get(newKey);
        if(newData?.globalSeed){
          mp._fetchAndUpdateNearby(newData.globalSeed,
            s.sphere.col*PIECE_W+s.sphere.lx,
            s.sphere.row*PIECE_H+s.sphere.ly
          ).then(()=>{
            const trails=mp.getTrails(newData.globalSeed);
            if(trails.length>0)s.otherTrails.set(newKey,trails);
          });
        }
      }

      const orbitNow=!!s.orbit;
      if(orbitNow&&!s.prevOrbitActive&&au.ready){au.startOrbit(s.orbit.angularSpeed);s.prevOrbitActive=true;}
      else if(!orbitNow&&s.prevOrbitActive){au.stopOrbit();s.prevOrbitActive=false;}

      const swx=sphereWorldX(s),swy=sphereWorldY(s);
      s.trail.push({x:swx,y:swy,age:0});if(s.trail.length>280)s.trail.shift();s.trail.forEach(p=>p.age++);

      // ── 멀티플레이 tick: 현재 위치 기록 (공유 조각에서만 작동) ─────────────
      const curGlobalSeed=s.placedMap.get(s.currentPieceKey)?.globalSeed??null;
      mp.tick(swx,swy,curGlobalSeed);

      // ── 퍼즐 뷰 열릴 때 공유 조각들 30초마다 갱신 ───────────────────────────
      if(s.puzzleView&&frame%1800===0){
        const sharedSeeds=[];
        s.placedMap.forEach((v,k)=>{if(v.globalSeed)sharedSeeds.push({seed:v.globalSeed,key:k});});
        sharedSeeds.forEach(({seed,key})=>{
          mp._fetch(seed).then(()=>{
            const trails=mp.getTrails(seed);
            if(trails.length>0)s.otherTrails.set(key,trails);
          });
        });
      }
      // ── 현재 공유 조각 흔적 캐시 갱신 (3초마다) ─────────────────────────────
      if(curGlobalSeed&&frame%180===0){
        const fresh=mp.getTrails(curGlobalSeed);
        if(fresh.length>0)s.otherTrails.set(s.currentPieceKey,fresh);
      }

      const camTX=s.puzzleView?s.sphere.col*PIECE_W+PIECE_W/2:swx;
      const camTY=s.puzzleView?s.sphere.row*PIECE_H+PIECE_H/2:swy;
      s.cam.x+=(camTX-s.cam.x)*0.07;s.cam.y+=(camTY-s.cam.y)*0.07;

      const wx=x=>(x-s.cam.x)*s.zoom+cw/2;
      const wy=y=>(y-s.cam.y)*s.zoom+ch/2;
      const inView=(x,y,pad=400)=>wx(x)>-pad&&wx(x)<cw+pad&&wy(y)>-pad&&wy(y)<ch+pad;

      const curNodes=s.pieceNodes.get(s.currentPieceKey)||[];
      const curPieceData=s.placedMap.get(s.currentPieceKey);
      const curTheme=THEMES[curPieceData?.themeId||0];
      const curStars=s.pieceStars.get(s.currentPieceKey)||[];
      if(au.ready)try{au.startThemeAmb(curPieceData?.themeId??0);}catch(_){}

      // ── 별 업데이트 ──────────────────────────────────────────────────────────
      curStars.forEach(star=>{
        const sx=s.sphere.col*PIECE_W+star.x,sy=s.sphere.row*PIECE_H+star.y;
        const d=Math.hypot(swx-sx,swy-sy),near=d<STAR_LIGHT_RADIUS;
        star.brightness+=(near?(1-d/STAR_LIGHT_RADIUS)*0.88+STAR_AMBIENT:STAR_AMBIENT-star.brightness)*0.04;
        star.phase+=0.012;
        if(!star.discovered&&d<STAR_LIGHT_RADIUS*0.6)star.discovered=true;
      });

      // ── 수집 ────────────────────────────────────────────────────────────────
      const PROX_RATE=5,ORBIT_BONUS=3;let nearestGemProgress=null;
      curNodes.forEach(n=>{
        if(n.gemCollected&&n.pieceCollected)return;
        const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
        const dSphere=Math.hypot(swx-nx,swy-ny);
        const dOrbit=s.orbit?Math.hypot(s.orbit.cx-nx,s.orbit.cy-ny):Infinity;
        const inProx=dSphere<LIGHT_RADIUS*1.6,orbitNear=dOrbit<LIGHT_RADIUS*1.5;
        if(n.isGem&&!n.gemCollected){
          if(inProx||orbitNear){
            n.gemTimer=(n.gemTimer||0)+(orbitNear?PROX_RATE*ORBIT_BONUS:PROX_RATE);
            if(n.gemTimer>=ORBIT_COLLECT_MS&&s.collectedGems.length<MAX_GEM_FRAGS){
              n.gemCollected=true;const gem={hue:n.gemHue,name:n.gemName};s.collectedGems.push(gem);
              if(curPieceData)curPieceData.gemCount++;if(au.ready)au.gemCollect(gem.hue);hp.gemCollect();
              triggerSaveRef.current(s);
            }else{
              const prog=Math.min(1,(n.gemTimer||0)/ORBIT_COLLECT_MS);
              if(!nearestGemProgress||prog>nearestGemProgress.prog)nearestGemProgress={nx,ny,prog,hue:n.gemHue,name:n.gemName,size:n.baseSize};
            }
          }else if(n.gemTimer>0)n.gemTimer=Math.max(0,n.gemTimer-2);
        }
        if(n.isPiece&&!n.pieceCollected){
          if(inProx||orbitNear){
            n.pieceOrbitTimer=(n.pieceOrbitTimer||0)+(orbitNear?PROX_RATE*ORBIT_BONUS:PROX_RATE);
            if(n.pieceOrbitTimer>=ORBIT_COLLECT_MS*1.6){
              n.pieceCollected=true;const newInv=makeInventoryPiece(n.pieceTheme,s.inventoryPieces.length);
              s.inventoryPieces=[...s.inventoryPieces,newInv];s.puzzleFragments++;hp.puzzlePieceGet();
              const key=Date.now();
              setToasts(t=>[...t.slice(-2),{key,themeName:THEMES[n.pieceTheme].name}]);
              setTimeout(()=>setToasts(t=>t.filter(x=>x.key!==key)),2500);
              triggerSaveRef.current(s);
            }
          }else if(n.pieceOrbitTimer>0)n.pieceOrbitTimer=Math.max(0,n.pieceOrbitTimer-2);
        }
      });
      s._nearestGem=nearestGemProgress;

      // ── 노드 업데이트 ────────────────────────────────────────────────────────
      curNodes.forEach(n=>{
        const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
        if(!inView(nx,ny,LIGHT_RADIUS*3)){n.brightness=Math.max(0,n.brightness-0.018);n.pulsePhase+=0.018;return;}
        const d=Math.hypot(swx-nx,swy-ny);
        if(d<LIGHT_RADIUS){
          const tv=1-d/LIGHT_RADIUS;
          n.brightness=Math.min(1,n.brightness+(tv-n.brightness)*0.07);
          n.visits=Math.min(3,n.visits+0.003*tv);
          if(!n.hapticPlayed&&n.brightness>0.15){n.hapticPlayed=true;hp.nodeTouch(n.id);}
          if(!n.visited&&n.brightness>0.3){
            n.visited=true;if(curPieceData)curPieceData.explored++;s.nodesForNextFrag++;
            if(s.nodesForNextFrag>=NODES_PER_PUZZLE_FRAG){
              s.nodesForNextFrag=0;s.puzzleFragments++;hp.puzzlePieceGet();
              const key=Date.now();const rt=THEMES[Math.floor(Math.random()*THEMES.length)];
              s.inventoryPieces=[...s.inventoryPieces,makeInventoryPiece(rt.id,s.inventoryPieces.length)];
              setToasts(t=>[...t.slice(-2),{key,themeName:rt.name}]);
              setTimeout(()=>setToasts(t=>t.filter(x=>x.key!==key)),2500);
            }
          }
        }else n.brightness=Math.max(0,n.brightness-0.018);
        n.pulsePhase+=0.018;n.sparkPhase+=0.012;
        n.rangeReveal+=s.revealMode?(1-n.rangeReveal)*0.07:(0-n.rangeReveal)*0.06;
        [0.8,1.6,2.5].forEach((th,idx)=>{if(n.satellites.length<=idx&&n.visits>=th)n.satellites.push(spawnSat(n));});
        n.satellites.forEach(sat=>{
          sat.angle+=sat.orbitSpeed;sat.pulsePhase+=0.025;
          sat.brightness=n.brightness>0.01?Math.min(n.brightness*0.75,sat.brightness+0.04):Math.max(0,sat.brightness-0.015);
          if(!sat.soundPlayed&&sat.brightness>0.01&&au.ready){sat.soundPlayed=true;au.satSpawn(n.id);}
          if(!sat.hapticPlayed&&sat.brightness>0.01){sat.hapticPlayed=true;hp.satSpawn();}
        });
      });

      if(frame%18===0&&au.ready)curNodes.forEach(n=>{if(n.brightness>0.001||au.nodeOscs.has(n.id))au.tone(n.id,n.brightness);});

      const curParticles=s.pieceParticles.get(s.currentPieceKey)||[];
      curParticles.forEach(p=>{
        p.wobble+=p.wobbleSpeed;p.x+=p.vx+Math.sin(p.wobble)*0.04;p.y+=p.vy;p.x+=p.drift;
        if(p.y>PIECE_H){p.y=0;p.x=rand(0,PIECE_W);}if(p.y<0)p.y=PIECE_H;
        if(p.x<0)p.x=PIECE_W;if(p.x>PIECE_W)p.x=0;
      });

      s.detailAlpha+=((s.detailView&&!s.puzzleView?1:0)-s.detailAlpha)*0.09;
      s.puzzleAlpha+=((s.puzzleView?1:0)-s.puzzleAlpha)*0.07;

      if(s.detailView&&!s.puzzleView){
        if(!s.shardPattern){s.shardPattern=generateShatterPattern(s.shardSeed);s.shatterPhase='whole';s.shatterTimer=0;s.shatterT=0;}
        if(s.shatterPhase!=='done'){
          const PHASE_DUR={whole:600,crack:900,split:500,reform:700};
          s.shatterTimer+=16;const dur=PHASE_DUR[s.shatterPhase]||600;s.shatterT=Math.min(1,s.shatterTimer/dur);
          if(s.shatterT>=1){const next={whole:'crack',crack:'split',split:'reform',reform:'done'};s.shatterPhase=next[s.shatterPhase]||'done';s.shatterTimer=0;s.shatterT=0;}
        }
      }
      if(frame%60===0)setStats({col:s.sphere.col,row:s.sphere.row,orbiting:!!s.orbit,fragments:s.puzzleFragments,gems:s.collectedGems.length,puzzleView:s.puzzleView,themeName:curTheme.name,nodesLeft:Math.max(0,NODES_PER_PUZZLE_FRAG-s.nodesForNextFrag)});

      // ══ DRAW ════════════════════════════════════════════════════════════════
      const [bg0,bg1,bg2]=curTheme.bg;
      ctx.fillStyle=`rgb(${bg0},${bg1},${bg2})`;ctx.fillRect(0,0,cw,ch);
      const gNeb=ctx.createRadialGradient(cw*0.35,ch*0.3,0,cw*0.35,ch*0.3,cw*0.7);
      gNeb.addColorStop(0,`rgba(${bg0+12},${bg1+4},${bg2+25},0.5)`);gNeb.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gNeb;ctx.fillRect(0,0,cw,ch);

      // void 어두워짐
      const VOID_MARGIN=2200;
      const vConnL=s.placedMap.has(pk(s.sphere.col-1,s.sphere.row)),vConnR=s.placedMap.has(pk(s.sphere.col+1,s.sphere.row));
      const vConnT=s.placedMap.has(pk(s.sphere.col,s.sphere.row-1)),vConnB=s.placedMap.has(pk(s.sphere.col,s.sphere.row+1));
      const dL=vConnL?VOID_MARGIN:s.sphere.lx,dR=vConnR?VOID_MARGIN:PIECE_W-s.sphere.lx;
      const dT=vConnT?VOID_MARGIN:s.sphere.ly,dB=vConnB?VOID_MARGIN:PIECE_H-s.sphere.ly;
      const voidness=Math.max(0,1-Math.min(dL,dR,dT,dB)/VOID_MARGIN)*0.82;
      if(voidness>0.01){const vg=ctx.createRadialGradient(cw/2,ch/2,Math.min(cw,ch)*0.2,cw/2,ch/2,Math.max(cw,ch)*0.8);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,`rgba(0,0,3,${voidness})`);ctx.fillStyle=vg;ctx.fillRect(0,0,cw,ch);}

      // 피스 경계
      s.placedMap.forEach((_,k)=>{
        const [c,r]=k.split(",").map(Number);const ox=c*PIECE_W,oy=r*PIECE_H;
        ctx.strokeStyle=k===s.currentPieceKey?"rgba(150,130,255,0.22)":"rgba(100,90,180,0.10)";
        ctx.lineWidth=1;ctx.setLineDash([8,14]);ctx.strokeRect(wx(ox),wy(oy),wx(ox+PIECE_W)-wx(ox),wy(oy+PIECE_H)-wy(oy));ctx.setLineDash([]);
      });

      // 파티클
      curParticles.forEach(p=>{
        const px=s.sphere.col*PIECE_W+p.x,py=s.sphere.row*PIECE_H+p.y;
        const psx=wx(px),psy=wy(py);
        if(psx<-60||psx>cw+60||psy<-60||psy>ch+60)return;
        if(p.isSmall){ctx.beginPath();ctx.arc(psx,psy,Math.max(0.5,p.r*s.zoom),0,Math.PI*2);ctx.fillStyle=`hsla(${p.hue},${p.sat}%,${p.lightness}%,${p.opacity})`;ctx.fill();}
        else{const br=p.blurR*s.zoom;const pg=ctx.createRadialGradient(psx,psy,0,psx,psy,br);pg.addColorStop(0,`hsla(${p.hue},${p.sat}%,${p.lightness}%,${p.opacity})`);pg.addColorStop(1,`hsla(${p.hue},${p.sat}%,${p.lightness}%,0)`);ctx.fillStyle=pg;ctx.beginPath();ctx.arc(psx,psy,br,0,Math.PI*2);ctx.fill();}
      });

      // 트레일
      for(let i=1;i<s.trail.length;i++){
        const p=s.trail[i],prev=s.trail[i-1],prog=i/s.trail.length;
        const alpha=prog*prog*Math.max(0,1-p.age/(280*0.75));if(alpha<0.004)continue;
        ctx.beginPath();ctx.moveTo(wx(prev.x),wy(prev.y));ctx.lineTo(wx(p.x),wy(p.y));
        ctx.strokeStyle=`rgba(${curTheme.nodeHue===220?180:200},${curTheme.nodeHue===185?220:160},255,${alpha*0.65})`;
        ctx.lineWidth=prog*2.2*Math.max(s.zoom,0.5);ctx.lineCap="round";ctx.stroke();
      }

      // ── 다른 플레이어 흔적 (공유 조각에서만) ─────────────────────────────────
      if(!s.puzzleView&&!s.detailView&&curGlobalSeed){
        const pieceTrails=s.otherTrails.get(s.currentPieceKey);
        if(pieceTrails?.length>0)
          drawWorldTrails(ctx,pieceTrails,s.sphere.col,s.sphere.row,wx,wy,s.time);
        if(mp.nearbyPlayers.length>0)
          drawNearbyGlows(ctx,mp.nearbyPlayers,s.sphere.col,s.sphere.row,wx,wy,s.time);
      }

      // revealMode 파문
      if(s.revealMode){
        curNodes.forEach(n=>{
          if(!n.isPiece||n.pieceCollected)return;
          const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
          const sxn=wx(nx),syn=wy(ny);const MAX_RIPPLE_R=PIECE_W*0.55*s.zoom;
          for(let ring=0;ring<3;ring++){
            const phase=((s.time*0.22+ring/3)%1),rr=phase*MAX_RIPPLE_R,ra=(1-phase)*(1-phase)*0.45;
            if(ra<0.01)continue;
            ctx.beginPath();ctx.arc(sxn,syn,rr,0,Math.PI*2);ctx.strokeStyle=`rgba(255,225,100,${ra})`;ctx.lineWidth=Math.max(0.5,(1-phase)*2.5);ctx.stroke();
          }
        });
      }

      // 노드 렌더
      const nh=curTheme.nodeHue;
      curNodes.forEach(n=>{
        const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
        if(!inView(nx,ny,LIGHT_RADIUS*2))return;
        if(n.brightness<0.006&&n.rangeReveal<0.01&&n.satellites.every(st=>st.brightness<0.006)&&!n.isGem)return;
        const sxn=wx(nx),syn=wy(ny);
        const pulse=Math.sin(n.pulsePhase)*0.12+0.88,size=n.baseSize*(1+n.visits*0.5)*pulse;
        const hue=nh+n.visits*35,lgt=65+n.visits*10,lr=LIGHT_RADIUS*s.zoom;
        if(n.isPiece&&!n.pieceCollected){
          const sz=size*s.zoom*1.3;
          const glow=ctx.createRadialGradient(sxn,syn,0,sxn,syn,sz*7);
          glow.addColorStop(0,`rgba(255,245,200,${n.brightness*0.5})`);glow.addColorStop(0.4,`rgba(255,230,150,${n.brightness*0.15})`);glow.addColorStop(1,"rgba(0,0,0,0)");
          ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sxn,syn,sz*7,0,Math.PI*2);ctx.fill();
          ctx.save();ctx.translate(sxn,syn);ctx.rotate(s.time*0.4);
          ctx.beginPath();for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2;const r=i%2===0?sz:sz*0.65;ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();
          const pg=ctx.createRadialGradient(-sz*0.3,-sz*0.3,0,0,0,sz);
          pg.addColorStop(0,`rgba(255,255,240,${Math.max(n.brightness,0.35)})`);pg.addColorStop(0.6,`rgba(255,220,100,${Math.max(n.brightness,0.25)})`);pg.addColorStop(1,`rgba(200,150,50,${Math.max(n.brightness,0.15)})`);
          ctx.fillStyle=pg;ctx.fill();ctx.strokeStyle=`rgba(255,240,160,${Math.max(n.brightness,0.5)})`;ctx.lineWidth=0.8;ctx.stroke();ctx.restore();
          if(n.pieceOrbitTimer>0){
            const prog=n.pieceOrbitTimer/(ORBIT_COLLECT_MS*1.8);
            ctx.beginPath();ctx.arc(sxn,syn,sz*2,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle="rgba(255,220,100,0.85)";ctx.lineWidth=2;ctx.lineCap="round";ctx.stroke();
            ctx.fillStyle="rgba(255,230,140,0.8)";ctx.font="9px 'Courier New',monospace";ctx.textAlign="center";ctx.fillText(`${THEMES[n.pieceTheme]?.name||""} ${Math.round(prog*100)}%`,sxn,syn+sz*3.2);
          }
        }else if(n.isPiece&&n.pieceCollected){
          ctx.beginPath();ctx.arc(sxn,syn,n.baseSize*0.5*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(255,220,100,0.18)";ctx.lineWidth=1;ctx.stroke();
        }else if(n.isGem&&!n.gemCollected){
          drawGem(ctx,sxn,syn,size,n.gemHue,Math.max(n.brightness,n.rangeReveal*0.35,0.18),s.time,n.sparkPhase,s.zoom);
          const prog=n.gemTimer?Math.min(1,n.gemTimer/ORBIT_COLLECT_MS):0;
          if(prog>0.02){
            ctx.beginPath();ctx.arc(sxn,syn,size*s.zoom*2.2,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle=`hsla(${n.gemHue},90%,80%,0.9)`;ctx.lineWidth=2.5;ctx.lineCap="round";ctx.stroke();
            if(prog>0.12){ctx.fillStyle=`hsla(${n.gemHue},80%,80%,0.85)`;ctx.font="9px 'Courier New',monospace";ctx.textAlign="center";ctx.fillText(`${n.gemName} ${Math.round(prog*100)}%`,sxn,syn+size*s.zoom*3.5);}
          }
        }else if(!n.isGem){
          if(n.rangeReveal>0.01){const rev=n.rangeReveal;const rg=ctx.createRadialGradient(sxn,syn,0,sxn,syn,lr);rg.addColorStop(0,`hsla(${hue},50%,${lgt}%,${rev*0.05})`);rg.addColorStop(1,`hsla(${hue},50%,${lgt}%,0)`);ctx.fillStyle=rg;ctx.beginPath();ctx.arc(sxn,syn,lr,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(sxn,syn,lr,0,Math.PI*2);ctx.strokeStyle=`hsla(${hue},55%,${lgt}%,${rev*0.38})`;ctx.lineWidth=1.2;ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);}
          if(n.brightness>0.07){const gr=size*(4+n.visits*2)*s.zoom;const glow=ctx.createRadialGradient(sxn,syn,0,sxn,syn,gr);glow.addColorStop(0,`hsla(${hue},50%,${lgt}%,${n.brightness*0.35})`);glow.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sxn,syn,gr,0,Math.PI*2);ctx.fill();}
          if(n.brightness>0.01){ctx.beginPath();ctx.arc(sxn,syn,size*s.zoom,0,Math.PI*2);ctx.fillStyle=`hsla(${hue},50%,${lgt}%,${n.brightness})`;ctx.fill();}
          n.satellites.forEach((sat,idx)=>{
            if(sat.brightness<0.01)return;
            const sax=sxn+Math.cos(sat.angle)*sat.dist*s.zoom,say=syn+Math.sin(sat.angle)*sat.dist*s.zoom;
            const ss=sat.size*(Math.sin(sat.pulsePhase)*0.15+0.85)*s.zoom,sh=hue+20+idx*15;
            ctx.beginPath();ctx.moveTo(sxn,syn);ctx.lineTo(sax,say);ctx.strokeStyle=`hsla(${sh},70%,65%,${sat.brightness*0.2})`;ctx.lineWidth=0.6;ctx.stroke();
            const sg=ctx.createRadialGradient(sax,say,0,sax,say,ss*4);sg.addColorStop(0,`hsla(${sh},75%,65%,${sat.brightness*0.28})`);sg.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=sg;ctx.beginPath();ctx.arc(sax,say,ss*4,0,Math.PI*2);ctx.fill();
            ctx.beginPath();ctx.arc(sax,say,ss,0,Math.PI*2);ctx.fillStyle=`hsla(${sh},75%,65%,${sat.brightness})`;ctx.fill();
          });
        }
        if(n.isGem&&n.gemCollected){ctx.beginPath();ctx.arc(sxn,syn,n.baseSize*0.6*s.zoom,0,Math.PI*2);ctx.strokeStyle=`hsla(${n.gemHue},40%,50%,0.22)`;ctx.lineWidth=1;ctx.stroke();}
      });

      // 항성 렌더 (탐험 내부)
      curStars.forEach(star=>{
        const sxw=s.sphere.col*PIECE_W+star.x,syw=s.sphere.row*PIECE_H+star.y;
        const ssx=wx(sxw),ssy=wy(syw);
        if(ssx<-300||ssx>cw+300||ssy<-300||ssy>ch+300)return;
        const bri=star.brightness,pulse=Math.sin(star.phase*1.1)*0.18+0.82,sz=star.size*s.zoom;
        const farR=STAR_LIGHT_RADIUS*s.zoom*0.55;
        const farG=ctx.createRadialGradient(ssx,ssy,0,ssx,ssy,farR);
        farG.addColorStop(0,`hsla(${star.hue},80%,85%,${bri*0.22})`);farG.addColorStop(0.5,`hsla(${star.hue},70%,70%,${bri*0.06})`);farG.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=farG;ctx.beginPath();ctx.arc(ssx,ssy,farR,0,Math.PI*2);ctx.fill();
        if(bri>STAR_AMBIENT+0.05){const nearR=sz*7*pulse;const nearG=ctx.createRadialGradient(ssx,ssy,0,ssx,ssy,nearR);nearG.addColorStop(0,`hsla(${star.hue},90%,96%,${bri*0.7})`);nearG.addColorStop(0.3,`hsla(${star.hue},80%,80%,${bri*0.3})`);nearG.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=nearG;ctx.beginPath();ctx.arc(ssx,ssy,nearR,0,Math.PI*2);ctx.fill();}
        const rayLen=sz*(3.5+pulse*1.5);
        ctx.save();ctx.translate(ssx,ssy);ctx.rotate(star.phase*0.18);
        [0,1,2,3].forEach(ri=>{ctx.save();ctx.rotate(ri*Math.PI/2);ctx.beginPath();ctx.moveTo(0,-sz*0.5);ctx.lineTo(0,-rayLen);ctx.strokeStyle=`hsla(${star.hue},90%,95%,${bri*(0.6+pulse*0.4)})`;ctx.lineWidth=Math.max(0.8,sz*0.22);ctx.lineCap="round";ctx.stroke();ctx.restore();});
        [0,1,2,3].forEach(ri=>{ctx.save();ctx.rotate(ri*Math.PI/2+Math.PI/4);ctx.beginPath();ctx.moveTo(0,-sz*0.3);ctx.lineTo(0,-rayLen*0.55);ctx.strokeStyle=`hsla(${star.hue},85%,90%,${bri*0.4*pulse})`;ctx.lineWidth=Math.max(0.5,sz*0.12);ctx.lineCap="round";ctx.stroke();ctx.restore();});
        ctx.beginPath();ctx.arc(0,0,sz,0,Math.PI*2);
        const cg=ctx.createRadialGradient(-sz*0.25,-sz*0.25,0,0,0,sz);
        cg.addColorStop(0,`hsla(${star.hue},60%,100%,${bri*pulse})`);cg.addColorStop(0.5,`hsla(${star.hue},80%,90%,${bri*pulse*0.9})`);cg.addColorStop(1,`hsla(${star.hue},70%,70%,${bri*pulse*0.7})`);
        ctx.fillStyle=cg;ctx.fill();ctx.restore();
        if(!star.discovered&&bri>STAR_AMBIENT+0.02){ctx.fillStyle=`hsla(${star.hue},80%,85%,${(bri-STAR_AMBIENT)*2})`;ctx.font=`${Math.round(Math.max(9,sz*0.7))}px 'Courier New',monospace`;ctx.textAlign="center";ctx.fillText("✦",ssx,ssy+sz*3.8);}
      });

      // orbit / orbitPreview / joystick / pressCharge
      if(s.orbit){const ocx=wx(s.orbit.cx),ocy=wy(s.orbit.cy);ctx.beginPath();ctx.arc(ocx,ocy,3,0,Math.PI*2);ctx.fillStyle="rgba(180,170,255,0.4)";ctx.fill();ctx.beginPath();ctx.arc(ocx,ocy,s.orbit.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(160,150,240,0.14)";ctx.lineWidth=1;ctx.setLineDash([5,8]);ctx.stroke();ctx.setLineDash([]);}
      if(s.wallFlash){s.wallFlash.t-=0.045;if(s.wallFlash.t<=0)s.wallFlash=null;else{const fx=wx(s.wallFlash.wx),fy=wy(s.wallFlash.wy),ft=s.wallFlash.t,fr=(1-ft)*80*s.zoom;ctx.beginPath();ctx.arc(fx,fy,Math.max(2,fr),0,Math.PI*2);ctx.strokeStyle=`rgba(180,160,255,${ft*0.7})`;ctx.lineWidth=2;ctx.stroke();for(let i=0;i<6;i++){const pa=(i/6)*Math.PI*2,pr=fr*(0.6+Math.sin(ft*8+i)*0.3);ctx.beginPath();ctx.arc(fx+Math.cos(pa)*pr,fy+Math.sin(pa)*pr,1.5,0,Math.PI*2);ctx.fillStyle=`rgba(200,180,255,${ft*0.6})`;ctx.fill();}}}
      if(s.orbitPreview){const pcx=wx(s.orbitPreview.wx),pcy=wy(s.orbitPreview.wy);ctx.beginPath();ctx.arc(pcx,pcy,s.orbitPreview.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(180,170,255,0.3)";ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(pcx,pcy,5,0,Math.PI*2);ctx.fillStyle="rgba(200,190,255,0.55)";ctx.fill();}
      if(s.isDragging&&s.pressScreenStart&&!s.orbit&&!s.detailView&&!s.puzzleView&&!s.zoomedOut){const jx=s.pressScreenStart.x,jy=s.pressScreenStart.y;ctx.save();ctx.strokeStyle="rgba(200,190,255,0.22)";ctx.lineWidth=1;ctx.setLineDash([3,5]);ctx.beginPath();ctx.arc(jx,jy,32,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.moveTo(jx-8,jy);ctx.lineTo(jx+8,jy);ctx.moveTo(jx,jy-8);ctx.lineTo(jx,jy+8);ctx.strokeStyle="rgba(200,190,255,0.35)";ctx.lineWidth=1;ctx.stroke();ctx.restore();}
      if(s.pressStart&&!s.isDragging&&s.pressWorld&&!s.revealMode){const pcx=wx(s.pressWorld.wx),pcy=wy(s.pressWorld.wy),prog=s.pressProgress;ctx.beginPath();ctx.arc(pcx,pcy,12,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle=`rgba(200,190,255,${0.3+prog*0.5})`;ctx.lineWidth=2;ctx.stroke();}

      // 구체
      const spx=wx(swx),spy=wy(swy);
      const warmth=Math.min(1,s.collectedGems.length/12),ssz=(7+Math.sin(s.time*2)*0.5)*s.zoom;
      const gLight=ctx.createRadialGradient(spx,spy,0,spx,spy,LIGHT_RADIUS*s.zoom);
      gLight.addColorStop(0,`rgba(${Math.round(175+warmth*55)},${Math.round(165+warmth*30)},${Math.round(255-warmth*120)},${0.07+warmth*0.05})`);gLight.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gLight;ctx.beginPath();ctx.arc(spx,spy,LIGHT_RADIUS*s.zoom,0,Math.PI*2);ctx.fill();
      const gs=ctx.createRadialGradient(spx-ssz*0.3,spy-ssz*0.3,0,spx,spy,ssz*1.6);
      gs.addColorStop(0,`rgba(255,${Math.round(255-warmth*18)},${Math.round(255-warmth*55)},1)`);gs.addColorStop(0.4,`rgba(${Math.round(220+warmth*30)},${Math.round(215+warmth*10)},${Math.round(255-warmth*80)},0.95)`);gs.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gs;ctx.beginPath();ctx.arc(spx,spy,ssz*1.6,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(spx,spy,ssz,0,Math.PI*2);ctx.fillStyle=`rgba(255,${Math.round(255-warmth*18)},${Math.round(255-warmth*55)},0.97)`;ctx.fill();
      if(warmth>0.05){ctx.beginPath();ctx.arc(spx,spy,ssz*1.06,0,Math.PI*2);ctx.strokeStyle=`rgba(255,195,50,${warmth*0.4})`;ctx.lineWidth=0.8*s.zoom;ctx.stroke();}

      // 오버레이
      if(s.puzzleAlpha>0.01)drawPuzzleBoard(ctx,cw,ch,{placedMap:s.placedMap,currentPieceKey:s.currentPieceKey,inventoryPieces:s.inventoryPieces,selectedInventoryId:s.selectedInventoryId,puzzleFragments:s.puzzleFragments,boardCam:s.boardCam,boardZoom:s.boardZoom,pieceStars:s.pieceStars,sphere:s.sphere,otherTrails:s.otherTrails},s.time,s.puzzleAlpha);
      if(s.detailAlpha>0.01&&s.shardPattern)drawSphereDetail(ctx,cw,ch,s.collectedGems,s.shardPattern,s.shatterPhase,s.shatterT,s.time,s.detailAlpha);

      animRef.current=requestAnimationFrame(draw);
    };
    animRef.current=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(animRef.current);
  },[]);

  // ─── UI ──────────────────────────────────────────────────────────────────────
  const td="rgba(150,140,210,0.30)",tg="rgba(255,195,50,0.80)";
  return(
    <div style={{width:"100%",height:"100%",position:"fixed",top:0,left:0,overflow:"hidden",
      display:"flex",flexDirection:"column",fontFamily:"'Courier New',monospace",userSelect:"none"}}>
      <style>{`
        @keyframes fadeUpOut{0%{opacity:0;transform:translate(-50%,-50%) translateY(8px)}15%{opacity:1;transform:translate(-50%,-50%) translateY(0)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) translateY(-18px)}}
        @keyframes savePulse{0%,100%{opacity:0.35}50%{opacity:0.9}}
      `}</style>
      <canvas ref={canvasRef} style={{flex:1,width:"100%",touchAction:"none",cursor:"default"}}/>
      {toasts.map(t=><PieceToast key={t.key} themeName={t.themeName}/>)}

      {/* 상단 좌 */}
      <div style={{position:"absolute",top:14,left:16,display:"flex",flexDirection:"column",gap:"4px"}}>
        <span style={{color:td,fontSize:"10px",letterSpacing:"0.13em"}}>{stats.puzzleView?"◎ 퍼즐 판":stats.orbiting?"⟳ 공전":`→ ${stats.themeName}`}</span>
        {stats.fragments<=2&&<span style={{color:tg,fontSize:"10px",opacity:stats.fragments===0?0.4:1}}>✦ 퍼즐 조각 {stats.fragments===0?"없음":`×${stats.fragments}`}</span>}
        {stats.fragments<=2&&stats.nodesLeft>0&&<span style={{color:"rgba(200,185,140,0.45)",fontSize:"9px"}}>노드 {stats.nodesLeft}개 더 →</span>}
        {stats.gems>0&&<span style={{color:"rgba(255,195,50,0.55)",fontSize:"10px"}}>◈ 보석 {stats.gems}/{MAX_GEM_FRAGS}</span>}
        {saveStatus&&<span style={{color:saveStatus==="error"?"rgba(255,120,100,0.7)":saveStatus==="loaded"?"rgba(100,220,180,0.7)":saveStatus==="new"?"rgba(180,160,255,0.6)":"rgba(150,140,210,0.45)",fontSize:"9px",letterSpacing:"0.08em",animation:saveStatus==="saving"?"savePulse 0.8s ease infinite":"none"}}>
          {saveStatus==="saving"?"⟳ 저장 중":saveStatus==="saved"?"✓ 저장됨":saveStatus==="error"?"✗ 저장 실패":saveStatus==="loaded"?"◉ 불러옴":"◎ 새 시작"}
        </span>}
      </div>

      {/* 상단 우 */}
      <div style={{position:"absolute",top:14,right:16,display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"}}>
        <button onClick={()=>setMuted(m=>!m)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:muted?"rgba(120,110,180,0.35)":td,fontSize:"10px",fontFamily:"inherit"}}>{muted?"♪ 음소거":"♪"}</button>
        {hapticSupported&&<button onClick={()=>setHapticOn(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:hapticOn?td:"rgba(120,110,180,0.35)",fontSize:"10px",fontFamily:"inherit"}}>{hapticOn?"〜":"〜 꺼짐"}</button>}
        <button onClick={()=>triggerSave(stateRef.current)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:td,fontSize:"10px",fontFamily:"inherit",opacity:saveStatus==="saving"?0.4:1}}>💾</button>
        {!confirmNewGame&&<button onClick={()=>setConfirmNewGame(true)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:"rgba(120,110,180,0.25)",fontSize:"9px",fontFamily:"inherit"}}>↺ 초기화</button>}
        {confirmNewGame&&<div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:"3px"}}>
          <span style={{color:"rgba(255,140,120,0.7)",fontSize:"9px"}}>진행 삭제?</span>
          <button onClick={handleNewGame} style={{background:"rgba(200,80,60,0.15)",border:"1px solid rgba(200,80,60,0.3)",borderRadius:"3px",cursor:"pointer",padding:"1px 6px",color:"rgba(255,130,110,0.85)",fontSize:"9px",fontFamily:"inherit"}}>예</button>
          <button onClick={()=>setConfirmNewGame(false)} style={{background:"none",border:"none",cursor:"pointer",padding:"1px 0",color:td,fontSize:"9px",fontFamily:"inherit"}}>아니오</button>
        </div>}
      </div>

      <button onClick={()=>{const s=stateRef.current;s.puzzleView=!s.puzzleView;s.zoomTarget=s.puzzleView?ZOOM_OUT*0.55:ZOOM_NORMAL;s.selectedInventoryId=null;if(s.puzzleView){s.boardCam={x:0,y:0};s.boardZoom=1.0;}}}
        style={{position:"absolute",bottom:20,right:20,width:44,height:44,borderRadius:"50%",border:"1px solid rgba(150,130,255,0.35)",background:"rgba(10,8,28,0.75)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"18px",backdropFilter:"blur(4px)"}}>🗺</button>
      {stats.puzzleView&&<button onClick={()=>{stateRef.current.boardCam={x:0,y:0};stateRef.current.boardZoom=1.0;}}
        style={{position:"absolute",bottom:20,right:72,width:36,height:36,borderRadius:"50%",border:"1px solid rgba(150,130,255,0.22)",background:"rgba(10,8,28,0.65)",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",color:"rgba(150,140,210,0.55)",backdropFilter:"blur(4px)"}}>↺</button>}

      <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",pointerEvents:"none"}}>
        <span style={{color:"rgba(110,100,170,0.28)",fontSize:"9px",letterSpacing:"0.09em",whiteSpace:"nowrap"}}>
          {stats.puzzleView?"두 손가락 핀치 → 확대/축소 · 드래그 → 이동 · 조각 탭 → 선택 · 점선 탭 → 배치  |  ↺ 초기화":"누른 곳 기준 드래그 방향 · 꾹 범위 · 더블탭 줌아웃 · 🗺 퍼즐"}
        </span>
      </div>
    </div>
  );
}
