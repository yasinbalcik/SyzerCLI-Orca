'use strict';
// Independent `syzer` usage provider patches (hashes in filenames => globs; regex anchors survive minifier renames).
const SB = /^renderer\/assets\/StatusBar-.*\.js$/, ST = /^renderer\/assets\/store-.*\.js$/, SM = /^renderer\/assets\/useSettingsNavigationMetadata-.*\.js$/, CT = /^main\/chunks\/constants-.*\.js$/, MAIN = /^main\/index\.js$/;
// JSON -> Orca provider-state mapper. Written as a real function so it is unit-testable; the injected code is its
// toString() (same source). Injection conventions: backtick strings only, no single quotes, no template placeholders.
// memo: Map kept across polls in the Orca main process (globalThis.__syzerMemo). now: epoch ms.
function szMap(j, memo, now) {
  const WARN = 80, CRIT = 95, DAY = 864e5;
  const ps = (j.providers || []).filter(p => p.percent_used != null);
  if (!ps.length) return { session: null, buckets: [], error: `No quota info (` + j.keys_ready + `/` + j.keys_total + ` keys ready)`, status: `unavailable` };
  const rank = { ok: 0, warn: 1, crit: 2 };
  const roll = (iso) => { let t = iso ? Date.parse(iso) : NaN; if (!(t > 0)) return null; if (t < now) t += Math.ceil((now - t) / DAY) * DAY; return t; };
  const futures = ps.map(p => roll(p.resets_at)).filter(Boolean).sort((a, b) => a - b);
  const reset = futures[0] || now + DAY;
  const left = p => p.limit != null ? Math.max(0, p.limit - (p.used || 0)) + ` left` : `quota n/a`;
  const mk = (name, u, badge, detail, ra, level) => ({ name, usedPercent: u, windowMinutes: 1440, resetsAt: ra, resetDescription: badge, badge, detail, level });
  const buckets = ps.map(p => {
    const noKeys = p.keys_total > 0 && p.keys_ready === 0;
    const level = noKeys || p.percent_used >= CRIT ? `crit` : p.percent_used >= WARN ? `warn` : `ok`;
    const badge = noKeys ? `0 keys ready` : level !== `ok` ? `! ` + p.percent_used + `% used` : p.keys_ready + `/` + p.keys_total + ` keys`;
    let detail = left(p);
    // Key rotation notice: needs the optional payload field providers[].active_key (key index); never guessed.
    const key = p.active_key != null ? p.active_key : null;
    const prev = memo.get(p.provider || p.name);
    let notice = prev ? prev.notice : 0, shownKey = prev ? prev.shownKey : null, show = false;
    if (prev && key != null && prev.key != null && (key !== prev.key || p.keys_ready < prev.ready)) { notice = 2; shownKey = key; show = true; }
    else if (notice > 0) { notice--; show = true; }
    if (key != null && show && shownKey != null) detail = `rotated: key #` + shownKey;
    memo.set(p.provider || p.name, { key, ready: p.keys_ready, notice, shownKey });
    const b = mk(p.name, p.percent_used, badge, detail, roll(p.resets_at) || reset, level);
    b.effPercent = noKeys ? Math.max(p.percent_used, CRIT) : p.percent_used;
    return b;
  });
  const worst = buckets.reduce((a, b) => (rank[b.level] > rank[a.level] || (rank[b.level] === rank[a.level] && b.effPercent > a.effPercent)) ? b : a);
  const lim = ps.filter(p => p.limit != null);
  const tl = lim.length ? lim.reduce((a, p) => a + Math.max(0, p.limit - (p.used || 0)), 0) + ` left` : `quota n/a`;
  const avg = Math.round(ps.reduce((a, p) => a + p.percent_used, 0) / ps.length);
  const total = mk(`Total`, avg, j.keys_ready + `/` + j.keys_total + ` keys`, tl, reset, worst.level);
  if (worst.level !== `ok`) { total.badge = total.resetDescription = worst.badge + ` (` + worst.name + `)`; total.detail = tl + ` | ` + worst.name; }
  // Orca colors a meter purely by usedPercent, so the headline (session) meter would hide one exhausted provider
  // behind a healthy average. When any bucket is >= WARN we feed it the WORST bucket percent; the separate Total
  // bucket keeps the true average.
  const sess = Math.max(...buckets.map(b => b.effPercent));
  const session = sess >= WARN ? { ...total, usedPercent: sess } : total;
  buckets.forEach(b => { delete b.effPercent; });
  return { session, buckets: [...buckets, total], error: null, status: `ok` };
}
const MAP_SRC = szMap.toString();
const mapSyzerUsage = new Function(`return (` + MAP_SRC + `)`)();
const FETCH = 'fetchSyzerUsage(sig){return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' + MAP_SRC + ';' +
  'const base={provider:`syzer`,weekly:null,updatedAt:Date.now()};' +
  'return await new Promise(r=>{if(sig&&sig.aborted)return r({...base,session:null,error:`aborted`,status:`error`});' +
  'const ch=cp.exec((process.env.SYZER_BIN||__SYZER_CMD__)+` usage --summary --json`,{timeout:60000,windowsHide:true,maxBuffer:1<<20},(err,out)=>{' +
  'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(String.fromCharCode(10))[0],status:`error`});' +
  'try{const j=JSON.parse(out);r({...base,...szMap(j,globalThis.__syzerMemo||(globalThis.__syzerMemo=new Map()),Date.now())})}catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}});' +
  'sig&&sig.addEventListener&&sig.addEventListener(`abort`,()=>{try{ch.kill()}catch{}},{once:true})})})()}';
