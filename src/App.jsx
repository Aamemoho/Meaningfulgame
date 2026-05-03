import { useState, useEffect, useRef, useCallback } from "react";

// ─── World constants ───────────────────────────────────────────────────────────
const PIECE_W = 7200;
const PIECE_H = 7200;
const LIGHT_RADIUS = 200;
const SPHERE_SPEED = 1.8;
const LONG_PRESS_MS = 550;
const DOUBLE_TAP_MS = 260;
const SINGLE_TAP_DELAY = 290;
const DRAG_THRESHOLD = 12;
const STEER_STRENGTH = 0.032;
const ZOOM_NORMAL = 1.0;
const ZOOM_OUT = 0.12;
const PARTICLE_COUNT = 180;
const NODES_PER_PIECE = 100;
const GEM_CHANCE = 0.09;
const PIECE_NODE_CHANCE = 0.03;
const ORBIT_COLLECT_MS = 3800;
const MAX_GEM_FRAGS = 14;
const NODES_PER_PUZZLE_FRAG = 10;

const GEM_HUES  = [0,22,42,165,185,260,295,325];
const GEM_NAMES = ["루비","앰버","토파즈","에메랄드","아쿠아","사파이어","자수정","로즈쿼츠"];

// ─── 테마 ──────────────────────────────────────────────────────────────────────
const THEMES = [
  {id:0, name:"암흑",  bg:[4,4,12],    nodeHue:220, partHue:220, boardColor:"rgba(120,100,255,0.8)"},
  {id:1, name:"황혼",  bg:[10,5,2],    nodeHue:28,  partHue:30,  boardColor:"rgba(255,140,60,0.8)"},
  {id:2, name:"심해",  bg:[2,8,14],    nodeHue:185, partHue:190, boardColor:"rgba(60,200,220,0.8)"},
  {id:3, name:"새벽",  bg:[8,4,14],    nodeHue:295, partHue:290, boardColor:"rgba(200,100,255,0.8)"},
  {id:4, name:"황금",  bg:[10,8,2],    nodeHue:48,  partHue:45,  boardColor:"rgba(255,210,60,0.8)"},
];

const pk = (col,row) => `${col},${row}`;
const DIRS = [
  {dc:1, dr:0, wall:"right",  entry:"left",   ax:"x", sign:1},
  {dc:-1,dr:0, wall:"left",   entry:"right",  ax:"x", sign:-1},
  {dc:0, dr:1, wall:"bottom", entry:"top",    ax:"y", sign:1},
  {dc:0, dr:-1,wall:"top",    entry:"bottom", ax:"y", sign:-1},
];

function rand(a,b){return a+Math.random()*(b-a);}

// ─── 노드 생성 ────────────────────────────────────────────────────────────────
function generatePieceNodes(themeId){
  return Array.from({length:NODES_PER_PIECE},(_,i)=>{
    const roll=Math.random();
    const isPiece=roll<PIECE_NODE_CHANCE;
    const isGem=!isPiece&&roll<PIECE_NODE_CHANCE+GEM_CHANCE;
    const gemIdx=Math.floor(Math.random()*GEM_HUES.length);
    const pieceTheme=Math.floor(Math.random()*THEMES.length);
    return{
      id:`${themeId}-${i}-${Math.random().toString(36).slice(2,6)}`,
      x:rand(180,PIECE_W-180),y:rand(180,PIECE_H-180),
      baseSize:isPiece?rand(7,12):isGem?rand(5,9):rand(2.5,5.5),
      visits:0,brightness:0,pulsePhase:Math.random()*Math.PI*2,
      satellites:[],rangeReveal:0,hapticPlayed:false,visited:false,
      sparkPhase:Math.random()*Math.PI*2,
      isGem,gemHue:isGem?GEM_HUES[gemIdx]:null,gemName:isGem?GEM_NAMES[gemIdx]:null,
      gemCollected:false,
      isPiece,pieceTheme,pieceCollected:false,
      pieceOrbitTimer:0,
    };
  });
}

function makeParticle(themeId){
  const layer=Math.random(), r=layer<0.6?rand(1.2,2.8):layer<0.9?rand(2.5,5):rand(5,9);
  const h=THEMES[themeId].partHue;
  return{x:rand(0,PIECE_W),y:rand(0,PIECE_H),r,blurR:r*rand(2.5,4),
    vx:rand(-0.06,0.06),vy:rand(0.04,0.28),drift:rand(-0.015,0.015),
    hue:h+rand(-20,20),sat:rand(8,25),lightness:rand(50,72),
    opacity:rand(0.06,0.18),wobble:rand(0,Math.PI*2),wobbleSpeed:rand(0.005,0.025),isSmall:r<3};
}

function spawnSat(node){
  return{angle:Math.random()*Math.PI*2,dist:rand(20,38),brightness:0,
    size:node.baseSize*rand(0.3,0.55),pulsePhase:Math.random()*Math.PI*2,
    orbitSpeed:rand(0.003,0.008)*(Math.random()>.5?1:-1),
    soundPlayed:false,hapticPlayed:false};
}

function makeInventoryPiece(themeId, idx){
  return{id:`inv-${idx}-${Math.random().toString(36).slice(2,6)}`,themeId,
    scatterAngle: (idx/8)*Math.PI*2 + rand(-0.3,0.3),
    scatterDist: rand(0.72,0.92),
    rotation: rand(-0.25,0.25),
  };
}

// ─── 오디오/햅틱 ─────────────────────────────────────────────────────────────
const PENTATONIC=[130.81,155.56,174.61,196,220,261.63,311.13,349.23,392,440,523.25,622.25,698.46,783.99,880];
function hashFreq(id){let h=5381;for(let i=0;i<id.length;i++)h=((h<<5)+h+id.charCodeAt(i))|0;return PENTATONIC[Math.abs(h)%PENTATONIC.length];}

class HapticEngine{
  constructor(){this.supported="vibrate"in navigator;this.muted=false;this._cd={};}
  _can(k,ms){const n=Date.now();if(this._cd[k]&&n-this._cd[k]<ms)return false;this._cd[k]=n;return true;}
  _v(p){if(!this.supported||this.muted)return;try{navigator.vibrate(p);}catch(_){}}
  nodeTouch(id){if(!this._can(`n${id}`,1200))return;this._v(18);}
  satSpawn(){if(!this._can("sat",300))return;this._v([12,60,18]);}
  orbitStart(){if(!this._can("os",800))return;this._v(55);}
  orbitTick(sp){const p=Math.max(1400,Math.min(3500,1/Math.abs(sp)*8));if(!this._can("ot",p))return;this._v(10);}
  orbitRelease(){this._v([8,40,8]);}
  zoomOut(){this._v(35);}zoomIn(){this._v([20,50,12]);}
  pressCharge(prog){const s=Math.floor(prog*5);if(!this._can(`pc${s}`,80))return;this._v([8,10,14,18,24][s]||8);}
  pressComplete(){this._v([0,30,40,30,60]);}
  gemCollect(){this._v([30,60,40,50,80]);}
  puzzlePieceGet(){this._v([15,30,15,30,50]);}
  puzzlePiecePlace(){this._v([20,40,30,50,80,40,60]);}
  steer(){if(!this._can("st",80))return;this._v(6);}
  setMuted(v){this.muted=v;if(v&&this.supported)navigator.vibrate(0);}
}

class AudioEngine{
  constructor(){
    this.ctx=null;this.master=null;this.reverbIn=null;
    this.nodeOscs=new Map();this.orbitNodes=null;this.pressNodes=null;
    this.muted=false;this.ready=false;
    // ★ 테마 앰비언트
    this.themeAmbNodes=null;this.themeAmbId=-1;
  }

  init(){
    if(this.ready){this.ctx.resume();return;}
    this.ctx=new(window.AudioContext||window.webkitAudioContext)();
    this.master=this.ctx.createGain();this.master.gain.value=0.6;
    this.master.connect(this.ctx.destination);
    this._rev();this._baseAmb();this.ready=true;
  }

  _rev(){
    const d=this.ctx.createDelay(1);d.delayTime.value=0.29;
    const fb=this.ctx.createGain();fb.gain.value=0.40;
    const lp=this.ctx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=4200;
    const wet=this.ctx.createGain();wet.gain.value=0.20;
    const snd=this.ctx.createGain();
    snd.connect(d);d.connect(lp);lp.connect(fb);fb.connect(d);
    d.connect(wet);wet.connect(this.master);snd.connect(this.master);
    this.reverbIn=snd;
  }

  _baseAmb(){
    // 아주 낮은 공통 드론 (테마 앰비언트와 레이어)
    const g=this.ctx.createGain();g.gain.value=0.028;g.connect(this.master);
    [{f:55,t:"sine",v:.60},{f:55.18,t:"sine",v:.55}].forEach(({f,t,v})=>{
      const o=this.ctx.createOscillator(),og=this.ctx.createGain();
      o.type=t;o.frequency.value=f;og.gain.value=v;o.connect(og);og.connect(g);o.start();
    });
  }

  setMuted(v){
    this.muted=v;
    if(this.master)this.master.gain.setTargetAtTime(v?0:0.6,this.ctx.currentTime,0.4);
  }

  // ─── 테마 앰비언트 ────────────────────────────────────────────────────────
  startThemeAmb(themeId){
    if(!this.ready||this.themeAmbId===themeId)return;
    this.stopThemeAmb();
    this.themeAmbId=themeId;
    this.themeAmbNodes=this._makeThemeAmb(themeId);
  }

  stopThemeAmb(){
    if(!this.themeAmbNodes)return;
    const t=this.ctx.currentTime;
    this.themeAmbNodes.forEach(n=>{
      if(n.gain)n.gain.gain.setTargetAtTime(0,t,1.4);
      setTimeout(()=>{try{n.src?.stop();n.osc?.stop();}catch(_){}},6000);
    });
    this.themeAmbNodes=null;this.themeAmbId=-1;
  }

