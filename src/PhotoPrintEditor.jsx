import React, {useRef} from 'react';
import {photoPlacements,photosOverlap} from './export-model.js';

export default function PhotoPrintEditor({people,value,change,onPreview}) {
  const sheet=useRef(null), drag=useRef(null);
  const items=photoPlacements(people,value);
  const setPosition=(id,x,y)=>change({...value,positions:{...value.positions,[id]:{x,y}}});
  const move=(event)=>{
    if(!drag.current || !sheet.current) return;
    const box=sheet.current.getBoundingClientRect(), item=drag.current;
    setPosition(item.id,Math.max(0,Math.min(210-item.width,(event.clientX-box.left)*210/box.width-item.dx)),Math.max(0,Math.min(297-item.height,(event.clientY-box.top)*297/box.height-item.dy)));
  };
  return <section className="photoPrintEditor">
    <h3>Passport Photo Print Layout</h3>
    <p>ছবি drag করুন অথবা Left / Top mm বদলান। PDF-এ margin, border বা লেখা থাকবে না।</p>
    <div className="photoPrintSizes"><label>Photo width (mm)<input type="number" min="10" max="100" value={value.width ?? 35} onChange={e=>change({...value,width:Number(e.target.value)})}/></label><label>Photo height (mm)<input type="number" min="10" max="140" value={value.height ?? 45} onChange={e=>change({...value,height:Number(e.target.value)})}/></label></div>
    <div className="photoPrintSheet" ref={sheet}>
      {items.map(item=><button type="button" className="photoPrintTile" key={item.id} title={`${item.label}: drag to move`} aria-label={`${item.label} photo position`} style={{left:`${item.x/210*100}%`,top:`${item.y/297*100}%`,width:`${item.width/210*100}%`,height:`${item.height/297*100}%`}}
        onPointerDown={event=>{const box=sheet.current.getBoundingClientRect();drag.current={...item,dx:(event.clientX-box.left)*210/box.width-item.x,dy:(event.clientY-box.top)*297/box.height-item.y};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={move} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null}
        onKeyDown={event=>{const shift=event.shiftKey?5:1;const d={ArrowLeft:[-shift,0],ArrowRight:[shift,0],ArrowUp:[0,-shift],ArrowDown:[0,shift]}[event.key];if(d){event.preventDefault();setPosition(item.id,item.x+d[0],item.y+d[1]);}}}>
        <img src={item.photo} alt={item.label} draggable={false}/>
      </button>)}
    </div>
    {!items.length && <p>Applicant অথবা Nominee-এর photo যোগ করলে এখানে আসবে।</p>}
    {photosOverlap(items) && <p role="alert" style={{color:'#a23624'}}>ছবি একটির ওপর অন্যটি আছে। Left/Top বদলে আলাদা করুন, তারপর PDF তৈরি করুন।</p>}
    {items.map(item=><div className="photoPrintPosition" key={item.id}><b>{item.label}</b><label>Left (mm)<input type="number" min="0" max={210-item.width} step="1" value={Math.round(item.x*10)/10} onChange={e=>setPosition(item.id,Number(e.target.value),item.y)}/></label><label>Top (mm)<input type="number" min="0" max={297-item.height} step="1" value={Math.round(item.y*10)/10} onChange={e=>setPosition(item.id,item.x,Number(e.target.value))}/></label><button type="button" className="secondary" onClick={()=>setPosition(item.id,210-item.width,item.y)}>ডানে নিন</button></div>)}
    <div className="photoPrintButtons"><button type="button" className="secondary" onClick={()=>change({width:35,height:45,positions:{}})}>Reset: 35 × 45 mm</button><button type="button" className="secondary" disabled={!items.length} onClick={()=>{const columns=Math.max(1,Math.floor(210/items[0].width));change({...value,positions:Object.fromEntries(items.map((p,i)=>{const count=Math.min(columns,items.length-Math.floor(i/columns)*columns);return [p.id,{x:210-count*p.width+(i%columns)*p.width,y:Math.floor(i/columns)*p.height}];}))});}}>সব ছবি ডানে</button><button type="button" className="secondary" onClick={onPreview} disabled={!items.length || photosOverlap(items)}>Print PDF Preview</button></div>
    <small>Print: Actual size / 100%। “Fit to page” বন্ধ রাখুন। একেবারে ধার পর্যন্ত ছাপতে printer-এর borderless support দরকার। অবস্থান বদলানোর পরে Save করুন।</small>
  </section>;
}
