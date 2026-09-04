"""Read-only ZIP export for older saved PDF cases. Never modifies original records."""
import base64
import io
import json
import re
import zipfile
from PIL import Image, ImageChops, ImageFilter
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from reportlab.lib.units import mm
from reportlab.lib.pagesizes import A4

def filename(value, fallback='CUSTOMER'):
    return re.sub(r'[<>:"/\\|?*\x00-\x1f\s]+', '_', str(value or '')).strip('. ')[:100] or fallback

def picture(value):
    if not isinstance(value,str) or not value.startswith('data:image/') or ',' not in value:
        raise ValueError('Missing embedded image')
    raw=base64.b64decode(value.split(',',1)[1],validate=True)
    image=Image.open(io.BytesIO(raw)); image.load()
    return image

def jpg(value):
    image=picture(value).convert('RGBA')
    background=Image.new('RGB',image.size,'white'); background.paste(image,mask=image.getchannel('A'))
    for quality in (94,90,86,82,78,74,70,65,60):
        out=io.BytesIO(); background.save(out,'JPEG',quality=quality,optimize=True)
        if out.tell() <= 150*1024: break
    return out.getvalue()

def signature_png(value):
    image=picture(value).convert('RGBA')
    # Keep an already-transparent signature exactly; otherwise remove pale paper.
    if image.getchannel('A').getextrema()[0] == 255:
        rgb=image.convert('RGB'); gray=rgb.convert('L')
        alpha=ImageChops.invert(gray).point(lambda p: min(255,max(0,(p-20)*4)))
        image.putalpha(alpha)
    out=io.BytesIO(); image.save(out,'PNG'); return out.getvalue()

def document_pdf(pages, identity=False):
    out=io.BytesIO(); pdf=canvas.Canvas(out,pagesize=A4,pageCompression=1)
    def draw(value,top,max_w,max_h):
        image=picture(value).convert('RGB'); w,h=image.size
        scale=min(max_w/w,max_h/h); w,h=w*scale,h*scale
        pdf.drawImage(ImageReader(image),(210-w)/2*mm,(297-top-(max_h+h)/2)*mm,width=w*mm,height=h*mm)
    if identity:
        for i,page in enumerate(pages[:2]): draw(page,28+i*98,118,76)
    else:
        for i,page in enumerate(pages):
            if i: pdf.showPage()
            draw(page,20,190,257)
    pdf.save();return out.getvalue()

def photo_print_pdf(people,layout):
    def numeric(value,default):
        try:
            number=float(value)
            return number if number==number and abs(number)!=float('inf') else default
        except (TypeError,ValueError):return default
    width=min(100,max(10,numeric(layout.get('width'),35))); height=min(140,max(10,numeric(layout.get('height'),45)))
    out=io.BytesIO(); pdf=canvas.Canvas(out,pagesize=A4,pageCompression=1)
    for i,p in enumerate(p for p in people if p.get('photo')):
        position=(layout.get('positions') or {}).get(p.get('id'),{})
        columns=max(1,int(210//width))
        x=min(210-width,max(0,numeric(position.get('x'),i%columns*width)))
        y=min(297-height,max(0,numeric(position.get('y'),i//columns*height)))
        pdf.drawImage(ImageReader(io.BytesIO(jpg(p['photo']))),x*mm,(297-y-height)*mm,width=width*mm,height=height*mm)
    pdf.save(); return out.getvalue()

def legacy_customer_zip(row,case,original_pdf):
    if not isinstance(case,dict):case={}
    out=io.BytesIO(); root=filename(str(row.get('name') or case.get('name') or 'CUSTOMER')+'_'+str(row.get('phone') or 'NO-MOBILE'))
    people=case.get('people') or []; docs=case.get('docs') or []; declaration=case.get('declaration') or {}
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
        def put(name,data):archive.writestr(root+'/'+name,data)
        lines=['CUSTOMER DETAILS', 'Name: '+str(row.get('name','')), 'Phone: '+str(row.get('phone',''))]
        for section,data in [('Contact',case.get('details') or {})]+[(p.get('role') or f'Person {i+1}',p) for i,p in enumerate(people)]+[('Income Declaration',declaration)]:
            lines.extend(['',section])
            for key,value in data.items():
                if key in ('idFront','idBack','photo','birthCertificate','id','busy','ocrStatus'): continue
                if isinstance(value,(str,int,float)) and not str(value).startswith('data:'): lines.append(f'{key}: {value}')
        put('Customer_Details.txt','\ufeff'+'\r\n'.join(lines))
        # Keep the complete original as an extra file when exporting a legacy case.
        put('Original_Combined_Document.pdf',original_pdf)
        for i,p in enumerate(people):
            prefix=('Applicant' if i==0 else f'Nominee_{i}')+'_'+filename(p.get('name') or p.get('nameBn') or p.get('nid'),'PERSON')
            for key,label in [('idFront','ID_Front'),('idBack','ID_Back'),('photo','Photo'),('birthCertificate','Birth_Certificate')]:
                if p.get(key): put(prefix+'_'+label+'.jpg',jpg(p[key]))
            if p.get('identityType')=='birth' and p.get('birthCertificate'):put(prefix+'_Birth_Certificate.pdf',document_pdf([p['birthCertificate']]))
            elif p.get('idFront') and p.get('idBack'):put(prefix+'_ID_Card.pdf',document_pdf([p['idFront'],p['idBack']],True))
        for i,d in enumerate(docs):
            pages=[p for p in d.get('pages',[]) if p]
            if not pages:continue
            prefix=f'{i+1:02d}_'+filename(d.get('name') or d.get('kind'),'Document')
            if d.get('kind')=='signature':
                for j,page in enumerate(pages):put(prefix+f'_Signature_{j+1}.png',signature_png(page))
            elif d.get('kind')=='signature_card':
                for j,page in enumerate(pages):put(prefix+f'_Signature_Card_{j+1}.jpg',jpg(page))
            else:put(prefix+'.pdf',document_pdf(pages,d.get('kind')=='job' and len(pages)==2))
        if any(declaration.get(key) for key in ('customerName','rawDescription','polishedDescription')):
            reader=PdfReader(io.BytesIO(original_pdf)); writer=PdfWriter()
            if reader.pages:
                writer.add_page(reader.pages[-1]); target=io.BytesIO();writer.write(target);put('Income_Declaration.pdf',target.getvalue())
        if any(p.get('photo') for p in people):put('Passport_Photos_Print.pdf',photo_print_pdf(people,case.get('photoPrintLayout') or {}))
        put('Print_Instructions.txt','Print at Actual size / 100% on A4. Borderless output depends on your printer.\r\nEdit the customer in Document Studio to move photos, then Save again.\r\n')
    return out.getvalue()