  _makeThemeAmb(themeId){
    // 테마별 파라미터 — 모두 편안하고 부드러운 앰비언트 백색 노이즈 계열
    const CFG=[
      // 0 암흑: 우주 심연 — 매우 낮은 드론 + 희박한 고역 노이즈, 느린 LFO
      {nf:70,  nq:0.7, nl:0.036, lfoR:0.07, lfoD:0.010,
       oscs:[{f:41,   t:"sine",    v:0.055},{f:55.18,t:"sine",v:0.035},{f:27.5, t:"sine",v:0.026}]},
      // 1 황혼: 사막 바람 — 중역 따뜻한 노이즈 + 낮은 현악 드론
      {nf:340, nq:1.1, nl:0.040, lfoR:0.13, lfoD:0.016,
       oscs:[{f:110,  t:"sine",    v:0.030},{f:138.6,t:"sine",v:0.018},{f:82.4, t:"triangle",v:0.013}]},
      // 2 심해: 수중 — 저역 구르는 소리 + 느린 파동
      {nf:110, nq:1.4, nl:0.044, lfoR:0.055,lfoD:0.020,
       oscs:[{f:55,   t:"sine",    v:0.062},{f:73.4, t:"sine",v:0.028},{f:36.7, t:"sine",v:0.022}]},
      // 3 새벽: 여명 공기 — 높은 필터 노이즈 + 가벼운 드론
      {nf:680, nq:1.8, nl:0.026, lfoR:0.19, lfoD:0.012,
       oscs:[{f:220,  t:"sine",    v:0.020},{f:293.7,t:"sine",v:0.012},{f:164.8,t:"sine",v:0.014}]},
      // 4 황금: 따뜻한 빛 — 중고역 노이즈 + 따뜻한 화음
      {nf:460, nq:1.6, nl:0.031, lfoR:0.16, lfoD:0.014,
       oscs:[{f:164.8,t:"sine",    v:0.034},{f:220,  t:"sine",v:0.022},{f:130.8,t:"sine",v:0.018}]},
    ];
    const cfg=CFG[themeId]||CFG[0];
    const nodes=[];

    // ── 루핑 필터드 노이즈 버퍼 ────────────────────────────────────────────
    const dur=4, rate=this.ctx.sampleRate;
    const buf=this.ctx.createBuffer(1,rate*dur,rate);
    const bd=buf.getChannelData(0);
    for(let i=0;i<rate*dur;i++)bd[i]=Math.random()*2-1;

    const src=this.ctx.createBufferSource();
    src.buffer=buf;src.loop=true;

    const filt=this.ctx.createBiquadFilter();
    filt.type="bandpass";filt.frequency.value=cfg.nf;filt.Q.value=cfg.nq;

    // 2차 LP로 부드럽게
    const lp=this.ctx.createBiquadFilter();
    lp.type="lowpass";lp.frequency.value=cfg.nf*3.5;

    const nGain=this.ctx.createGain();
    nGain.gain.value=0;
    nGain.gain.setTargetAtTime(cfg.nl,this.ctx.currentTime,2.2);

    // LFO — 노이즈 레벨 천천히 출렁임
    const lfo=this.ctx.createOscillator();
    lfo.type="sine";lfo.frequency.value=cfg.lfoR;
    const lfoG=this.ctx.createGain();
    lfoG.gain.value=cfg.lfoD;
    lfo.connect(lfoG);lfoG.connect(nGain.gain);

    src.connect(filt);filt.connect(lp);lp.connect(nGain);
    nGain.connect(this.master);
    src.start();lfo.start();
    nodes.push({src,gain:nGain});
    nodes.push({osc:lfo,gain:lfoG});

    // ── 드론 오실레이터들 (리버브로 공간감) ─────────────────────────────────
    cfg.oscs.forEach(({f,t,v})=>{
      const osc=this.ctx.createOscillator(),g=this.ctx.createGain();
      osc.type=t;osc.frequency.value=f;
      g.gain.value=0;
      g.gain.setTargetAtTime(v,this.ctx.currentTime,2.8);
      osc.connect(g);g.connect(this.reverbIn);
      osc.start();
      nodes.push({osc,gain:g});
    });

    return nodes;
  }

  // ─── 기존 메서드들 ────────────────────────────────────────────────────────
  tone(id,bri){
    if(!this.ready)return;
    const tgt=Math.min(bri*0.085,0.085);
    if(!this.nodeOscs.has(id)){
      if(tgt<0.004||this.nodeOscs.size>=8)return;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine";o.frequency.value=hashFreq(id);g.gain.value=0;
      o.connect(g);g.connect(this.reverbIn);o.start();
      this.nodeOscs.set(id,{osc:o,gain:g});
    }
    const{gain}=this.nodeOscs.get(id);
    gain.gain.setTargetAtTime(tgt,this.ctx.currentTime,0.35);
    if(tgt<0.002){
      const e=this.nodeOscs.get(id);this.nodeOscs.delete(id);
      e.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.5);
      setTimeout(()=>{try{e.osc.stop();}catch(_){}},2500);
    }
  }

  satSpawn(nodeId){
    if(!this.ready||this.muted)return;
    const f=hashFreq(nodeId)*2,o=this.ctx.createOscillator(),g=this.ctx.createGain();
    o.type="sine";
    o.frequency.setValueAtTime(f*1.18,this.ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f,this.ctx.currentTime+0.1);
    g.gain.setValueAtTime(0.075,this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+0.55);
    o.connect(g);g.connect(this.reverbIn);o.start();o.stop(this.ctx.currentTime+0.6);
  }

  gemCollect(hue){
    if(!this.ready)return;
    const bf=392+(hue/360)*300;
    [1,1.25,1.5,2].forEach((m,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine";o.frequency.value=bf*m;
      const t=this.ctx.currentTime+i*0.08;
      g.gain.setValueAtTime(0.08-i*0.015,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+1.2);
      o.connect(g);g.connect(this.reverbIn);o.start(t);o.stop(t+1.3);
    });
  }

  piecePlace(){
    if(!this.ready)return;
    [261.63,329.63,392,523.25,659.25,783.99].forEach((f,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine";o.frequency.value=f;
      const t=this.ctx.currentTime+i*0.09;
      g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.10,t+0.04);
      g.gain.exponentialRampToValueAtTime(0.001,t+1.4);
      o.connect(g);g.connect(this.reverbIn);o.start(t);o.stop(t+1.5);
    });
  }

  startOrbit(sp){
    if(!this.ready||this.orbitNodes)return;
    const o=this.ctx.createOscillator(),lfo=this.ctx.createOscillator(),
          lg=this.ctx.createGain(),g=this.ctx.createGain();
    o.type="sine";o.frequency.value=82.41;
    lfo.frequency.value=Math.min(Math.max(Math.abs(sp)*25,0.35),4);
    lg.gain.value=0.04;g.gain.value=0;
    g.gain.setTargetAtTime(0.08,this.ctx.currentTime,0.7);
    lfo.connect(lg);lg.connect(g.gain);o.connect(g);g.connect(this.reverbIn);
    o.start();lfo.start();this.orbitNodes={osc:o,lfo,gain:g};
  }

  stopOrbit(){
    if(!this.orbitNodes)return;
    const n=this.orbitNodes;this.orbitNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.45);
    setTimeout(()=>{try{n.osc.stop();n.lfo.stop();}catch(_){}},2200);
  }

  _sw(f0,f1,dur){
    if(!this.ready||this.muted)return;
    const n=Math.floor(this.ctx.sampleRate*dur),buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource();src.buffer=buf;
    const bpf=this.ctx.createBiquadFilter();bpf.type="bandpass";bpf.Q.value=4;
    bpf.frequency.setValueAtTime(f0,this.ctx.currentTime);
    bpf.frequency.exponentialRampToValueAtTime(f1,this.ctx.currentTime+dur);
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0.14,this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    src.connect(bpf);bpf.connect(g);g.connect(this.master);src.start();
  }

  zoomOut(){this._sw(600,160,0.5);}
  zoomIn(){this._sw(180,720,0.32);}

  pressCharge(prog){
    if(!this.ready||this.muted)return;
    if(prog>0.02&&!this.pressNodes){
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine";o.frequency.value=220;g.gain.value=0.01;
      o.connect(g);g.connect(this.master);o.start();this.pressNodes={osc:o,gain:g};
    }
    if(this.pressNodes){
      this.pressNodes.osc.frequency.setTargetAtTime(220+prog*prog*680,this.ctx.currentTime,0.04);
      this.pressNodes.gain.gain.setTargetAtTime(0.01+prog*0.06,this.ctx.currentTime,0.04);
    }
  }

  releasePressCharge(done){
    if(!this.pressNodes)return;
    const n=this.pressNodes;this.pressNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.08);
    setTimeout(()=>{try{n.osc.stop();}catch(_){}},600);
    if(done){
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine";o.frequency.value=880;
      g.gain.setValueAtTime(0.09,this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+0.65);
      o.connect(g);g.connect(this.reverbIn);o.start();o.stop(this.ctx.currentTime+0.7);
    }
  }

  destroy(){this.stopThemeAmb();if(this.ctx)this.ctx.close();}
}

// ─── 보석 노드 렌더 ───────────────────────────────────────────────────────────
function drawGem(ctx,sx,sy,size,hue,bri,time,spark,zoom){
  const sz=size*zoom;
  const glow=ctx.createRadialGradient(sx,sy,0,sx,sy,sz*6);
  glow.addColorStop(0,`hsla(${hue},90%,65%,${bri*0.4})`);glow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sx,sy,sz*6,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(sx,sy);
  ctx.beginPath();
  for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2-Math.PI/6;i===0?ctx.moveTo(Math.cos(a)*sz,Math.sin(a)*sz):ctx.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);}
  ctx.closePath();
  const gg=ctx.createRadialGradient(-sz*0.3,-sz*0.35,0,sz*0.1,sz*0.1,sz*1.2);
  gg.addColorStop(0,`hsla(${hue},90%,88%,${bri})`);gg.addColorStop(0.5,`hsla(${hue},80%,60%,${bri})`);gg.addColorStop(1,`hsla(${hue},70%,32%,${bri*0.8})`);
  ctx.fillStyle=gg;ctx.fill();
  for(let i=0;i<6;i++){const a=(i/6)*Math.PI*2-Math.PI/6;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);ctx.strokeStyle=`hsla(${hue},60%,92%,${bri*0.3})`;ctx.lineWidth=0.7;ctx.stroke();}
  ctx.restore();
  for(let i=0;i<3;i++){
    const sa=spark+time*0.8+i*(Math.PI*2/3),sr=sz*(1.5+Math.sin(time*2+i)*0.4),spA=Math.sin(time*3+i*1.4)*0.5+0.5;
    if(bri*spA<0.08)continue;
    ctx.save();ctx.translate(sx+Math.cos(sa)*sr,sy+Math.sin(sa)*sr);
    const ss=sz*0.16*spA;
    ctx.beginPath();ctx.moveTo(0,-ss*2);ctx.lineTo(ss*0.4,-ss*0.4);ctx.lineTo(ss*2,0);ctx.lineTo(ss*0.4,ss*0.4);ctx.lineTo(0,ss*2);ctx.lineTo(-ss*0.4,ss*0.4);ctx.lineTo(-ss*2,0);ctx.lineTo(-ss*0.4,-ss*0.4);ctx.closePath();
    ctx.fillStyle=`hsla(${hue},80%,90%,${bri*spA*0.85})`;ctx.fill();ctx.restore();
  }
}

