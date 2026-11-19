"use strict";
// Offline view-function checks; not a substitute for browser layout verification.
const fs = require("node:fs"),
  vm = require("node:vm"),
  assert = require("node:assert/strict");
const elements = new Map();
const node = (id) => {
  if (!elements.has(id))
    elements.set(id, {
      value: "",
      innerHTML: "",
      textContent: "",
      classList: { add() {}, remove() {} },
      addEventListener() {},
    });
  return elements.get(id);
};
const initial = {
  records: [],
  sessions: [],
  messages: [],
  providers: [],
  activeRuns: [],
};
const context = {
  document: {
    querySelector: node,
    querySelectorAll: () => [],
    addEventListener() {},
    activeElement: { tagName: "BODY" },
  },
  location: { hash: "#home" },
  window: { addEventListener() {}, scrollTo() {} },
  localStorage: { getItem: () => null },
  fetch: async () => ({ ok: true, json: async () => initial }),
  setTimeout: () => 0,
  clearTimeout() {},
  console,
};
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(
    require("node:path").join(__dirname, "dist/assets/app.js"),
    "utf8",
  ),
  context,
);
const run = (source) => vm.runInContext(source, context);
assert.match(run("home()"), /An empty workspace/);
assert.ok(!run("home()").includes("AI copilot"));
run(
  `state.records=[{id:'test',type:'problem',title:'<img src=x onerror=alert(1)>',body:'Evidence',stage:'exploring',fields:{people:'Who'},updated:'2026-01-01'}]`,
);
assert.match(run("collection('problem')"), /&lt;img/);
assert.ok(!run("collection('problem')").includes("<img"));
run(
  `state.sessions=[{id:'chat',title:'A real discussion',mode:'parallel',rounds:1,localOnly:true,agents:[{id:'a',name:'Skeptic',role:'skeptic',provider:'local',model:'test-model',instruction:''}],contextIds:[],updated:'2026-01-01'}];location.hash='#chat/chat'`,
);
assert.match(run("chat()"), /Participants & context/);
assert.match(run("chat()"), /Local endpoint only/);
run(
  `state.messages=[{id:'message',sessionId:'chat',role:'assistant',agent:state.sessions[0].agents[0],text:'<script>bad</script>',status:'failed',error:'Connection failed',round:1,usage:null}]`,
);
assert.match(run("messageList('chat')"), /Retry this response/);
assert.match(run("messageList('chat')"), /&lt;script&gt;/);
assert.match(run("messageList('chat')"), /Usage unavailable/);
context.localStorage.getItem = () =>
  JSON.stringify({
    version: 1,
    records: [
      { id: "demo", title: "Fake", demo: true },
      { id: "personal", title: "Keep me", demo: false },
    ],
  });
assert.equal(run("legacyEntries().length"), 1);
run(
  `state.providers=[{provider:'local',configured:true,base:'x'}];state.assistant={enabled:true,planner:{provider:'local',model:'m'},writer:{provider:'local',model:'w'},maxPapers:5,autoRunOnCapture:true};state.records=[{id:'made',type:'idea',title:'<b>Made</b>',body:'',stage:'draft',fields:{},links:[],updated:'2026-01-01',origin:{by:'assistant',runId:'run1'},reviewed:null},{id:'sim',type:'note',title:'<i>Sim</i>',body:'',stage:'draft',fields:{},links:[],updated:'2026-01-01',origin:{by:'simulation'},reviewed:null},{id:'kept',type:'note',title:'Accepted note',body:'',stage:'draft',fields:{},links:[],updated:'2026-01-01',origin:{by:'assistant',runId:'run1'},reviewed:'2026-01-02'}];state.messages=[{id:'reply',sessionId:'s',role:'assistant',text:'<img src=x onerror=alert(1)>',status:'complete'}];state.assistantRuns=[{id:'run1',provider:'local',model:'m',status:'done',phase:'',steps:[{action:'search_papers',input:null,result:null,error:'OpenAlex unavailable: HTTP 429.',at:''},{action:'create_entry',input:null,result:{id:'made',type:'idea',title:'<b>Made</b>'},error:'',at:''}],createdIds:['made'],sessionId:'s',messageId:'reply',usage:{calls:2},error:''}]`,
);
const panel = run("assistantPanel()");
assert.match(panel, /Paper search failed: OpenAlex unavailable: HTTP 429/);
assert.match(panel, /&lt;img src=x/);
assert.match(panel, /&lt;b&gt;Made/);
assert.ok(!panel.includes("<img") && !panel.includes("<b>Made"));
assert.match(panel, /Open thread/);
assert.match(panel, /data-assistant-undo="run1"/);
assert.match(panel, /by assistant/);
assert.match(run("home()"), /id="quick-assist" type="checkbox" checked/);
const homeHtml = run("home()");
assert.match(homeHtml, /id="to-review"/);
assert.match(homeHtml, /data-review="accept" data-id="made"/);
assert.match(homeHtml, /data-review="discard" data-id="sim"/);
assert.match(homeHtml, /Accept all from this run/);
assert.match(homeHtml, /by-simulation">Simulated/);
assert.match(homeHtml, /&lt;i&gt;Sim/);
assert.ok(!homeHtml.includes("<i>Sim") && !homeHtml.includes("<b>Made"));
const lists = JSON.parse(run("JSON.stringify([entries().map((r) => r.id), toReview().map((r) => r.id)])"));
assert.deepEqual(lists, [["kept"], ["made", "sim"]]);
assert.match(run("assistantPanel()"), /1 waiting for your review/);
assert.match(run("settings()"), /Capture assistant/);
assert.match(run("settings()"), /titles and types of your 50 most recent reviewed entries/);
assert.match(run("settings()"), /name="plannerModel"/);
assert.match(run("settings()"), /name="writerModel"/);
assert.match(run("settings()"), /3 to 4 billion parameter model/);
assert.match(run("settings()"), /plain text/);
assert.match(run("settings()"), /Export workspace/);
console.log(
  "PASS: empty workspace, escaped record/model content, discussion controls, failure recovery controls, honest usage and personal-only migration.",
);
