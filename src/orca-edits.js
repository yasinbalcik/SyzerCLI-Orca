'use strict';

// Orca yama listesi. Her düzenleme { file | glob, from, to, group }:
//   from  → paketteki TAM metin (dosya içinde tam bir kez eşleşmeli)
//   group → bir grup bütünüyle uygulanır ya da bütünüyle atlanır (yarım yama bırakılmaz)
// Gruplar: core (yama işareti) · usage (Usage paneli/durum çubuğu) · agent (Syzer'ın kendi ajan kimliği + durum olayları)
//          · history (oturum geçmişi tarayıcısı: Syzer oturumları + alt ajan listesi)
const SB = /^out\/renderer\/assets\/StatusBar-.*\.js$/;

// usage sağlayıcı yamaları (ayrı dosya; glob'lar out/ önekiyle, yer tutucular doldurulur)
function usageEdits(cmd, ICON) {
  const fill = (s) => s.split('__SYZER_CMD__').join(JSON.stringify(cmd)).split('__SYZER_ICON__').join(ICON);
  return require('./orca-edits-usage').edits.map((e) => ({
    group: e.group === 'settings' ? 'usage-settings' : 'usage',
    glob: new RegExp(e.glob.source.replace(/^\^/, '^out\/'), e.glob.flags),
    from: e.from,
    to: typeof e.to === 'function' ? (m) => fill(e.to(m)) : fill(e.to),
  }));
}
const g = (name) => (re) => ({ re, name });