// ─── 시드 기반 난수 생성기 ─────────────────────────────────────────────────────
function seededRng(seed){
  let s=seed|0;
  return()=>{s=Math.imul(s^(s>>>16),0x45d9f3b);s=Math.imul(s^(s>>>16),0x45d9f3b);s^=s>>>16;return(s>>>0)/0xffffffff;};
}

// ─── 랜덤 균열 패턴 생성 ─────────────────────────────────────────────────────
function generateShatterPattern(seed){
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
      shards.push(buildCleanWedge(a1,a2,0,splitR,rng));
      shards.push(buildCleanWedge(a1,a2,splitR,0.97,rng));
    }else{
      shards.push(buildCleanWedge(a1,a2,0,0.97,rng));
    }
  }
  return shards;
}

function buildCleanWedge(a1,a2,r1,r2,rng){
  const pts=[];
  const span=((a2-a1)+Math.PI*2)%(Math.PI*2);
  const steps=Math.max(3,Math.ceil(span/(Math.PI/5)));
  if(r1<0.01){
    pts.push([0,0]);
  }else{
    for(let i=0;i<=steps;i++){const a=a1+span*i/steps;pts.push([Math.cos(a)*r1,Math.sin(a)*r1]);}
  }
  for(let i=steps;i>=0;i--){
    const a=a1+span*i/steps,rv=r2*(1+(rng()-0.5)*0.035);
    pts.push([Math.cos(a)*rv,Math.sin(a)*rv]);
  }
  return pts;
}

// ─── 구체 디테일 뷰 ───────────────────────────────────────────────────────────
function drawSphereDetail(ctx,cw,ch,gems,shards,shatterPhase,shatterT,time,alpha){
  if(alpha<0.01)return;
  ctx.globalAlpha=alpha;
  ctx.fillStyle=`rgba(4,3,10,${alpha*0.96})`;ctx.fillRect(0,0,cw,ch);
  const isLS=cw>ch;
  const sR=Math.round(isLS?Math.min(ch*0.38,cw*0.26):Math.min(cw*0.44,ch*0.30));
  const sCX=Math.round(isLS?cw*0.32:cw*0.50);
  const sCY=Math.round(isLS?ch*0.50:ch*0.40);
  const outerGlow=ctx.createRadialGradient(sCX,sCY,sR*0.6,sCX,sCY,sR*1.55);
  outerGlow.addColorStop(0,"rgba(80,60,140,0.0)");outerGlow.addColorStop(0.5,`rgba(60,40,110,${0.12*alpha})`);outerGlow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=outerGlow;ctx.beginPath();ctx.arc(sCX,sCY,sR*1.55,0,Math.PI*2);ctx.fill();
  const ease=(t)=>t<0.5?2*t*t:(1-Math.pow(-2*t+2,2)/2);
  if(shatterPhase==='whole'){drawBlackOrb(ctx,sCX,sCY,sR,0,[]);}
  else if(shatterPhase==='crack'){drawBlackOrb(ctx,sCX,sCY,sR,ease(shatterT),shards);}
  else if(shatterPhase==='split'){drawShardsSpread(ctx,sCX,sCY,sR,shards,ease(shatterT)*0.055,gems,time,alpha);}
  else if(shatterPhase==='reform'){drawShardsSpread(ctx,sCX,sCY,sR,shards,(1-ease(shatterT))*0.055,gems,time,alpha);}
  else{drawShardsSpread(ctx,sCX,sCY,sR,shards,0,gems,time,alpha);}
  ctx.beginPath();ctx.arc(sCX,sCY,sR,0,Math.PI*2);ctx.strokeStyle="rgba(120,100,180,0.30)";ctx.lineWidth=1;ctx.stroke();
  const filled=Math.min(gems.length,shards.length);
  ctx.fillStyle="rgba(180,160,220,0.40)";ctx.font=`${Math.round(sR*0.09)}px 'Courier New',monospace`;ctx.textAlign="center";
  ctx.fillText(`${filled} / ${shards.length}`,sCX,sCY+sR+sR*0.16);
  if(isLS&&gems.length>0){
    const pX=cw*0.60,pY=ch*0.12,pW=cw*0.36,pH=ch*0.78;
    ctx.fillStyle="rgba(255,255,255,0.03)";ctx.strokeStyle="rgba(120,100,180,0.15)";ctx.lineWidth=1;
    ctx.beginPath();if(ctx.roundRect)ctx.roundRect(pX,pY,pW,pH,10);else ctx.rect(pX,pY,pW,pH);ctx.fill();ctx.stroke();
    ctx.fillStyle="rgba(180,160,220,0.5)";ctx.font=`${Math.round(pH*0.046)}px 'Courier New',monospace`;
    ctx.textAlign="left";ctx.fillText("수집한 보석",pX+14,pY+pH*0.07);
    const cols=4,gS=Math.min(pW/5.2,pH/6,28);const gXs=(pW-20)/cols,gYs=gS*2.4;
    gems.forEach((g,i)=>{
      const col=i%cols,row=Math.floor(i/cols);const gx=pX+12+col*gXs+gXs/2,gy=pY+pH*0.14+row*gYs+gS;
      if(gy+gS>pY+pH-10)return;
      const sh=Math.sin(time*1.3+i*0.8)*0.15+0.85;
      ctx.save();ctx.translate(gx,gy);
      ctx.beginPath();for(let j=0;j<6;j++){const a=(j/6)*Math.PI*2-Math.PI/6;j===0?ctx.moveTo(Math.cos(a)*gS,Math.sin(a)*gS):ctx.lineTo(Math.cos(a)*gS,Math.sin(a)*gS);}ctx.closePath();
      const gg=ctx.createRadialGradient(-gS*0.3,-gS*0.3,0,0,0,gS);
      gg.addColorStop(0,`hsla(${g.hue},90%,88%,${sh})`);gg.addColorStop(0.5,`hsla(${g.hue},80%,58%,${sh})`);gg.addColorStop(1,`hsla(${g.hue},70%,30%,${sh*0.8})`);
      ctx.fillStyle=gg;ctx.fill();ctx.strokeStyle=`hsla(${g.hue},70%,88%,0.45)`;ctx.lineWidth=0.6;ctx.stroke();ctx.restore();
      ctx.fillStyle=`hsla(${g.hue},65%,72%,0.65)`;ctx.font=`${Math.round(gS*0.38)}px 'Courier New',monospace`;ctx.textAlign="center";ctx.fillText(g.name,gx,gy+gS*1.52);
    });
  }
  ctx.fillStyle="rgba(110,100,150,0.32)";ctx.font=`${Math.round(Math.min(cw,ch)*0.021)}px 'Courier New',monospace`;ctx.textAlign="center";
  ctx.fillText("탭하면 닫힘",sCX,sCY+sR+(isLS?sR*0.30:sR*0.34));
  ctx.globalAlpha=1;
}

function drawBlackOrb(ctx,sCX,sCY,sR,crackAlpha,shards){
  ctx.save();ctx.beginPath();ctx.arc(sCX,sCY,sR,0,Math.PI*2);ctx.clip();
  const base=ctx.createRadialGradient(sCX,sCY,0,sCX,sCY,sR);
  base.addColorStop(0,"rgb(22,18,32)");base.addColorStop(0.5,"rgb(12,9,20)");base.addColorStop(1,"rgb(4,3,8)");
  ctx.fillStyle=base;ctx.fillRect(sCX-sR,sCY-sR,sR*2,sR*2);
  if(crackAlpha>0.01){
    ctx.lineCap="round";
    shards.forEach(poly=>{
      ctx.beginPath();poly.forEach(([nx,ny],i)=>i===0?ctx.moveTo(sCX+nx*sR,sCY+ny*sR):ctx.lineTo(sCX+nx*sR,sCY+ny*sR));ctx.closePath();
      ctx.strokeStyle=`rgba(80,60,120,${crackAlpha*0.6})`;ctx.lineWidth=0.8;ctx.stroke();
    });
  }
  const hlx=sCX-sR*0.32,hly=sCY-sR*0.30;
  const hl=ctx.createRadialGradient(hlx,hly,0,hlx,hly,sR*0.50);
  hl.addColorStop(0,"rgba(255,255,255,0.28)");hl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=hl;ctx.fillRect(sCX-sR,sCY-sR,sR*2,sR*2);ctx.restore();
}

