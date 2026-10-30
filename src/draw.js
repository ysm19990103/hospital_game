'use strict';
const theme={bg:'#fff9ed',panel:'#ffffff',panel2:'#ecfff8',line:'#b8d7d1',ink:'#253344',muted:'#526273',teal:'#087b6c',gold:'#9b5708',red:'#be3152',purple:'#6840ad',mint:'#5de4b6',coral:'#ff9b80',lemon:'#ffe372',lavender:'#d7bdff',softPurple:'#f0e7ff',softCoral:'#fff0e9',softMint:'#e0fff2',softYellow:'#fff4c5'};
function painter(ctx){
 function box(x,y,w,h,fill,r=10,stroke){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
 function text(t,x,y,size=20,color=theme.ink,align='left',font='sans-serif',weight='normal'){ctx.font=`${weight} ${size}px ${font}`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='top';ctx.fillText(String(t),x,y)}
 function wrap(t,x,y,w,size=18,color=theme.ink,line=29,max=100){ctx.font=`${size}px sans-serif`;ctx.fillStyle=color;ctx.textAlign='left';ctx.textBaseline='top';let dy=0,parts=String(t||'').split('\n');for(const para of parts){let row='';for(const ch of para){if(ctx.measureText(row+ch).width>w&&row){ctx.fillText(row,x,y+dy);dy+=line;row='';if(dy>=line*max)return dy;}row+=ch;}ctx.fillText(row,x,y+dy);dy+=line;if(dy>=line*max)return dy;}return dy}
 function line(x1,y1,x2,y2,color=theme.line,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke()}
 function img(im,x,y,w,h,fit='cover',alpha=1){if(!im||!im._ready)return false;ctx.save();ctx.globalAlpha*=alpha;box(x,y,w,h,null,8);ctx.clip();const q=fit==='contain'?Math.min(w/im.width,h/im.height):Math.max(w/im.width,h/im.height);ctx.drawImage(im,x+(w-im.width*q)/2,y+(h-im.height*q)/2,im.width*q,im.height*q);ctx.restore();return true}
 function circle(x,y,r,fill,stroke){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1.5;ctx.stroke()}}
 return {box,text,wrap,line,img,circle,theme};
}
module.exports={painter,theme};
