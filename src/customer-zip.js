import JSZip from 'jszip';
import {customerDetailsText,exportName,photoPrintPdf} from './export-model.js';

export async function buildCustomerZip(caseData, {jpeg,identityPdf,docPdf,declarationPdf,signatureScan,blob,kinds=[]}) {
  const {name,details,people,docs,declaration,photoPrintLayout}=caseData;
  const zip=new JSZip(), folder=zip.folder(exportName(`${name}_${details.phone || 'NO-MOBILE'}`));
  const put=async(name,data)=>folder.file(name,data instanceof Blob ? await data.arrayBuffer() : data);
  await put('Customer_Details.txt',customerDetailsText(caseData));
  for(const [index,p] of people.entries()) {
    const prefix=`${index?`Nominee_${index}`:'Applicant'}_${exportName(p.name || p.nameBn || p.nid,'PERSON')}`;
    for(const [key,label] of [['idFront','ID_Front'],['idBack','ID_Back'],['birthCertificate','Birth_Certificate'],['photo','Photo']]) {
      if(p[key]) await put(`${prefix}_${label}.jpg`,await jpeg(p[key]));
    }
    const id=identityPdf(p);if(id)await put(`${prefix}_${p.identityType==='birth'?'Birth_Certificate':'ID_Card'}.pdf`,id);
  }
  let signature=docs.find(d=>d.kind==='signature')?.pages?.[0];
  for(const [index,d] of docs.entries()) {
    const pages=d.pages.filter(Boolean);if(!pages.length)continue;
    const prefix=`${String(index+1).padStart(2,'0')}_${exportName(d.name || kinds.find(k=>k.id===d.kind)?.label || d.kind)}`;
    if(d.kind==='signature') {
      for(const [i,page] of pages.entries()) {
        const png=page.startsWith('data:image/png;')?page:(await signatureScan(page,'process')).image;
        if(page===signature)signature=png;
        await put(`${prefix}_Signature${i?`_${i+1}`:''}.png`,await blob(png));
      }
    } else if(d.kind==='signature_card') {
      for(const [i,page] of pages.entries())await put(`${prefix}_Signature_Card${i?`_${i+1}`:''}.jpg`,await jpeg(page));
    } else await put(`${prefix}.pdf`,docPdf({...d,pages}));
  }
  if(declaration.customerName || declaration.rawDescription || declaration.polishedDescription)await put('Income_Declaration.pdf',await declarationPdf(people[0],declaration,signature));
  const print=photoPrintPdf(people,photoPrintLayout);if(print)await put('Passport_Photos_Print.pdf',print);
  await put('Print_Instructions.txt','Print Passport_Photos_Print.pdf on A4 at Actual size / 100%.\r\nNo PDF margins or borders. Borderless printing depends on your printer.\r\nTo move photos: open the saved customer in Document Studio, adjust Passport Photo Print Layout, then Save and download again.\r\n');
  return zip.generateAsync({type:'blob',mimeType:'application/zip',compression:'DEFLATE',compressionOptions:{level:6}});
}
