// ─── 보석 렌더 ────────────────────────────────────────────────────────────────
export function drawGem(ctx, sx, sy, size, hue, bri, time, spark, zoom){
  const sz=size*zoom;

  // 외부 글로우
  const glow=ctx.createRadialGradient(sx,sy,0,sx,sy,sz*6);
  glow.addColorStop(0,`hsla(${hue},90%,65%,${bri*0.4})`);
  glow.addColorStop(1,"rgba(0,0,0,0)");
  ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(sx,sy,sz*6,0,Math.PI*2); ctx.fill();

  // 6각형 몸체
  ctx.save(); ctx.translate(sx,sy);
  ctx.beginPath();
  for(let i=0;i<6;i++){
    const a=(i/6)*Math.PI*2-Math.PI/6;
    i===0?ctx.moveTo(Math.cos(a)*sz,Math.sin(a)*sz):ctx.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);
  }
  ctx.closePath();
  const gg=ctx.createRadialGradient(-sz*0.3,-sz*0.35,0,sz*0.1,sz*0.1,sz*1.2);
  gg.addColorStop(0,`hsla(${hue},90%,88%,${bri})`);
  gg.addColorStop(0.5,`hsla(${hue},80%,60%,${bri})`);
  gg.addColorStop(1,`hsla(${hue},70%,32%,${bri*0.8})`);
  ctx.fillStyle=gg; ctx.fill();

  // 내부 면 선
  for(let i=0;i<6;i++){
    const a=(i/6)*Math.PI*2-Math.PI/6;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(a)*sz,Math.sin(a)*sz);
    ctx.strokeStyle=`hsla(${hue},60%,92%,${bri*0.3})`; ctx.lineWidth=0.7; ctx.stroke();
  }
  ctx.restore();

  // 스파크
  for(let i=0;i<3;i++){
    const sa=spark+time*0.8+i*(Math.PI*2/3);
    const sr=sz*(1.5+Math.sin(time*2+i)*0.4);
    const spA=Math.sin(time*3+i*1.4)*0.5+0.5;
    if(bri*spA<0.08)continue;
    ctx.save(); ctx.translate(sx+Math.cos(sa)*sr, sy+Math.sin(sa)*sr);
    const ss=sz*0.16*spA;
    ctx.beginPath();
    ctx.moveTo(0,-ss*2); ctx.lineTo(ss*0.4,-ss*0.4); ctx.lineTo(ss*2,0);
    ctx.lineTo(ss*0.4,ss*0.4); ctx.lineTo(0,ss*2); ctx.lineTo(-ss*0.4,ss*0.4);
    ctx.lineTo(-ss*2,0); ctx.lineTo(-ss*0.4,-ss*0.4); ctx.closePath();
    ctx.fillStyle=`hsla(${hue},80%,90%,${bri*spA*0.85})`; ctx.fill();
    ctx.restore();
  }
}