function drawShardsSpread(ctx,sCX,sCY,sR,shards,spread,gems,time){
  ctx.save();ctx.beginPath();ctx.arc(sCX,sCY,sR*(1+spread*1.5),0,Math.PI*2);ctx.clip();
  const base=ctx.createRadialGradient(sCX,sCY,0,sCX,sCY,sR);
  base.addColorStop(0,"rgb(18,14,28)");base.addColorStop(1,"rgb(4,3,8)");
  ctx.fillStyle=base;ctx.fillRect(sCX-sR*2,sCY-sR*2,sR*4,sR*4);
  shards.forEach((poly,idx)=>{
    const gem=gems[idx];
    const cx2=poly.reduce((s,[x])=>s+x,0)/poly.length,cy2=poly.reduce((s,[,y])=>s+y,0)/poly.length;
    const ox=cx2*spread*sR*18,oy=cy2*spread*sR*18;
    ctx.save();ctx.translate(ox,oy);
    ctx.beginPath();poly.forEach(([nx,ny],i)=>i===0?ctx.moveTo(sCX+nx*sR,sCY+ny*sR):ctx.lineTo(sCX+nx*sR,sCY+ny*sR));ctx.closePath();
    if(gem){
      const shimmer=Math.sin(time*1.8+idx*0.7)*0.12+0.88;
      const gx=sCX+cx2*sR,gy=sCY+cy2*sR;
      const g=ctx.createLinearGradient(gx-sR*0.38,gy-sR*0.38,gx+sR*0.32,gy+sR*0.32);
      g.addColorStop(0,`hsla(${gem.hue},90%,84%,${shimmer*0.96})`);g.addColorStop(0.3,`hsla(${gem.hue},80%,60%,${shimmer*0.92})`);g.addColorStop(0.65,`hsla(${gem.hue},70%,36%,${shimmer*0.86})`);g.addColorStop(1,`hsla(${gem.hue},60%,18%,${shimmer*0.80})`);
      ctx.fillStyle=g;ctx.fill();
      const hg=ctx.createRadialGradient(gx-sR*0.16,gy-sR*0.16,0,gx-sR*0.16,gy-sR*0.16,sR*0.25);
      hg.addColorStop(0,`hsla(${gem.hue},100%,97%,${shimmer*0.62})`);hg.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=hg;ctx.fill();
      ctx.strokeStyle=`hsla(${gem.hue},80%,88%,0.50)`;ctx.lineWidth=0.9;ctx.stroke();
      const spk=Math.sin(time*2.2+idx*1.3);
      if(spk>0.62){
        const spx=gx+Math.cos(time+idx)*sR*0.12,spy=gy+Math.sin(time*1.3+idx)*sR*0.10,ss=sR*0.042*((spk-0.62)/0.38);
        ctx.beginPath();ctx.moveTo(spx,spy-ss*2.5);ctx.lineTo(spx+ss*0.5,spy-ss*0.5);ctx.lineTo(spx+ss*2.5,spy);ctx.lineTo(spx+ss*0.5,spy+ss*0.5);ctx.lineTo(spx,spy+ss*2.5);ctx.lineTo(spx-ss*0.5,spy+ss*0.5);ctx.lineTo(spx-ss*2.5,spy);ctx.lineTo(spx-ss*0.5,spy-ss*0.5);ctx.closePath();
        ctx.fillStyle=`hsla(${gem.hue},100%,98%,${(spk-0.62)/0.38*0.88})`;ctx.fill();
      }
    }else{ctx.fillStyle="rgba(0,0,0,0.38)";ctx.fill();ctx.strokeStyle="rgba(60,50,100,0.28)";ctx.lineWidth=0.6;ctx.stroke();}
    ctx.restore();
  });
  const hlx=sCX-sR*0.32,hly=sCY-sR*0.30;
  const hl=ctx.createRadialGradient(hlx,hly,0,hlx,hly,sR*0.50);
  hl.addColorStop(0,"rgba(255,255,255,0.24)");hl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=hl;ctx.fillRect(sCX-sR*2,sCY-sR*2,sR*4,sR*4);ctx.restore();
}

// ─── 퍼즐 판 ─────────────────────────────────────────────────────────────────
function drawPuzzleBoard(ctx,cw,ch,state,time,alpha){
  if(alpha<0.01)return;
  ctx.globalAlpha=alpha;
  ctx.fillStyle="rgb(3,3,10)";ctx.fillRect(0,0,cw,ch);
  for(let i=0;i<200;i++){
    const sx=((i*7919+i*1234)%(cw*10))/10,sy=((i*6271+i*4321)%(ch*10))/10;
    const ss=((i%5)*0.25+0.25),pulse=Math.sin(time*0.7+i*0.6)*0.3+0.7;
    ctx.beginPath();ctx.arc(sx,sy,ss,0,Math.PI*2);ctx.fillStyle=`rgba(200,200,255,${0.12*pulse})`;ctx.fill();
  }
  const neb=ctx.createRadialGradient(cw*0.5,ch*0.45,0,cw*0.5,ch*0.45,Math.max(cw,ch)*0.65);
  neb.addColorStop(0,"rgba(20,8,55,0.5)");neb.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=neb;ctx.fillRect(0,0,cw,ch);
  const {placedMap,currentPieceKey,inventoryPieces,selectedInventoryId,puzzleFragments}=state;
  let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
  placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);minC=Math.min(minC,c);maxC=Math.max(maxC,c);minR=Math.min(minR,r);maxR=Math.max(maxR,r);});
  const gridW=maxC-minC+1,gridH=maxR-minR+1;
  const boardAreaH=ch*0.62;
  const pieceSize=Math.min(Math.min(cw*0.82/Math.max(gridW+2,3),boardAreaH/Math.max(gridH+2,3)),120);
  const gap=pieceSize*0.12,stride=pieceSize+gap;
  const boardCX=cw/2,boardCY=ch*0.36;
  const toSX=(col)=>boardCX+(col-minC-(gridW-1)/2)*stride;
  const toSY=(row)=>boardCY+(row-minR-(gridH-1)/2)*stride;
  const validSlots=new Set();
  if(selectedInventoryId){
    placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(!placedMap.has(nk))validSlots.add(nk);});});
  }
  validSlots.forEach(k=>{
    const [c,r]=k.split(",").map(Number);const sx=toSX(c),sy=toSY(r);
    ctx.save();ctx.translate(sx,sy);
    ctx.strokeStyle="rgba(180,160,255,0.45)";ctx.lineWidth=1.5;ctx.setLineDash([5,6]);
    ctx.strokeRect(-pieceSize/2,-pieceSize/2,pieceSize,pieceSize);ctx.setLineDash([]);
    ctx.fillStyle="rgba(140,120,220,0.08)";ctx.fillRect(-pieceSize/2,-pieceSize/2,pieceSize,pieceSize);
    ctx.fillStyle="rgba(180,160,255,0.4)";ctx.font=`${Math.round(pieceSize*0.22)}px serif`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("+",0,0);ctx.restore();
  });
  placedMap.forEach((pieceData,k)=>{
    const [c,r]=k.split(",").map(Number);const sx=toSX(c),sy=toSY(r);
    const isCurrent=k===currentPieceKey,theme=THEMES[pieceData.themeId];
    const pulse=isCurrent?Math.sin(time*1.5)*0.04+0.96:1,ps=pieceSize*pulse;
    const exploreRatio=Math.min(1,pieceData.explored/(NODES_PER_PIECE*0.5));
    ctx.save();ctx.translate(sx,sy);
    const grad=ctx.createLinearGradient(-ps/2,-ps/2,ps/2,ps/2);
    const [b0,b1,b2]=theme.bg;
    grad.addColorStop(0,`rgba(${b0+30},${b1+25},${b2+40},0.92)`);grad.addColorStop(1,`rgba(${b0},${b1},${b2},0.88)`);
    ctx.fillStyle=grad;ctx.fillRect(-ps/2,-ps/2,ps,ps);
    if(exploreRatio>0){
      const expGrad=ctx.createRadialGradient(0,0,0,0,0,ps*0.6);
      expGrad.addColorStop(0,`${theme.boardColor.replace("0.8",String(exploreRatio*0.35))}`);expGrad.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=expGrad;ctx.fillRect(-ps/2,-ps/2,ps,ps);
    }
    if(isCurrent){ctx.strokeStyle=theme.boardColor;ctx.lineWidth=2.5;ctx.strokeRect(-ps/2,-ps/2,ps,ps);ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.9)";ctx.fill();}
    else{ctx.strokeStyle=theme.boardColor.replace("0.8","0.35");ctx.lineWidth=1;ctx.strokeRect(-ps/2,-ps/2,ps,ps);}
    ctx.fillStyle=theme.boardColor;ctx.font=`${Math.round(ps*0.11)}px 'Courier New',monospace`;ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(theme.name,0,isCurrent?ps*0.25:0);
    if(exploreRatio>0.05&&!isCurrent){ctx.fillStyle="rgba(200,190,255,0.5)";ctx.font=`${Math.round(ps*0.09)}px 'Courier New',monospace`;ctx.fillText(`${Math.round(exploreRatio*100)}%`,0,ps*0.22);}
    if(isCurrent){ctx.fillStyle="rgba(200,190,255,0.55)";ctx.font=`${Math.round(ps*0.09)}px 'Courier New',monospace`;ctx.fillText(`${Math.round(exploreRatio*100)}% 탐험`,0,-ps*0.22);}
    DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(placedMap.has(nk)){const ex=d.dc*ps/2,ey=d.dr*ps/2;ctx.beginPath();ctx.moveTo(ex-d.dr*4,ey-d.dc*4);ctx.lineTo(ex+d.dr*4,ey+d.dc*4);ctx.strokeStyle=theme.boardColor.replace("0.8","0.5");ctx.lineWidth=2;ctx.stroke();}});
    ctx.restore();
  });
  const invCX=cw/2,invCY=ch/2,scatterR=Math.min(cw,ch)*0.42;
  inventoryPieces.forEach((inv,idx)=>{
    const sx=invCX+Math.cos(inv.scatterAngle)*scatterR*inv.scatterDist,sy=invCY+Math.sin(inv.scatterAngle)*scatterR*inv.scatterDist;
    const theme=THEMES[inv.themeId],isSelected=inv.id===selectedInventoryId;
    const ps=pieceSize*(isSelected?0.62:0.52),pulse=isSelected?Math.sin(time*3)*0.06+0.94:1;
    ctx.save();ctx.translate(sx,sy);ctx.rotate(inv.rotation);
    const grad=ctx.createLinearGradient(-ps/2,-ps/2,ps/2,ps/2);
    const [b0,b1,b2]=theme.bg;
    grad.addColorStop(0,`rgba(${b0+20},${b1+18},${b2+30},${isSelected?0.95:0.80})`);grad.addColorStop(1,`rgba(${b0},${b1},${b2},${isSelected?0.90:0.75})`);
    ctx.fillStyle=grad;ctx.fillRect(-ps/2*pulse,-ps/2*pulse,ps*pulse,ps*pulse);
    if(isSelected){ctx.strokeStyle=theme.boardColor;ctx.lineWidth=2.2;const glow=ctx.createRadialGradient(0,0,0,0,0,ps);glow.addColorStop(0,theme.boardColor.replace("0.8","0.25"));glow.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=glow;ctx.fillRect(-ps,-ps,ps*2,ps*2);}
    else{ctx.strokeStyle=theme.boardColor.replace("0.8","0.45");ctx.lineWidth=1;}
    ctx.strokeRect(-ps/2*pulse,-ps/2*pulse,ps*pulse,ps*pulse);
    ctx.fillStyle=isSelected?theme.boardColor:"rgba(180,170,220,0.6)";ctx.font=`${Math.round(ps*0.18)}px 'Courier New',monospace`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(theme.name,0,0);ctx.restore();
  });
  ctx.fillStyle="rgba(255,195,50,0.85)";ctx.font=`${Math.round(Math.min(cw,ch)*0.032)}px 'Courier New',monospace`;ctx.textAlign="left";ctx.fillText(`✦ 퍼즐 조각 ×${puzzleFragments}`,18,ch-20);
  if(selectedInventoryId){ctx.fillStyle="rgba(180,160,255,0.6)";ctx.font=`${Math.round(Math.min(cw,ch)*0.022)}px 'Courier New',monospace`;ctx.fillText("점선 위치에 놓기",18,ch-6);}
  else if(inventoryPieces.length>0&&puzzleFragments>0){ctx.fillStyle="rgba(180,160,255,0.4)";ctx.font=`${Math.round(Math.min(cw,ch)*0.022)}px 'Courier New',monospace`;ctx.fillText("흩어진 조각을 탭해보세요",18,ch-6);}
  ctx.fillStyle="rgba(120,110,170,0.35)";ctx.font=`${Math.round(Math.min(cw,ch)*0.020)}px 'Courier New',monospace`;ctx.textAlign="right";ctx.fillText("🗺 또는 더블탭 → 탐험으로",cw-14,ch-6);
  ctx.globalAlpha=1;
}

