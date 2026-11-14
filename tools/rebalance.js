#!/usr/bin/env node
/* 答案位置均衡器
 * 用法：node tools/rebalance.js <题目目录>   例：node tools/rebalance.js stage2
 * 把每关 10 题的正确答案位置均匀打散（约 2-3 次/位置，无三连同位），
 * 选项内容不变，仅重排顺序；使用固定种子保证可复现。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', process.argv[2] || '');
let src = '';
for (const f of ['js/questions-a.js', 'js/questions-b.js', 'js/facts.js']) {
  src += fs.readFileSync(path.join(dir, f), 'utf8') + '\n';
}
src += ';globalThis.__out={BANK_A,BANK_B};';
const ctx = vm.createContext({ console });
vm.runInContext(src, ctx);
const { BANK_A, BANK_B } = ctx.__out;

// 固定种子伪随机（mulberry32）
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function balancedSeq(len, rnd) {
  // 每个位置尽量均匀：counts = [3,3,2,2] 的排列
  for (let attempt = 0; attempt < 500; attempt++) {
    const pool = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3].slice(0, len);
    while (pool.length < len) pool.push(3);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    let ok = true, run = 1;
    for (let i = 1; i < pool.length; i++) {
      run = pool[i] === pool[i - 1] ? run + 1 : 1;
      if (run >= 3) { ok = false; break; }
    }
    if (ok) return pool;
  }
  throw new Error('无法生成均衡序列');
}

let seed = 42;
const rndAll = mulberry32(seed);
const dist = [0, 0, 0, 0];
let count = 0;

function rebalance(levels, file, banner) {
  levels.forEach((lv, li) => {
    const seq = balancedSeq(lv.questions.length, mulberry32(seed + li * 100 + (file === 'a' ? 0 : 7)));
    lv.questions.forEach((q, qi) => {
      const t = seq[qi];
      const correct = q.opts[q.ans];
      const wrongs = q.opts.filter((_, i) => i !== q.ans);
      const opts = [];
      let w = 0;
      for (let i = 0; i < q.opts.length; i++) {
        if (i === t) opts.push(correct);
        else opts.push(wrongs[w++]);
      }
      q.opts = opts;
      q.ans = t;
      dist[t]++;
      count++;
    });
  });
  const header = `/* ${banner} —— 由 tools/rebalance.js 自动均衡答案位置（固定种子，可复现） */\n\n`;
  const body = file === 'a'
    ? `const BANK_A = ${JSON.stringify(levels, null, 2)};\n`
    : `const BANK_B = ${JSON.stringify(levels, null, 2)};\n`;
  fs.writeFileSync(path.join(dir, file === 'a' ? 'js/questions-a.js' : 'js/questions-b.js'), header + body);
}

rebalance(BANK_A, 'a', '天问闯关题库 A（自动生成，改题请先读本注释）');
rebalance(BANK_B, 'b', '天问闯关题库 B（自动生成，改题请先读本注释）');

console.log(`已重排 ${count} 题的答案位置`);
console.log('新的答案分布 A/B/C/D:', dist.map(d => ((d / count) * 100).toFixed(1) + '%').join(' / '));
console.log(`目录: ${dir}`);
