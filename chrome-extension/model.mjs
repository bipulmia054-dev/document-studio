export const DEFAULT_SERVER = 'http://100.96.199.117:8765';
export function serverOrigin(input) {
  const url = new URL(input);
  const host = url.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) && /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.ts.net');
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))) throw new Error('HTTPS অথবা private LAN/Tailscale server address দিন');
  return url.origin;
}
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function personFields(person = {}, fallback = {}) {
  return [
    ['Issue date / ইস্যুর তারিখ', text(person.issueDate || person.issue_date)],
    ['Issue place / ইস্যুর স্থান', text(person.issuePlace || person.issue_place)],
    ['Name / নাম (English)', text(person.name || fallback.name)],
    ['নাম (বাংলা)', text(person.nameBn || fallback.name_bn)],
    [person.identityType === 'birth' ? 'Birth certificate number' : 'NID number', text(person.nid || fallback.customer_number)],
    ['Date of birth', text(person.dob)],
    ['Address (English)', text(person.addressEn)],
    ['ঠিকানা (বাংলা)', text(person.addressBn)],
    ["Father’s name (English)", text(person.fatherNameEn)],
    ['পিতার নাম', text(person.fatherNameBn)],
    ["Mother’s name (English)", text(person.motherNameEn)],
    ['মাতার নাম', text(person.motherNameBn)]
  ];
}
export function casePeople(caseData = {}) {
  const people = Array.isArray(caseData.people) ? caseData.people.filter(p => p && typeof p === 'object') : [];
  const applicantIndex = people.findIndex(p => String(p.role).toLowerCase() === 'applicant');
  const index = applicantIndex < 0 ? 0 : applicantIndex;
  return { applicant: people[index] || {}, nominees: people.filter((p, i) => i !== index) };
}
export function safeImage(value) {
  return typeof value === 'string' && /^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(value) ? value : '';
}
