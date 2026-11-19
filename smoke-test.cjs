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
  setInterval: () => 0,
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
assert.match(run("settings()"), /one small non-thinking model for both planner and writer/);
assert.match(run("settings()"), /plain text/);
assert.match(run("settings()"), /gemma4:e4b class/);
assert.match(run("settings()"), /Export workspace/);
run(`state.jobs=[{id:'job1',kind:'test_pipeline',ideaId:'idea1',ideaTitle:'<b>Telescope</b>',stage:'grill',status:'waiting_user',usage:{calls:2,inputTokens:0,outputTokens:0},caps:{calls:25},models:{planner:{provider:'local',model:'p'},writer:{provider:'local',model:'w'},simulation:{provider:'local',model:'w'}},gate:null,error:'',waiting:{kind:'grill',round:1,text:'Q1 - <img src=x onerror=alert(1)>: why?\\nRecommended: <b>yes</b>\\n\\nQ2 - Who: who?',fatal:'<script>x</script>',threadId:'t1'},stages:[{name:'grill',status:'waiting_user',usage:{calls:2,ms:1500},output:null},{name:'board',status:'pending',usage:{calls:0},output:null}]}]`);
const asks = run("jobAsks()");
assert.match(asks, /Spark has 2 questions about &lt;b&gt;Telescope/);
assert.match(asks, /data-job-answer="job1"/);
assert.match(asks, /data-job-park="job1"/);
assert.match(asks, /data-job-enough="job1">Enough questions/);
assert.ok(!asks.includes("<img") && !asks.includes("<script>") && !asks.includes("<b>Telescope"));
assert.match(run("home()"), /id="job-asks"/);
const card = run("validationCard({id:'idea1',title:'T'})");
assert.match(card, /2 of 25 model calls/);
assert.match(card, /Matt Pocock/);
assert.match(card, /by-simulation">Simulated/);
assert.match(card, /data-job-cancel="job1"/);
assert.match(card, /id="test-idea" disabled/);
assert.ok(!card.includes("<img") && !card.includes("<script>"));
run(`state.jobs[0].status='stopped';state.jobs[0].waiting=null;state.jobs[0].gate={stage:'grill',kind:'gate',reason:'<i>No payer</i>'}`);
const stopped = run("validationCard({id:'idea1',title:'T'})");
assert.match(stopped, /data-job-resume="job1" data-override="1">Override and continue/);
assert.match(stopped, /&lt;i&gt;No payer/);
run(`state.records=[{id:'idea1',type:'idea',title:'Idea',body:'',stage:'draft',fields:{},links:[],updated:'2026-01-01'},{id:'g1',type:'note',title:'Panel <b>x</b>',body:'<i>guess</i>',stage:'draft',fields:{},links:['idea1'],origin:{by:'simulation',runId:'job1'},reviewed:'2026-01-02',updated:'2026-01-01'},{id:'c1',type:'competitor',title:'Real Co',body:'',stage:'draft',fields:{sources:'https://x.test'},links:['idea1'],origin:{by:'simulation',runId:'job1'},reviewed:'2026-01-02',updated:'2026-01-01'},{id:'c2',type:'competitor',title:'Guess Co (unconfirmed)',body:'',stage:'draft',fields:{facts:'Positioning'},links:['idea1'],origin:{by:'simulation',runId:'job1'},reviewed:'2026-01-02',updated:'2026-01-01'}]`);
const brief = run("renderBrief('idea1')");
const [before, guesses] = brief.split("Guesses to test");
assert.ok(guesses, "brief has a Guesses to test section");
assert.match(guesses, /Panel &lt;b&gt;x&lt;\/b&gt;/);
assert.match(guesses, /&lt;i&gt;guess/);
assert.match(guesses, /Guess Co \(unconfirmed\)/);
assert.ok(!guesses.includes("Real Co") && before.includes("Real Co"));
assert.ok(!before.includes("Guess Co") && !brief.includes("<i>guess"));
run("var BUSINESS_MATH_INPUTS=['price'];location.hash='#entry/abc'");
assert.deepEqual(JSON.parse(run("JSON.stringify(route())")), { view: "entry", id: "abc" });
run("location.hash='#entry'");
const readField = run("fieldMarkup('solution','What would you create?')");
assert.match(readField, /class="rd-btn empty"[^>]*>Add what you would create</);
assert.match(readField, /<textarea data-field="solution"[^>]* hidden>/);
const filled = run("fieldDraft={solution:'<b>x</b>'};fieldMarkup('solution','What would you create?')");
assert.match(filled, /class="rd-btn"[^>]*>&lt;b&gt;x&lt;\/b&gt;</);
const chart = run(`panelChart({stages:[{name:'panel',output:{bySegment:[{group:'A <i>',buyers:5,buyRate:0.1}],buyRate:0.1,answered:5,targetSegment:'A <i>',objections:[]}}]})`);
assert.match(chart, /A &lt;i&gt;/);
assert.ok(!chart.includes("<i>") || !chart.includes("A <i>"));
assert.match(run("barRows([{label:'x',v:2,val:'1'}])"), /--v:1;/);
console.log(
  "PASS: empty workspace, escaped record/model content, discussion controls, failure recovery controls, honest usage and personal-only migration.",
);
