#!/usr/bin/env node
/* 天问闯关 · 题库校验脚本
 * 用法：node tools/validate.js
 * 检查：题数、id 唯一性、选项完整性、解析长度、答案分布、知识卡映射。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', process.argv[2] || '');
let src = '';
for (const f of ['js/questions-a.js', 'js/questions-b.js', 'js/facts.js']) {
  src += fs.readFileSync(path.join(root, f), 'utf8') + '\n';
}
src += ';globalThis.__out={BANK_A,BANK_B,FACTS};';
const ctx = vm.createContext({ console });
vm.runInContext(src, ctx);
const { BANK_A, BANK_B, FACTS } = ctx.__out;
const LEVELS = BANK_A.concat(BANK_B);

const errs = [];
const allIds = new Set();
const dist = [0, 0, 0, 0];
let qcount = 0;

LEVELS.forEach(lv => {
  if (lv.questions.length !== 10) errs.push(`${lv.id} 题数=${lv.questions.length}（建议 10）`);
  if (!Array.isArray(lv.cards) || lv.cards.length !== 2) errs.push(`${lv.id} cards 数量异常`);
  lv.cards.forEach(c => { if (c < 0 || c >= FACTS.length) errs.push(`${lv.id} 知识卡下标越界 ${c}`); });
  lv.questions.forEach(q => {
    qcount++;
    if (allIds.has(q.id)) errs.push(`重复题号 ${q.id}`);
    allIds.add(q.id);
    if (!Array.isArray(q.opts) || q.opts.length !== 4) errs.push(`${q.id} 选项数不是 4`);
    else if (new Set(q.opts).size !== 4) errs.push(`${q.id} 选项重复`);
    if (!(q.ans >= 0 && q.ans <= 3)) errs.push(`${q.id} ans 越界`);
    if (!q.exp || q.exp.length < 30) errs.push(`${q.id} 解析过短`);
    if (!(q.diff >= 1 && q.diff <= 3)) errs.push(`${q.id} diff 异常`);
    if (!q.tag) errs.push(`${q.id} 缺少 tag`);
    dist[q.ans]++;
  });
  for (let j = 2; j < lv.questions.length; j++) {
    const a = lv.questions[j].ans, b = lv.questions[j - 1].ans, c = lv.questions[j - 2].ans;
    if (a === b && b === c) errs.push(`${lv.id} 第 ${j + 1} 题起连续 3 题答案位置相同（${a}）`);
  }
});

const used = LEVELS.flatMap(l => l.cards).sort((a, b) => a - b);
const expect = Array.from({ length: FACTS.length }, (_, i) => i);
if (JSON.stringify(used) !== JSON.stringify(expect)) errs.push('知识卡映射不完整或重复');

console.log(`[${path.basename(root) || '根目录'}] 关卡数: ${LEVELS.length} | 总题数: ${qcount} | 知识卡: ${FACTS.length}`);
console.log(`答案分布 A/B/C/D: ${dist.map(d => ((d / qcount) * 100).toFixed(1) + '%').join(' / ')}`);
if (errs.length) {
  console.log('发现问题:');
  errs.forEach(e => console.log('  -', e));
  process.exit(1);
}
console.log('✅ 数据校验全部通过');
