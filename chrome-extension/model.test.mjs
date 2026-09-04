import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import {serverOrigin,personFields,casePeople,safeImage} from './model.mjs';
test('only private HTTP or HTTPS server origins', () => {
  assert.equal(serverOrigin('http://127.0.0.1:8765/path?q=1'), 'http://127.0.0.1:8765');
  assert.equal(serverOrigin('http://100.96.199.117:8765/'), 'http://100.96.199.117:8765');
  assert.equal(serverOrigin('https://example.com'), 'https://example.com');
  for(const bad of ['javascript:alert(1)','file:///x','http://example.com','https://user:pass@example.com','http://192.168.example.com']) assert.throws(() => serverOrigin(bad));
});
test('preserve exact identity text and do not invent issue information', () => {
  const fields = personFields({name:'TEST  PERSON',nid:'001002',dob:'01/01/2000'});
  assert.equal(fields[0][1],''); assert.equal(fields[1][1],'');
  assert.equal(fields[2][1],'TEST  PERSON'); assert.equal(fields[4][1],'001002');
  assert.equal(personFields({issue_date:'01/01/2020',issue_place:'TEST PLACE'})[0][1], '01/01/2020');
});
test('applicant first and all nominees retained', () => {
  const result = casePeople({people:[{role:'Nominee',name:'N'},{role:'Applicant',name:'A'},{role:'Nominee',name:'N2'}]});
  assert.equal(result.applicant.name,'A'); assert.deepEqual(result.nominees.map(p=>p.name),['N','N2']);
  assert.deepEqual(casePeople({people:null}),{applicant:{},nominees:[]});
});
test('only embedded raster images allowed', () => {
  assert.equal(safeImage('data:image/png;base64,YQ=='),'data:image/png;base64,YQ==');
  for(const bad of ['https://tracker.invalid/a.png','javascript:alert(1)','data:image/svg+xml;base64,YQ==']) assert.equal(safeImage(bad),'');
});
test('manifest files exist, no popup, content scripts or browsing permissions', () => {
  const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
  assert.equal(manifest.manifest_version,3); assert.equal(manifest.action.default_popup,undefined); assert.equal(manifest.content_scripts,undefined);
  assert.deepEqual(manifest.permissions,['sidePanel','storage']);
  for(const file of [manifest.background.service_worker,manifest.side_panel.default_path,'panel.js','panel.css']) assert.ok(existsSync(new URL(file,import.meta.url)));
});
test('toolbar click opens global panel without toggle/close', async () => {
  let click,opened;
  const chrome={action:{onClicked:{addListener:fn=>click=fn}},sidePanel:{open:async value=>{opened=value;}}};
  vm.runInNewContext(readFileSync(new URL('./background.js',import.meta.url),'utf8'),{chrome,console});
  click({windowId:17}); await Promise.resolve(); assert.equal(opened.windowId,17); assert.equal(opened.tabId,undefined);
});
