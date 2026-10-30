# 双榜云开发接入

当前交付的是可测试的本机榜与云端架构。没有部署云函数，也没有填写 AppID、云环境 ID 或密钥。`cloudfunctions/baiyiLeaderboard/server-config.json` 的 `enabled` 默认为 `false`；客户端也必须显式配置云环境后才能启用全服榜。本机纪录应始终标为“本机纪录”，不能作为全服验证成绩上传。

## 已确认的计分口径

- 最长存活：单局曾达到的最高 `state.survivalActionCount`，与真实行动数 `state.actionCount` 和视频日数 `state.videoDays` 分开。有效行动计1个时间单位，视频首次完成计5个单位；每5个存活时间单位计一天，显示存活到第 `floor(最高存活计数 / 5) + 1` 天，同一天内按存活时间单位排序。仅旧引擎缺少 `survivalActionCount` 字段时才回退到 `actionCount`，明确的零值不会回退。
- 连续35个时间单位（7日，包含视频首完）没有临床工作 `work` 或首次作答教学题 `clinical`，当前存活计数归零；之后的非临床行动保持零，直到临床行动重新开始计数。已经达到的历史最高纪录保留，不因归零被剔榜。免费复习旧题不算首次作答，也不消耗有效行动。
- 金币：单局曾达到的最高金币余额，包括后来已花费的金币。
- 死亡后允许读档与已到达章节的分支重玩，服务器重放这些操作；历史峰值不会被较低的恢复值覆盖。引擎在读档和重玩时保留最新的存活计数与连续未做临床行动的计数，不能靠回到节点撤销归零惩罚；剧情日历仍按节点恢复。新游戏开启新 `runId`，每位玩家在每张榜只保留其最佳纪录。
- 两张榜展示每日北京时间 00:00 截止的**累计最高纪录快照**。当天新增成绩于下次快照出现，榜单不在每日清空。游戏内昼夜、月考、加速和电脑时区均不改变更新时间。
- 为兼容现有接口，`longestMetric` 仍只接受字符串 `actionCount`，返回字段 `peakActionCount` 及榜单 `score/actionCount` 表示上述存活计数的历史峰值，而不是剧情日历行动数。真实活跃分钟没有实现，配置其他值会返回 `unsupported_metric`，不会代用游戏时长。

## 文件与规则版本

`cloudfunctions/baiyiLeaderboard/index.js` 是微信适配层；`core.js` 负责严格操作验证、服务器规则重放、匿名标识和北京时间边界。`vendor/` 包含打包时的权威引擎、其本地依赖、章节、NPC、教学题库和 SHA-256 清单。

每次修改引擎或故事数据后，先完成项目正常构建，再执行：

```sh
python3 tools/build_leaderboard_server.py
node --test cloudfunctions/baiyiLeaderboard/core.test.js
```

脚本仅复制本地规则，不上传或部署。客户端必须与服务器使用同一规则版本。服务器返回 `engineVersion`；上线集成应在开始竞技前核对客户端随包清单，版本不一致时要求更新。当前逻辑会拒绝旧版本周目的新操作，不会用新规则重新解释旧日志。

实际榜期键由 `seasonId`、规则哈希和读档策略组成。不同规则版本隔离排行，旧数据仍保留。需要跨版本沿用榜单时，应先制定迁移和公平性规则，不能直接改旧日志或分数。

## 云函数配置

1. 在实际小程序工程中设置有效 AppID 与云环境，配置云函数目录为 `cloudfunctions/`。使用支持当前语法的 Node.js 运行时（Node.js 18 或更新的受支持版本），安装该函数的 `package.json` 依赖。
2. 创建下面列出的集合、索引与安全规则。
3. 在**云函数服务端环境变量**中分别设置至少 32 字符的高熵 `LEADERBOARD_PLAYER_SECRET` 和 `LEADERBOARD_TIMER_SECRET`。不要放入客户端、Git、题本或上传包。前者用于将微信 `OPENID` 转为稳定匿名 ID；更换它会改变玩家身份，应制定迁移计划。
4. 设置 `server-config.json` 的 `enabled:true`，检查 `seasonId`。默认 `restorePolicy:'allow_server_replay'` 符合允许死亡读档继续刷新纪录的要求。另有 `reject` 与 `pending_confirmation` 供明确的新榜期方案使用，不能由客户端修改。
5. 部署云函数，再在测试环境核对下面的验收清单，最后才启用客户端云连接。

