// ─── 햅틱 ─────────────────────────────────────────────────────────────────────
export class HapticEngine{
  constructor(){this.supported="vibrate"in navigator;this.muted=false;this._cd={};}
  _can(k,ms){const n=Date.now();if(this._cd[k]&&n-this._cd[k]<ms)return false;this._cd[k]=n;return true;}
  _v(p){if(!this.supported||this.muted)return;try{navigator.vibrate(p);}catch(_){}}
  nodeTouch(id){if(!this._can(`n${id}`,1200))return;this._v(18);}
  satSpawn(){if(!this._can("sat",300))return;this._v([12,60,18]);}
  orbitStart(){if(!this._can("os",800))return;this._v(55);}
  orbitTick(sp){const p=Math.max(1400,Math.min(3500,1/Math.abs(sp)*8));if(!this._can("ot",p))return;this._v(10);}
  orbitRelease(){this._v([8,40,8]);}
  zoomOut(){this._v(35);} zoomIn(){this._v([20,50,12]);}
  pressCharge(prog){const s=Math.floor(prog*5);if(!this._can(`pc${s}`,80))return;this._v([8,10,14,18,24][s]||8);}
  pressComplete(){this._v([0,30,40,30,60]);}
  gemCollect(){this._v([30,60,40,50,80]);}
  puzzlePieceGet(){this._v([15,30,15,30,50]);}
  puzzlePiecePlace(){this._v([20,40,30,50,80,40,60]);}
  steer(){if(!this._can("st",80))return;this._v(6);}
  save(){this._v([10,30,10,30,20]);}
  setMuted(v){this.muted=v;if(v&&this.supported)navigator.vibrate(0);}
}

// ─── 오디오 ───────────────────────────────────────────────────────────────────
const PENTATONIC=[130.81,155.56,174.61,196,220,261.63,311.13,349.23,392,440,523.25,622.25,698.46,783.99,880];
function hashFreq(id){let h=5381;for(let i=0;i<id.length;i++)h=((h<<5)+h+id.charCodeAt(i))|0;return PENTATONIC[Math.abs(h)%PENTATONIC.length];}

// 테마별 앰비언트 설정
const THEME_AMB_CFG=[
  {nf:70,  nq:0.7, nl:0.036, lfoR:0.07, lfoD:0.010, oscs:[{f:41,t:"sine",v:0.055},{f:55.18,t:"sine",v:0.035},{f:27.5,t:"sine",v:0.026}]},
  {nf:340, nq:1.1, nl:0.040, lfoR:0.13, lfoD:0.016, oscs:[{f:110,t:"sine",v:0.030},{f:138.6,t:"sine",v:0.018},{f:82.4,t:"triangle",v:0.013}]},
  {nf:110, nq:1.4, nl:0.044, lfoR:0.055,lfoD:0.020, oscs:[{f:55,t:"sine",v:0.062},{f:73.4,t:"sine",v:0.028},{f:36.7,t:"sine",v:0.022}]},
  {nf:680, nq:1.8, nl:0.026, lfoR:0.19, lfoD:0.012, oscs:[{f:220,t:"sine",v:0.020},{f:293.7,t:"sine",v:0.012},{f:164.8,t:"sine",v:0.014}]},
  {nf:460, nq:1.6, nl:0.031, lfoR:0.16, lfoD:0.014, oscs:[{f:164.8,t:"sine",v:0.034},{f:220,t:"sine",v:0.022},{f:130.8,t:"sine",v:0.018}]},
];

export class AudioEngine{
  constructor(){
    this.ctx=null; this.master=null; this.reverbIn=null;
    this.nodeOscs=new Map(); this.orbitNodes=null; this.pressNodes=null;
    this.muted=false; this.ready=false;
    this.themeAmbNodes=null; this.themeAmbId=-1;
  }

