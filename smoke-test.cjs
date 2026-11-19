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
vm.runInContext(fs.readFileSync(require("node:path").join(__dirname, "dist/assets/business-math.js"), "utf8").replace(/if \(typeof module[\s\S]*$/, ""), context);
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
run("location.hash='#entry/abc'");
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

// dashboard cards
const ST = (name, output, extra = {}) => ({ name, status: "done", usage: { calls: 1 }, output, ...extra });
const dashJob = {
  id: "dj1", kind: "test_pipeline", ideaId: "d1", ideaTitle: "D", stage: "", status: "done", usage: { calls: 3, inputTokens: 0, outputTokens: 0 }, caps: { calls: 25 }, gate: null, error: "", waiting: null,
  models: { planner: { provider: "local", model: "p" }, writer: { provider: "local", model: "w" }, simulation: { provider: "local", model: "w" } },
  stages: [
    ST("board", { scores: [6, 5, 7], votes: ["FUND", "FUND IF", "PASS"], chair: "Chair <b>x</b>", recordIds: [] }),
    ST("competitors", { names: ["A"], items: [{ recordId: "k1", name: "AstroSoft", kind: "direct", x: 3, y: 4 }, { recordId: "k2", name: "Sheets", kind: "substitute", x: 8, y: 2 }], axes: { x: { label: "Price", low: "free", high: "costly" }, y: { label: "Ease", low: "manual", high: "auto" } }, gap: "No quantum <i>", copycat: "Big cloud", recordIds: ["k1", "k2"] }),
    ST("panel", { n: 20, answered: 20, inconclusive: false, buyRate: 0.35, targetSegment: "Postdocs", targetRate: 0.5, bySegment: [{ group: "Postdocs", buyers: 10, buyRate: 0.5, yes: 5, no: 5, reasons: [{ text: "No <b>budget</b>", count: 3 }] }, { group: "Staff", buyers: 10, buyRate: 0.2, yes: 2, no: 8, reasons: [] }], objections: [{ text: "Another tool", count: 4 }], flips: ["Cheaper"], recordIds: [] }),
    ST("pricing", { suggested: 7, range: [4, 11], rangeReversed: false, points: {}, competitorPrices: [], businessMath: { missing: [], invalid: [], contribution: 5, margin: 0.714, breakEven: 20, capacity: 50, profitAtCapacity: 150, warnings: [] }, ownBusinessMath: null, recordIds: ["pn"] }),
  ],
};
const dashRecords = [
  { id: "d1", type: "idea", title: "D", body: "", stage: "draft", fields: {}, links: [], updated: "2026-01-01" },
  { id: "pn", type: "note", title: "Pricing (simulated)", body: "Simulated: a guess.\n\nSuggested test price: $7", stage: "draft", fields: {}, links: ["d1"], origin: { by: "simulation" }, reviewed: null, updated: "2026-01-01" },
  { id: "k1", type: "competitor", title: "AstroSoft (unconfirmed)", body: "", stage: "draft", fields: { facts: "Kind: direct.\nSells (hypothesis): Pipelines\nPositioning (hypothesis): Classical <b>x</b>\nLikely buyer complaint (hypothesis): Slow\nWhere to check (price and source): Their pricing page", gaps: "No quantum" }, links: ["d1"], origin: { by: "simulation", runId: "dj1" }, reviewed: null, updated: "2026-01-01" },
  { id: "k2", type: "competitor", title: "Sheets (unconfirmed)", body: "", stage: "draft", fields: { facts: "Kind: substitute.\nPositioning (hypothesis): Free" }, links: ["d1"], origin: { by: "simulation", runId: "dj1" }, reviewed: null, updated: "2026-01-01" },
  { id: "k3", type: "competitor", title: "Real Co", body: "", stage: "draft", fields: { facts: "Their site", pricing: "$7 a month", sources: "https://real.test" }, links: ["d1"], origin: { by: "user" }, reviewed: null, updated: "2026-01-01" },
];
context.__dash = { job: dashJob, records: dashRecords };
run(`state.assistant={planner:{provider:'local',model:'p'},writer:{provider:'local',model:'w'}};state.jobs=[__dash.job];state.records=__dash.records;fieldDraft={currency:'$',price:'9',variableCost:'2',fixedCosts:'100',hoursPerCustomer:'2',availableHours:'100'};dash.summary={forId:'d1',data:null,busy:false,error:''}`);
const idea1 = "state.records[0]";
assert.match(run(`heroCard(${idea1})`), /Loading the summary/);
run(`dash.summary.data={ready:true,current:true,busy:false,summary:{text:'x',sections:{verdict:'Board is <b>split</b>.',signal:'Sig',risk:'Risk',numbers:'Nums',competitors:'Comps',next:'Pre-sell to ten.'},words:140,model:'w',localOnly:true,at:'2026-11-01T00:00:00Z'}}`);
const hero = run(`heroCard(${idea1})`);
assert.match(hero, /Board is &lt;b&gt;split/);
assert.ok(!hero.includes("<b>split"));
assert.match(hero, /data-summary="force"[^>]*>Regenerate/);
assert.match(hero, /Pre-sell to ten/);
assert.match(hero, /local only/);
assert.match(run(`heroKpis(${idea1})`), /2 of 3 fund/);
assert.match(run(`heroKpis(${idea1})`), /50% yes/);
assert.match(run(`heroKpis(${idea1})`), /77\.8%/);
assert.equal((hero.match(/by-simulation/g) || []).length, 1, "one Simulated mark in the hero card");
assert.ok(!hero.includes("results changed since"));
run(`dash.summary.data.current=false`);
assert.match(run(`heroCard(${idea1})`), /results changed since/);
run(`dash.summary.data={ready:false,current:false,busy:false,summary:null}`);
assert.match(run(`heroCard(${idea1})`), /Nothing tested yet/);
run(`dash.summary.data={ready:true,current:false,busy:false,summary:null}`);
assert.match(run(`heroCard(${idea1})`), /data-summary="1"[^>]*>Write the summary/);
run(`dash.summary.busy=true`);
assert.match(run(`heroCard(${idea1})`), /Writing the summary/);
run(`dash.summary.busy=false`);

const detail = run("segDetail(stageOut('d1','panel').out, 0)");
assert.match(detail, /5 yes · 5 no · 50%/);
assert.match(detail, /No &lt;b&gt;budget/);
assert.match(detail, /Target segment/);
assert.match(run("segDetail(stageOut('d1','panel').out, 1)"), /2 yes · 8 no[\s\S]*Another tool/);
assert.match(run("segDetail(stageOut('d1','panel').out, -1)"), /All buyers[\s\S]*7 yes · 13 no/);
const charts = run(`chartsCard(${idea1})`);
assert.match(charts, /data-seg="-1"[^>]*role="button"/);
assert.match(charts, /id="seg-detail"/);
assert.match(charts, /What price feels right/);
assert.equal((charts.match(/by-simulation/g) || []).length, 1);

const nums = run(`numbersCard(${idea1})`);
assert.match(nums, /Your numbers/);
assert.match(nums, /At the test price \$ 7/);
assert.match(nums, /<th scope="row">Margin<\/th><td>77\.8%<\/td><td>71\.4%<\/td>/);
assert.match(nums, /Kept per sale<\/th><td>\$ 7<\/td><td>\$ 5<\/td>/);
assert.match(nums, /Break-even<\/th><td>15<\/td><td>20<\/td>/);
run(`fieldDraft={currency:'$',price:'',variableCost:'2'}`);
const missing = run(`numbersCard(${idea1})`);
assert.match(missing, /Your numbers: Missing: price, fixed costs, hours per customer, available hours/);
assert.ok(!/NaN|undefined|Infinity/.test(missing), "no NaN when inputs are missing");
run(`fieldDraft={}`);
assert.ok(!/NaN|undefined|Infinity/.test(run(`numbersCard(${idea1})`)));
assert.match(run(`heroKpis(${idea1})`), /Margin at test price<\/span><strong>71\.4%/, "falls back to the test price, and says so");
run(`state.jobs=[{...__dash.job,stages:__dash.job.stages.filter((x)=>x.name!=="pricing")}]`);
assert.match(run(`heroKpis(${idea1})`), /Test the idea to work it out/, "says what to do, not that it failed");
run(`state.jobs=[__dash.job]`);

const comp = run(`compCard(${idea1})`);
assert.match(comp, /href="#entry\/k1"[^>]*>AstroSoft</);
assert.match(comp, /Direct <small>1<\/small>/);
assert.match(comp, /Substitutes <small>1<\/small>/);
assert.match(comp, /Added by you <small>1<\/small>/);
assert.match(comp, /Classical &lt;b&gt;x&lt;\/b&gt;/);
assert.match(comp, /Check price and source<\/dt><dd>Their pricing page/);
assert.match(comp, /Price: \$7 a month/);
assert.equal((comp.match(/Price not confirmed/g) || []).length, 2, "no invented prices for unconfirmed competitors");
assert.equal((comp.match(/>Unconfirmed</g) || []).length, 2);
assert.match(comp, />Sourced</);
assert.match(comp, /accept it, and add a source link/);
assert.match(comp, /<svg viewBox/);
assert.match(comp, /Positioning map, Price across and Ease up\. 1 AstroSoft, 2 Sheets/);
assert.match(comp, /class="comp-no" aria-hidden="true">1<\/span><a class="comp-name"[^>]*>AstroSoft/);
assert.ok(!/<text[^>]*>[A-Za-z]/.test(comp), "map dots carry numbers, never truncated names");
assert.match(comp, /Across: Price \(free to costly\)\. Up: Ease \(manual to auto\)\./);
assert.match(comp, /No quantum &lt;i&gt;/);

run(`state.records.push({id:'k0',type:'competitor',title:'AstroSoft (unconfirmed)',body:'',stage:'draft',fields:{facts:'Kind: direct.'},links:['d1'],origin:{by:'simulation',runId:'older'},reviewed:null,updated:'2026-01-01'})`);
assert.equal((run(`compCard(${idea1})`).match(/class="comp-name"[^>]*>AstroSoft</g) || []).length, 1, "competitors from an older run are not listed twice");
run(`state.records.pop()`);
run(`fieldDraft={}`);
run(`state.jobs=[{...__dash.job,stages:__dash.job.stages.filter((x)=>x.name!=="pricing")}]`);
assert.match(run(`numbersCard(${idea1})`), /Not worked out yet[\s\S]*Test this idea/);
run(`state.jobs=[__dash.job]`);
const outs = run(`outputsPanel(${idea1})`);
assert.match(outs, /id="out-board"/);
assert.match(outs, /Chair &lt;b&gt;x/);
assert.match(outs, /Suggested test price: \$7/);
assert.ok(!outs.includes("Simulated: a guess"), "boilerplate disclaimer is not repeated in outputs");

assert.deepEqual(JSON.parse(run("JSON.stringify(defaultLayout('idea').map((c) => c.id))")), ["kpis", "hero", "charts", "numbers", "details", "timeline", "research", "links", "comp"]);
assert.deepEqual(JSON.parse(run("JSON.stringify(defaultLayout('note'))")), [{ id: "details", w: 2, h: "full" }, { id: "links", w: 1, h: "full" }]);
run("state.layouts={idea:[{id:'charts',w:3,h:'compact'},{id:'bogus',w:1,h:'full'},{id:'hero',w:1,h:'full'}]}");
const merged = JSON.parse(run("JSON.stringify(mergedLayout('idea'))"));
assert.deepEqual(merged.slice(0, 2), [{ id: "charts", w: 3, h: "compact" }, { id: "hero", w: 1, h: "full" }], "saved order and sizes win");
assert.ok(!merged.some((c) => c.id === "bogus"), "unknown cards are dropped");
assert.equal(merged.length, 9, "cards missing from a saved layout are appended");
assert.deepEqual(JSON.parse(run("JSON.stringify(mergedLayout('note'))")), JSON.parse(run("JSON.stringify(defaultLayout('note'))")), "one layout per entry type");
run("state.layouts={}");
run("dash.lim={}");
const page = (n) => JSON.parse(run(`JSON.stringify(limited('t', Array.from({length: 80}, (_, i) => i), (n) => '<i>' + n + '</i>'))`));
let lim = page();
assert.equal((lim.html.match(/<i>/g) || []).length, 10);
assert.match(lim.controls, /Showing 10 of 80/);
assert.match(lim.controls, /data-more="t"[^>]*>Show 10 more</);
assert.ok(!lim.controls.includes("data-less"));
run("dash.lim.t = 30");
lim = page();
assert.equal((lim.html.match(/<i>/g) || []).length, 30);
assert.match(lim.controls, /data-less="t"[^>]*>Show less</);
run("dash.lim.t = 80");
assert.ok(!page().controls.includes("data-more"));
assert.equal(run("limited('t', [1,2,3], String).controls"), "", "short lists have no controls");
run("dash.lim={}");
run(`rs={forId:'d1',view:{papers:Array.from({length:80},(_, i)=>({id:'p'+i,title:'Paper '+i,authors:[],year:2020,decision:'maybe',sources:[]})),counts:{include:0,exclude:0,maybe:80},searches:[]},error:'',filter:'all',q:'',verified:false,sel:new Set(),claim:'',cite:null,busy:''}`);
const table = run("rsTable(rs.view)");
assert.equal((table.match(/class="rs-row"/g) || []).length, 10, "the screening table shows 10 of 80 first");
assert.match(table, /Show 10 more/);
assert.match(table, /80 candidates/);
assert.match(run(`researchCard(${idea1})`), /<dt>Candidates<\/dt><dd>80<\/dd>/);

(async () => {
// unit economics card, retry buttons and the no-"n/a" rule
{
  const { unitEconomics } = require("./dist/assets/business-math.js");
  const mk = (over) => ({ price: 9, variableCost: 2.5, fixedCosts: 400, hoursPerCustomer: 2, availableHours: 100, startup: 300, ramp: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.9, 0.9], ...over });
  const cfoOut = {
    assumed: ["variableCost", "fixedCosts"],
    assumptions: { variableCost: { value: 2.5, why: "Cost of <b>materials</b>", label: "ASSUMPTION" }, fixedCosts: { value: 400, why: "Rent share", label: "ASSUMPTION" }, startup: { value: 300, why: "Launch spend", label: "ASSUMPTION" }, ramp: { shares: mk().ramp, why: "Slow start" } },
    source: { price: "yours", variableCost: "assumed", fixedCosts: "assumed", hoursPerCustomer: "yours", availableHours: "yours" },
    inputs: { price: 7, variableCost: 2.5, fixedCosts: 400, hoursPerCustomer: 2, availableHours: 100, startup: 300 },
    testPrice: 7,
    atTestPrice: unitEconomics(mk({ price: 7 })),
    atOwnPrice: unitEconomics(mk({ price: 9 })),
    recordIds: [],
  };
  context.__cfo = cfoOut;
  const base = (stages, over = {}) => `state.jobs=[{...__dash.job,${Object.entries(over).map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(",")}${Object.keys(over).length ? "," : ""}stages:[...__dash.job.stages,...${JSON.stringify(stages)}]}]`;
  const noWords = (html, label) => assert.ok(!/\bn\/a\b|not computed|\bbug\b|\berror\b|NaN|undefined|Infinity/i.test(html), label + ": " + (html.match(/\bn\/a\b|not computed|\bbug\b|\berror\b|NaN|undefined|Infinity/i) || [])[0]);
  const restore = () => run("state.records=__dash.records;state.assistant={planner:{provider:'local',model:'p'},writer:{provider:'local',model:'w'}}");
  const cards = () => ["heroKpis", "heroCard", "chartsCard", "numbersCard", "timelineCard", "compCard", "researchCard", "outputsPanel"].map((f) => [f, run(`${f}(${idea1})`)]);

  run(`state.records=__dash.records;rs={forId:'d1',view:null,error:'',filter:'all',q:'',verified:false,sel:new Set(),claim:'',cite:null,busy:'',frameDraft:null,queryDraft:null};fieldDraft={currency:'$',price:'9',hoursPerCustomer:'2',availableHours:'100'};dash.summary={forId:'d1',data:{ready:true,current:true,busy:false,summary:{text:'x',sections:{verdict:'v',signal:'s',risk:'r',numbers:'n',competitors:'c',next:'x'},words:100,model:'w',localOnly:true,at:'2026-11-01T00:00:00Z'}},busy:false,error:''}`);
  run(base([{ name: "cfo", status: "done", usage: { calls: 1 }, output: "__CFO__" }]).replace('"__CFO__"', "__cfo"));
  const nums = run(`numbersCard(${idea1})`);
  noWords(nums, "numbers card with assumptions");
  assert.match(nums, /ASSUMPTION/);
  assert.match(nums, /Cost of &lt;b&gt;materials&lt;\/b&gt;/, "the rationale is escaped");
  assert.match(nums, /At your price \$ 9/);
  assert.match(nums, /At the test price \$ 7/);
  for (const row of ["Kept per sale", "Margin", "Break-even", "Capacity", "Profit at capacity", "Year 1 profit", "Cash needed", "Startup earned back"]) assert.match(nums, new RegExp(`<th scope="row">${row}</th>`));
  assert.match(nums, /Year 1, month by month/);
  assert.equal((nums.match(/<tr><th scope="row">\d+<\/th>/g) || []).length, 12, "twelve months");
  assert.match(nums, /What if the price drops, sales dip or costs rise/);
  for (const row of ["Base plan", "Price -10%", "Sales -20%", "Costs +10%"]) assert.equal((nums.match(new RegExp(`<th scope="row">${row.replace(/[+%]/g, "\\$&")}</th>`, "g")) || []).length, 2, row + " at both prices");
  assert.match(nums, /data-use-numbers="1"[^>]*>Use these numbers/);
  assert.match(nums, /Copies variable cost per sale, fixed costs per period into your idea/);
  assert.match(nums, /<span class="tag yours">Yours<\/span>/);
  assert.equal((nums.match(/class="tag assumed">ASSUMPTION/g) || []).length, 3, "two assumed inputs and the startup spend");
  assert.match(run(`heroKpis(${idea1})`), /Margin<\/span><strong>[\d.]+%<\/strong><span class="kpi-s">break-even \d+ of \d+ · assumed inputs/);
  assert.deepEqual(JSON.parse(run("JSON.stringify(fieldsToUse(__cfo))")), { variableCost: "2.5", fixedCosts: "400" }, "only assumptions for blank fields");

  // "Use these numbers" fills the form fields only when clicked, and never overwrites the owner
  run(`fieldDraft.variableCost='3'`);
  assert.deepEqual(JSON.parse(run("JSON.stringify(fieldsToUse(__cfo))")), { fixedCosts: "400" }, "a value the owner typed is kept");
  run(`fieldDraft.variableCost=''`);
  assert.equal(run("fieldDraft.fixedCosts"), undefined, "rendering never writes assumptions into the draft");
  node("#record-id").value = "d1";
  await run("handleJobClick({dataset:{useNumbers:'1'}})");
  restore();
  run(base([{ name: "cfo", status: "done", usage: { calls: 1 }, output: "__CFO__" }]).replace('"__CFO__"', "__cfo"));
  assert.equal(run("fieldDraft.variableCost"), "2.5");
  assert.equal(run("fieldDraft.fixedCosts"), "400");
  assert.equal(run("fieldDraft.price"), "9", "the owner's own price is untouched");
  const after = run(`numbersCard(${idea1})`);
  assert.ok(!after.includes("data-use-numbers"), "the button goes away once the numbers are copied");
  assert.ok(!after.includes("You changed your numbers"), "copied values match the worked-out ones");
  run(`fieldDraft.fixedCosts='999'`);
  const changed = run(`numbersCard(${idea1})`);
  assert.match(changed, /You changed your numbers since this was worked out[\s\S]*data-retry="dj1" data-retry-stage="cfo"[^>]*>Update from new results/);
  run(`fieldDraft={currency:'$',price:'9',hoursPerCustomer:'2',availableHours:'100'}`);
  node("#record-id").value = "";

  // a failed unit-economics step says what happened in plain words and offers a retry
  run(base([{ name: "cfo", status: "failed", usage: { calls: 1 }, output: null, error: "TypeError: x is not a function at foo.cjs:12", reason: "The model's answer could not be read." }]));
  let failedNums = run(`numbersCard(${idea1})`);
  noWords(failedNums, "failed CFO card");
  assert.match(failedNums, /The model&#39;s answer could not be read\.[\s\S]*data-retry="dj1" data-retry-stage="cfo"[^>]*>Retry this step/);
  assert.ok(!failedNums.includes("foo.cjs") && !failedNums.includes("TypeError"), "no internal error text");
  assert.match(failedNums, /Test this idea|Not worked out yet/);
  run(`state.jobs=[{...__dash.job,status:"running",stages:[...__dash.job.stages,{name:"cfo",status:"failed",usage:{calls:1},output:null,reason:"x"}]}]`);
  assert.match(run(`numbersCard(${idea1})`), /disabled>Working…/, "the button shows progress while the job runs");

  // incomplete and stale stages
  run(base([], {}));
  run(`state.jobs=[{...__dash.job,stages:__dash.job.stages.map((s)=>s.name==="panel"?{...s,output:{...s.output,incomplete:{stage:"panel",action:"Ask the 15 missing buyers",reason:"Only 5 of 20 simulated buyers answered, so the buy rate is not reliable yet."}}}:s.name==="competitors"?{...s,stale:{by:"competitors",at:"2026-11-02"}}:s)}]`);
  const charts2 = run(`chartsCard(${idea1})`);
  assert.match(charts2, /Only 5 of 20 simulated buyers answered[\s\S]*data-retry="dj1" data-retry-stage="panel" title="Ask the 15 missing buyers"[^>]*>Retry this step/);
  assert.match(run(`compCard(${idea1})`), /Built on older competitors results\.[\s\S]*data-retry-stage="competitors"[^>]*>Update from new results/);
  const tl = run(`timelineCard(${idea1})`);
  assert.match(tl, /incomplete/);
  assert.match(tl, /outdated/);
  assert.match(tl, /<b>Panel\.<\/b> Only 5 of 20/);
  const outRows = run(`jobStageRow(state.jobs[0], state.jobs[0].stages.find((s)=>s.name==="panel"))`);
  assert.match(outRows, /Done, incomplete[\s\S]*Retry this step/);

  // a failed job explains itself without raw error text
  run(`state.jobs=[{...__dash.job,status:"failed",error:"marketing: ECONNRESET at socket.js:99",stages:__dash.job.stages.map((s)=>s.name==="pricing"?{...s,status:"failed",output:null,error:"boom internal",reason:"The model took too long to answer."}:s)}]`);
  assert.equal(run("jobProblem(state.jobs[0])"), "Pricing: The model took too long to answer.");
  assert.equal(run(`jobProblem({status:"failed",error:"x",stages:[{name:"cfo",status:"failed",reason:"weird raw text"}]})`), "Unit economics: This step did not finish.", "an unknown reason falls back to plain words");
  assert.ok(!run(`jobProblem(state.jobs[0])`).includes("boom"));

  // the retry button calls the API for just that stage
  const calls = [];
  context.fetch = async (url, init) => (calls.push([url, init?.method, init?.body]), { ok: true, json: async () => ({ ...initial, jobs: [] }) });
  await run("handleJobClick({dataset:{retry:'dj1',retryStage:'panel'}})");
  restore();
  assert.deepEqual(calls[0], ["/api/jobs/dj1/retry", "POST", JSON.stringify({ stage: "panel" })]);
  assert.equal(run("retrying.size"), 0, "the busy mark clears afterwards");
  context.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: "ECONNRESET deep inside the stack" }) });
  await run("retryStage('dj1','panel')");
  restore();
  assert.equal(run("retrying.size"), 0);
  assert.equal(run("friendlyError('ECONNRESET deep inside the stack')"), "That did not work this time. Try again in a moment.");
  assert.equal(run("friendlyError('This test is still working. Wait for it to finish or cancel it first.')"), "This test is still working. Wait for it to finish or cancel it first.");
  context.fetch = async () => ({ ok: true, json: async () => initial });

  // summary: a failed write says so plainly and offers a retry; the regenerate button is still there
  run(`state.jobs=[{...__dash.job,summaryError:"The model took too long to answer."}]`);
  run(`dash.summary.data={ready:true,current:false,busy:false,summary:null}`);
  const sumFail = run(`heroCard(${idea1})`);
  assert.match(sumFail, /The summary did not get written\. The model took too long to answer\.[\s\S]*data-summary="1"[^>]*>Retry this step/);
  assert.match(sumFail, /data-summary="force"[^>]*>Regenerate/);
  run(`state.jobs=[{...__dash.job,summaryError:"TypeError: raw detail"}]`);
  assert.ok(!run(`heroCard(${idea1})`).includes("TypeError"), "raw summary errors are not shown");
  run(`dash.summary.error="The summary did not get written this time."`);
  assert.match(run(`heroCard(${idea1})`), /class="retry-note failed"[\s\S]*Retry this step/);
  run(`dash.summary.error=""`);

  // the rule: no card shows n/a, not computed, bug or error, in any of these states
  const states = {
    "nothing run": () => run(`state.jobs=[];fieldDraft={}`),
    "no numbers, test done": () => run(`state.jobs=[__dash.job];fieldDraft={}`),
    "partial numbers": () => run(`state.jobs=[__dash.job];fieldDraft={currency:'$',price:'',variableCost:'2'}`),
    "with unit economics": () => run(`fieldDraft={currency:'$',price:'9'};${base([{ name: "cfo", status: "done", usage: { calls: 1 }, output: "__CFO__" }]).replace('"__CFO__"', "__cfo")}`),
    "unit economics failed": () => run(`fieldDraft={};${base([{ name: "cfo", status: "failed", usage: { calls: 1 }, output: null, reason: "x" }])}`),
    "pricing without a test price": () => run(`fieldDraft={};state.jobs=[{...__dash.job,stages:__dash.job.stages.map((s)=>s.name==="pricing"?{...s,output:{...s.output,suggested:null,range:[null,null],businessMath:null,incomplete:{stage:"panel",action:"x",reason:"The simulated buyers gave too few usable price answers, so no test price could be suggested."}}}:s)}]`),
  };
  for (const [name, set] of Object.entries(states)) {
    run(`dash.summary.data={ready:true,current:true,busy:false,summary:null}`);
    set();
    for (const [fn, html] of cards()) noWords(html, `${fn} / ${name}`);
  }
  run(`state.jobs=[__dash.job];fieldDraft={currency:'$',price:'9',variableCost:'2',fixedCosts:'100',hoursPerCustomer:'2',availableHours:'100'}`);
}

console.log(
  "PASS: empty workspace, escaped record/model content, discussion controls, failure recovery controls, honest usage and personal-only migration.",
);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
