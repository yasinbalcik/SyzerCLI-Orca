'use strict';
// Independent `syzer` usage provider patches (hashes in filenames => globs; regex anchors survive minifier renames).
const SB = /^renderer\/assets\/StatusBar-.*\.js$/, ST = /^renderer\/assets\/store-.*\.js$/, SM = /^renderer\/assets\/useSettingsNavigationMetadata-.*\.js$/, CT = /^main\/chunks\/constants-.*\.js$/, MAIN = /^main\/index\.js$/;
const FETCH = 'fetchSyzerUsage(sig){return(async()=>{const cp=process.getBuiltinModule?process.getBuiltinModule(`child_process`):require(`child_process`);' +
  'const base={provider:`syzer`,weekly:null,updatedAt:Date.now()};' +
  'return await new Promise(r=>{if(sig&&sig.aborted)return r({...base,session:null,error:`aborted`,status:`error`});' +
  'const ch=cp.exec((process.env.SYZER_BIN||__SYZER_CMD__)+` usage --summary --json`,{timeout:20000,windowsHide:true,maxBuffer:1<<20},(err,out)=>{' +
  'if(err)return r({...base,session:null,error:`syzer: `+String(err.message).split(String.fromCharCode(10))[0],status:`error`});' +
  'try{const j=JSON.parse(out);const ps=(j.providers||[]).filter(p=>p.percent_used!=null);' +
  'if(!ps.length)return r({...base,session:null,error:`No quota info (${j.keys_ready}/${j.keys_total} keys ready)`,status:`unavailable`});' +
  'const reset=ps.map(p=>p.resets_at?Date.parse(p.resets_at):null).filter(Boolean).sort()[0]||Date.now()+864e5;' +
  'const mk=(name,u,badge,detail,ra)=>({name,usedPercent:u,windowMinutes:1440,resetsAt:ra,resetDescription:badge,badge,detail});' +
  'const left=p=>p.limit!=null?`${Math.max(0,p.limit-(p.used||0))} left`:`quota n/a`;' +
  'const lim=ps.filter(p=>p.limit!=null);const tl=lim.length?`${lim.reduce((a,p)=>a+Math.max(0,p.limit-(p.used||0)),0)} left`:`quota n/a`;' +
  'const total=mk(`Total`,Math.round(ps.reduce((a,p)=>a+p.percent_used,0)/ps.length),`${j.keys_ready}/${j.keys_total} keys`,tl,reset);' +
  'const buckets=[...ps.map(p=>mk(p.name,p.percent_used,`${p.keys_ready}/${p.keys_total} keys`,left(p),p.resets_at?Date.parse(p.resets_at):reset)),total];' +
  'r({...base,session:total,buckets,error:null,status:`ok`})}catch(e){r({...base,session:null,error:`syzer: bad JSON`,status:`error`})}});' +
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
  P('main', MAIN, /this\.withFetchingStatus\(s\.zcode,`zcode`\)\}\);let /, () => 'this.withFetchingStatus(s.zcode,`zcode`),syzer:this.withFetchingStatus(s.syzer,`syzer`)});let '),
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
  P('statusbar', SB, '(0,J.jsx)(`div`,{className:`font-medium ${n}`,children:t}),(0,J.jsx)(`div`,{className:`h-[6px]', '(0,J.jsxs)(`div`,{className:`flex justify-between font-medium ${n}`,children:[t,e.badge?(0,J.jsx)(`span`,{className:`font-normal opacity-70`,children:e.badge}):null]}),(0,J.jsx)(`div`,{className:`h-[6px]'),
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
  P('statusbar', SB, 'e.zcode!==void 0&&Z(e.zcode)?!1:', 'e.zcode!==void 0&&Z(e.zcode)||e.syzer!=null&&Z(e.syzer)?!1:'),
  P('statusbar', SB, /&&!([\w$]+)\(e\.zcode\)\}function /, (m) => `&&!${m[1]}(e.zcode)&&!${m[1]}(e.syzer)}function `),
  P('statusbar', SB, /([\w$]+)\?\.status===`fetching`,([\w$]+)=([\w$]+)\?`Minimize Floating Workspace`/, (m) => `${m[1]}?.status===\`fetching\`||__SZ?.status===\`fetching\`,${m[2]}=${m[3]}?\`Minimize Floating Workspace\``),
  P('statusbar', SB, /,([\w$]+)\?([\w$]+):null\]\.filter\(e=>e!==null\),segmentsIconOnly:/, (m) => `,${m[1]}?${m[2]}:null,__szv?__szd:null].filter(e=>e!==null),segmentsIconOnly:`),
  // kullanım menüsü: ZCode satırının arkasına Syzer anahtarı
  P('statusbar', SB, /([\w$]+)\(`zcode`,t\)&&\(0,([\w$]+)\.jsxs\)\(([\w$]+),\{checked:([\w$]+)\.includes\(`zcode`\),onCheckedChange:\(\)=>\{([\w$]+)\(`usage-tracking`\),([\w$]+)\(`zcode`\)\},children:\[[^\]]*?`ZCode Usage`\)\]\}\),/,
    (m) => `${m[0]}(0,${m[2]}.jsxs)(${m[3]},{checked:${m[4]}.includes(\`syzer\`),onCheckedChange:()=>{${m[5]}(\`usage-tracking\`),${m[6]}(\`syzer\`)},children:[${szIcon(m[2], 14)},\`Syzer Usage\`]}),`),
];
module.exports = { edits };
