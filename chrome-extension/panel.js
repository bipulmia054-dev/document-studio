import { DEFAULT_SERVER, serverOrigin, personFields, casePeople, safeImage } from './model.mjs';
const $ = id => document.getElementById(id);
let server = DEFAULT_SERVER, selected = null, requestVersion = 0;
const blobs = new Set();
function notice(message = '', error = false) { $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
function clearRecords() { requestVersion++; selected = null; $('results').replaceChildren(); $('record-content').replaceChildren(); $('record').hidden = true; $('results').hidden = false; }
function unauthenticated() { clearRecords(); $('workspace').hidden = true; $('login').hidden = false; }
async function api(path, options = {}) {
  const response = await fetch(server + path, { ...options, credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (response.status === 401) { unauthenticated(); notice('Login করুন। Session শেষ হয়ে থাকতে পারে।', true); throw new Error('Login করুন। Session শেষ হয়ে থাকতে পারে।'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Server error ${response.status}`);
  return result;
}
function showError(error) { notice(error instanceof TypeError || error.name === 'TimeoutError' ? 'Server পাওয়া যাচ্ছে না। PC/server, Tailscale ও Server address পরীক্ষা করুন।' : error.message, true); }
async function connect() {
  notice('Server-এ সংযোগ হচ্ছে…');
  try {
    const auth = await api('/api/auth/status');
    if (!auth.authenticated) { unauthenticated(); notice(auth.setupRequired ? 'আগে মূল software-এ username/password তৈরি করুন।' : 'আগের username/password দিয়ে Login করুন।'); return; }
    $('login').hidden = true; $('workspace').hidden = false; $('user').textContent = auth.username; notice();
    await search();
  } catch (error) { unauthenticated(); showError(error); $('settings').open = true; }
}
async function search() {
  clearRecords(); const version = requestVersion;
  $('search-button').disabled = true; notice('Customer খোঁজা হচ্ছে…');
  try {
    const result = await api('/api/customers?q=' + encodeURIComponent($('query').value.trim()));
    if (version !== requestVersion) return;
    const rows = Array.isArray(result.customers) ? result.customers : [];
    notice(rows.length ? `${rows.length}টি file পাওয়া গেছে${rows.length === 100 ? '—আরও নির্দিষ্ট করে search করুন' : ''}` : 'কোনো Save করা customer পাওয়া যায়নি।');
    for (const row of rows) {
      const button = document.createElement('button'); button.className = 'result';
      const name = document.createElement('strong'); name.textContent = row.name || row.name_bn || 'Customer';
      const meta = document.createElement('small'); meta.textContent = [row.serial, row.phone, row.customer_number].filter(Boolean).join(' • ');
      const email = document.createElement('small'); email.textContent = row.email || '';
      button.append(name, meta, email); button.addEventListener('click', () => openRecord(row)); $('results').append(button);
    }
  } catch (error) { if (version === requestVersion) showError(error); }
  finally { $('search-button').disabled = false; }
}
function fields(container, values) {
  const list = document.createElement('dl');
  for (const [label, value] of values) {
    const field = document.createElement('div'); field.className = 'field';
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'), text = document.createElement('span'); text.textContent = value || 'দেওয়া নেই'; if (!value) text.className = 'missing'; dd.append(text);
    if (value) { const copy = document.createElement('button'); copy.className = 'copy'; copy.textContent = 'Copy'; copy.setAttribute('aria-label', label + ' copy'); copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(value); copy.textContent = '✓'; setTimeout(() => copy.textContent = 'Copy', 1000); } catch { notice('Copy হয়নি—লেখাটি select করে Ctrl+C করুন।', true); } }); dd.append(copy); }
    field.append(dt, dd); list.append(field);
  }
  container.append(list);
}
function photo(container, source, label) {
  const src = safeImage(source); if (!src) return;
  const image = document.createElement('img'); image.src = src; image.alt = label; image.className = 'photo'; image.loading = 'lazy'; container.append(image);
}
function personCard(label, person, fallback = {}, nominee = false) {
  const card = document.createElement('section'); card.className = 'person';
  const title = document.createElement('h3'); title.textContent = label; card.append(title);
  const values = personFields(person, fallback); fields(card, nominee ? values.slice(2) : values);
  photo(card, person.photo, label + ' photo');
  if (safeImage(person.idFront) || safeImage(person.idBack) || safeImage(person.birthCertificate)) {
    const images = document.createElement('details'); images.className = 'documents'; const summary = document.createElement('summary'); summary.textContent = 'ID / Birth certificate দেখুন'; images.append(summary);
    photo(images, person.idFront, 'ID Front'); photo(images, person.idBack, 'ID Back'); photo(images, person.birthCertificate, 'Birth certificate'); card.append(images);
  }
  $('record-content').append(card);
}
async function openRecord(row) {
  const version = ++requestVersion; selected = row; $('record-content').replaceChildren(); $('results').hidden = true; $('record').hidden = false;
  $('record-title').textContent = row.name || row.name_bn || 'Customer'; $('serial').textContent = row.serial || ''; notice('Details আসছে…');
  let caseData = {};
  try { const data = await api(`/api/customers/${encodeURIComponent(row.id)}/edit`); if (version !== requestVersion) return; caseData = data.case || {}; notice(); }
  catch (error) { if (version !== requestVersion) return; if ($('workspace').hidden) return; notice('সম্পূর্ণ details পাওয়া যায়নি। ' + error.message + ' মূল PDF download করে দেখুন।', true); }
  const { applicant, nominees } = casePeople(caseData);
  personCard('Applicant / আবেদনকারী', applicant, row);
  const contact = document.createElement('section'); contact.className = 'contact'; fields(contact, [['Phone number', row.phone || caseData.details?.phone || ''], ['Email address', row.email || caseData.details?.email || '']]); $('record-content').append(contact);
  if (nominees.length) nominees.forEach((p, i) => personCard(`Nominee / নমিনি ${nominees.length > 1 ? i + 1 : ''}`, p, {}, true));
  else { const missing = document.createElement('p'); missing.textContent = 'Nominee-এর details সংরক্ষিত নেই।'; $('record-content').append(missing); }
}
$('search-form').addEventListener('submit', event => { event.preventDefault(); search(); });
$('back').addEventListener('click', () => { requestVersion++; selected = null; $('record').hidden = true; $('record-content').replaceChildren(); $('results').hidden = false; notice(); });
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true;
  try { await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: $('username').value.trim(), password: $('password').value }) }); $('password').value = ''; await connect(); }
  catch (error) { $('password').value = ''; showError(error); }
  finally { $('login-button').disabled = false; }
});
$('logout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); unauthenticated(); notice('Logout হয়েছে'); } catch (error) { showError(error); } });
$('server-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const next = serverOrigin($('server').value.trim());
    const origin = new URL(next).protocol + '//' + new URL(next).hostname + '/*';
    if (!await chrome.permissions.request({ origins: [origin] })) throw new Error('Server permission দেওয়া হয়নি');
    clearRecords(); $('workspace').hidden = true; server = next; await chrome.storage.local.set({ server }); $('settings').open = false; await connect();
  } catch (error) { showError(error); }
});
$('close').addEventListener('click', async () => { const current = await chrome.windows.getCurrent(); await chrome.sidePanel.close({ windowId: current.id }); });
$('open-server').addEventListener('click', () => chrome.tabs.create({ url: server + '/' }));
$('download').addEventListener('click', async () => {
  if (!selected) return;
  const row = selected; $('download').disabled = true; notice('ZIP download হচ্ছে…');
  try {
    const response = await fetch(`${server}/api/customers/${encodeURIComponent(row.id)}/download`, { credentials: 'include', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(90000) });
    if (response.status === 401) { unauthenticated(); throw new Error('আবার Login করুন'); }
    if (!response.ok) throw new Error('Customer file পাওয়া যায়নি');
    const blob = await response.blob(); if (!blob.type.includes('zip') && !blob.type.includes('pdf')) throw new Error('Server download file ফেরত দেয়নি');
    const suffix=blob.type.includes('zip')?'.zip':'.pdf';
    const url = URL.createObjectURL(blob); blobs.add(url); const link = document.createElement('a'); link.href = url; link.download = (row.archive_name || `${row.name}_${row.phone}`).replace(/[\\/:*?"<>|]/g, '_').replace(/\.(zip|pdf)$/i, '')+suffix; link.click();
    setTimeout(() => { URL.revokeObjectURL(url); blobs.delete(url); }, 60000); notice('Customer file Chrome Downloads-এ পাঠানো হয়েছে');
  } catch (error) { showError(error); } finally { $('download').disabled = false; }
});
window.addEventListener('pagehide', () => { for (const url of blobs) URL.revokeObjectURL(url); });
try {
  const settings = await chrome.storage.local.get('server');
  const previous = settings.server ? serverOrigin(settings.server) : '';
  // Migrate the previous PC-only default to the user's private Tailscale server.
  server = !previous || ['http://127.0.0.1:8765', 'http://localhost:8765'].includes(previous) ? DEFAULT_SERVER : previous;
  await chrome.storage.local.set({ server });
} catch { server = DEFAULT_SERVER; }
$('server').value = server;
connect();
