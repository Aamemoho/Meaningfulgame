// ─── 구체 디테일 뷰 (보석 컬렉션 오버레이) ────────────────────────────────────

export function drawSphereDetail(ctx,cw,ch,gems,shards,shatterPhase,shatterT,time,alpha){
  if(alpha<0.01)return;
  ctx.globalAlpha=alpha;
  ctx.fillStyle=`rgba(4,3,10,${alpha*0.96})`; ctx.fillRect(0,0,cw,ch);

  const isLS=cw>ch;
  const sR=Math.round(isLS?Math.min(ch*0.38,cw*0.26):Math.min(cw*0.44,ch*0.30));
  const sCX=Math.round(isLS?cw*0.32:cw*0.50);
  const sCY=Math.round(isLS?ch*0.50:ch*0.40);

  const outerGlow=ctx.createRadialGradient(sCX,sCY,sR*0.6,sCX,sCY,sR*1.55);
  outerGlow.addColorStop(0,"rgba(80,60,140,0.0)");
  outerGlow.addColorStop(0.5,`rgba(60,40,110,${0.12*alpha})`);
  outerGlow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=outerGlow; ctx.beginPath(); ctx.arc(sCX,sCY,sR*1.55,0,Math.PI*2); ctx.fill();

  const ease=(t)=>t<0.5?2*t*t:(1-Math.pow(-2*t+2,2)/2);
  if(shatterPhase==='whole')     _drawBlackOrb(ctx,sCX,sCY,sR,0,[]);
  else if(shatterPhase==='crack') _drawBlackOrb(ctx,sCX,sCY,sR,ease(shatterT),shards);
  else if(shatterPhase==='split') _drawShardsSpread(ctx,sCX,sCY,sR,shards,ease(shatterT)*0.055,gems,time);
  else if(shatterPhase==='reform')_drawShardsSpread(ctx,sCX,sCY,sR,shards,(1-ease(shatterT))*0.055,gems,time);
  else                            _drawShardsSpread(ctx,sCX,sCY,sR,shards,0,gems,time);

  ctx.beginPath(); ctx.arc(sCX,sCY,sR,0,Math.PI*2);
  ctx.strokeStyle="rgba(120,100,180,0.30)"; ctx.lineWidth=1; ctx.stroke();

  const filled=Math.min(gems.length,shards.length);
  ctx.fillStyle="rgba(180,160,220,0.40)";
  ctx.font=`${Math.round(sR*0.09)}px 'Courier New',monospace`;
  ctx.textAlign="center";
  ctx.fillText(`${filled} / ${shards.length}`,sCX,sCY+sR+sR*0.16);

  // 가로 모드일 때 오른쪽에 보석 목록 패널
  if(isLS&&gems.length>0){
    const pX=cw*0.60,pY=ch*0.12,pW=cw*0.36,pH=ch*0.78;
    ctx.fillStyle="rgba(255,255,255,0.03)"; ctx.strokeStyle="rgba(120,100,180,0.15)"; ctx.lineWidth=1;
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(pX,pY,pW,pH,10);
    else ctx.rect(pX,pY,pW,pH);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle="rgba(180,160,220,0.5)";
    ctx.font=`${Math.round(pH*0.046)}px 'Courier New',monospace`;
    ctx.textAlign="left"; ctx.fillText("수집한 보석",pX+14,pY+pH*0.07);
    const cols=4,gS=Math.min(pW/5.2,pH/6,28);
    const gXs=(pW-20)/cols,gYs=gS*2.4;
    gems.forEach((g,i)=>{
      const col=i%cols,row=Math.floor(i/cols);
      const gx=pX+12+col*gXs+gXs/2,gy=pY+pH*0.14+row*gYs+gS;
      if(gy+gS>pY+pH-10)return;
      const sh=Math.sin(time*1.3+i*0.8)*0.15+0.85;
      ctx.save(); ctx.translate(gx,gy);
      ctx.beginPath();
      for(let j=0;j<6;j++){const a=(j/6)*Math.PI*2-Math.PI/6;j===0?ctx.moveTo(Math.cos(a)*gS,Math.sin(a)*gS):ctx.lineTo(Math.cos(a)*gS,Math.sin(a)*gS);}
      ctx.closePath();
      const gg=ctx.createRadialGradient(-gS*0.3,-gS*0.3,0,0,0,gS);
      gg.addColorStop(0,`hsla(${g.hue},90%,88%,${sh})`);
      gg.addColorStop(0.5,`hsla(${g.hue},80%,58%,${sh})`);
      gg.addColorStop(1,`hsla(${g.hue},70%,30%,${sh*0.8})`);
      ctx.fillStyle=gg; ctx.fill();
      ctx.strokeStyle=`hsla(${g.hue},70%,88%,0.45)`; ctx.lineWidth=0.6; ctx.stroke();
      ctx.restore();
      ctx.fillStyle=`hsla(${g.hue},65%,72%,0.65)`;
      ctx.font=`${Math.round(gS*0.38)}px 'Courier New',monospace`;
      ctx.textAlign="center"; ctx.fillText(g.name,gx,gy+gS*1.52);
    });
  }

  ctx.fillStyle="rgba(110,100,150,0.32)";
  ctx.font=`${Math.round(Math.min(cw,ch)*0.021)}px 'Courier New',monospace`;
  ctx.textAlign="center";
  ctx.fillText("탭하면 닫힘",sCX,sCY+sR+(isLS?sR*0.30:sR*0.34));
  ctx.globalAlpha=1;
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────────────────
function _drawBlackOrb(ctx,sCX,sCY,sR,crackAlpha,shards){
  ctx.save(); ctx.beginPath(); ctx.arc(sCX,sCY,sR,0,Math.PI*2); ctx.clip();
  const base=ctx.createRadialGradient(sCX,sCY,0,sCX,sCY,sR);
  base.addColorStop(0,"rgb(22,18,32)"); base.addColorStop(0.5,"rgb(12,9,20)"); base.addColorStop(1,"rgb(4,3,8)");
  ctx.fillStyle=base; ctx.fillRect(sCX-sR,sCY-sR,sR*2,sR*2);
  if(crackAlpha>0.01){
    ctx.lineCap="round";
    shards.forEach(poly=>{
      ctx.beginPath();
      poly.forEach(([nx,ny],i)=>i===0?ctx.moveTo(sCX+nx*sR,sCY+ny*sR):ctx.lineTo(sCX+nx*sR,sCY+ny*sR));
      ctx.closePath();
      ctx.strokeStyle=`rgba(80,60,120,${crackAlpha*0.6})`; ctx.lineWidth=0.8; ctx.stroke();
    });
  }
  const hlx=sCX-sR*0.32,hly=sCY-sR*0.30;
  const hl=ctx.createRadialGradient(hlx,hly,0,hlx,hly,sR*0.50);
  hl.addColorStop(0,"rgba(255,255,255,0.28)"); hl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=hl; ctx.fillRect(sCX-sR,sCY-sR,sR*2,sR*2);
  ctx.restore();
}

function _drawShardsSpread(ctx,sCX,sCY,sR,shards,spread,gems,time){
  ctx.save(); ctx.beginPath(); ctx.arc(sCX,sCY,sR*(1+spread*1.5),0,Math.PI*2); ctx.clip();
  const base=ctx.createRadialGradient(sCX,sCY,0,sCX,sCY,sR);
  base.addColorStop(0,"rgb(18,14,28)"); base.addColorStop(1,"rgb(4,3,8)");
  ctx.fillStyle=base; ctx.fillRect(sCX-sR*2,sCY-sR*2,sR*4,sR*4);
  shards.forEach((poly,idx)=>{
    const gem=gems[idx];
    const cx2=poly.reduce((s,[x])=>s+x,0)/poly.length;
    const cy2=poly.reduce((s,[,y])=>s+y,0)/poly.length;
    const ox=cx2*spread*sR*18,oy=cy2*spread*sR*18;
    ctx.save(); ctx.translate(ox,oy);
    ctx.beginPath();
    poly.forEach(([nx,ny],i)=>i===0?ctx.moveTo(sCX+nx*sR,sCY+ny*sR):ctx.lineTo(sCX+nx*sR,sCY+ny*sR));
    ctx.closePath();
    if(gem){
      const shimmer=Math.sin(time*1.8+idx*0.7)*0.12+0.88;
      const gx=sCX+cx2*sR,gy=sCY+cy2*sR;
      const g=ctx.createLinearGradient(gx-sR*0.38,gy-sR*0.38,gx+sR*0.32,gy+sR*0.32);
      g.addColorStop(0,`hsla(${gem.hue},90%,84%,${shimmer*0.96})`);
      g.addColorStop(0.3,`hsla(${gem.hue},80%,60%,${shimmer*0.92})`);
      g.addColorStop(0.65,`hsla(${gem.hue},70%,36%,${shimmer*0.86})`);
      g.addColorStop(1,`hsla(${gem.hue},60%,18%,${shimmer*0.80})`);
      ctx.fillStyle=g; ctx.fill();
      const hg=ctx.createRadialGradient(gx-sR*0.16,gy-sR*0.16,0,gx-sR*0.16,gy-sR*0.16,sR*0.25);
      hg.addColorStop(0,`hsla(${gem.hue},100%,97%,${shimmer*0.62})`);
      hg.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=hg; ctx.fill();
      ctx.strokeStyle=`hsla(${gem.hue},80%,88%,0.50)`; ctx.lineWidth=0.9; ctx.stroke();
      const spk=Math.sin(time*2.2+idx*1.3);
      if(spk>0.62){
        const spx=gx+Math.cos(time+idx)*sR*0.12,spy=gy+Math.sin(time*1.3+idx)*sR*0.10;
        const ss=sR*0.042*((spk-0.62)/0.38);
        ctx.beginPath();
        ctx.moveTo(spx,spy-ss*2.5);ctx.lineTo(spx+ss*0.5,spy-ss*0.5);ctx.lineTo(spx+ss*2.5,spy);
        ctx.lineTo(spx+ss*0.5,spy+ss*0.5);ctx.lineTo(spx,spy+ss*2.5);ctx.lineTo(spx-ss*0.5,spy+ss*0.5);
        ctx.lineTo(spx-ss*2.5,spy);ctx.lineTo(spx-ss*0.5,spy-ss*0.5);ctx.closePath();
        ctx.fillStyle=`hsla(${gem.hue},100%,98%,${(spk-0.62)/0.38*0.88})`; ctx.fill();
      }
    }else{
      ctx.fillStyle="rgba(0,0,0,0.38)"; ctx.fill();
      ctx.strokeStyle="rgba(60,50,100,0.28)"; ctx.lineWidth=0.6; ctx.stroke();
    }
    ctx.restore();
  });
  const hlx=sCX-sR*0.32,hly=sCY-sR*0.30;
  const hl=ctx.createRadialGradient(hlx,hly,0,hlx,hly,sR*0.50);
  hl.addColorStop(0,"rgba(255,255,255,0.24)"); hl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=hl; ctx.fillRect(sCX-sR*2,sCY-sR*2,sR*4,sR*4);
  ctx.restore();
}
