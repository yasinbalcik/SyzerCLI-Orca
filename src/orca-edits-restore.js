'use strict';
// Orca yeniden açılınca Syzer sekmesinin geri gelmesi: oturum kimliği kaydı + `syzer --resume <id>`.
// Minified adlar sürümden sürüme değiştiği için çapalar RegExp (yakalama grupları yeni adları taşır).

const ARGV_RE = /case`jcode`:return t\.key===`session_id`\?\[`jcode`,`--resume`,r\]:null(?=(?:;case`[\w-]+`:return t\.key===`session_id`\?\[[^\]]*\]:null)*\}\})/;
const ARGV_TO = 'case`jcode`:return t.key===`session_id`?[`jcode`,`--resume`,r]:null;case`syzer`:return t.key===`session_id`?[`syzer`,`--resume`,r]:null';
const LIST_RE = /`zcode`,`dsh`,`jcode`((?:,`[\w-]+`)*)\](\)|;var [\w$]+=new Set\([\w$]+\))/;
const LIST_TO = (m) => `\`zcode\`,\`dsh\`,\`jcode\`,\`syzer\`${m[1]}]${m[2]}`;
const MAIN_CHUNK = /^main\/chunks\/(?:agent-session-host-authority|daemon-protocol-version)-.*\.js$/;
const patches = [
  // --- renderer: resume argv + resumable set (store chunk)
  { name: 'R1 renderer argv', glob: /^renderer\/assets\/store-.*\.js$/, from: ARGV_RE, to: ARGV_TO },
  { name: 'R2 renderer set', glob: /^renderer\/assets\/store-.*\.js$/, from: LIST_RE, to: LIST_TO },
  // --- main: agent-session-host-authority chunk (argv, RESUMABLE list/set, provider-session extractor)
  // (1.4.225'te bu parça daemon-protocol-version adıyla yeniden adlandırıldı)
  { name: 'M1 main argv', glob: MAIN_CHUNK, from: ARGV_RE, to: ARGV_TO },
  { name: 'M2 main list', glob: MAIN_CHUNK, from: LIST_RE, to: LIST_TO },
  { name: 'M3 main extractor', glob: MAIN_CHUNK,
    from: /case`jcode`:\{let e=([\w$]+)\(t,\[`session_id`,`sessionId`\]\);return e\?\{key:`session_id`,id:e\}:null\}case`omp`:/,
    to: (m) => `case\`syzer\`:{let e=${m[1]}(t,[\`session_id\`]);return e?{key:\`session_id\`,id:e}:null}${m[0]}` },
  // --- optional: also capture an IDLE (done) syzer pane at quit
  { name: 'O1 quit capture done syzer', glob: /^renderer\/assets\/store-.*\.js$/,
    from: 'for(let o of Object.values(t.agentStatusByPaneKey)){if(o.state===`done`){let t=i[o.paneKey];',
    to: 'for(let o of Object.values(t.agentStatusByPaneKey)){if(o.state===`done`&&!(o.agentType===`syzer`&&e===`quit`)){let t=i[o.paneKey];' },
];

module.exports = { patches };
