import json, random, statistics
from pathlib import Path
out=['# 交互与 AI 改进验证（2026-09-18）','', '## 发布选择','', '默认保持 market-v3.1 的原版稳健策略。新局可选择入门（旧版出牌）、标准（抽样出牌）、自适应（实验竞价），并独立选择性格。自适应不是已获证明的困难档。旧存档不带 AI 设置时沿用原版。', '', '新性格用显式风险参数替代普通买入/报价中的座位系数；原版稳健保留原策略。保守、激进、均衡主要影响竞价预算，自适应控场还会惩罚向对手让利。所有策略仍只接收 Observation。', '', '## 独立对照','', '每个实验使用 60 个新牌种子，覆盖 3/4/5 人、全部待测座位及旧版/保守激进混合对手。每组 1,440 局候选 + 1,440 局匹配基线，三组共 8,640 局（不含 576 局先导实验）。按种子聚类做 5,000 次配对 bootstrap，区间为逐项 95%，未作多重比较校正。混合对手仍是启发式变体，不代表人类策略。', '', '| 比较 | 对手 | 人数 | 候选胜利分率 | 基线 | 差值百分点及95%区间 |', '| --- | --- | ---: | ---: | ---: | --- |']
summary=[]
for name,label in [('jumps','v3.1跳价 vs v3最小加价'),('standard','标准新性格 vs 原版v3.1'),('adaptive','自适应 vs 标准新性格')]:
 data=json.loads(Path(f'experiments/experience-{name}-holdout.json').read_text())
 for opponent in ['legacy','mixed']:
  for count in [3,4,5]:
   rows=[r for r in data['rows'] if r['count']==count and r['opponents']==opponent]
   groups={}
   for r in rows: groups.setdefault(r['seed'],[]).append(r['win']-r['baselineWin'])
   groups=[statistics.mean(g) for g in groups.values()]
   rng=random.Random(20260918)
   boot=sorted(statistics.mean(rng.choices(groups,k=len(groups))) for _ in range(5000))
   win=statistics.mean(r['win'] for r in rows); base=statistics.mean(r['baselineWin'] for r in rows)
   lo,hi=boot[125],boot[4874]
   out.append(f'| {label} | {opponent} | {count} | {win:.1%} | {base:.1%} | {(win-base)*100:+.1f} [{lo*100:+.1f}, {hi*100:+.1f}] |')
   summary.append(dict(mode=name,opponents=opponent,count=count,games=len(rows),candidate=win,baseline=base,difference=win-base,ci95=[lo,hi],steps=statistics.mean(r['steps'] for r in rows),baselineSteps=statistics.mean(r['baselineSteps'] for r in rows)))
out+=['', '跳价：六组没有出现大幅负向点估计，但不能据此声称统计非劣；未预先设定非劣界值。继续保留已有跳价策略。', '', '新性格：四人局点估计有退步，因此不替换默认。性格是玩法选择，不是强度保证。', '', '自适应：五人局两组提升较明显，三、四人局未形成一致优势，保留为实验选项。先导实验使用 91001–91012；独立数据冻结后未依据结果调参。之后仅新增原版稳健默认分支，不影响被测新性格。', '', '## 实现限制','', '- 对手意愿采用同画家公开成交的近期样本，并向估值先验收缩；未成交报价和未揭晓暗标不参与学习。尚不完整建模所有公开喊价。', '- 定价枚举合法金额，按顺序估计接手概率，并计入无人购买时卖家自购的银行支出。', '- 暗标比较估计中标概率与利润，卖家考虑失去其他报价收入的机会成本。购买考虑现金预算，保守性格保留早期流动资金。', '- 教学是六个可交互的规则情境，不是完整托管对局。复盘使用真实行动重放；终季名次对比只描述结算前后现金，不能证明另一出牌会赢。', '', '## 复现','', '```sh', 'npm test', 'npm run build', 'node --experimental-strip-types experiments/experience-benchmark.ts 101001 60 experiments/experience-jumps-holdout.json jumps', 'node --experimental-strip-types experiments/experience-benchmark.ts 103001 60 experiments/experience-standard-holdout.json standard', 'node --experimental-strip-types experiments/experience-benchmark.ts 105001 60 experiments/experience-adaptive-holdout.json adaptive', 'python3 experiments/summarize-experience.py', '```','']
Path('docs/experience-improvements.md').write_text('\n'.join(out))
Path('experiments/experience-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