目前默认每批最多 30 操作、单局最多 5,000 操作、操作日志最多 600 KB、每玩家每天最多创建 50 局、每张快照最多扫描 20,000 条日记录、展示前 50 名。这些是防止文档/函数资源耗尽的初版技术限额，不是故事结束条件。扩容前先做负载和数据库容量测试；超过快照容量时返回错误并保留已发布快照，绝不发布截断的假榜。初版使用同一事务日闸门，适合小规模试运行，高并发时需分片改造。

## 定时快照与鉴权

`config.json` 给出定时触发器 `baiyiDailySnapshot` 与七字段表达式 `0 0 0 * * * *`。部署时在实际控制台确认时区为 **UTC+8**；若触发器明确采用 UTC，则改为 `0 0 16 * * * *`。运行时的 `TZ` 环境变量不能代替触发器时区配置。将下次执行时间核对为北京时间次日 00:00。

上传触发器后，在腾讯云定时触发器的自定义入参 **Message** 中配置以下 JSON 字符串，其中值与服务器环境变量一致：

```json
{"secret":"在控制台填写 LEADERBOARD_TIMER_SECRET 的实际值"}
```

提交的配置文件故意不包含密钥；仅上传 `config.json` **不足以完成受信任的定时任务配置**。若开发者工具不能设置 Message，使用腾讯云函数控制台设置该触发器的入参。之后再次上传触发器可能覆盖入参，需复核。

服务器同时要求：`Type:'Timer'`、匹配触发器名、没有微信客户端 `OPENID`、没有 `action` 字段、常量时间比较通过的独立定时密钥。只伪造 `Type` 或 `TriggerName` 不算鉴权。没有开放 HTTP/匿名调用端点的需要，不要额外启用；有权限调用云函数并持有定时密钥的服务端身份属于受信任管理员。密钥不能写日志。

调度器可能延迟或重复。服务端用自己的现实时间计算截止点，不信任事件中的时间。事务日闸门先封存前一天的日记录，后续成绩只能写到新一天；两榜计算完成后按日期键原子发布，重复执行返回同一快照。`getBoards` 也可以幂等补做当天快照，因此定时执行暂时失败后首次读榜能够恢复。读榜只能发布当前现实日期对应的截止快照，不能指定未来日期。不能承诺网络系统在 00:00:00 毫秒级完成，界面显示快照截止时间和实际生成时间。

## 集合、索引与权限

所有集合均禁止小程序客户端直接读写，只允许云函数服务端 SDK：

```json
{"read":false,"write":false}
```

在控制台为每个集合单独配置上述安全规则。用户从云函数获得清理后的公开榜单，不能读取其他玩家的周目、操作日志或服务器管理集合。

| 集合 | 内容 / 索引 |
| --- | --- |
| `baiyi_ranked_runs` | 按 `runId` 作为 `_id`，服务端种子、匿名玩家 ID、规则哈希、允许操作日志；`_id` 默认唯一索引 |
| `baiyi_ranked_daily` | 每规则榜期、北京时间日期、匿名玩家一条，存当日提交时的各单局峰值；`_id` 唯一索引 |
| `baiyi_ranked_snapshots` | 每榜期每天一条不可变公开快照；`_id` 唯一索引 |
| `baiyi_ranked_gates` | 每榜期一条事务跨日闸门；`_id` 唯一索引 |
| `baiyi_ranked_players` | 匿名玩家日开局次数，不存姓名、工号、手机号；`_id` 唯一索引 |

为 `baiyi_ranked_daily` 创建两个复合查询索引，并按实际控制台对查询计划的提示核对：

1. `seasonId ASC, longest DESC, longestAt ASC, playerId ASC, dayStart ASC`
2. `seasonId ASC, wealthiest DESC, wealthiestAt ASC, playerId ASC, dayStart ASC`