// ─── 퍼즐 조각 획득 토스트 ───────────────────────────────────────────────────
function PieceToast({themeName}){
  const [visible,setVisible]=useState(true);
  useEffect(()=>{const t=setTimeout(()=>setVisible(false),2400);return()=>clearTimeout(t);},[]);
  if(!visible)return null;
  const theme=THEMES.find(t=>t.name===themeName);
  return(
    <div style={{position:"absolute",top:"42%",left:"50%",transform:"translate(-50%,-50%)",
      pointerEvents:"none",animation:"fadeUpOut 2.4s ease forwards",
      color:theme?.boardColor||"rgba(255,210,80,0.95)",fontFamily:"'Courier New',monospace",
      fontSize:"13px",letterSpacing:"0.12em",textShadow:`0 0 18px ${theme?.boardColor||"rgba(255,180,50,0.5)"}`,
      whiteSpace:"nowrap",textAlign:"center"}}>
      ✦ {themeName} 조각
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SphereV9(){
  const canvasRef=useRef(null);
  const audio=useRef(new AudioEngine());
  const haptic=useRef(new HapticEngine());
  const pendingTapRef=useRef(null);

  const initPlaced=()=>{const m=new Map();m.set("0,0",{themeId:0,explored:0,gemCount:0});return m;};
  const initNodes=()=>{const m=new Map();m.set("0,0",generatePieceNodes(0));return m;};
  const initParts=()=>{const m=new Map();m.set("0,0",Array.from({length:PARTICLE_COUNT},()=>makeParticle(0)));return m;};

  const stateRef=useRef({
    sphere:{col:0,row:0,lx:PIECE_W/2,ly:PIECE_H/2},
    vel:{x:SPHERE_SPEED,y:SPHERE_SPEED*0.2},
    targetAngle:Math.atan2(0.2,1),
    trail:[],
    placedMap:initPlaced(),
    pieceNodes:initNodes(),
    pieceParticles:initParts(),
    currentPieceKey:"0,0",
    inventoryPieces:[],
    selectedInventoryId:null,
    puzzleFragments:0,
    nodesForNextFrag:0,
    cam:{x:PIECE_W/2,y:PIECE_H/2},
    zoom:ZOOM_NORMAL,zoomTarget:ZOOM_NORMAL,
    zoomedOut:false,orbitPreview:null,
    puzzleView:false,puzzleAlpha:0,
    detailView:false,detailAlpha:0,
    collectedGems:[],
    orbit:null,
    wallFlash:null,
    shardSeed:Math.floor(Math.random()*0xffffff),
    shardPattern:null,
    shatterPhase:'none',
    shatterT:0,shatterTimer:0,
    time:0,
    lastTapTime:0,lastTapPos:{x:0,y:0},
    pressStart:null,pressProgress:0,pressWorld:null,
    pressScreenStart:null,isDragging:false,revealMode:false,
    prevOrbitActive:false,
    toastKey:0,toastCount:0,showToast:false,
  });

  const animRef=useRef(null);
  const pressTimerRef=useRef(null);
  const [muted,setMuted]=useState(false);
  const [hapticOn,setHapticOn]=useState(true);
  const [hapticSupported]=useState(()=>"vibrate"in navigator);
  const [toasts,setToasts]=useState([]);
  const [stats,setStats]=useState({col:0,row:0,orbiting:false,fragments:0,gems:0,puzzleView:false,themeName:"암흑",nodesLeft:NODES_PER_PUZZLE_FRAG});

  useEffect(()=>{audio.current.setMuted(muted);},[muted]);
  useEffect(()=>{haptic.current.setMuted(!hapticOn);},[hapticOn]);
  useEffect(()=>()=>audio.current.destroy(),[]);

  const initCanvas=useCallback(()=>{const c=canvasRef.current;if(!c)return;c.width=c.offsetWidth;c.height=c.offsetHeight;},[]);
  useEffect(()=>{initCanvas();window.addEventListener("resize",initCanvas);return()=>window.removeEventListener("resize",initCanvas);},[initCanvas]);

  const sphereWorldX=(s)=>s.sphere.col*PIECE_W+s.sphere.lx;
  const sphereWorldY=(s)=>s.sphere.row*PIECE_H+s.sphere.ly;

  const toWorld=useCallback((cx,cy)=>{
    const s=stateRef.current,c=canvasRef.current;if(!c)return{x:0,y:0};
    const rect=c.getBoundingClientRect();
    return{x:(cx-rect.left-c.width/2)/s.zoom+s.cam.x,
           y:(cy-rect.top-c.height/2)/s.zoom+s.cam.y};
  },[]);

  const handleBoardTap=useCallback((cx,cy,cw,ch)=>{
    const s=stateRef.current;
    const {placedMap,inventoryPieces,selectedInventoryId,puzzleFragments}=s;
    let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
    placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);minC=Math.min(minC,c);maxC=Math.max(maxC,c);minR=Math.min(minR,r);maxR=Math.max(maxR,r);});
    const gridW=maxC-minC+1,gridH=maxR-minR+1;
    const boardAreaH=ch*0.62;
    const pieceSize=Math.min(Math.min(cw*0.82/Math.max(gridW+2,3),boardAreaH/Math.max(gridH+2,3)),120);
    const stride=pieceSize*(1.12);
    const boardCX=cw/2,boardCY=ch*0.36;
    const toSX=(col)=>boardCX+(col-minC-(gridW-1)/2)*stride;
    const toSY=(row)=>boardCY+(row-minR-(gridH-1)/2)*stride;
    const rect=canvasRef.current.getBoundingClientRect();
    const sx=cx-rect.left,sy=cy-rect.top;
    const scatterR=Math.min(cw,ch)*0.42,invCX=cw/2,invCY=ch/2;
    let tappedInvId=null;
    inventoryPieces.forEach(inv=>{
      const ix=invCX+Math.cos(inv.scatterAngle)*scatterR*inv.scatterDist;
      const iy=invCY+Math.sin(inv.scatterAngle)*scatterR*inv.scatterDist;
      const ps=pieceSize*(inv.id===selectedInventoryId?0.62:0.52);
      if(Math.abs(sx-ix)<ps*0.6&&Math.abs(sy-iy)<ps*0.6)tappedInvId=inv.id;
    });
    if(tappedInvId){s.selectedInventoryId=tappedInvId===selectedInventoryId?null:tappedInvId;return;}
    if(selectedInventoryId&&puzzleFragments>0){
      const validSlots=new Set();
      placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(!placedMap.has(nk))validSlots.add(nk);});});
      validSlots.forEach(k=>{
        const [c,r]=k.split(",").map(Number);const slotX=toSX(c),slotY=toSY(r);
        if(Math.abs(sx-slotX)<pieceSize*0.55&&Math.abs(sy-slotY)<pieceSize*0.55){
          const inv=inventoryPieces.find(i=>i.id===selectedInventoryId);if(!inv)return;
          placedMap.set(k,{themeId:inv.themeId,explored:0,gemCount:0});
          s.pieceNodes.set(k,generatePieceNodes(inv.themeId));
          s.pieceParticles.set(k,Array.from({length:PARTICLE_COUNT},()=>makeParticle(inv.themeId)));
          s.inventoryPieces=inventoryPieces.filter(i=>i.id!==selectedInventoryId);
          s.puzzleFragments=puzzleFragments-1;s.selectedInventoryId=null;
          audio.current.piecePlace();haptic.current.puzzlePiecePlace();
        }
      });
    }
  },[]);

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
      const wasReveal=s.revealMode,wasDragging=s.isDragging;
      s.isDragging=false;s.pressStart=null;s.pressProgress=0;s.revealMode=false;s.pressScreenStart=null;
      if(au.ready)au.releasePressCharge(false);
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
      const now=performance.now();
      const wp=toWorld(cx,cy);
      const dt=now-s.lastTapTime,dd=Math.hypot(wp.x-s.lastTapPos.x,wp.y-s.lastTapPos.y);
      s.lastTapTime=now;s.lastTapPos={x:wp.x,y:wp.y};
      if(dt<DOUBLE_TAP_MS&&dd<100&&pendingTapRef.current){clearPending();fireDoubleTap();return;}
      clearPending();
      const sc=cx,sd=cy;
      pendingTapRef.current={timer:setTimeout(()=>{pendingTapRef.current=null;fireSingleTap(sc,sd);},SINGLE_TAP_DELAY)};
    };

    // ★ 조이스틱 방식: 드래그 시작점(pressScreenStart) 기준 상대 방향
    const handlePointerMove=(cx,cy,sX,sY)=>{
      const s=stateRef.current;
      if(s.puzzleView)return;
      if(s.pressScreenStart&&!s.isDragging&&!s.revealMode){
        if(Math.hypot(sX-s.pressScreenStart.x,sY-s.pressScreenStart.y)>DRAG_THRESHOLD){
          s.isDragging=true;clearTimeout(pressTimerRef.current);s.pressProgress=0;
          clearPending();if(au.ready)au.releasePressCharge(false);
          if(s.orbit){s.orbit=null;hp.orbitRelease();}
        }
      }
      if(s.isDragging&&!s.orbit&&!s.detailView){
        // ★ 조이스틱: 손가락 시작점 기준 상대 방향으로 steering
        const dx=cx-s.pressScreenStart.x;
        const dy=cy-s.pressScreenStart.y;
        if(Math.hypot(dx,dy)>8){s.targetAngle=Math.atan2(dy,dx);}
      }
      if(s.zoomedOut){
        const wp=toWorld(cx,cy);
        const swx=sphereWorldX(s),swy=sphereWorldY(s);
        const r=Math.hypot(wp.x-swx,wp.y-swy);
        s.orbitPreview=r>15?{wx:wp.x,wy:wp.y,radius:r}:null;
      }
    };

    const startPress=(cx,cy,sX,sY)=>{
      ensure();
      const s=stateRef.current;
      const wp=toWorld(cx,cy);
      s.pressStart={wx:wp.x,wy:wp.y,t:performance.now()};
      s.pressWorld={wx:wp.x,wy:wp.y};
      s.pressScreenStart={x:sX,y:sY};
      s.pressProgress=0;s.revealMode=false;s.isDragging=false;
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
    const onTS=e=>{e.preventDefault();const t=e.touches[0];startPress(t.clientX,t.clientY,t.clientX,t.clientY);};
    const onTE=e=>{e.preventDefault();const t=e.changedTouches[0];handlePointerEnd(t.clientX,t.clientY);};
    const onTM=e=>{e.preventDefault();const t=e.touches[0];handlePointerMove(t.clientX,t.clientY,t.clientX,t.clientY);};

    canvas.addEventListener("mousedown",onMD);canvas.addEventListener("mouseup",onMU);canvas.addEventListener("mousemove",onMM);
    canvas.addEventListener("touchstart",onTS,{passive:false});canvas.addEventListener("touchend",onTE,{passive:false});canvas.addEventListener("touchmove",onTM,{passive:false});
    return()=>{
      canvas.removeEventListener("mousedown",onMD);canvas.removeEventListener("mouseup",onMU);canvas.removeEventListener("mousemove",onMM);
      canvas.removeEventListener("touchstart",onTS);canvas.removeEventListener("touchend",onTE);canvas.removeEventListener("touchmove",onTM);
      clearTimeout(pressTimerRef.current);clearPending();
    };
  },[toWorld,handleBoardTap]);

  // ─── Draw loop ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    const au=audio.current,hp=haptic.current;
    let frame=0;

    const draw=()=>{
      const s=stateRef.current;
      const cw=canvas.width,ch=canvas.height;
      if(!cw||!ch){animRef.current=requestAnimationFrame(draw);return;}
      s.time+=0.016;frame++;

      if(s.pressStart&&!s.isDragging){
        s.pressProgress=Math.min(1,(performance.now()-s.pressStart.t)/LONG_PRESS_MS);
        if(au.ready)au.pressCharge(s.pressProgress);hp.pressCharge(s.pressProgress);
      }

      if(s.puzzleView)s.zoomTarget=ZOOM_OUT*0.55;
      s.zoom+=(s.zoomTarget-s.zoom)*0.06;

      // ── 이동 ────────────────────────────────────────────────────────────────
      if(!s.puzzleView){
        if(s.orbit){
          s.orbit.angle+=s.orbit.angularSpeed;
          const swx=s.orbit.cx+Math.cos(s.orbit.angle)*s.orbit.radius;
          const swy=s.orbit.cy+Math.sin(s.orbit.angle)*s.orbit.radius;
          const targetCol=Math.floor(swx/PIECE_W),targetRow=Math.floor(swy/PIECE_H);
          const targetKey=pk(targetCol,targetRow);
          if(s.placedMap.has(targetKey)){
            s.sphere.col=targetCol;s.sphere.row=targetRow;
            s.sphere.lx=swx-targetCol*PIECE_W;s.sphere.ly=swy-targetRow*PIECE_H;
            const tang=s.orbit.angularSpeed>0?s.orbit.angle+Math.PI/2:s.orbit.angle-Math.PI/2;
            s.vel.x=Math.cos(tang)*SPHERE_SPEED;s.vel.y=Math.sin(tang)*SPHERE_SPEED;
            s.targetAngle=Math.atan2(s.vel.y,s.vel.x);
            hp.orbitTick(s.orbit.angularSpeed);
          }else{
            const curWX=s.sphere.col*PIECE_W+s.sphere.lx,curWY=s.sphere.row*PIECE_H+s.sphere.ly;
            const pieceCX=(s.sphere.col+0.5)*PIECE_W,pieceCY=(s.sphere.row+0.5)*PIECE_H;
            const toCenter=Math.atan2(pieceCY-curWY,pieceCX-curWX);
            s.vel.x=Math.cos(toCenter)*SPHERE_SPEED;s.vel.y=Math.sin(toCenter)*SPHERE_SPEED;
            s.targetAngle=toCenter;s.orbit=null;
          }
        }else{
          const curA=Math.atan2(s.vel.y,s.vel.x);let diff=s.targetAngle-curA;
          while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
          const newA=curA+diff*STEER_STRENGTH;
          s.vel.x=Math.cos(newA)*SPHERE_SPEED;s.vel.y=Math.sin(newA)*SPHERE_SPEED;
          s.sphere.lx+=s.vel.x;s.sphere.ly+=s.vel.y;
          const connL=s.placedMap.has(pk(s.sphere.col-1,s.sphere.row));
          const connR=s.placedMap.has(pk(s.sphere.col+1,s.sphere.row));
          const connT=s.placedMap.has(pk(s.sphere.col,s.sphere.row-1));
          const connB=s.placedMap.has(pk(s.sphere.col,s.sphere.row+1));
          const EDGE=320;
          const resist=(dist,connected)=>{if(connected||dist>EDGE)return 1;return(dist/EDGE)*0.18+0.82;};
          s.vel.x*=resist(s.sphere.lx,connL)*resist(PIECE_W-s.sphere.lx,connR);
          s.vel.y*=resist(s.sphere.ly,connT)*resist(PIECE_H-s.sphere.ly,connB);
          if(s.sphere.lx>PIECE_W){const nk=pk(s.sphere.col+1,s.sphere.row);if(s.placedMap.has(nk)){s.sphere.col++;s.sphere.lx-=PIECE_W;}else{s.sphere.lx=PIECE_W-1;s.vel.x=Math.min(s.vel.x,-0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
          if(s.sphere.lx<0){const nk=pk(s.sphere.col-1,s.sphere.row);if(s.placedMap.has(nk)){s.sphere.col--;s.sphere.lx+=PIECE_W;}else{s.sphere.lx=1;s.vel.x=Math.max(s.vel.x,0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
          if(s.sphere.ly>PIECE_H){const nk=pk(s.sphere.col,s.sphere.row+1);if(s.placedMap.has(nk)){s.sphere.row++;s.sphere.ly-=PIECE_H;}else{s.sphere.ly=PIECE_H-1;s.vel.y=Math.min(s.vel.y,-0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
          if(s.sphere.ly<0){const nk=pk(s.sphere.col,s.sphere.row-1);if(s.placedMap.has(nk)){s.sphere.row--;s.sphere.ly+=PIECE_H;}else{s.sphere.ly=1;s.vel.y=Math.max(s.vel.y,0.2);s.targetAngle=Math.atan2(s.vel.y,s.vel.x);}}
        }
      }

      const newKey=pk(s.sphere.col,s.sphere.row);
      if(newKey!==s.currentPieceKey&&s.placedMap.has(newKey))s.currentPieceKey=newKey;

      const orbitNow=!!s.orbit;
      if(orbitNow&&!s.prevOrbitActive&&au.ready){au.startOrbit(s.orbit.angularSpeed);s.prevOrbitActive=true;}
      else if(!orbitNow&&s.prevOrbitActive){au.stopOrbit();s.prevOrbitActive=false;}

      const swx=sphereWorldX(s),swy=sphereWorldY(s);
      s.trail.push({x:swx,y:swy,age:0});
      if(s.trail.length>280)s.trail.shift();
      s.trail.forEach(p=>p.age++);

      const camTX=s.puzzleView?s.sphere.col*PIECE_W+PIECE_W/2:swx;
      const camTY=s.puzzleView?s.sphere.row*PIECE_H+PIECE_H/2:swy;
      s.cam.x+=(camTX-s.cam.x)*0.07;s.cam.y+=(camTY-s.cam.y)*0.07;

      const wx=x=>(x-s.cam.x)*s.zoom+cw/2;
      const wy=y=>(y-s.cam.y)*s.zoom+ch/2;
      const inView=(x,y,pad=400)=>wx(x)>-pad&&wx(x)<cw+pad&&wy(y)>-pad&&wy(y)<ch+pad;

      const curNodes=s.pieceNodes.get(s.currentPieceKey)||[];
      const curPieceData=s.placedMap.get(s.currentPieceKey);
      const curTheme=THEMES[curPieceData?.themeId||0];

      // ★ 테마 앰비언트 트리거
      if(au.ready)au.startThemeAmb(curPieceData?.themeId??0);

      // ── 근접/공전 수집 ───────────────────────────────────────────────────────
      const PROX_RATE=5, ORBIT_BONUS=3;
      let nearestGemProgress=null;
      curNodes.forEach(n=>{
        if(n.gemCollected&&n.pieceCollected)return;
        const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
        const dSphere=Math.hypot(swx-nx,swy-ny);
        const dOrbit=s.orbit?Math.hypot(s.orbit.cx-nx,s.orbit.cy-ny):Infinity;
        const inProx=dSphere<LIGHT_RADIUS*1.6,orbitNear=dOrbit<LIGHT_RADIUS*1.5;
        if(n.isGem&&!n.gemCollected){
          if(inProx||orbitNear){
            const rate=orbitNear?PROX_RATE*ORBIT_BONUS:PROX_RATE;
            n.gemTimer=(n.gemTimer||0)+rate;
            if(n.gemTimer>=ORBIT_COLLECT_MS&&s.collectedGems.length<MAX_GEM_FRAGS){
              n.gemCollected=true;const gem={hue:n.gemHue,name:n.gemName};s.collectedGems.push(gem);
              if(curPieceData)curPieceData.gemCount++;if(au.ready)au.gemCollect(gem.hue);hp.gemCollect();
            }else{
              const prog=Math.min(1,(n.gemTimer||0)/ORBIT_COLLECT_MS);
              if(!nearestGemProgress||prog>nearestGemProgress.prog)nearestGemProgress={nx,ny,prog,hue:n.gemHue,name:n.gemName,size:n.baseSize};
            }
          }else if(n.gemTimer>0){n.gemTimer=Math.max(0,n.gemTimer-2);}
        }
        if(n.isPiece&&!n.pieceCollected){
          if(inProx||orbitNear){
            const rate=orbitNear?PROX_RATE*ORBIT_BONUS:PROX_RATE;
            n.pieceOrbitTimer=(n.pieceOrbitTimer||0)+rate;
            if(n.pieceOrbitTimer>=ORBIT_COLLECT_MS*1.6){
              n.pieceCollected=true;const newInvPiece=makeInventoryPiece(n.pieceTheme,s.inventoryPieces.length);
              s.inventoryPieces=[...s.inventoryPieces,newInvPiece];s.puzzleFragments++;hp.puzzlePieceGet();
              const key=Date.now();
              setToasts(t=>[...t.slice(-2),{key,themeName:THEMES[n.pieceTheme].name}]);
              setTimeout(()=>setToasts(t=>t.filter(x=>x.key!==key)),2500);
            }
          }else if(n.pieceOrbitTimer>0){n.pieceOrbitTimer=Math.max(0,n.pieceOrbitTimer-2);}
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
              const key=Date.now();const randTheme=THEMES[Math.floor(Math.random()*THEMES.length)];
              s.inventoryPieces=[...s.inventoryPieces,makeInventoryPiece(randTheme.id,s.inventoryPieces.length)];
              setToasts(t=>[...t.slice(-2),{key,themeName:randTheme.name}]);
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

      // ── 구슬 균열 애니메이션 ────────────────────────────────────────────────
      if(s.detailView&&!s.puzzleView){
        if(!s.shardPattern){s.shardPattern=generateShatterPattern(s.shardSeed);s.shatterPhase='whole';s.shatterTimer=0;s.shatterT=0;}
        if(s.shatterPhase!=='done'){
          const PHASE_DUR={whole:600,crack:900,split:500,reform:700};
          s.shatterTimer+=16;const dur=PHASE_DUR[s.shatterPhase]||600;s.shatterT=Math.min(1,s.shatterTimer/dur);
          if(s.shatterT>=1){const next={whole:'crack',crack:'split',split:'reform',reform:'done'};s.shatterPhase=next[s.shatterPhase]||'done';s.shatterTimer=0;s.shatterT=0;}
        }
      }

      if(frame%60===0){
        setStats({col:s.sphere.col,row:s.sphere.row,orbiting:!!s.orbit,
          fragments:s.puzzleFragments,gems:s.collectedGems.length,
          puzzleView:s.puzzleView,themeName:curTheme.name,
          nodesLeft:Math.max(0,NODES_PER_PUZZLE_FRAG-s.nodesForNextFrag)});
      }

      // ══ DRAW ═══════════════════════════════════════════════════════════════
      const [bg0,bg1,bg2]=curTheme.bg;
      ctx.fillStyle=`rgb(${bg0},${bg1},${bg2})`;ctx.fillRect(0,0,cw,ch);
      const gNeb=ctx.createRadialGradient(cw*0.35,ch*0.3,0,cw*0.35,ch*0.3,cw*0.7);
      gNeb.addColorStop(0,`rgba(${bg0+12},${bg1+4},${bg2+25},0.5)`);gNeb.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gNeb;ctx.fillRect(0,0,cw,ch);

      // 공간의 끝 어두워짐
      const lx=s.sphere.lx,ly=s.sphere.ly;const VOID_MARGIN=2200;
      const vConnL=s.placedMap.has(pk(s.sphere.col-1,s.sphere.row));
      const vConnR=s.placedMap.has(pk(s.sphere.col+1,s.sphere.row));
      const vConnT=s.placedMap.has(pk(s.sphere.col,s.sphere.row-1));
      const vConnB=s.placedMap.has(pk(s.sphere.col,s.sphere.row+1));
      const dL=vConnL?VOID_MARGIN:lx,dR=vConnR?VOID_MARGIN:PIECE_W-lx;
      const dT=vConnT?VOID_MARGIN:ly,dB=vConnB?VOID_MARGIN:PIECE_H-ly;
      const voidness=Math.max(0,1-Math.min(dL,dR,dT,dB)/VOID_MARGIN)*0.82;
      if(voidness>0.01){const vg=ctx.createRadialGradient(cw/2,ch/2,Math.min(cw,ch)*0.2,cw/2,ch/2,Math.max(cw,ch)*0.8);vg.addColorStop(0,"rgba(0,0,0,0)");vg.addColorStop(1,`rgba(0,0,3,${voidness})`);ctx.fillStyle=vg;ctx.fillRect(0,0,cw,ch);}

      s.placedMap.forEach((_,k)=>{
        const [c,r]=k.split(",").map(Number);const ox=c*PIECE_W,oy=r*PIECE_H;
        const bx1=wx(ox),by1=wy(oy),bx2=wx(ox+PIECE_W),by2=wy(oy+PIECE_H);
        ctx.strokeStyle=k===s.currentPieceKey?"rgba(150,130,255,0.22)":"rgba(100,90,180,0.10)";
        ctx.lineWidth=1;ctx.setLineDash([8,14]);ctx.strokeRect(bx1,by1,bx2-bx1,by2-by1);ctx.setLineDash([]);
      });

      // 파티클
      curParticles.forEach(p=>{
        const px=s.sphere.col*PIECE_W+p.x,py=s.sphere.row*PIECE_H+p.y;
        const sx=wx(px),sy=wy(py);
        if(sx<-60||sx>cw+60||sy<-60||sy>ch+60)return;
        if(p.isSmall){ctx.beginPath();ctx.arc(sx,sy,Math.max(0.5,p.r*s.zoom),0,Math.PI*2);ctx.fillStyle=`hsla(${p.hue},${p.sat}%,${p.lightness}%,${p.opacity})`;ctx.fill();}
        else{const br=p.blurR*s.zoom;const pg=ctx.createRadialGradient(sx,sy,0,sx,sy,br);pg.addColorStop(0,`hsla(${p.hue},${p.sat}%,${p.lightness}%,${p.opacity})`);pg.addColorStop(1,`hsla(${p.hue},${p.sat}%,${p.lightness}%,0)`);ctx.fillStyle=pg;ctx.beginPath();ctx.arc(sx,sy,br,0,Math.PI*2);ctx.fill();}
      });

      // 트레일
      for(let i=1;i<s.trail.length;i++){
        const p=s.trail[i],prev=s.trail[i-1],prog=i/s.trail.length;
        const alpha=prog*prog*Math.max(0,1-p.age/(280*0.75));
        if(alpha<0.004)continue;
        ctx.beginPath();ctx.moveTo(wx(prev.x),wy(prev.y));ctx.lineTo(wx(p.x),wy(p.y));
        ctx.strokeStyle=`rgba(${curTheme.nodeHue===220?180:200},${curTheme.nodeHue===185?220:160},255,${alpha*0.65})`;
        ctx.lineWidth=prog*2.2*Math.max(s.zoom,0.5);ctx.lineCap="round";ctx.stroke();
      }

      // revealMode 파문
      if(s.revealMode){
        curNodes.forEach(n=>{
          if(n.isPiece&&!n.pieceCollected){
            const nx=s.sphere.col*PIECE_W+n.x,ny=s.sphere.row*PIECE_H+n.y;
            const sxn=wx(nx),syn=wy(ny);const MAX_RIPPLE_R=PIECE_W*0.55*s.zoom;
            for(let ring=0;ring<3;ring++){
              const phase=((s.time*0.22+ring/3)%1),rr=phase*MAX_RIPPLE_R,ra=(1-phase)*(1-phase)*0.45;
              if(ra<0.01)continue;
              ctx.beginPath();ctx.arc(sxn,syn,rr,0,Math.PI*2);ctx.strokeStyle=`rgba(255,225,100,${ra})`;ctx.lineWidth=Math.max(0.5,(1-phase)*2.5);ctx.stroke();
            }
          }
        });
      }

      // ── 노드 렌더 ────────────────────────────────────────────────────────────
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
            ctx.beginPath();ctx.arc(sxn,syn,sz*2,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle=`rgba(255,220,100,0.85)`;ctx.lineWidth=2;ctx.lineCap="round";ctx.stroke();
            const tname=THEMES[n.pieceTheme]?.name||"";
            ctx.fillStyle="rgba(255,230,140,0.8)";ctx.font="9px 'Courier New',monospace";ctx.textAlign="center";ctx.fillText(`${tname} ${Math.round(prog*100)}%`,sxn,syn+sz*3.2);
          }
        }else if(n.isPiece&&n.pieceCollected){
          ctx.beginPath();ctx.arc(sxn,syn,size*0.5*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(255,220,100,0.18)";ctx.lineWidth=1;ctx.stroke();
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

      // orbit
      if(s.orbit){
        const ocx=wx(s.orbit.cx),ocy=wy(s.orbit.cy);
        ctx.beginPath();ctx.arc(ocx,ocy,3,0,Math.PI*2);ctx.fillStyle="rgba(180,170,255,0.4)";ctx.fill();
        ctx.beginPath();ctx.arc(ocx,ocy,s.orbit.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(160,150,240,0.14)";ctx.lineWidth=1;ctx.setLineDash([5,8]);ctx.stroke();ctx.setLineDash([]);
      }

      // wallFlash
      if(s.wallFlash){
        s.wallFlash.t-=0.045;
        if(s.wallFlash.t<=0){s.wallFlash=null;}
        else{
          const fx=wx(s.wallFlash.wx),fy=wy(s.wallFlash.wy),ft=s.wallFlash.t,fr=(1-ft)*80*s.zoom;
          ctx.beginPath();ctx.arc(fx,fy,Math.max(2,fr),0,Math.PI*2);ctx.strokeStyle=`rgba(180,160,255,${ft*0.7})`;ctx.lineWidth=2;ctx.stroke();
          ctx.beginPath();ctx.arc(fx,fy,Math.max(1,fr*0.5),0,Math.PI*2);ctx.strokeStyle=`rgba(220,200,255,${ft*0.5})`;ctx.lineWidth=1;ctx.stroke();
          for(let i=0;i<6;i++){const pa=(i/6)*Math.PI*2,pr=fr*(0.6+Math.sin(ft*8+i)*0.3);ctx.beginPath();ctx.arc(fx+Math.cos(pa)*pr,fy+Math.sin(pa)*pr,1.5,0,Math.PI*2);ctx.fillStyle=`rgba(200,180,255,${ft*0.6})`;ctx.fill();}
        }
      }

      if(s.orbitPreview){
        const pcx=wx(s.orbitPreview.wx),pcy=wy(s.orbitPreview.wy);
        ctx.beginPath();ctx.arc(pcx,pcy,s.orbitPreview.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(180,170,255,0.3)";ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.arc(pcx,pcy,5,0,Math.PI*2);ctx.fillStyle="rgba(200,190,255,0.55)";ctx.fill();
      }

      // ★ 조이스틱 시각 피드백 — 드래그 중 시작점에 작은 십자
      if(s.isDragging&&s.pressScreenStart&&!s.orbit&&!s.detailView&&!s.puzzleView&&!s.zoomedOut){
        const jx=s.pressScreenStart.x,jy=s.pressScreenStart.y;
        // 현재 손가락 위치 방향 벡터
        ctx.save();
        ctx.strokeStyle="rgba(200,190,255,0.22)";ctx.lineWidth=1;ctx.setLineDash([3,5]);
        ctx.beginPath();ctx.arc(jx,jy,32,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
        ctx.beginPath();ctx.moveTo(jx-8,jy);ctx.lineTo(jx+8,jy);ctx.moveTo(jx,jy-8);ctx.lineTo(jx,jy+8);
        ctx.strokeStyle="rgba(200,190,255,0.35)";ctx.lineWidth=1;ctx.stroke();
        ctx.restore();
      }

      if(s.pressStart&&!s.isDragging&&s.pressWorld&&!s.revealMode){
        const pcx=wx(s.pressWorld.wx),pcy=wy(s.pressWorld.wy),prog=s.pressProgress;
        ctx.beginPath();ctx.arc(pcx,pcy,12,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle=`rgba(200,190,255,${0.3+prog*0.5})`;ctx.lineWidth=2;ctx.stroke();
      }

      // 구체
      const spx=wx(swx),spy=wy(swy);
      const warmth=Math.min(1,s.collectedGems.length/12);
      const ssz=(7+Math.sin(s.time*2)*0.5)*s.zoom;
      const gLight=ctx.createRadialGradient(spx,spy,0,spx,spy,LIGHT_RADIUS*s.zoom);
      gLight.addColorStop(0,`rgba(${Math.round(175+warmth*55)},${Math.round(165+warmth*30)},${Math.round(255-warmth*120)},${0.07+warmth*0.05})`);gLight.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gLight;ctx.beginPath();ctx.arc(spx,spy,LIGHT_RADIUS*s.zoom,0,Math.PI*2);ctx.fill();
      const gs=ctx.createRadialGradient(spx-ssz*0.3,spy-ssz*0.3,0,spx,spy,ssz*1.6);
      gs.addColorStop(0,`rgba(255,${Math.round(255-warmth*18)},${Math.round(255-warmth*55)},1)`);gs.addColorStop(0.4,`rgba(${Math.round(220+warmth*30)},${Math.round(215+warmth*10)},${Math.round(255-warmth*80)},0.95)`);gs.addColorStop(1,"rgba(0,0,0,0)");
      ctx.fillStyle=gs;ctx.beginPath();ctx.arc(spx,spy,ssz*1.6,0,Math.PI*2);ctx.fill();
      ctx.beginPath();ctx.arc(spx,spy,ssz,0,Math.PI*2);ctx.fillStyle=`rgba(255,${Math.round(255-warmth*18)},${Math.round(255-warmth*55)},0.97)`;ctx.fill();
      if(warmth>0.05){ctx.beginPath();ctx.arc(spx,spy,ssz*1.06,0,Math.PI*2);ctx.strokeStyle=`rgba(255,195,50,${warmth*0.4})`;ctx.lineWidth=0.8*s.zoom;ctx.stroke();}

      // 퍼즐 판 오버레이
      if(s.puzzleAlpha>0.01)
        drawPuzzleBoard(ctx,cw,ch,{placedMap:s.placedMap,currentPieceKey:s.currentPieceKey,inventoryPieces:s.inventoryPieces,selectedInventoryId:s.selectedInventoryId,puzzleFragments:s.puzzleFragments},s.time,s.puzzleAlpha);

      // 구체 디테일 오버레이
      if(s.detailAlpha>0.01&&s.shardPattern)
        drawSphereDetail(ctx,cw,ch,s.collectedGems,s.shardPattern,s.shatterPhase,s.shatterT,s.time,s.detailAlpha);

      animRef.current=requestAnimationFrame(draw);
    };
    animRef.current=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(animRef.current);
  },[]);

  const td="rgba(150,140,210,0.30)";
  const tg="rgba(255,195,50,0.80)";

  return(
    <div style={{width:"100%",height:"100%",position:"fixed",top:0,left:0,overflow:"hidden",
      display:"flex",flexDirection:"column",fontFamily:"'Courier New',monospace",userSelect:"none"}}>
      <style>{`
        @keyframes fadeUpOut{0%{opacity:0;transform:translate(-50%,-50%) translateY(8px)}15%{opacity:1;transform:translate(-50%,-50%) translateY(0)}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) translateY(-18px)}}
      `}</style>
      <canvas ref={canvasRef} style={{flex:1,width:"100%",touchAction:"none",cursor:"default"}}/>

      {toasts.map(t=><PieceToast key={t.key} themeName={t.themeName}/>)}

      {/* 상단 좌 */}
      <div style={{position:"absolute",top:14,left:16,display:"flex",flexDirection:"column",gap:"4px"}}>
        <span style={{color:td,fontSize:"10px",letterSpacing:"0.13em"}}>
          {stats.puzzleView?"◎ 퍼즐 판":stats.orbiting?"⟳ 공전":`→ ${stats.themeName}`}
        </span>
        {stats.fragments<=2&&<span style={{color:tg,fontSize:"10px",opacity:stats.fragments===0?0.4:1}}>
          ✦ 퍼즐 조각 {stats.fragments===0?"없음":`×${stats.fragments}`}
        </span>}
        {stats.fragments<=2&&stats.nodesLeft>0&&<span style={{color:"rgba(200,185,140,0.45)",fontSize:"9px"}}>
          노드 {stats.nodesLeft}개 더 →
        </span>}
        {stats.gems>0&&<span style={{color:"rgba(255,195,50,0.55)",fontSize:"10px"}}>◈ 보석 {stats.gems}/{MAX_GEM_FRAGS}</span>}
      </div>

      {/* 상단 우 */}
      <div style={{position:"absolute",top:14,right:16,display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"}}>
        <button onClick={()=>setMuted(m=>!m)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:muted?"rgba(120,110,180,0.35)":td,fontSize:"10px",fontFamily:"inherit"}}>
          {muted?"♪ 음소거":"♪"}
        </button>
        {hapticSupported&&<button onClick={()=>setHapticOn(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:hapticOn?td:"rgba(120,110,180,0.35)",fontSize:"10px",fontFamily:"inherit"}}>
          {hapticOn?"〜":"〜 꺼짐"}
        </button>}
      </div>

      {/* 🗺 퍼즐 판 버튼 */}
      <button
        onClick={()=>{const s=stateRef.current;s.puzzleView=!s.puzzleView;s.zoomTarget=s.puzzleView?ZOOM_OUT*0.55:ZOOM_NORMAL;s.selectedInventoryId=null;}}
        style={{position:"absolute",bottom:20,right:20,width:44,height:44,borderRadius:"50%",
          border:"1px solid rgba(150,130,255,0.35)",background:"rgba(10,8,28,0.75)",
          cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:"18px",backdropFilter:"blur(4px)"}}>
        🗺
      </button>

      {/* 하단 힌트 */}
      <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",pointerEvents:"none"}}>
        <span style={{color:"rgba(110,100,170,0.28)",fontSize:"9px",letterSpacing:"0.09em",whiteSpace:"nowrap"}}>
          {stats.puzzleView
            ?"조각 탭 → 선택 · 점선 탭 → 배치  |  🗺 또는 더블탭 → 돌아가기"
            :"누른 곳 기준 드래그 방향 · 꾹 범위 · 더블탭 줌아웃 · 🗺 퍼즐"}
        </span>
      </div>
    </div>
  );
}