  init(){
    if(this.ready){try{this.ctx.resume();}catch(_){}return;}
    try{
      this.ctx=new(window.AudioContext||window.webkitAudioContext)();
      this.master=this.ctx.createGain(); this.master.gain.value=0.6;
      this.master.connect(this.ctx.destination);
      this._rev(); this._baseAmb(); this.ready=true;
    }catch(e){console.warn("Audio init failed",e);}
  }

  _rev(){
    const d=this.ctx.createDelay(1); d.delayTime.value=0.29;
    const fb=this.ctx.createGain(); fb.gain.value=0.40;
    const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=4200;
    const wet=this.ctx.createGain(); wet.gain.value=0.20;
    const snd=this.ctx.createGain();
    snd.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d);
    d.connect(wet); wet.connect(this.master); snd.connect(this.master);
    this.reverbIn=snd;
  }

  _baseAmb(){
    const g=this.ctx.createGain(); g.gain.value=0.028; g.connect(this.master);
    [{f:55,t:"sine",v:.60},{f:55.18,t:"sine",v:.55}].forEach(({f,t,v})=>{
      const o=this.ctx.createOscillator(),og=this.ctx.createGain();
      o.type=t; o.frequency.value=f; og.gain.value=v;
      o.connect(og); og.connect(g); o.start();
    });
  }

  setMuted(v){
    this.muted=v;
    if(this.master)this.master.gain.setTargetAtTime(v?0:0.6,this.ctx.currentTime,0.4);
  }

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
    this.themeAmbNodes=null; this.themeAmbId=-1;
  }

  _makeThemeAmb(themeId){
    const cfg=THEME_AMB_CFG[themeId]||THEME_AMB_CFG[0];
    const nodes=[];
    const dur=4, rate=this.ctx.sampleRate;
    const buf=this.ctx.createBuffer(1,rate*dur,rate);
    const bd=buf.getChannelData(0);
    for(let i=0;i<rate*dur;i++)bd[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(); src.buffer=buf; src.loop=true;
    const filt=this.ctx.createBiquadFilter(); filt.type="bandpass"; filt.frequency.value=cfg.nf; filt.Q.value=cfg.nq;
    const lp=this.ctx.createBiquadFilter(); lp.type="lowpass"; lp.frequency.value=cfg.nf*3.5;
    const nGain=this.ctx.createGain(); nGain.gain.value=0;
    nGain.gain.setTargetAtTime(cfg.nl,this.ctx.currentTime,2.2);
    const lfo=this.ctx.createOscillator(); lfo.type="sine"; lfo.frequency.value=cfg.lfoR;
    const lfoG=this.ctx.createGain(); lfoG.gain.value=cfg.lfoD;
    lfo.connect(lfoG); lfoG.connect(nGain.gain);
    src.connect(filt); filt.connect(lp); lp.connect(nGain); nGain.connect(this.master);
    src.start(); lfo.start();
    nodes.push({src,gain:nGain}); nodes.push({osc:lfo,gain:lfoG});
    cfg.oscs.forEach(({f,t,v})=>{
      const osc=this.ctx.createOscillator(),g=this.ctx.createGain();
      osc.type=t; osc.frequency.value=f; g.gain.value=0;
      g.gain.setTargetAtTime(v,this.ctx.currentTime,2.8);
      osc.connect(g); g.connect(this.reverbIn); osc.start();
      nodes.push({osc,gain:g});
    });
    return nodes;
  }

  tone(id,bri){
    if(!this.ready)return;
    const tgt=Math.min(bri*0.085,0.085);
    if(!this.nodeOscs.has(id)){
      if(tgt<0.004||this.nodeOscs.size>=8)return;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine"; o.frequency.value=hashFreq(id); g.gain.value=0;
      o.connect(g); g.connect(this.reverbIn); o.start();
      this.nodeOscs.set(id,{osc:o,gain:g});
    }
    const{gain}=this.nodeOscs.get(id);
    gain.gain.setTargetAtTime(tgt,this.ctx.currentTime,0.35);
    if(tgt<0.002){
      const e=this.nodeOscs.get(id); this.nodeOscs.delete(id);
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
    o.connect(g); g.connect(this.reverbIn); o.start(); o.stop(this.ctx.currentTime+0.6);
  }

  gemCollect(hue){
    if(!this.ready)return;
    const bf=392+(hue/360)*300;
    [1,1.25,1.5,2].forEach((m,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine"; o.frequency.value=bf*m;
      const t=this.ctx.currentTime+i*0.08;
      g.gain.setValueAtTime(0.08-i*0.015,t);
      g.gain.exponentialRampToValueAtTime(0.001,t+1.2);
      o.connect(g); g.connect(this.reverbIn); o.start(t); o.stop(t+1.3);
    });
  }

  piecePlace(){
    if(!this.ready)return;
    [261.63,329.63,392,523.25,659.25,783.99].forEach((f,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine"; o.frequency.value=f;
      const t=this.ctx.currentTime+i*0.09;
      g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.10,t+0.04);
      g.gain.exponentialRampToValueAtTime(0.001,t+1.4);
      o.connect(g); g.connect(this.reverbIn); o.start(t); o.stop(t+1.5);
    });
  }

  startOrbit(sp){
    if(!this.ready||this.orbitNodes)return;
    const o=this.ctx.createOscillator(),lfo=this.ctx.createOscillator(),
          lg=this.ctx.createGain(),g=this.ctx.createGain();
    o.type="sine"; o.frequency.value=82.41;
    lfo.frequency.value=Math.min(Math.max(Math.abs(sp)*25,0.35),4);
    lg.gain.value=0.04; g.gain.value=0;
    g.gain.setTargetAtTime(0.08,this.ctx.currentTime,0.7);
    lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(this.reverbIn);
    o.start(); lfo.start(); this.orbitNodes={osc:o,lfo,gain:g};
  }

  stopOrbit(){
    if(!this.orbitNodes)return;
    const n=this.orbitNodes; this.orbitNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.45);
    setTimeout(()=>{try{n.osc.stop();n.lfo.stop();}catch(_){}},2200);
  }

  _sw(f0,f1,dur){
    if(!this.ready||this.muted)return;
    const n=Math.floor(this.ctx.sampleRate*dur);
    const buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<n;i++)d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const bpf=this.ctx.createBiquadFilter(); bpf.type="bandpass"; bpf.Q.value=4;
    bpf.frequency.setValueAtTime(f0,this.ctx.currentTime);
    bpf.frequency.exponentialRampToValueAtTime(f1,this.ctx.currentTime+dur);
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0.14,this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    src.connect(bpf); bpf.connect(g); g.connect(this.master); src.start();
  }

  zoomOut(){this._sw(600,160,0.5);} zoomIn(){this._sw(180,720,0.32);}

  pressCharge(prog){
    if(!this.ready||this.muted)return;
    if(prog>0.02&&!this.pressNodes){
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine"; o.frequency.value=220; g.gain.value=0.01;
      o.connect(g); g.connect(this.master); o.start();
      this.pressNodes={osc:o,gain:g};
    }
    if(this.pressNodes){
      this.pressNodes.osc.frequency.setTargetAtTime(220+prog*prog*680,this.ctx.currentTime,0.04);
      this.pressNodes.gain.gain.setTargetAtTime(0.01+prog*0.06,this.ctx.currentTime,0.04);
    }
  }

  releasePressCharge(done){
    if(!this.pressNodes)return;
    const n=this.pressNodes; this.pressNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.08);
    setTimeout(()=>{try{n.osc.stop();}catch(_){}},600);
    if(done){
      const o=this.ctx.createOscillator(),g=this.ctx.createGain();
      o.type="sine"; o.frequency.value=880;
      g.gain.setValueAtTime(0.09,this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+0.65);
      o.connect(g); g.connect(this.reverbIn); o.start(); o.stop(this.ctx.currentTime+0.7);
    }
  }

  destroy(){this.stopThemeAmb();if(this.ctx)this.ctx.close();}
}