const K = 'fetchKimiWithResolvedHome(){let e=this.kimiHomeResolver?.();';
const P = (group, glob, from, to) => ({ group, glob, from, to });
// Minified adlar sürümden sürüme değişir: çapalar RegExp, yeni adlar yakalama gruplarından gelir.
// `to` bir fonksiyon olabilir; orca-edits.js yer tutucuları (__SYZER_CMD__, __SYZER_ICON__) doldurur.
const szIcon = (jsx, n) => `(0,${jsx}.jsx)(\`img\`,{src:\`__SYZER_ICON__\`,width:${n},height:${n},alt:\`Syzer\`,style:{borderRadius:4}})`;
const FETCHING = '`fetching`';
const edits = [
  // ===== main: kullanım servisi =====
  P('main', MAIN, K, FETCH + K),
  P('main', MAIN, 'cursor:null,zcode:null};grokAuthConfigured=', 'cursor:null,zcode:null,syzer:null};grokAuthConfigured='),
  P('main', MAIN, 'cursor:0,zcode:0};activeFailureStreakByProvider=', 'cursor:0,zcode:0,syzer:0};activeFailureStreakByProvider='),
  P('main', MAIN, 'cursor:0,zcode:0};mainWindow=null;', 'cursor:0,zcode:0,syzer:0};mainWindow=null;'),
  // döngü başında "fetching" durumu
  P('main', MAIN, /this\.withFetchingStatus\(([\w$]+)\.zcode,`zcode`\)\}\);let /, (m) => `this.withFetchingStatus(${m[1]}.zcode,\`zcode\`),syzer:this.withFetchingStatus(${m[1]}.syzer,\`syzer\`)});let `),
  // hazırlık adımı Syzer isteğini başlatır (reddedilmez: hata durumunu kendisi döner), çalıştırma adımı sonucu bekler
  P('main', MAIN, /antigravityResultPromise:([\w$]+)\}\)\}\};function ([\w$]+)\(e,t\)\{return t\.status===`fulfilled`/, (m) => `antigravityResultPromise:${m[1]},syzerResultPromise:this.fetchSyzerUsage(e)})}};function ${m[2]}(e,t){return t.status===\`fulfilled\``),
  P('main', MAIN, /antigravityResultPromise:([\w$]+)\}=n;/, (m) => `antigravityResultPromise:${m[1]},syzerResultPromise:__szq}=n;`),
  P('main', MAIN, /antigravity:this\.applyStalePolicy\(([\w$]+),s\.antigravity\)\}\)\}\},/, (m) => `antigravity:this.applyStalePolicy(${m[1]},s.antigravity),syzer:this.applyStalePolicy((await __szq)??s.syzer,s.syzer)})}},`),
  P('main', MAIN, 'zcode:this.state.zcode};return Object.entries(e)', 'zcode:this.state.zcode,syzer:this.state.syzer};return Object.entries(e)'),
  P('main', MAIN, /`cursor`,`zcode`,`ssh`,`resource-usage`,`ports`\]\)/, () => '`cursor`,`zcode`,`syzer`,`ssh`,`resource-usage`,`ports`])'),
  P('main', MAIN, /_zcodeStatusBarDefaultAdded:([\w$]+)\.l\(\)\.optional\(\),/, (m) => `${m[0]}_syzerStatusBarDefaultAdded:${m[1]}.l().optional(),`),
  // ===== store =====
  P('store', ST, /`cursor`,`zcode`,`ssh`,`resource-usage`,`ports`\](,[\w$]+=\{todo:)/, (m) => `\`cursor\`,\`zcode\`,\`syzer\`,\`ssh\`,\`resource-usage\`,\`ports\`]${m[1]}`),
  P('store', ST, /\[`_zcodeStatusBarDefaultAdded`,([\w$]+)\]\];for/, (m) => `[\`_zcodeStatusBarDefaultAdded\`,${m[1]}],[\`_syzerStatusBarDefaultAdded\`,\`syzer\`]];for`),
  P('store', ST, 'cursor:null,zcode:null,minimaxCookieConfigured:!1', 'cursor:null,zcode:null,syzer:null,minimaxCookieConfigured:!1'),
  // ===== durum çubuğu =====
  P('statusbar', SB, /(e\.resetsAt\?[\w$]+\(e\.resetsAt-[\w$]+\):null;return\(0,([\w$]+)\.jsxs\)\(`div`,\{className:`space-y-1`,children:\[)\(0,\2\.jsx\)\(`div`,\{className:`font-medium \$\{([\w$]+)\}`,children:([\w$]+)\}\),\(0,\2\.jsx\)\(`div`,\{className:`h-\[6px\]/,
    (m) => `${m[1]}(0,${m[2]}.jsxs)(\`div\`,{className:\`flex justify-between font-medium \${${m[3]}}\`,children:[${m[4]},e.badge?(0,${m[2]}.jsx)(\`span\`,{className:\`font-normal opacity-70\`,children:e.badge}):null]}),(0,${m[2]}.jsx)(\`div\`,{className:\`h-[6px]`),
  P('statusbar', SB, /d&&\(0,([\w$]+)\.jsx\)\(`span`,\{children:d\}\)\]\}\)\]\}\)\}function ([\w$]+)\(\{p:e,/, (m) => `e.detail&&(0,${m[1]}.jsx)(\`span\`,{children:e.detail}),d&&(0,${m[1]}.jsx)(\`span\`,{children:d})]})]})}function ${m[2]}({p:e,`),
  P('statusbar', SB, /:e===`zcode`\?`ZCode`:e===`cursor`\?`Cursor`:e\}/, () => ':e===`zcode`?`ZCode`:e===`cursor`?`Cursor`:e===`syzer`?`Syzer`:e}'),
  P('statusbar', SB, /e===`kimi`\?\(0,([\w$]+)\.jsx\)\(([\w$]+),\{agent:`kimi`,size:13\}\)/, (m) => `e===\`syzer\`?${szIcon(m[1], 13)}:${m[0]}`),
  P('statusbar', SB, 'case`kimi`:return`K`;', 'case`kimi`:return`K`;case`syzer`:return`S`;'),
  P('statusbar', SB, 'case`antigravity`:case`kimi`:return null;', 'case`antigravity`:case`kimi`:return null;case`syzer`:return null;'),
  P('statusbar', SB, /cursor:([\w$]+),zcode:([\w$]+)\}=n,/, (m) => `cursor:${m[1]},zcode:${m[2]},syzer:__SZ}=n,`),
  P('statusbar', SB, /([\w$]+)=([\w$]+)\(`zcode`,([\w$]+),([\w$]+)\),/, (m) => `${m[0]}__szd=${m[2]}(\`syzer\`,__SZ,${m[4]}),`),
  P('statusbar', SB, /([\w$]+)=([\w$]+)!==null&&([\w$]+)\.includes\(`zcode`\)&&\([\w$]+\.zcodePlanApiKeyConfigured\|\|[\w$]+\(`zcode`,[\w$]+\)\),/, (m) => `${m[0]}__szv=__szd!==null&&${m[3]}.includes(\`syzer\`),`),
  P('statusbar', SB, /,([\w$]+)=((?:[\w$]+\|\|){9}[\w$]+),([\w$]+)=\1\|\|[\w$]+,/, (m) => `,${m[1]}=${m[2]}||__szv,${m[3]}=${m[1]}||${m[0].split('||').pop()}`),
  P('statusbar', SB, /cursor:([\w$]+),zcode:([\w$]+)\},([\w$]+)\),/, (m) => `cursor:${m[1]},zcode:${m[2]},syzer:__SZ},${m[3]}),`),
  P('statusbar', SB, /e\.zcode!==void 0&&([\w$]+)\(e\.zcode\)\?!1:/, (m) => `e.zcode!==void 0&&${m[1]}(e.zcode)||e.syzer!=null&&${m[1]}(e.syzer)?!1:`),
  P('statusbar', SB, /&&!([\w$]+)\(e\.zcode\)\}function /, (m) => `&&!${m[1]}(e.zcode)&&!${m[1]}(e.syzer)}function `),
  P('statusbar', SB, /([\w$]+)\?\.status===`fetching`,([\w$]+)=([\w$]+)\?`Minimize Floating Workspace`/, (m) => `${m[1]}?.status===\`fetching\`||__SZ?.status===\`fetching\`,${m[2]}=${m[3]}?\`Minimize Floating Workspace\``),
  P('statusbar', SB, /,([\w$]+)\?([\w$]+):null\]\.filter\(e=>e!==null\),segmentsIconOnly:/, (m) => `,${m[1]}?${m[2]}:null,__szv?__szd:null].filter(e=>e!==null),segmentsIconOnly:`),
  // kullanım menüsü: ZCode satırının arkasına Syzer anahtarı
  P('statusbar', SB, /([\w$]+)\(`zcode`,t\)&&\(0,([\w$]+)\.jsxs\)\(([\w$]+),\{checked:([\w$]+)\.includes\(`zcode`\),onCheckedChange:\(\)=>\{([\w$]+)\(`usage-tracking`\),([\w$]+)\(`zcode`\)\},children:\[[^\]]*?`ZCode Usage`\)\]\}\),/,
    (m) => `${m[0]}(0,${m[2]}.jsxs)(${m[3]},{checked:${m[4]}.includes(\`syzer\`),onCheckedChange:()=>{${m[5]}(\`usage-tracking\`),${m[6]}(\`syzer\`)},children:[${szIcon(m[2], 14)},\`Syzer Usage\`]}),`),
];
module.exports = { edits, mapSyzerUsage, MAP_SRC };