// Tarayıcı hizmetine eklenen Syzer oturum ayrıştırıcısı. Minified yardımcı adları sürümden sürüme değişir:
// jcode ayrıştırıcısının kendi gövdesinden okunur (H=genel yardımcılar, M=tarayıcı modülü, dosya okuyucu).
// Biçim değişirse parserFor fırlatır ve grup güvenle atlanır.
const ID = String.raw`[\w$]+`;
const LIST_CODEBUDDY = /\.codebuddy\.jcode(?=(?:\.[\w-]+)*`\.split\(`\.`\))/;
const JCODE_PARSER_RE = new RegExp(
  String.raw`async function ${ID}\(e,t=process\.platform,n\)\{return ${ID}\(e,await ${ID}\.${ID}\(e\.path,\`utf-8\`,\`scan\`\),t,n\?\{messages:n\}:void 0\)\}` +
  String.raw`function ${ID}\(e,t,n=process\.platform,${ID}=\{\}\)\{(?:(?!agent:\`)[^])*agent:\`jcode\`[^]*?return ${ID}\.${ID}\(${ID},n,${ID}\)\}` +
  String.raw`function ${ID}\(e,t\)\{[^]*?\}(?=async function|var |function )`,
);
function parserFor(src) {
  const need = (re, what) => { const m = src.match(re); if (!m) throw new Error(`jcode parser shape changed: ${what}`); return m; };
  const rd = need(new RegExp(String.raw`await (${ID})\.(${ID})\(e\.path,\`utf-8\`,\`scan\``), 'reader');
  // yerel değişken adları (i/a/o/r…) sürümden sürüme değişir: hepsi yakalama grubundan okunur
  const [, RAW, OB, H, OBJ, REC, M, MK, STR, IDP] = need(new RegExp(String.raw`let (${ID});try\{\1=JSON\.parse\(t\)\}catch\{return null\}let (${ID})=(${ID})\.(${ID})\(\1\);if\(!\2\)return null;let (${ID})=(${ID})\.(${ID})\(\{agent:\`jcode\`,file:e,sessionId:\3\.(${ID})\(\2\.id\)\?\?\3\.\8\(\2\.session_id\)\?\?\6\.(${ID})\(e\.path\)`), 'object/session');
  const ARR = need(new RegExp(String.raw`for\(let e of ${H}\.(${ID})\(${OB}\.messages\)\)`), 'array')[1];
  const TS = need(new RegExp(String.raw`${M}\.(${ID})\(${REC},${OB}\.created_at\)`), 'timestamp')[1];
  const FIN = need(new RegExp(String.raw`return ${M}\.(${ID})\(${REC},n,${ID}\)\}`), 'finish')[1];
  const ADD = need(new RegExp(String.raw`${M}\.(${ID})\(e,${ID},${ID},n\.timestamp\)`), 'add message')[1];
  const [, TITLE, CONTENT] = need(new RegExp(String.raw`${H}\.(${ID})\(${H}\.(${ID})\(${ID}\)\?\?\`\`\)`), 'title/content');
  return 'async function __syzerParse(file,platform,messages){' +
    `let o;try{o=${H}.${OBJ}(JSON.parse(await ${rd[1]}.${rd[2]}(file.path,\`utf-8\`,\`scan\`)))}catch(e){return null}` +
    'if(!o)return null;' +
    `const a=${M}.${MK}({agent:\`syzer\`,file,sessionId:${H}.${STR}(o.id)??${M}.${IDP}(file.path),messages});` +
    `a.cwd=${H}.${STR}(o.cwd);a.model=${H}.${STR}(o.model);${M}.${TS}(a,o.ts);` +
    `const t=${H}.${STR}(o.title);if(t)a.title=${H}.${TITLE}(t);` +
    `for(const x of ${H}.${ARR}(o.messages)){const r=${H}.${OBJ}(x),role=${H}.${STR}(r?.role);` +
    'if(role!==`user`&&role!==`assistant`)continue;' +
    `a.messageCount++;role===\`user\`&&(a.title??=${H}.${TITLE}(${H}.${CONTENT}(r.content)??\`\`)||null);${M}.${ADD}(a,role,r.content,void 0)}` +
    'try{const fs=require(`node:fs`),p=require(`node:path`);' +
    'a.subagentTranscriptCount=fs.readdirSync(p.join(p.dirname(file.path),p.basename(file.path,p.extname(file.path)),`subagents`)).filter(n=>n.startsWith(`agent-`)&&n.endsWith(`.json`)).length}catch{}' +
    `return ${M}.${FIN}(a,platform,messages?{messages}:{})}\n`;
}

const SUBS = 'async function __syzerSubs(parent){' +
  'const fs=require(`node:fs`),pa=require(`node:path`),base=pa.basename(parent,pa.extname(parent)),' +
  'dir=pa.join(pa.dirname(parent),base,`subagents`),out=[],issues=[];' +
  'let names;try{names=fs.readdirSync(dir).filter(n=>n.startsWith(`agent-`)&&n.endsWith(`.json`))}catch{return{sessions:[],issues}}' +
  'const ST={running:`running`,completed:`completed`,failed:`failed`,stopped:`stopped`,killed:`stopped`};' +
  'for(const n of names){try{' +
  'const fp=pa.join(dir,n),st=fs.statSync(fp),j=JSON.parse(fs.readFileSync(fp,`utf8`)),iso=st.mtime.toISOString(),' +
  'k=(Array.isArray(j.messages)?j.messages:[]).filter(x=>x&&(x.role===`user`||x.role===`assistant`)).length,' +
  'sid=String(j.id||pa.basename(n,`.json`));' +
  'out.push({id:`local:syzer:${base}:${sid}:${fp}`,executionHostId:`local`,agent:`syzer`,sessionId:sid,' +
  'title:String(j.description||sid).slice(0,200),cwd:null,branch:null,model:null,filePath:fp,codexHome:null,' +
  'createdAt:iso,updatedAt:iso,modifiedAt:iso,messageCount:k,totalTokens:0,previewMessages:[],' +
  'queuedMessageCount:0,subagentTranscriptCount:0,resumeCommand:``,' +
  'subagent:{parentSessionId:base,agentType:j.agentType||null,status:ST[j.status]??null}})}catch{}}' +
  'out.sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt));return{sessions:out,issues}}\n';


// Syzer olay ayrıştırıcısı: kendi durum tablosu ve alan çıkarımı; Orca'dan yalnızca genel şema normalleştiricisini (un) kullanır
const SYZER_EVENT = require('./orca-snippets/syzer-event').SYZER_EVENT;

const SYZER_DIR = 'require(`node:path`).join(require(`node:os`).homedir(),`.syzercli`,`sessions`)';

const fsx = require('fs');
const pathx = require('path');
const snippet = (n) => fsx.readFileSync(pathx.join(__dirname, 'orca-snippets', n), 'utf8').trim();

const analyticsEdits = (cmd) => require('./orca-analytics-edits').analyticsEdits(cmd);

// Orca yeniden açılınca Syzer sekmesinin geri gelmesi: oturum kimliği kaydı + `syzer --resume <id>` (ayrı dosya)
function restoreEdits() {
  const { patches } = require('./orca-edits-restore');
  return patches.map((p) => ({ group: 'restore', glob: new RegExp(p.glob.source.replace(/^\^/, '^out\\/'), p.glob.flags), from: p.from, to: p.to }));
}

function edits(cmd, ICON, marker) {
  const icon = (size) => `(0,J.jsx)(\`img\`,{src:\`${ICON}\`,width:${size},height:${size},alt:\`Syzer\`,style:{borderRadius:4}})`;
  const CFG = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`}};';
  const CFG_TO = 'jcode:{detectCmd:`jcode`,launchCmd:`jcode`,expectedProcess:`jcode`,promptInjectionMode:`stdin-after-start`},syzer:{detectCmd:`syzer`,launchCmd:`syzer`,expectedProcess:`syzer`,promptInjectionMode:`stdin-after-start`}};';
  const RESUME = 'case`omp`:case`prime-agent`:return`${t} --resume ${n}`';
  return [
    // ---- core: yama sürüm işareti ----
    { group: 'core', file: 'out/main/index.js', from: 'const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"', to: `${marker}const guardKey = "__ORCA_BOOTSTRAP_FATAL_EXIT_GUARD__"` },

    // ---- usage: Syzer'ın KENDİ kullanım sağlayıcısı (provider id: syzer; Kimi'ye bağlı değil) ----
    ...usageEdits(cmd, ICON),

    // ---- agent: Syzer kendi ajan kimliği (`syzer`) ----
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: CFG, to: CFG_TO },
    { group: 'agent', glob: /^out\/main\/chunks\/tui-agent-config-.*\.js$/, from: CFG, to: CFG_TO },
    { group: 'agent', glob: /^out\/main\/chunks\/tui-agent-display-names-.*\.js$/, from: 'jcode:`Jcode`}', to: 'jcode:`Jcode`,syzer:`Syzer`}' },
    // yeni sekme menüsü / ajan seçimi sıralaması (main + renderer)
    { group: 'agent', glob: /^out\/main\/chunks\/tui-agent-selection-.*\.js$/, from: LIST_CODEBUDDY, to: '.codebuddy.jcode.syzer' },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: LIST_CODEBUDDY, to: '.codebuddy.jcode.syzer' },
    { group: 'agent', glob: /^out\/renderer\/assets\/stale-document-visibility-.*\.js$/, from: 'jcode:`Jcode`', to: 'jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'agent', glob: /^out\/renderer\/assets\/markdown-preview-document\.worker-.*\.js$/, from: 'jcode:`Jcode`}', to: 'jcode:`Jcode`,syzer:`Syzer`}' },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: 'dsb:`DeepSeek Build`,jcode:`Jcode`}', to: 'dsb:`DeepSeek Build`,jcode:`Jcode`,syzer:`Syzer`}' },
    { group: 'agent', file: 'out/main/index.js', from: 'dsb:`DeepSeek Build`,jcode:`Jcode`}', to: 'dsb:`DeepSeek Build`,jcode:`Jcode`,syzer:`Syzer`}' },
    { group: 'agent', glob: /^out\/renderer\/assets\/store-.*\.js$/, from: 'dsb:!0,jcode:!0}', to: 'dsb:!0,jcode:!0,syzer:!0}' },
    { group: 'agent', glob: /^out\/renderer\/assets\/agent-catalog-.*\.js$/, from: 'homepageUrl:`https://github.com/1jehuang/jcode`}]}', to: 'homepageUrl:`https://github.com/1jehuang/jcode`},{id:`syzer`,label:`Syzer`,cmd:`syzer`,iconUrl:`' + ICON + '`,searchAliases:[`syzercli`,`openrouter`,`nvidia`],homepageUrl:`https://github.com/yasinbalcik/SyzerCLI`}]}' },
    // durum olayları: Syzer'ın KENDİ hook yolu (POST /hook/syzer) ve kendi olay ayrıştırıcısı (başka ajana bağlı değil)
    { group: 'agent', file: 'out/main/index.js', from: '"/hook/jcode":`jcode`', to: '"/hook/jcode":`jcode`,"/hook/syzer":`syzer`' },
    { group: 'agent', file: 'out/main/index.js', from: /\.zcode\.dsh\.jcode(?=(?:\.[\w-]+)*`\.split\(`\.`\))/, to: '.zcode.dsh.jcode.syzer' },
    { group: 'agent', file: 'out/main/index.js', from: 'case`hermes`:return t===`pre_llm_call`||t===`on_session_start`;case`devin`:', to: 'case`hermes`:return t===`pre_llm_call`||t===`on_session_start`;case`syzer`:return t===`Prompt`;case`devin`:' },
    { group: 'agent', file: 'out/main/index.js', from: /case`hermes`:f=([\w$]+)\(t,r,i,a,o\);break;/, to: (m) => `${m[0]}case\`syzer\`:f=__syzerEvent(t,r,i,a,o);break;` },
    // olay ayrıştırıcısı: Orca'nın genel durum normalleştiricisinin (minify adı sürümden sürüme değişir) adı devin işleyicisinden okunur
    { group: 'agent', file: 'out/main/index.js', from: /function [\w$]+\(e,t,n,r,i\)\{if\(t===`SessionStart`\)return [\w$]+\(e,r\),null;let a=t===`UserPromptSubmit`\|\|t===`PreToolUse`\|\|t===`PostToolUse`\|\|t===`PostCompaction`[^]*?return ([\w$]+)\(\{state:a,prompt:/, to: (m) => SYZER_EVENT.split('un(').join(`${m[1]}(`) + m[0] },
    // ---- history: oturum geçmişi (Syzer oturumları + alt ajanlar, kendi biçimimiz) ----
    // Minified adlar sürümden sürüme değiştiği için çapalar RegExp; yakalama grupları yeni adları taşır.
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: /`kimi`,`muse`,`jcode`((?:,`[\w-]+`)*)\](,[\w$]+=64)/, to: (m) => `\`kimi\`,\`muse\`,\`jcode\`,\`syzer\`${m[1]}]${m[2]}` },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: 'muse:`Muse`,jcode:`Jcode`', to: 'muse:`Muse`,jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: /`kimi`,`muse`,`jcode`((?:,`[\w-]+`)*)\]/, to: (m) => `\`kimi\`,\`muse\`,\`jcode\`,\`syzer\`${m[1]}]` },
    { group: 'history', glob: /^out\/renderer\/assets\/ai-vault-types-.*\.js$/, from: 'jcode:`Jcode`', to: 'jcode:`Jcode`,syzer:`Syzer`' },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-opencode-sqlite-open-.*\.js$/, from: RESUME, to: RESUME + ';case`syzer`:return`${t} --resume ${n}`' },
    { group: 'history', glob: /^out\/renderer\/assets\/(?:ai-vault-session-drag|AgentSessionContinuationDialog)-.*\.js$/, from: RESUME, to: RESUME + ';case`syzer`:return`${t} --resume ${n}`' },
    { group: 'history', glob: /^out\/main\/chunks\/session-search-sqlite-support-.*\.js$/, from: /"prime-agent":\{rootDirs:\(e,t\)=>[\w$]+\(e\.primeAgentSessionsDir\?\?[\w$]+,t,\[`\.prime`,`agent`,`sessions`\]\),extensions:\[`\.jsonl`\]\},/, to: (m) => `${m[0]}syzer:{rootDirs:()=>[${SYZER_DIR}],extensions:[\`.json\`],directoryPredicate:()=>!1},` },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: /case`jcode`:return ([\w$]+)\(e\.file,t,n\)(?=(?:;case`[\w-]+`:return [\w$]+\(e\.file,t,n\))*\}\})/, to: (m) => `case\`jcode\`:return ${m[1]}(e.file,t,n);case\`syzer\`:return __syzerParse(e.file,t,n)` },
    { group: 'history', glob: /^out\/main\/chunks\/session-scanner-service-protocol-.*\.js$/, from: JCODE_PARSER_RE, to: (m) => parserFor(m[0]) + m[0] },
    { group: 'history', file: 'out/main/session-scanner-service-entry.js', from: /function ([\w$]+)\(e\)\{return e\.agent===`claude`\?([\w$]+)\(\{parentFilePath:e\.parentFilePath\}\):([\w$]+)\(\{parentFilePath:e\.parentFilePath\}\)\}/, to: (m) => `${SUBS}function ${m[1]}(e){return e.agent===\`syzer\`?__syzerSubs(e.parentFilePath):e.agent===\`claude\`?${m[2]}({parentFilePath:e.parentFilePath}):${m[3]}({parentFilePath:e.parentFilePath})}` },
    { group: 'history', file: 'out/main/index.js', from: 'if(!e||e.agent!==`claude`&&e.agent!==`omp`||typeof e.parentFilePath', to: 'if(!e||e.agent!==`claude`&&e.agent!==`omp`&&e.agent!==`syzer`||typeof e.parentFilePath' },
    { group: 'history', file: 'out/main/index.js', from: /\(e\.agent===`claude`\?([\w$]+)\.([\w$]+)\(\{wslHomeDirs:n\}\):([\w$]+)\.([\w$]+)\(\{wslHomeDirs:n\}\)\)\.some/, to: (m) => `(e.agent===\`syzer\`?[${SYZER_DIR}]:e.agent===\`claude\`?${m[1]}.${m[2]}({wslHomeDirs:n}):${m[3]}.${m[4]}({wslHomeDirs:n})).some` },

    // ---- keys: Ayarlar → AI Provider Accounts içinde "Syzer" bölümü (key listesi, seç, sil, ekle) ----
    // Minified adlar sürümden sürüme değişir: main'de ipcMain takma adı, renderer'da React/jsx/Button/Badge/Label adları kaynaktan okunur.
    { group: 'keys', file: 'out/main/index.js', from: /function ([\w$]+)\(e\)\{([\w$]+)\.ipcMain\.handle\(`minimaxCredentials:getStatus`/, to: (m) => snippet('keys-main.js').split('__SYZER_CMD__').join(JSON.stringify(cmd)).split('I.ipcMain').join(`${m[2]}.ipcMain`) + `function ${m[1]}(e){__syzerReg();${m[2]}.ipcMain.handle(\`minimaxCredentials:getStatus\`` },
    { group: 'keys', file: 'out/preload/index.js', from: 'const minimaxCredentialsApi = {', to: 'const syzerKeysApi = {list:()=>electron.ipcRenderer.invoke("syzerKeys:list"),add:(t)=>electron.ipcRenderer.invoke("syzerKeys:add",t),remove:(p,i)=>electron.ipcRenderer.invoke("syzerKeys:remove",p,i),use:(p,i)=>electron.ipcRenderer.invoke("syzerKeys:use",p,i),test:(p)=>electron.ipcRenderer.invoke("syzerKeys:test",p),usage:(p)=>electron.ipcRenderer.invoke("syzerKeys:usage",p),prune:(p)=>electron.ipcRenderer.invoke("syzerKeys:prune",p)};\nconst minimaxCredentialsApi = {' },
    { group: 'keys', file: 'out/preload/index.js', from: '\tminimaxCredentials: minimaxCredentialsApi,', to: '\tsyzerKeys: syzerKeysApi,\n\tminimaxCredentials: minimaxCredentialsApi,' },
    { group: 'keys', glob: /^out\/renderer\/assets\/useSettingsNavigationMetadata-.*\.js$/, from: /(`AI Provider Accounts`\),description:[\w$]+\(`[^`]+`,`[^`]+`\),icon:[\w$]+,searchEntries:)([\w$]+)\(\)/, to: (m) => `${m[1]}[{title:"Syzer API keys",description:"Manage Syzer OpenRouter and NVIDIA API keys.",keywords:["syzer","api key","openrouter","nvidia","key"]},...${m[2]}()]` },
    { group: 'keys', glob: /^out\/renderer\/assets\/Settings-.*\.js$/, from: /function ([\w$]+)\(\{provider:e,target:t\}\)\{let\[n,r\]=\(0,([\w$]+)\.useState\)\(null\)/,
      to: (m) => {
        const src = m[m.length - 1];
        const top = (re) => { const c = {}; for (const x of src.matchAll(re)) c[x[1]] = (c[x[1]] || 0) + 1; const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; if (!k) throw new Error(`keys: alias not found ${re}`); return k; };
        const J = top(/\(0,([\w$]+)\.jsx\)\(`div`/g);
        const BTN = top(/\(0,[\w$]+\.jsx\)\(([\w$]+),\{variant:`ghost`,size:`xs`/g);
        const BADGE = top(/\(0,[\w$]+\.jsx\)\(([\w$]+),\{variant:`secondary`/g);
        const LABEL = top(/\(0,[\w$]+\.jsx\)\(([\w$]+),\{htmlFor:/g);
        const body = snippet('keys-renderer.js')
          .split('(0,Q.jsx)(R,').join(`(0,${J}.jsx)(${BTN},`).split('(0,Q.jsx)(q,').join(`(0,${J}.jsx)(${BADGE},`).split('(0,Q.jsx)(G,').join(`(0,${J}.jsx)(${LABEL},`)
          .split('(0,Q.jsx)(Jd,{').join(`(0,${J}.jsx)(\`textarea\`,{`).split('rows:4,className:`font-mono text-xs`').join('rows:4,className:`w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs`')
          .split('(0,Q.jsxs)').join(`(0,${J}.jsxs)`).split('(0,Q.jsx)').join(`(0,${J}.jsx)`).split('(0,Z.').join(`(0,${m[2]}.`);
        return body + m[0];
      } },
    { group: 'keys', glob: /^out\/renderer\/assets\/Settings-.*\.js$/, from: /([\w$]+)=\[!([\w$]+)\|\|\/opencode\|devin\|account\/i\.test\(\2\)\?\(0,([\w$]+)\.jsxs\)/, to: (m) => `${m[1]}=[!${m[2]}||/syzer|openrouter|nvidia|api key/i.test(${m[2]})?(0,${m[3]}.jsx)(__SyzerKeys,{},\`syzer\`):null,!${m[2]}||/opencode|devin|account/i.test(${m[2]})?(0,${m[3]}.jsxs)` },

    // ---- analytics: Ayarlar → Stats & Usage → "Syzer" filtresi (kendi sağlayıcı servisi, kendi kart/ısı haritası) ----
    ...analyticsEdits(cmd),

    // ---- restore: Orca yeniden başlatılınca Syzer oturumunun geri yüklenmesi ----
    ...restoreEdits(),

    // ---- shells: Orca kapanırken açık terminal kabuklarını kapat (sahipsiz pwsh birikmesini önler)
    ...require('./orca-edits-shells').patches,
  ];
}

module.exports = { edits, g };
