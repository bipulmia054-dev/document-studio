import { jsPDF } from 'jspdf';

export const PRINT_PAGE = { width: 210, height: 297 };
export function exportName(value, fallback = 'CUSTOMER') {
  return String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 110) || fallback;
}
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function photoPlacements(people, layout = {}) {
  const width = Math.min(100, Math.max(10, number(layout.width, 35)));
  const height = Math.min(140, Math.max(10, number(layout.height, 45)));
  return people.filter(p => p.photo).map((p, i) => {
    const saved = layout.positions?.[p.id] || {};
    const columns = Math.max(1, Math.floor(210 / width));
    return { id: p.id, photo: p.photo, label: p.role || (i ? 'Nominee' : 'Applicant'), width, height,
      x: Math.min(210 - width, Math.max(0, number(saved.x, (i % columns) * width))),
      y: Math.min(297 - height, Math.max(0, number(saved.y, Math.floor(i / columns) * height))) };
  });
}
export function photoPrintPdf(people, layout = {}) {
  const items = photoPlacements(people, layout);
  if (!items.length) return null;
  if (photosOverlap(items)) throw new Error('Print layout-এ ছবি একটির ওপর অন্যটি আছে। Left/Top বদলে আলাদা করুন।');
  const pdf = new jsPDF({unit:'mm',format:'a4',compress:true});
  // No page margins, labels or borders. Placement is measured from the paper edge.
  for (const p of items) pdf.addImage(p.photo, undefined, p.x, p.y, p.width, p.height);
  return pdf.output('blob');
}
export function photosOverlap(items) {
  return items.some((a,i)=>items.slice(i+1).some(b=>a.x < b.x+b.width-0.01 && a.x+a.width > b.x+0.01 && a.y < b.y+b.height-0.01 && a.y+a.height > b.y+0.01));
}
export function customerDetailsText({name='',details={},people=[],docs=[],declaration={},photoPrintLayout={}}) {
  const line = (label, value) => `${label}: ${value === undefined || value === null || value === '' ? 'দেওয়া নেই' : String(value)}`;
  const result = ['CUSTOMER DETAILS', line('Customer / Case name',name), ...Object.entries(details).map(([k,v])=>line(k,v)), ''];
  const labels = {name:'Name (English)',nameBn:'নাম (বাংলা)',nid:'NID / Birth certificate number',dob:'Date of birth',issueDate:'Issue date',issuePlace:'Issue place',fatherNameEn:"Father's name (English)",fatherNameBn:'পিতার নাম',motherNameEn:"Mother's name (English)",motherNameBn:'মাতার নাম',addressEn:'Address (English)',addressBn:'ঠিকানা (বাংলা)',identityType:'Identity document type',ocrText:'Scanned text'};
  for (const [i,p] of people.entries()) {
    result.push(p.role || (i?'NOMINEE':'APPLICANT'));
    for (const [key,label] of Object.entries(labels)) result.push(line(label,p[key]));
    result.push('');
  }
  result.push('INCOME DECLARATION');
  for(const [k,v] of Object.entries(declaration)) if(typeof v==='string' || typeof v==='number') result.push(line(k,v));
  result.push('', 'DOCUMENTS', ...docs.map(d=>line(d.kind,d.name || d.kind)), '', 'PASSPORT PHOTO PRINT');
  for(const p of photoPlacements(people,photoPrintLayout)) result.push(`${p.label}: ${p.width} x ${p.height} mm; left ${p.x} mm; top ${p.y} mm`);
  result.push('Print at Actual size / 100%. Disable Fit to page. Borderless printing requires a compatible printer.');
  return '\ufeff' + result.join('\r\n');
}
