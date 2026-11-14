const fs=require('fs'),vm=require('vm'),assert=require('assert');
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},listeners:{},classList:{add(){},remove(){}},addEventListener(t,fn){this.listeners[t]=fn},focus(){},reset(){},showModal(){this.open=true},close(){this.open=false},setCustomValidity(){},reportValidity(){},click(){}});return elements.get(id)}
let stored={};const context={document:{querySelector:element,querySelectorAll:()=>[],addEventListener(){},activeElement:{tagName:'BODY'},createElement:()=>element('anchor')},localStorage:{getItem:k=>stored[k]||null,setItem:(k,v)=>stored[k]=v},location:{hash:''},window:{addEventListener(){},scrollTo(){}},setTimeout:()=>0,clearTimeout(){},confirm:()=>true,Blob,URL,crypto:require('crypto').webcrypto,console};
vm.createContext(context);vm.runInContext(fs.readFileSync(require('path').join(__dirname,'dist/assets/app.js'),'utf8'),context);
function run(s){return vm.runInContext(s,context)}
assert.equal(run('state.records.length'),9);assert.ok(element('#content').innerHTML.includes('What could you'));
for(const section of ['ideas','problems','tech','experiments','library']){context.location.hash='#'+section;run('render()');assert.ok(element('#content').innerHTML.includes('page-toolbar'))}
run("openEditor(null,'ideas','A new test idea')");element('#category').value='Testing';element('#stage').value='Building';element('#description').value='A meaningful test';element('#linked').value='';element('#form').listeners.submit({preventDefault(){}});assert.equal(run('state.records.length'),10);assert.ok(JSON.parse(Object.values(stored)[0]).records.some(r=>r.title==='A new test idea'));
const id=run("state.records.find(r=>r.title==='A new test idea').id");context.testId=id;run('openEditor(testId)');element('#title').value='Edited idea';element('#form').listeners.submit({preventDefault(){}});assert.equal(run('state.records.find(r=>r.id===testId).title'),'Edited idea');
run("openEditor(null,'experiments','Test an assumption')");assert.ok(element('#description').value.includes('Success criteria'));
run('openEditor(testId)');element('#delete').listeners.click();assert.equal(run('state.records.length'),9);
run("query='<script>';render()");assert.ok(!element('#content').innerHTML.includes('<script>'));assert.ok(element('#content').innerHTML.includes('&lt;script&gt;'));
run("state.records[0].demo=false");element('#clear-demo').listeners.click();assert.equal(run('state.records.length'),1);assert.equal(run('state.records[0].demo'),false);
context.localStorage.setItem=()=>{throw Error('Quota exceeded')};assert.equal(run('persist()'),false);assert.ok(element('#saved').textContent.includes('unavailable'));
console.log('PASS: all navigation views, seeded records, create/edit/delete, persistence, experiment prompts, escaped search, clear examples, and storage failure handling.');

