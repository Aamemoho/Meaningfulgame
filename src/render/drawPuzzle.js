import { THEMES, DIRS, pk, PIECE_W, PIECE_H, NODES_PER_PIECE } from "../constants.js";
import { BOARD_STARS, BOARD_STAR_TYPES } from "../generators.js";
import { drawPuzzleTrailOverlay, drawSharedBadge } from "./drawTrails.js"; // ── 추가

// ─── 퍼즐 판 오버레이 ─────────────────────────────────────────────────────────
// otherTrails: Map(pieceKey → trails) — 멀티플레이 흔적 데이터 (없으면 undefined)
export function drawPuzzleBoard(ctx,cw,ch,state,time,alpha,otherTrails){
  if(alpha<0.01)return;
  ctx.globalAlpha=alpha;
  ctx.fillStyle="rgb(3,3,10)"; ctx.fillRect(0,0,cw,ch);

  // 배경 별
  for(let i=0;i<200;i++){
    const sx=((i*7919+i*1234)%(cw*10))/10,sy=((i*6271+i*4321)%(ch*10))/10;
    const ss=((i%5)*0.25+0.25),pulse=Math.sin(time*0.7+i*0.6)*0.3+0.7;
    ctx.beginPath();ctx.arc(sx,sy,ss,0,Math.PI*2);ctx.fillStyle=`rgba(200,200,255,${0.12*pulse})`;ctx.fill();
  }
  const neb=ctx.createRadialGradient(cw*0.5,ch*0.45,0,cw*0.5,ch*0.45,Math.max(cw,ch)*0.65);
  neb.addColorStop(0,"rgba(20,8,55,0.5)");neb.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=neb;ctx.fillRect(0,0,cw,ch);

  const {placedMap,currentPieceKey,inventoryPieces,selectedInventoryId,puzzleFragments,boardCam,pieceStars,sphere}=state;
  const bcx=boardCam?.x||0,bcy=boardCam?.y||0;
  const bz=state.boardZoom||1.0;

  let minC=Infinity,maxC=-Infinity,minR=Infinity,maxR=-Infinity;
  placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);minC=Math.min(minC,c);maxC=Math.max(maxC,c);minR=Math.min(minR,r);maxR=Math.max(maxR,r);});
  const gridW=maxC-minC+1,gridH=maxR-minR+1;
  const boardAreaH=ch*0.62;
  const pieceSize=Math.min(Math.min(cw*0.82/Math.max(gridW+2,3),boardAreaH/Math.max(gridH+2,3)),120);
  const gap=pieceSize*0.12,stride=pieceSize+gap;
  const psSc=pieceSize*bz;
  const boardCX=cw/2,boardCY=ch*0.36;
  const toSX=(col)=>boardCX+(col-minC-(gridW-1)/2)*stride*bz+bcx;
  const toSY=(row)=>boardCY+(row-minR-(gridH-1)/2)*stride*bz+bcy;

  // BOARD_STARS discovered 감지
  BOARD_STARS.forEach(star=>{
    if(!star.discovered){
      placedMap.forEach((_,k)=>{
        const [pc,pr]=k.split(",").map(Number);
        if(Math.hypot(pc-star.col,pr-star.row)<1.8)star.discovered=true;
      });
    }
  });

  const validSlots=new Set();
  if(selectedInventoryId){
    placedMap.forEach((_,k)=>{const [c,r]=k.split(",").map(Number);DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(!placedMap.has(nk))validSlots.add(nk);});});
  }

  // 원형 경계 띠
  {
    const ox=toSX(0),oy=toSY(0),ringR=7.5*stride*bz;
    const bw=Math.max(psSc*0.18,8);
    const rg=ctx.createRadialGradient(ox,oy,Math.max(0,ringR-bw*2.2),ox,oy,ringR+bw*2.2);
    rg.addColorStop(0,"rgba(255,255,255,0)");rg.addColorStop(0.38,"rgba(255,255,255,0.04)");
    rg.addColorStop(0.50,"rgba(255,255,255,0.14)");rg.addColorStop(0.62,"rgba(255,255,255,0.04)");rg.addColorStop(1,"rgba(255,255,255,0)");
    ctx.save();
    ctx.beginPath();ctx.arc(ox,oy,ringR+bw*2.2,0,Math.PI*2,false);ctx.arc(ox,oy,Math.max(0,ringR-bw*2.2),0,Math.PI*2,true);
    ctx.fillStyle=rg;ctx.fill();
    ctx.beginPath();ctx.arc(ox,oy,ringR,0,Math.PI*2);
    ctx.strokeStyle=`rgba(255,255,255,${0.10+Math.sin(time*0.6)*0.04})`;ctx.lineWidth=Math.max(1,bw*0.35);ctx.stroke();
    ctx.beginPath();ctx.arc(ox,oy,ringR-bw*0.5,0,Math.PI*2);ctx.strokeStyle="rgba(255,255,255,0.04)";ctx.lineWidth=Math.max(0.5,bw*0.12);ctx.stroke();
    ctx.beginPath();ctx.arc(ox,oy,ringR+bw*0.5,0,Math.PI*2);ctx.strokeStyle="rgba(255,255,255,0.04)";ctx.lineWidth=Math.max(0.5,bw*0.12);ctx.stroke();
    ctx.restore();
  }

  // 배치 가능 슬롯
  validSlots.forEach(k=>{
    const [c,r]=k.split(",").map(Number);const sx=toSX(c),sy=toSY(r);
    const slotHasStar=BOARD_STARS.some(bs=>Math.floor(bs.col)===c&&Math.floor(bs.row)===r);
    ctx.save();ctx.translate(sx,sy);
    ctx.strokeStyle=slotHasStar?"rgba(255,220,120,0.65)":"rgba(180,160,255,0.45)";
    ctx.lineWidth=slotHasStar?2:1.5;ctx.setLineDash([5,6]);
    ctx.strokeRect(-psSc/2,-psSc/2,psSc,psSc);ctx.setLineDash([]);
    ctx.fillStyle=slotHasStar?"rgba(255,200,80,0.10)":"rgba(140,120,220,0.08)";ctx.fillRect(-psSc/2,-psSc/2,psSc,psSc);
    ctx.fillStyle=slotHasStar?"rgba(255,215,100,0.55)":"rgba(180,160,255,0.4)";
    ctx.font=`${Math.round(psSc*0.22)}px serif`;ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(slotHasStar?"✦":"+",0,0);ctx.restore();
  });

  // 배치된 조각들
  placedMap.forEach((pieceData,k)=>{
    const [c,r]=k.split(",").map(Number);const sx=toSX(c),sy=toSY(r);
    const isCurrent=k===currentPieceKey,theme=THEMES[pieceData.themeId];
    const pulse=isCurrent?Math.sin(time*1.5)*0.04+0.96:1,ps=psSc*pulse;
    const exploreRatio=Math.min(1,pieceData.explored/(NODES_PER_PIECE*0.5));
    const [b0,b1,b2]=theme.bg;
    ctx.save();ctx.translate(sx,sy);

    if(psSc>50){
      const grad=ctx.createLinearGradient(-ps/2,-ps/2,ps/2,ps/2);
      grad.addColorStop(0,`rgba(${b0+30},${b1+25},${b2+40},0.92)`);grad.addColorStop(1,`rgba(${b0},${b1},${b2},0.88)`);
      ctx.fillStyle=grad;ctx.fillRect(-ps/2,-ps/2,ps,ps);
      if(exploreRatio>0){const eg=ctx.createRadialGradient(0,0,0,0,0,ps*0.6);eg.addColorStop(0,`${theme.boardColor.replace("0.8",String(exploreRatio*0.35))}`);eg.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=eg;ctx.fillRect(-ps/2,-ps/2,ps,ps);}
      if(isCurrent){ctx.strokeStyle=theme.boardColor;ctx.lineWidth=2.5;ctx.strokeRect(-ps/2,-ps/2,ps,ps);ctx.beginPath();ctx.arc(0,0,5,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.9)";ctx.fill();}
      else{ctx.strokeStyle=theme.boardColor.replace("0.8","0.35");ctx.lineWidth=1;ctx.strokeRect(-ps/2,-ps/2,ps,ps);}
      ctx.fillStyle=theme.boardColor;ctx.font=`${Math.round(ps*0.11)}px 'Courier New',monospace`;ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillText(theme.name,0,isCurrent?ps*0.25:0);
      if(exploreRatio>0.05&&!isCurrent){ctx.fillStyle="rgba(200,190,255,0.5)";ctx.font=`${Math.round(ps*0.09)}px 'Courier New',monospace`;ctx.fillText(`${Math.round(exploreRatio*100)}%`,0,ps*0.22);}
      if(isCurrent){ctx.fillStyle="rgba(200,190,255,0.55)";ctx.font=`${Math.round(ps*0.09)}px 'Courier New',monospace`;ctx.fillText(`${Math.round(exploreRatio*100)}% 탐험`,0,-ps*0.22);}
      DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(placedMap.has(nk)){const ex=d.dc*ps/2,ey=d.dr*ps/2;ctx.beginPath();ctx.moveTo(ex-d.dr*3,ey-d.dc*3);ctx.lineTo(ex+d.dr*3,ey+d.dc*3);ctx.strokeStyle=theme.boardColor.replace("0.8","0.5");ctx.lineWidth=2;ctx.stroke();}});
    }else if(psSc>12){
      const brightness=0.55+exploreRatio*0.40;
      ctx.fillStyle=`rgba(${b0+30},${b1+25},${b2+50},${brightness*0.88})`;ctx.fillRect(-ps/2,-ps/2,ps,ps);
      if(exploreRatio>0.05){const eg=ctx.createRadialGradient(0,0,0,0,0,ps*0.6);eg.addColorStop(0,theme.boardColor.replace("0.8",String(exploreRatio*0.55)));eg.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=eg;ctx.fillRect(-ps/2,-ps/2,ps,ps);}
      if(isCurrent){ctx.strokeStyle=theme.boardColor;ctx.lineWidth=Math.max(1,ps*0.05);ctx.strokeRect(-ps/2,-ps/2,ps,ps);ctx.beginPath();ctx.arc(0,0,Math.max(1.5,ps*0.12),0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.95)";ctx.fill();}
      else{ctx.strokeStyle=theme.boardColor.replace("0.8","0.25");ctx.lineWidth=0.6;ctx.strokeRect(-ps/2,-ps/2,ps,ps);}
      DIRS.forEach(d=>{const nk=pk(c+d.dc,r+d.dr);if(placedMap.has(nk)){const ex=d.dc*ps/2,ey=d.dr*ps/2;ctx.beginPath();ctx.moveTo(ex-d.dr*2,ey-d.dc*2);ctx.lineTo(ex+d.dr*2,ey+d.dc*2);ctx.strokeStyle=theme.boardColor.replace("0.8","0.45");ctx.lineWidth=1;ctx.stroke();}});
    }else{
      const dotR=Math.max(1.5,ps*0.42);
      if(isCurrent){const glow=ctx.createRadialGradient(0,0,0,0,0,dotR*6);glow.addColorStop(0,theme.boardColor.replace("0.8","0.35"));glow.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=glow;ctx.beginPath();ctx.arc(0,0,dotR*6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(0,0,dotR*1.5,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.95)";ctx.fill();}
      else{const dimness=0.45+exploreRatio*0.45;ctx.beginPath();ctx.arc(0,0,dotR,0,Math.PI*2);ctx.fillStyle=theme.boardColor.replace("0.8",String(dimness));ctx.fill();}
    }
    ctx.restore();

    // ── 멀티플레이: 공유 조각 흔적 오버레이 + 배지 ────────────────────────────
    if(pieceData.globalSeed&&otherTrails){
      const trails=otherTrails.get(k)||[];
      if(psSc>12){
        drawPuzzleTrailOverlay(ctx,trails,sx,sy,psSc,time);
      }
      drawSharedBadge(ctx,sx,sy,psSc,trails.length>0,time);
    }
  });

  // 조각 위 항성 렌더
  if(pieceStars){
    placedMap.forEach((_,k)=>{
      const stars=pieceStars.get(k);if(!stars)return;
      const [c,r]=k.split(",").map(Number);
      const pLeft=toSX(c)-psSc/2,pTop=toSY(r)-psSc/2;
      stars.forEach(star=>{
        const sx=pLeft+(star.x/PIECE_W)*psSc,sy=pTop+(star.y/PIECE_H)*psSc;
        const pulse=Math.sin(time*1.1+star.phase)*0.25+0.75,bri=star.discovered?0.95:0.55;
        const gr=ctx.createRadialGradient(sx,sy,0,sx,sy,psSc*0.20);
        gr.addColorStop(0,`hsla(${star.hue},90%,92%,${bri*pulse*0.60})`);gr.addColorStop(0.5,`hsla(${star.hue},80%,72%,${bri*pulse*0.15})`);gr.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=gr;ctx.beginPath();ctx.arc(sx,sy,psSc*0.20,0,Math.PI*2);ctx.fill();
        const rayL=psSc*0.09*pulse;
        ctx.save();ctx.translate(sx,sy);
        [0,1,2,3].forEach(ri=>{ctx.save();ctx.rotate(ri*Math.PI/2+time*0.18);ctx.beginPath();ctx.moveTo(0,-rayL*0.18);ctx.lineTo(0,-rayL);ctx.strokeStyle=`hsla(${star.hue},90%,94%,${bri*pulse*0.88})`;ctx.lineWidth=Math.max(0.7,psSc*0.013);ctx.lineCap="round";ctx.stroke();ctx.restore();});
        [0,1,2,3].forEach(ri=>{ctx.save();ctx.rotate(ri*Math.PI/2+Math.PI/4+time*0.18);ctx.beginPath();ctx.moveTo(0,-rayL*0.12);ctx.lineTo(0,-rayL*0.50);ctx.strokeStyle=`hsla(${star.hue},85%,88%,${bri*pulse*0.48})`;ctx.lineWidth=Math.max(0.5,psSc*0.008);ctx.lineCap="round";ctx.stroke();ctx.restore();});
        ctx.beginPath();ctx.arc(0,0,Math.max(1.5,psSc*0.026),0,Math.PI*2);ctx.fillStyle=`hsla(${star.hue},75%,97%,${bri*pulse})`;ctx.fill();
        ctx.restore();
        if(star.discovered){ctx.beginPath();ctx.arc(sx,sy,psSc*0.055,0,Math.PI*2);ctx.strokeStyle=`hsla(${star.hue},70%,80%,0.38)`;ctx.lineWidth=0.8;ctx.stroke();}
      });
    });
  }

  // 구 위치 표시기
  if(sphere&&placedMap.has(pk(sphere.col,sphere.row))){
    const spx=toSX(sphere.col)-psSc/2+(sphere.lx/PIECE_W)*psSc;
    const spy=toSY(sphere.row)-psSc/2+(sphere.ly/PIECE_H)*psSc;
    const pulse=Math.sin(time*2.8)*0.22+0.78;
    const sg=ctx.createRadialGradient(spx,spy,0,spx,spy,psSc*0.16);
    sg.addColorStop(0,"rgba(255,255,255,0.40)");sg.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle=sg;ctx.beginPath();ctx.arc(spx,spy,psSc*0.16,0,Math.PI*2);ctx.fill();
    const ringR=Math.max(3,psSc*0.075)*(1.6-pulse*0.6);
    ctx.beginPath();ctx.arc(spx,spy,ringR,0,Math.PI*2);ctx.strokeStyle=`rgba(255,255,255,${(pulse-0.5)*0.7})`;ctx.lineWidth=0.9;ctx.stroke();
    ctx.beginPath();ctx.arc(spx,spy,Math.max(2,psSc*0.032)*pulse,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.97)";ctx.fill();
    ctx.fillStyle=`rgba(255,255,255,${0.38*pulse})`;ctx.font=`${Math.round(Math.max(7,psSc*0.08))}px 'Courier New',monospace`;
    ctx.textAlign="center";ctx.textBaseline="bottom";ctx.fillText("나",spx,spy-Math.max(3,psSc*0.04)-1);
  }

  // BOARD_STARS 렌더
  BOARD_STARS.forEach(star=>{
    const sx=toSX(star.col),sy=toSY(star.row);
    if(sx<-300||sx>cw+300||sy<-300||sy>ch+300)return;
    const t=BOARD_STAR_TYPES[star.typeIdx];
    const pulse=Math.sin(time*t.pulseSpd+star.phase)*0.22+0.78;
    const bri=star.discovered?0.92:0.62;
    const sz=Math.max(4,star.size*(pieceSize/100)),glowR=sz*t.glowMult*3.5;
    const gr=ctx.createRadialGradient(sx,sy,0,sx,sy,glowR);
    gr.addColorStop(0,`hsla(${t.h0},88%,90%,${bri*pulse*t.glowAlpha})`);gr.addColorStop(0.45,`hsla(${t.h1},75%,72%,${bri*pulse*t.glowAlpha*0.25})`);gr.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=gr;ctx.beginPath();ctx.arc(sx,sy,glowR,0,Math.PI*2);ctx.fill();
    ctx.save();ctx.translate(sx,sy);ctx.rotate(time*t.raySpd+star.phase);
    for(let ri=0;ri<t.rayN;ri++){ctx.save();ctx.rotate(ri*Math.PI*2/t.rayN);const rl=sz*t.rayLen*pulse;ctx.beginPath();ctx.moveTo(0,-sz*0.28);ctx.lineTo(0,-rl);ctx.strokeStyle=`hsla(${t.h0},90%,95%,${bri*pulse*0.88})`;ctx.lineWidth=Math.max(0.5,sz*t.rayW);ctx.lineCap="round";ctx.stroke();ctx.restore();}
    for(let ri=0;ri<t.rayN;ri++){ctx.save();ctx.rotate(ri*Math.PI*2/t.rayN+Math.PI/t.rayN);const rl=sz*t.rayLen*0.48*pulse;ctx.beginPath();ctx.moveTo(0,-sz*0.18);ctx.lineTo(0,-rl);ctx.strokeStyle=`hsla(${t.h1},80%,88%,${bri*pulse*0.42})`;ctx.lineWidth=Math.max(0.4,sz*t.rayW*0.6);ctx.lineCap="round";ctx.stroke();ctx.restore();}
    ctx.beginPath();ctx.arc(0,0,sz*pulse,0,Math.PI*2);
    const cg=ctx.createRadialGradient(-sz*0.22,-sz*0.22,0,0,0,sz*pulse);
    cg.addColorStop(0,`hsla(${t.h0},55%,99%,${bri*t.coreAlpha})`);cg.addColorStop(0.45,`hsla(${t.h0},80%,88%,${bri*t.coreAlpha*0.9})`);cg.addColorStop(1,`hsla(${t.h1},70%,65%,${bri*t.coreAlpha*0.7})`);
    ctx.fillStyle=cg;ctx.fill();ctx.restore();
    const labelA=star.discovered?0.55:0.28;
    ctx.fillStyle=`hsla(${t.h0},70%,82%,${labelA*pulse})`;ctx.font=`${Math.round(Math.max(7,sz*0.65))}px 'Courier New',monospace`;ctx.textAlign="center";ctx.textBaseline="top";ctx.fillText(t.name,sx,sy+sz*pulse+4);
  });

  // 인벤토리 조각
  const invCX=cw/2,invCY=ch/2,scatterR=Math.min(cw,ch)*0.42;
  inventoryPieces.forEach((inv)=>{
    const sx=invCX+Math.cos(inv.scatterAngle)*scatterR*inv.scatterDist+bcx;
    const sy=invCY+Math.sin(inv.scatterAngle)*scatterR*inv.scatterDist+bcy;
    const theme=THEMES[inv.themeId],isSelected=inv.id===selectedInventoryId;
    const basePS=Math.min(pieceSize,Math.max(psSc,16));
    const ps=basePS*(isSelected?0.62:0.52),pulse=isSelected?Math.sin(time*3)*0.06+0.94:1;
    ctx.save();ctx.translate(sx,sy);ctx.rotate(inv.rotation);
    const [b0,b1,b2]=theme.bg;
    if(ps>18){
      const grad=ctx.createLinearGradient(-ps/2,-ps/2,ps/2,ps/2);
      grad.addColorStop(0,`rgba(${b0+20},${b1+18},${b2+30},${isSelected?0.95:0.80})`);grad.addColorStop(1,`rgba(${b0},${b1},${b2},${isSelected?0.90:0.75})`);
      ctx.fillStyle=grad;ctx.fillRect(-ps/2*pulse,-ps/2*pulse,ps*pulse,ps*pulse);
      if(isSelected){ctx.strokeStyle=theme.boardColor;ctx.lineWidth=2.2;const glow=ctx.createRadialGradient(0,0,0,0,0,ps);glow.addColorStop(0,theme.boardColor.replace("0.8","0.25"));glow.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=glow;ctx.fillRect(-ps,-ps,ps*2,ps*2);}
      else{ctx.strokeStyle=theme.boardColor.replace("0.8","0.45");ctx.lineWidth=1;}
      ctx.strokeRect(-ps/2*pulse,-ps/2*pulse,ps*pulse,ps*pulse);
      if(ps>32){ctx.fillStyle=isSelected?theme.boardColor:"rgba(180,170,220,0.6)";ctx.font=`${Math.round(ps*0.18)}px 'Courier New',monospace`;ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText(theme.name,0,0);}
      // ── 인벤토리 공유 조각 배지 ─────────────────────────────────────────────
      if(inv.globalSeed){drawSharedBadge(ctx,0,0,ps,false,time);}
    }else{
      const dotR=Math.max(2,ps*0.45);
      if(isSelected){const g=ctx.createRadialGradient(0,0,0,0,0,dotR*4);g.addColorStop(0,theme.boardColor.replace("0.8","0.5"));g.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=g;ctx.beginPath();ctx.arc(0,0,dotR*4,0,Math.PI*2);ctx.fill();}
      ctx.beginPath();ctx.arc(0,0,dotR,0,Math.PI*2);ctx.fillStyle=theme.boardColor.replace("0.8","0.8");ctx.fill();
    }
    ctx.restore();
  });

  // 하단 HUD
  ctx.fillStyle="rgba(255,195,50,0.85)";ctx.font=`${Math.round(Math.min(cw,ch)*0.032)}px 'Courier New',monospace`;ctx.textAlign="left";ctx.fillText(`✦ 퍼즐 조각 ×${puzzleFragments}`,18,ch-20);
  if(selectedInventoryId){ctx.fillStyle="rgba(180,160,255,0.6)";ctx.font=`${Math.round(Math.min(cw,ch)*0.022)}px 'Courier New',monospace`;ctx.fillText("점선 위치에 놓기",18,ch-6);}
  else if(inventoryPieces.length>0&&puzzleFragments>0){ctx.fillStyle="rgba(180,160,255,0.4)";ctx.font=`${Math.round(Math.min(cw,ch)*0.022)}px 'Courier New',monospace`;ctx.fillText("흩어진 조각을 탭해보세요",18,ch-6);}
  ctx.fillStyle="rgba(120,110,170,0.35)";ctx.font=`${Math.round(Math.min(cw,ch)*0.020)}px 'Courier New',monospace`;ctx.textAlign="right";ctx.fillText("🗺 또는 더블탭 → 탐험으로",cw-14,ch-6);
  ctx.globalAlpha=1;
}
