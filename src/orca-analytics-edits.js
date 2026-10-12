'use strict';

// Ayarlar → Stats & Usage → "Syzer" filtresi yamaları (kendi sağlayıcı servisi, kendi kart/ısı haritası).
// Minified adlar sürümden sürüme değiştiği için çapalar RegExp'tir. Syzer paneli ve Overview satırı, Orca'nın kendi
// Muse panelinden/oluşturucusundan metin dönüşümüyle türetilir (Muse → Syzer): yardımcı bileşen adları kendiliğinden doğru olur.
const fs = require('fs');
const path = require('path');

const snip = (n) => fs.readFileSync(path.join(__dirname, 'orca-snippets', n), 'utf8');

// `start` konumundaki işlevin tam metni (dize/şablon sabitleri atlanarak süslü parantez eşleştirilir)
function extractFn(src, start) {
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'") { for (i++; src[i] !== c; i++) if (src[i] === '\\') i++; continue; }
    if (c === '`') {
      for (i++; src[i] !== '`'; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { const inner = extractFn(src, i + 1); i += inner.length; }
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('unbalanced function');
}

const MUSE_L = /L\(`auto\.components\.stats\.MuseUsagePane\.\w+`,(`[^`]*`)\)/g;
const museToSyzer = (s) => s.replace(MUSE_L, (_, lit) => lit.replace(/Muse/g, 'Syzer'))
  .split('museUsage').join('syzerUsage').split('MuseUsage').join('SyzerUsage').split('hasAnyMuseData').join('hasAnySyzerData')
  .replace(/\bMuse\b/g, 'Syzer');

function analyticsEdits(cmd) {
  const mainInject = snip('analytics-main.js').split('process.env.SYZER_BIN||`syzer`').join('process.env.SYZER_BIN||' + JSON.stringify(cmd));
  const A = 'analytics';
  const O = 'analytics-overview';
  const ST = /^out\/renderer\/assets\/store-.*\.js$/;
  const SET = /^out\/renderer\/assets\/Settings-.*\.js$/;
  const last = (m) => m[m.length - 1];
  const off = (m) => m[m.length - 2];
  return [
    // ---- main: servis + IPC kaydı (claude/codex/opencode/muse yanına syzerUsage) ----
    { group: A, file: 'out/main/index.js', from: /function ([\w$]+)\(e\)\{(([\w$]+)\(`claudeUsage`,e\.claudeUsage\),[^}]*?\3\(`museUsage`,e\.museUsage\))\}/,
      to: (m) => `${mainInject}function ${m[1]}(e){${m[2]},${m[3]}(\`syzerUsage\`,__getSyzerUsage())}` },
    // ---- preload köprüsü ----
    { group: A, file: 'out/preload/index.js', from: 'const museUsageApi = createUsageProviderApi(electron.ipcRenderer, "museUsage");', to: 'const museUsageApi = createUsageProviderApi(electron.ipcRenderer, "museUsage");\nconst syzerUsageApi = createUsageProviderApi(electron.ipcRenderer, "syzerUsage");' },
    { group: A, file: 'out/preload/index.js', from: '\tmuseUsage: museUsageApi,', to: '\tmuseUsage: museUsageApi,\n\tsyzerUsage: syzerUsageApi,' },
    // ---- renderer deposu: Muse diliminin yanına Syzer dilimi (iki dilim tek yayılımda birleşir) ----
    { group: A, glob: ST, from: /([\w$]+)=([\w$]+)\((\{prefix:`muse`,name:`Muse`,initialScope:`orca`,initialRange:`30d`,getApi:\(\)=>window\.api\.museUsage,hasCachedData:e=>e\.hasAnyMuseData\})\)/,
      to: (m) => `${m[1]}=((a,b)=>(...e)=>({...a(...e),...b(...e)}))(${m[2]}(${m[3]}),${m[2]}({prefix:\`syzer\`,name:\`Syzer\`,initialScope:\`all\`,initialRange:\`30d\`,getApi:()=>window.api.syzerUsage,hasCachedData:e=>e.hasAnySyzerData}))` },
    // ---- Ayarlar paneli: Syzer paneli (Muse panelinden türetilir) + sekme + simge + yönlendirme ----
    { group: A, glob: SET, from: /function ([\w$]+)\(\)\{let e=([\w$]+)\(e=>e\.museUsageScanState\)/,
      to: (m) => `${museToSyzer(extractFn(last(m), off(m))).replace(/^function [\w$]+\(\)/, 'function __SyzerUsagePane()')}${m[0]}` },
    { group: A, glob: SET, from: /(\{id:`grok`,get label\(\)\{return [\w$]+\(`[^`]+`,`Grok`\)\}\})(\];function [\w$]+\(\{tab:e\}\))/,
      to: (m) => `${m[1]},{id:\`syzer\`,get label(){return\`Syzer\`}}${m[2]}` },
    { group: A, glob: SET, from: /(function [\w$]+\(\{tab:e\}\)\{return e===`overview`\?\(0,([\w$]+)\.jsx\)\([\w$]+,\{className:`size-3\.5 text-muted-foreground`\}\):)(\(0,[\w$]+\.jsx\)\([\w$]+,\{agent:e,size:14\}\)\})/,
      to: (m) => `${m[1]}e===\`syzer\`?(0,${m[2]}.jsx)(\`span\`,{className:\`grid size-3.5 place-items-center rounded-sm bg-secondary text-[9px] font-bold text-foreground\`,children:\`S\`}):${m[3]}` },
    { group: A, glob: SET, from: /([\w$]+)===`muse`\?\(0,([\w$]+)\.jsx\)\(([\w$]+),\{\}\):\(0,\2\.jsx\)\(([\w$]+),\{\}\)/,
      to: (m) => `${m[1]}===\`muse\`?(0,${m[2]}.jsx)(${m[3]},{}):${m[1]}===\`syzer\`?(0,${m[2]}.jsx)(__SyzerUsagePane,{}):(0,${m[2]}.jsx)(${m[4]},{})` },
    // ---- Overview (ısı haritası, token karışımı, sağlayıcı listesi): Muse oluşturucusundan türetilen Syzer satırı ----
    { group: O, glob: SET, from: /function ([\w$]+)\(e\)\{let t=\[([\w$]+)\(e\.claude\),([\w$]+)\(e\.codex\),([\w$]+)\(e\.opencode\),([\w$]+)\(e\.muse\)\],n=/,
      to: (m) => {
        const src = last(m);
        const at = src.indexOf(`function ${m[5]}(e){`);
        if (at < 0) throw new Error('muse overview builder not found');
        const ov = extractFn(src, at).replace(/^function [\w$]+\(e\)/, 'function __syzOv(e)')
          .replace(/id:`muse`/, 'id:`syzer`').replace(/label:L\(`[^`]+`,`Muse`\)/, 'label:`Syzer`')
          .split('hasAnyMuseData').join('hasAnySyzerData').replace('estimatedCostUsd:null', 'estimatedCostUsd:t?.estimatedCostUsd??null');
        return `${ov}function ${m[1]}(e){let t=[${m[2]}(e.claude),${m[3]}(e.codex),${m[4]}(e.opencode),${m[5]}(e.muse),__syzOv(e.syzer)],n=`;
      } },
    { group: O, glob: SET, from: /for\(let n of e\.muse\.daily\)\{let e=t\.get\(n\.day\)\?\?([\w$]+)\(n\.day\);e\.totalTokens\+=n\.totalTokens,e\.museTokens\+=n\.totalTokens,t\.set\(n\.day,e\)\}/,
      to: (m) => `${m[0]}for(let n of e.syzer.daily){let e=t.get(n.day)??${m[1]}(n.day);e.totalTokens+=n.totalTokens,t.set(n.day,e)}` },
    { group: O, glob: SET, from: /([\w$]+)=([\w$]+)\(e=>e\.enableMuseUsage\),([\w$]+)=\2\(e=>e\.recordFeatureInteraction\);\(0,([\w$]+)\.useEffect\)\(\(\)=>\{([\w$]+)\(\),([\w$]+)\(\),([\w$]+)\(\),([\w$]+)\(\)\},\[([\w$]+),([\w$]+),([\w$]+),([\w$]+)\]\);/,
      to: (m) => `${m[1]}=${m[2]}(e=>e.enableMuseUsage),${m[3]}=${m[2]}(e=>e.recordFeatureInteraction),__szA=${m[2]}(e=>e.syzerUsageScanState),__szB=${m[2]}(e=>e.syzerUsageSummary),__szC=${m[2]}(e=>e.syzerUsageDaily),__szD=${m[2]}(e=>e.fetchSyzerUsage),__szE=${m[2]}(e=>e.refreshSyzerUsage),__szF=${m[2]}(e=>e.enableSyzerUsage);(0,${m[4]}.useEffect)(()=>{${m[5]}(),${m[6]}(),${m[7]}(),${m[8]}(),__szD()},[${m[9]},${m[10]},${m[11]},${m[12]},__szD]);` },
    { group: O, glob: SET, from: /muse:\{scanState:([\w$]+),summary:([\w$]+),daily:([\w$]+)\}\}\),\[([^\]]+)\]\)/,
      to: (m) => `muse:{scanState:${m[1]},summary:${m[2]},daily:${m[3]}},syzer:{scanState:__szA,summary:__szB,daily:__szC}}),[${m[4]},__szA,__szB,__szC])` },
    { group: O, glob: SET, from: /[\w$]+\?\.enabled\?[\w$]+\(\):Promise\.resolve\(\)\]\)/, to: (m) => `${m[0].slice(0, -2)},__szA?.enabled?__szE():Promise.resolve()])` },
    { group: O, glob: SET, from: /e\.id===`opencode`\?([\w$]+)\(\):([\w$]+)\(\)\}/, to: (m) => `e.id===\`opencode\`?${m[1]}():e.id===\`syzer\`?__szF():${m[2]}()}` },
  ];
}

module.exports = { analyticsEdits, extractFn, museToSyzer };
