import json, random, statistics
from pathlib import Path
p=Path('experiments/difficulty-balance-holdout.json')
data=json.loads(p.read_text())
assert len(data['rows']) == data['seeds'] * 12 * 3, 'benchmark incomplete'
names={'beginner':'入门','medium':'中等','hard':'困难','expert':'专家'}
lines=['# 四档难度平衡（2026-09-18）','','## 策略选择','','入门不再统一低价，也不再限制只能花现金的15%。它沿用基础估值，加入同场拍卖内稳定的±30%误差，可能高估也可能低估；出牌考虑自己的当前藏品与预期卖画收入，不比较对手财富。中等使用稳定竞价和局部出牌判断。困难只在任一画家数量达到3或第四季时使用场景推演；专家在所有出牌/补画阶段使用24个场景。中等以上共用稳健竞价，未启用未获稳定验证的自适应竞价。','','## 实验','','两轮先导实验各720局（131001及132001起的20个种子）。第一轮入门与中等差距不足，第二轮前改进中等卖家机会成本判断，并扩大入门双向判断误差。独立验证冻结策略，采用151001–151060共60个新种子，覆盖3/4/5人、每个座位，共2160局。每局一个高档AI对其余低一档AI；不代表对熟练人类的胜率。','','同档对称参考为1/人数（逐种子轮换所有座位时，所有席位胜利分率之和为1）。平局分摊胜利。区间按种子聚类、5000次bootstrap，逐项95%，未校正多重比较。','','| 高档对低档 | 人数 | 对局数 | 高档胜利分率 | 同档参考 | 差值95%区间 |','| --- | ---: | ---: | ---: | ---: | --- |']
for lower,higher in [('beginner','medium'),('medium','hard'),('hard','expert')]:
 for count in [3,4,5]:
  rows=[r for r in data['rows'] if r['lower']==lower and r['higher']==higher and r['count']==count]
  groups={}
  for r in rows:groups.setdefault(r['seed'],[]).append(r['win']-1/count)
  values=[statistics.mean(v) for v in groups.values()];rng=random.Random(20260918)
  boot=sorted(statistics.mean(rng.choices(values,k=len(values))) for _ in range(5000))
  lines.append(f'| {names[higher]} 对 {names[lower]} | {count} | {len(rows)} | {statistics.mean(r["win"] for r in rows):.1%} | {1/count:.1%} | {boot[125]*100:+.1f} 至 {boot[4874]*100:+.1f} 个百分点 |')
lines+=['','## 如何解读','','难度首先对应决策能力与推演覆盖，不能保证任意局面单调更强。多人拍卖依赖其他玩家出牌及资金转移；更多场景推演也不是最优策略证明。困难与专家接近，尤其需要更多真人局检验体验差异，不应宣传专家稳赢或把AI自对战当作真人难度评级。','','旧的720局低价弱对手实验不再对应当前入门。旧存档只要已有level，就续用新的同档策略；不带level的旧格式保留原策略兼容。','','## 验证','','回归覆盖正常价竞买、估值双向误差、零现金合法性、3/4/5人四档整局守恒、隐藏信息隔离和存档往返。','','```sh','npm test','npm run build','node --experimental-strip-types experiments/difficulty-balance.ts 151001 60 experiments/difficulty-balance-holdout.json','python3 experiments/summarize-difficulty.py','```','']
Path('docs/difficulty-balance.md').write_text('\n'.join(lines))
