'use strict';
// Orca kapanırken açık terminal kabuklarını (ve içindeki süreçleri) kapatır; sahipsiz pwsh/claude birikmesini önler.
// Minified adlar sürümden sürüme değişir: oturum listesi/adaptör işlevleri pty:management:listSessions işleyicisinden okunur.
const { DEFS } = require('./orca-snippets/quit-kill');

const MAIN = /^out\/main\/index\.js$/;
// function X(){I.ipcMain.removeHandler(`pty:management:listSessions`),...I.ipcMain.handle(`pty:management:listSessions`,async()=>({sessions:await LIST(ADAPT()),
const DEF_ANCHOR = /function [\w$]+\(\)\{[\w$]+\.ipcMain\.removeHandler\(`pty:management:listSessions`\)[^]*?ipcMain\.handle\(`pty:management:listSessions`,async\(\)=>\(\{sessions:await ([\w$]+)\(([\w$]+)\(\)\)/;
const TEARDOWN = /\{name:`daemon`,promise:([\w$]+)\(\)\?([\w$]+)\(\):([\w$]+)\(\)\}/;
const patches = [
  {
    group: 'shells', glob: MAIN, from: DEF_ANCHOR,
    to: (m) => DEFS.split('ZYr(').join(`${m[2]}(`).split('eH(').join(`${m[1]}(`).replace('try{u$t()}catch{}', '') + m[0],
  },
  { group: 'shells', glob: MAIN, from: TEARDOWN, to: (m) => `{name:\`daemon\`,promise:__syzerQuitDaemon(${m[1]}()?${m[2]}:${m[3]})}` },
];
module.exports = { patches };