查询条件为同一榜期、`dayStart < cutoff`，按分数降序、首次达成时间升序、匿名 ID 升序。服务端对跨日期的同一玩家去重。这里只存匿名化后的 ID；其仍可跨局关联，应按实际隐私方案设置保留期限和删除流程。它与职业倦怠问卷的研究 participantId 完全独立，不传问卷答案。

## 客户端协议

客户端独立模块 `src/leaderboard.js` 的入口为 `createLeaderboard(config, storage, transport)`。`transport(payload, {envId, functionName})` 可返回普通结果，或微信的 `{result:...}` 包装。同步本机方法为 `startLocalRun / observeState / finishLocalRun / getState / getLocalBoards`；异步云方法为 `startOnlineRun / appendOperations / retryPendingOperations / resumeOnlineRun / refreshBoards`。具体参数以模块导出接口及 `tests/leaderboard.test.js` 为准。

`getState().local` 包含 `boards/currentBest`；`getState().online` 包含 `configured/connected/status/lastError/pendingCount/run`。角色死亡时只观察状态，不调用 `finishLocalRun`；死亡读档继续使用同一局，真正开始新游戏才调用 `startLocalRun`。上传队列自动分成每批 30 操作，重载恢复时先重试队列，再用 `getRun` 同步。遇到永久 `operation_rejected` 不能静默丢弃再接着传后续操作，应清楚提示继续本机游玩或显式开启新竞技局。

通过 `wx.cloud.callFunction({name:'baiyiLeaderboard',data:payload})` 调用。传输适配器读取微信返回的 `result`。请求仅允许文档中的字段，多出的 `score`、`state`、`saveData`、`seed`、身份和规则字段都会被拒绝。

```js
{ action: 'startRun' }
{ action: 'getRun', runId }
{ action: 'appendOperations', runId, expectedSeq: 0, operations: [
  { method: 'act', action: { type: 'work' } },
  { method: 'restoreCheckpoint' }
] }
{ action: 'getBoards' }
```

`startRun/getRun/appendOperations` 成功返回 `{ok:true,runId,seed,seq,engineVersion,seasonId,restorePolicy,longestMetric,state,saveData,peakActionCount,peakMoney}`。`saveData` 是服务器用自己引擎生成的权威存档，可由客户端 `game.load(saveData)` 同步；服务器从不接受客户端存档。返回数据删除了失败记录中的纪念馆 ID 和纪念馆存储字段，防止服务器重放与本机即时死亡记录重复计入；纪念馆继续由本机独立管理。新局 `seed` 与 `runId` 使用服务端安全随机数；身份只能取 `cloud.getWXContext().OPENID` 后生成匿名昵称“夜行者XXXXXX”，不用微信姓名或头像。

同一个 `runId` 必须串行提交，`expectedSeq` 是最后确认的日志长度。响应丢失时，用相同 `expectedSeq` 和原操作批次重试；服务器对已接受区间的标准化操作哈希作比对，一致则返回当前确认及 `replayed:true`，不重复行动。不一致返回 `sequence_conflict`。`getRun` 可恢复已有周目。`startRun` 表示显式开启新局；当前不带创建幂等键，不要把不确定的开局请求无限自动重试。

允许操作：

```js
{ method:'act', action:{type:'rest' /* 或work/research/politics/entertain */} }
{ method:'act', action:{type:'inspect',clueId} }
{ method:'act', action:{type:'travel',room:'hospital' /* 或other */} }
{ method:'act', action:{type:'prepare',kind:'record' /* 或grant/neutral */} }
{ method:'act', action:{type:'puzzle',answer:0} }
{ method:'act', action:{type:'npc',npcId,completeQuest:true} }
{ method:'act', action:{type:'clinical',questionId,answer:0} }
{ method:'resolveEvent',choiceId }
{ method:'chooseEnding',choiceId }
{ method:'answerMonthly',answerIndex:0,expectedQuestionId }
{ method:'buyMonthlyHint',expectedQuestionId }
{ method:'checkpoint',label:'关键节点'}
{ method:'restoreCheckpoint' }
{ method:'startChapter',chapterId }
{ method:'startChapter',chapterId,params:{replay:true} }
```

普通章节前进进入当前目录中最早尚未完成的章节，以兼容插入新章后的旧存档；分支重玩仅能回到服务器确实到达过的章节。无效动作使整个批次不提交。教学题免费复习和画面移动不改变规则，不应加入操作日志。提示购买同样经过服务器规则扣金币，同题再看不重复收费。

