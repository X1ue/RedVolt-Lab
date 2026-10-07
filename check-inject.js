'use strict';
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || 'smoke11.js', 'utf8');
let n = 0;
const re = /ev\((`(?:\\[\s\S]|[^\\])*?`|'(?:\\[\s\S]|[^\\'])*?')\)/g;
let m;
while ((m = re.exec(src))) {
  n++;
  const lit = m[1];
  const upto = src.slice(0, m.index).split('\n').length;
  let s;
  try { s = eval(lit); } catch (e) { console.log('EVALFAIL line ' + upto + ': ' + e.message); continue; }
  try { new Function(s); } catch (e) {
    console.log('SYNTAX FAIL line ' + upto + ': ' + e.message);
    console.log('   >>> ' + JSON.stringify(s.slice(0, 220)));
  }
}
console.log('checked ' + n + ' injected scripts');
