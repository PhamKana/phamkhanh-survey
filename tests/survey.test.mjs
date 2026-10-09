import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { seedSurvey } from '../lib/seed.mjs';
import { validateSubmission, validateSurvey } from '../lib/validation.mjs';
import { visibleQuestions, answerError, timeCheck, eligibility } from '../public/logic.mjs';
import { repairReferences } from '../public/editor.mjs';
const ids = (answers,meta) => visibleQuestions(seedSurvey,answers,meta).map(q => q.id);
const base = { S01:{value:0},S02:{value:0},S03:{value:0},Q01:{value:3} };
test('screening, non-user branch, baseline comparison and Vietnamese exposure', () => {
  assert.deepEqual(ids({S01:{value:1}}),['S01']);
  assert.deepEqual(ids({S01:{value:0},S02:{value:1}}),['S01','S02']);
  assert.deepEqual(ids({...base,S03:{value:9}}),['S01','S02','S03']);
  const short=ids({...base,Q01:{value:0}});
  assert(short.includes('Q02')); assert(short.includes('Q26a')); assert(!short.includes('Q03')); assert(!short.includes('Q27'));
  const noBaseline=ids({...base,Q13:{value:1},Q07:{value:0}});
  for(const id of ['Q14','Q15','Q16','Q17','Q18b','Q25','Q21','Q22_1'])assert(!noBaseline.includes(id));
  const baseline=ids({...base,Q13:{value:0},Q15:{value:4},Q07:{special:0}});
  assert(baseline.includes('Q17')); assert(!baseline.includes('Q16')); assert(baseline.includes('Q21'));
  assert(!ids({...base,Q07:{special:1}}).includes('Q21'));
  assert(ids({...base,Q13:{value:0},Q15:{value:0},Q16:{value:100}}).includes('Q20'));
  assert(!ids({...base,Q13:{value:0},Q15:{value:0},Q16:{value:101}}).includes('Q20'));
});
test('unanswered sliders, numeric zero, extensible hours and exclusive answers', () => {
  const q=id=>seedSurvey.questions.find(x=>x.id===id);
  assert(answerError(q('Q09'),undefined)); assert.equal(answerError(q('Q09'),{value:0}),null);
  assert.equal(answerError(q('Q11'),{value:240.25}),null);
  assert(answerError(q('Q10'),{value:168.25})); assert(answerError(q('Q10'),{value:4.1}));
  assert.equal(answerError(q('Q16'),{value:1200}),null);
  assert(answerError(q('Q02'),{value:[0,1,2,3]})); assert(answerError(q('Q02'),{value:[0,11]}));
  assert(answerError(q('Q25'),{value:[0,1]}));
  assert.equal(answerError(q('Q07'),{special:0}),null);
  assert(answerError(q('Q07'),{special:0,value:0}));
  assert(answerError(q('S03'),{value:8})); assert.equal(answerError(q('S03'),{value:8,other:'Văn phòng phi kỹ thuật'}),null);
});
test('allocation requires 100%, explicit confirmation and preserves unknown states', () => {
  const q=seedSurvey.questions.find(x=>x.id==='Q19');
  assert(answerError(q,{value:[50,25,0,25,0,0,0,0],confirmed:false}));
  assert.equal(answerError(q,{value:[50,25,0,25,0,0,0,0],confirmed:true}),null);
  assert(answerError(q,{value:[50,20,0,25,0,0,0,0],confirmed:true}));
  assert.equal(answerError(q,{special:0}),null);
  const answers={...base,Q10:{value:6},Q11:{value:4},Q12:{value:0}};
  assert(timeCheck(answers,seedSurvey.analysis).conflict);
  assert(!ids(answers).includes('Q19')); assert(!ids(answers,{timeBasis:'numeric'}).includes('Q19')); assert(ids(answers,{timeBasis:'reported'}).includes('Q19'));
  assert(ids({...base,Q10:{special:0},Q11:{special:0},Q12:{value:0}}).includes('Q19'));
});
test('server validates all visible answers and strips skipped values', () => {
  const short={...base,Q01:{value:0},Q02:{value:[0]},Q03:{value:2}};
  const result=validateSubmission(seedSurvey,{answers:short,submissionKey:crypto.randomUUID()});
  assert(!result.answers.Q03); assert.equal(result.outcome,'eligible');
  assert.equal(validateSubmission(seedSurvey,{answers:{...short,S03:{value:8,other:'Điều phối văn phòng phi kỹ thuật'}},submissionKey:crypto.randomUUID()}).meta.jobOtherReview,true);
  assert.throws(()=>validateSubmission(seedSurvey,{answers:{S01:{value:99}},submissionKey:crypto.randomUUID()}));
  assert.throws(()=>validateSubmission(seedSurvey,{answers:{...base,Q01:{value:3}},submissionKey:crypto.randomUUID()}));
  assert.equal(validateSubmission(seedSurvey,{answers:{S01:{value:1}},submissionKey:crypto.randomUUID()}).outcome,'screened_out');
  assert.throws(()=>validateSurvey({...seedSurvey,questions:seedSurvey.questions.slice(1)},seedSurvey));
  assert.equal(validateSurvey(seedSurvey,seedSurvey).questions.length,seedSurvey.questions.length);
});
test('Word is an editable template; changed questions and routing persist without fixed IDs',()=>{
  const edited=structuredClone(seedSurvey);
  edited.questions=edited.questions.filter(q=>q.id!=='Q28');
  edited.questions.push({id:'CUSTOM',section:7,type:'text',title:'Câu hỏi mới',required:false,help:'',showWhen:{question:'Q01',op:'eq',value:0}});
  edited.sections.push('Phần bổ sung');
  edited.questions.find(q=>q.id==='Q27').section=8;
  edited.questions.find(q=>q.id==='Q03').required=false;
  edited.questions.find(q=>q.id==='Q06').max=60;
  const saved=validateSurvey(edited,seedSurvey);
  assert.equal(saved.questions.length,40);assert(!saved.questions.some(q=>q.id==='Q28'));
  assert(saved.questions.find(q=>q.id==='Q06').max===60);
  assert(visibleQuestions(saved,{...base,Q01:{value:0}}).some(q=>q.id==='CUSTOM'));
  assert(!visibleQuestions(saved,base).some(q=>q.id==='CUSTOM'));
  const custom={title:'Tự chọn',slug:'tu-chon',kind:'generic',status:'open',sections:['Nội dung'],questions:[
    {id:'FIRST',section:0,type:'single',title:'Bạn chọn gì?',required:true,options:['Có','Không'],screenOut:[1]},
    {id:'FOLLOW',section:0,type:'text',title:'Vì sao?',required:true,showWhen:{question:'FIRST',op:'eq',value:0}}
  ]};
  const config=validateSurvey(custom);
  assert.deepEqual(visibleQuestions(config,{FIRST:{value:1}}).map(q=>q.id),['FIRST']);
  assert.equal(eligibility({FIRST:{value:1}},config),'screened_out');
  assert.throws(()=>validateSubmission(config,{answers:{FIRST:{value:0}},submissionKey:crypto.randomUUID()}));
  assert.equal(validateSubmission(config,{answers:{FIRST:{value:0},FOLLOW:{value:'Tốt'}},submissionKey:crypto.randomUUID()}).answers.FOLLOW.value,'Tốt');
  const hidden={...config,questions:[config.questions[0],{...config.questions[1],required:false},{id:'CHAIN',section:0,type:'text',title:'Sau câu 2',required:true,showWhen:{question:'FOLLOW',op:'answered'}}]};
  assert.deepEqual(visibleQuestions(hidden,{FIRST:{value:1},FOLLOW:{value:'forged'}}).map(q=>q.id),['FIRST']);
  const cycle=structuredClone(config);cycle.questions[0].showWhen={question:'FOLLOW',op:'answered'};
  assert.throws(()=>validateSurvey(cycle),/vòng lặp/);
  const deleted=structuredClone(seedSurvey);deleted.questions=deleted.questions.filter(q=>q.id!=='Q10');
  assert(repairReferences(deleted).length);assert.equal(deleted.analysis,null);assert(validateSurvey(deleted));
});
test('private APIs, CSRF, persistence, idempotence, versioning, export and account lifecycle', async () => {
  const dir=mkdtempSync(join(dirname(fileURLToPath(import.meta.url)),'tmp-'));
  const password='a-secure-test-password-2026';
  let app=createApp({dataDir:dir,initialPassword:password});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  let cookie='',csrf='';
  async function request(path,method='GET',body,extra={}) {
    const response=await fetch(origin+path,{method,headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...extra},body:body?JSON.stringify(body):undefined});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}
    return{status:response.status,value,headers:response.headers};
  }
  try {
    for(const path of ['/api/admin/surveys','/api/admin/surveys/genai/responses','/api/admin/surveys/genai/export','/api/admin/surveys/genai/schema'])assert.equal((await request(path)).status,401);
    for(const path of ['/data/survey.sqlite','/data/admin-first-login.txt','/server.mjs','/.git/config','/api/public/surveys/genai/responses'])assert.equal((await request(path)).status,404);
    assert.equal((await request('/api/auth/login','POST',{username:'admin',password}, {Origin:'https://evil.example'})).status,403);
    const login=await request('/api/auth/login','POST',{username:'admin',password});assert.equal(login.status,200);
    cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.value.csrf;
    assert(login.headers.get('set-cookie').includes('HttpOnly'));assert(login.headers.get('set-cookie').includes('SameSite=Strict'));
    const config=(await request('/api/admin/surveys/genai')).value;
    assert.equal((await request('/api/admin/surveys/genai','PUT',config,{'X-CSRF-Token':'wrong'})).status,403);
    const submission={version:1,answers:{...base,Q01:{value:0},Q02:{value:[0]},Q28:{value:'hidden'}},submissionKey:crypto.randomUUID()};
    assert.equal((await request('/api/public/surveys/genai/responses','POST',submission)).status,201);
    assert.equal((await request('/api/public/surveys/genai/responses','POST',submission)).status,200);
    const responses=(await request('/api/admin/surveys/genai/responses')).value;assert.equal(responses.total,1);assert(!responses.responses[0].answers.Q28);
    const exportResult=await request('/api/admin/surveys/genai/export');assert.equal(exportResult.status,200);assert(exportResult.value.includes('Q02_label'));assert(exportResult.value.includes('Chưa rõ AI'));
    const updated=await request('/api/admin/surveys/genai','PUT',{...config,title:'Tên khảo sát đã cập nhật'});assert.equal(updated.status,200);assert.equal(updated.value.version,2);
    assert.equal((await request('/api/public/surveys/genai/responses','POST',{...submission,submissionKey:crypto.randomUUID()})).status,409);
    const historic=(await request('/api/admin/surveys/genai/responses')).value;assert.equal(historic.responses[0].snapshot.title,seedSurvey.title);
    assert.equal((await request('/api/admin/surveys/genai','PUT',{...updated.value,status:'closed'})).status,200);
    assert.equal((await request('/api/public/surveys/genai')).status,410);
    assert.equal((await request('/api/public/surveys/genai/responses','POST',{...submission,version:3})).status,410);
    const generic=JSON.parse(readTemplate());
    const created=await request('/api/admin/surveys','POST',generic);assert.equal(created.status,201);
    assert.equal((await request(`/api/public/surveys/${generic.slug}`)).status,410);
    assert.equal((await request('/api/auth/password','POST',{current:password,password:'new-test-password-long'})).status,200);
    assert.equal((await request('/api/auth/logout','POST',{})).status,200);
    assert.equal((await request('/api/admin/surveys')).status,401);
    cookie='';csrf=''; assert.equal((await request('/api/auth/login','POST',{username:'admin',password})).status,401);
    assert.equal((await request('/api/auth/login','POST',{username:'admin',password:'new-test-password-long'})).status,200);
    const legacyRow=app.db.prepare('SELECT config,version FROM surveys WHERE id=?').get('genai');
    const legacy=JSON.parse(legacyRow.config);delete legacy.routingVersion;delete legacy.analysis;
    for(const q of legacy.questions)for(const key of ['showWhen','screenOut','reviewChoices'])delete q[key];
    app.db.prepare('UPDATE surveys SET config=? WHERE id=?').run(JSON.stringify(legacy),'genai');
    const immutableSnapshot=app.db.prepare('SELECT snapshot FROM responses LIMIT 1').get().snapshot;
    await new Promise(resolve=>app.server.close(resolve));app.db.close();
    app=createApp({dataDir:dir});
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM responses').get().n,1);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM surveys').get().n,2);
    const migrated=app.db.prepare('SELECT config,version FROM surveys WHERE id=?').get('genai');
    assert.equal(migrated.version,legacyRow.version+1);assert.equal(JSON.parse(migrated.config).routingVersion,1);
    assert.equal(JSON.parse(migrated.config).title,'Tên khảo sát đã cập nhật');assert.equal(JSON.parse(migrated.config).status,'closed');
    assert.equal(app.db.prepare('SELECT snapshot FROM responses LIMIT 1').get().snapshot,immutableSnapshot);
  } finally { if(app.server.listening)await new Promise(resolve=>app.server.close(resolve));app.db.close();rmSync(dir,{recursive:true,force:true}); }
});
function readTemplate(){return JSON.stringify({title:'Mẫu mới',slug:'mau-moi',kind:'generic',status:'draft',sections:['Nội dung'],description:'',introduction:'',questions:[{id:'Q1',section:0,title:'Góp ý',help:'',type:'text',required:false}]});}