`getBoards` 返回 `{ok:true,boards:{longest:[],wealthiest:[]},snapshotAt,nextUpdateAt,generatedAt,player,source:'server_snapshot',...}`。每项包含 `{playerId,nickname,score,runId,achievedAt}`；最长榜另有 `actionCount,survivalDays,completedDays,actionsPerDay`，这些派生字段均来自历史最高存活计数，不代表当前剧情日历。新部署到首个跨日之前可能是空榜，不能用本机纪录填充成全服榜。

所有失败统一 `{ok:false,code,message}`。断网时保留本机进度与待提交的允许操作；恢复在线后先重试待确认批次，再取 `getRun`。无法验证的导入旧存档只能继续本机游玩，不能凭它初始化服务器竞技局。

## 测试与上线边界

本地自动测试覆盖北京时间跨日、操作白名单、调试/状态注入拒绝、服务器重放、死亡读档峰值、章节越级拒绝、匿名化和伪造定时事件拒绝。上线前仍必须在真实测试云环境核对事务 SDK 返回形状、缺失文档行为、索引查询、客户端直写被拒绝、两个并发 append 只能提交一次、00:00 前后成绩分桶、定时 Message 鉴权以及网络丢包后的重试。没有云凭据，因此这些云端验收尚未执行。

服务端重放防止客户端直接伪造分数，不等于完整反自动化系统。客户端可见规则和种子，能够分析路线；若未来有奖励或竞技需求，应另加速率、异常行为检测与适合该运营模式的规则。当前没有充值、金币购买、客户端加分或付费复活接口。

官方资料（部署时核对当前控制台）：[CloudBase 定时触发器](https://docs.cloudbase.net/cloud-function/timer-trigger)、[腾讯云定时触发器事件与 Message 入参](https://intl.cloud.tencent.com/zh/document/product/583/9708)、[CloudBase 数据库事务](https://docs.cloudbase.net/database/transaction)、[CloudBase 定时任务示例与时区核对](https://docs.cloudbase.net/recipes/schedule-cloud-function-cron-job)。

## 0.3视频跨日与跨局题史

操作协议包含 `{method:'completeVideo',chapterId}`。0.3版首次完成会增加 `videoDays`，推进1个游戏日与5个存活/临床缺席时间单位，结算已有持续状态、工资和月考，并进行一次随机事件判定；真实行动数不增加，也不伪造5次工作或休息。首次结果包含 `advancedDays:1` 与 `elapsedUnits:5`；重复结果为0，不再次计时、抽取事件或入队。服务器使用同一引擎重放，并验证当前章节与状态。客户端播放器只在自然结束时发送该操作；本协议不提供视频观看时长的防作弊证明。关键节点恢复同时回滚日历与视频完成资格；恢复到播放前节点后重新完成视频是新进度中的有效结算，不能将此操作与同一进度的重复回放混淆。

服务器按账号保存已答知识题，新局继承开局题史快照，随后仅用该快照与本局操作日志重放。这样不会因账号后来增加已答记录而改变旧操作的随机序列。日常与月考共享记录；客户不能上传任意题史或存档来获得免考。

每账号同时仅一个可追加操作的当前周目。开启新局后，旧周目只读，历史成绩保留；重复请求仍按序号与内容判断幂等。题史分别属于本机与云账号，本机已答记录不会直接导入云端；首次从本机转入云账号时可能再次遇到本机已答题。本次默认不开启云榜。

账号题史使用现有 `baiyi_ranked_players` 集合内独立的 `history_<匿名playerId>` 文档，跨榜期保留。清理某个榜期纪录时不应删除该账号题史；无需为客户端开放新的数据库直写权限。

## 当前剧情与科研规则

主线32章、人物支线9段。支线完成使用 `{method:'completeSideVideo',sideStoryId}`，服务端验证前置故事、状态与首次完成资格。

连续25个计时单位未完成科研，会触发科研逾期死亡。首次主线或支线视频完成计5单位；普通有效行动计1单位；完成科研将计数清零。准备行动不算完成科研。服务端按同一规则重放，不能由客户端提交免除期限的状态。
