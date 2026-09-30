# 专家 AI：统一拍卖搜索

2026-09-23 · `auction-search-v1`。已接入正式「专家」档；选画与双画补画沿用前版专家策略，五种拍卖中的定价、竞买、暗标、公开加价与一次出价统一进入同一个搜索接口。

后续的 [公开出牌手牌采样实验](hand-belief-experiment.md)没有通过整局胜率接入门槛；本页正式专家仍使用均匀隐藏牌采样。

## 做法

搜索先取前版专家动作为基线，再生成附近的整数报价、最低加价、放弃、购买/不购买等合法候选。每个候选使用同一批最多 24 个隐藏牌场景，对完整的当前拍卖调用真实规则引擎，直到成交或流拍；不为不同拍卖类型手写不同的收付款公式。对手只接收各自观察，按前版专家策略及场景内固定的保守/标准/激进风格回应。暗标未揭晓的对手选择在每个场景中固定，不随自己的隐藏报价改变。

候选评分是自己的现金与藏品估值，减去最富对手相应财富的 0.35 倍（第四季为 0.8 倍）。它是决策代理指标，不是胜率。相对基线的平均收益没有超过 1.5 千元及配对标准误中的较大值时，保留基线动作。预算为每步最多 24 场景、180ms **软**墙钟预算；一个场景做完才检查时间，实际单步可能超出 180ms。实现见 [通用搜索](../src/game/ai-universal.ts)，对照基线见 [前版专家](../src/game/ai-improved.ts)。

## 冻结后的效果对比

每局仅一名待测 AI，其余为指定对手；同发牌、同先手、同待测席位重新运行前版专家。轮换三、四、五人全部席位。并列第一按人数分摊胜利分。下表为新版/前版胜利分率；括号内为新版减前版的百分点。

| 对手                       |                   3 人 |                   4 人 |                   5 人 | 三个人数等权提升 |
| -------------------------- | ---------------------: | ---------------------: | ---------------------: | ---------------: |
| 前版专家，12 种子          | 58.3% / 33.3%（+25.0） | 60.4% / 25.0%（+35.4） | 40.0% / 20.0%（+20.0） |        **+26.8** |
| 保守/激进专家混合，12 种子 | 72.2% / 41.7%（+30.6） | 72.9% / 57.3%（+15.6） | 39.2% / 20.0%（+19.2） |        **+21.8** |
| 困难，6 种子，辅助         |  61.1% / 55.6%（+5.6） | 83.3% / 62.5%（+20.8） | 76.7% / 55.0%（+21.7） |        **+16.0** |

两个主要对照的种子聚类、10,000 次 bootstrap **97.5% 双侧区间**分别为 **+18.0～+36.4** 和 **+11.2～+31.6** 个百分点，均高于零；这符合预先冻结的两项比较 Bonferroni 判据。困难辅助组区间为 +1.9～+30.8 个百分点，但只有 6 种子；其中三人组逐项 95% 区间跨零，不能声称每个人数组都确认提升。完整逐局数据、源码哈希、统计脚本和冻结协议见 [验证协议](../experiments/universal-validation-plan.md)、[汇总](../experiments/universal-holdout-summary.json)、[专家对照](../experiments/universal-holdout-expert.json)、[混合对照](../experiments/universal-holdout-mixed.json)、[困难对照](../experiments/universal-holdout-hard.json)。这些固定 AI 对手不能代表熟练真人，也不证明策略最优。

独占 Node 进程串行测量 690 个相同观察位置：前版专家平均 1.56ms、P95 11.25ms；统一搜索平均 **33.74ms**、P95 **186.87ms**，最大 219.69ms。浏览器 Worker 另有 3 秒看门狗，设备和负载会影响实际完成场景数；测量数据见 [耗时记录](../experiments/universal-timing.json)。

## 复现与边界

```sh
node --experimental-strip-types experiments/universal-benchmark.ts 620001 12 expert experiments/universal-holdout-expert.json
node --experimental-strip-types experiments/universal-benchmark.ts 630001 12 mixed experiments/universal-holdout-mixed.json
node --experimental-strip-types experiments/universal-benchmark.ts 640001 6 hard experiments/universal-holdout-hard.json
python3 experiments/summarize-universal.py
node --experimental-strip-types experiments/universal-timing.ts
npm test
npm run build
```

不要覆盖已保存的验证数据；重跑时另指定输出路径，并核对 JSON 中的核心源码哈希。该验证完成后先有 `ai-levels.ts` 接入路由变化，随后又增加了[公开出牌手牌采样实验](hand-belief-experiment.md)所需的公开事件和可选采样器，因此当前文件哈希不等于本页历史验证时的全部哈希。新事件已从原均匀搜索的随机种子中排除；本页结果应以保存的冻结数据与当时源码为准。选牌/补牌未改为完整 ISMCTS；实验 ISMCTS 仍是独立模式。搜索只在当前拍卖向前推进，对季末价值使用估值，长期手牌影响仍通过基线策略间接体现。后续优先研究更可靠的对手行为模型，以及把相同预算下的候选数与抽样数做消融，再用新种子和真人或更多异质对手验收。
