# 喵庭 1.0 → 2.0 实施执行方案（v1）

> 面向两人私密空间的迭代方案。读者：sturyous（Codex 执行）、cosphy。  
> 编写日期：2026-09-29。基线代码：`meow-courtyard-main`（Canvas 2D + Supabase Realtime，无数据库）。

---

## 0. 已确认的产品决策（来自 2026-09-29 对齐）

| # | 问题      | 结论                          | 对方案的影响                                                   |
| - | ------- | --------------------------- | -------------------------------------------------------- |
| 1 | 北极星指标   | **周均在线时长**（两人合计）            | 需要 presence 日志来度量；P1 的留痕/留言驱动打开频次，P2/P3 的双人互动与经营内容驱动单次时长 |
| 2 | 目标用户    | **先只做我们两人的私人空间**，验证后再考虑公共产品 | 不做账号系统、不做多租户、不做邀请码管理后台；单房间 + 口令即可，架构从简                   |
| 3 | 猫的定位    | **猫 = 用户的化身**（我=猫）          | 离线留痕以"影子化身"实现；共同种植等"关系具象化"内容放到 P3 再议                     |
| 4 | 平台      | **桌面网页优先**，移动端不做沉浸适配        | 保留现有移动虚拟方向键但不投入；素材/UI 按 960×640 桌面视口设计                   |
| 5 | 素材合规    | 暂不考虑                        | 但 P2 的素材管线重做顺手解决（全部自产图集后自然合规）                            |
| 6 | 运维/数据治理 | 暂不考虑                        | 不设计解除关系/数据导出流程，仅留接口余地                                    |

**工程总原则**：直接、非保守的实现；不为假想的公共产品预留抽象；不覆盖旧版本输出，每个 Phase 打完 git tag。

---

## 1. 架构决策（一句话版）

1. **拓扑**：单房间硬编码（`courtyard:our-yard`），房间口令拼在 URL hash 里（`#k=xxxx`），两人书签即入口——不做邀请码系统。
2. **身份**：`localStorage` 持久 UUID + 自选名字与外观，首次进入一次性设定；不做登录。换浏览器/清缓存 = 重新认领身份，两人场景可接受。
3. **持久化**：Supabase 新增 3 张表（`players` / `notes` / `presence_log`），仅用于影子猫、留言、上线回放与指标统计；实时通道维持现有 Presence + Broadcast 不变。
4. **安全**：anon key + 生僻房间名 + URL 口令的客户端校验，属"防君子不防贼"；两人场景够用，公共化时再上 Supabase Auth + RLS（预留迁移路径，不实现）。
5. **远端渲染**：快照插值 + 120ms 渲染延迟缓冲，替换现有指数趋近（`dt*9` lerp）。
6. **素材管线**：Aseprite 标准 48×48 单元格图集 + 索引色预渲染换色缓存，替换运行时 `ctx.filter` 换色。
7. **指标**：`presence_log` 记录 join/leave，周均在线时长用 SQL 视图直接算出，不上分析平台。

---

## 2. 数据模型（P1 新增，Supabase SQL）

```sql
-- 2.1 影子猫/身份：每个玩家一行，最后快照
create table players (
  id           text primary key,           -- localStorage UUID
  room         text not null default 'our-yard',
  name         text not null,
  appearance   jsonb not null,
  last_snapshot jsonb not null,            -- PlayerSnapshot 全量（含 x/y/activity/direction）
  last_seen    timestamptz not null default now()
);

-- 2.2 留言（纸条/小鱼干都走这张表，kind 区分）
create table notes (
  id         uuid primary key default gen_random_uuid(),
  room       text not null default 'our-yard',
  author_id  text not null references players(id),
  kind       text not null default 'note',  -- 'note' | 'treat'
  text       text not null check (char_length(text) <= 200),
  anchor_x   int, anchor_y int,             -- 纸条钉在庭院的位置（可选）
  created_at timestamptz not null default now(),
  opened_at  timestamptz                    -- 对方拆开时间；null = 未读
);

-- 2.3 在场日志：度量北极星 + 生成"你不在时"回放
create table presence_log (
  id        bigint generated always as identity primary key,
  room      text not null default 'our-yard',
  player_id text not null,
  event     text not null,                  -- 'join' | 'leave' | 'activity:<name>'
  at        timestamptz not null default now()
);

-- 2.4 北极星视图：周均在线时长（分钟）
create view weekly_online_minutes as
select date_trunc('week', j.at) as week,
       j.player_id,
       sum(extract(epoch from (coalesce(l.at, now()) - j.at)) / 60) as minutes
from presence_log j
left join lateral (
  select at from presence_log x
  where x.player_id = j.player_id and x.event = 'leave' and x.at > j.at
  order by x.at limit 1
) l on true
where j.event = 'join'
group by 1, 2;
```

- 三表全部 `alter table ... disable row level security`（现阶段无 RLS），公共化迁移路径 = 加 `auth.uid()` 列再开 RLS。
- 写入时机：`players` 每次外观/活动变化时 upsert + 每 30s 心跳；`presence_log` 在 SUBSCRIBED / pagehide 时写入；`notes` 创建与拆阅时写入。

---

## 3. 事件协议扩展（`src/types.ts`）

```ts
// 现有：move / activity / appearance / chat / snapshot-request / snapshot-response
// P1 新增：
| { type: 'note-placed'; note: NotePayload }            // 放纸条/小鱼干
| { type: 'note-opened'; noteId: string }               // 对方拆开
| { type: 'bed-claim'; playerId: string; bedIndex: number }  // P0 床位认领
// P2 新增：
| { type: 'interact-invite'; from: string; to: string; kind: 'nuzzle' | 'cosleep' }
| { type: 'interact-accept'; from: string; to: string; kind: 'nuzzle' | 'cosleep' }
| { type: 'emote'; playerId: string; emote: string }    // 快捷表情/贴纸
```

所有事件带 `v: 2` 字段做协议版本隔离，旧客户端收到未知 type 静默忽略。

---

## 4. P0 —— 修复与手感（预计 1–1.5 天，纯前端，不动数据库）

### P0.1 睡觉重叠 → 床位认领机制

- **根因**：`game.ts` `setActivity('sleep')` 用 `hashString(id) % beds.length` 确定性分床，两人 hash 相撞即重叠。
- **方案**：床位改成**按加入顺序分配**：Presence sync 回调里已有全员 `joinedAt`，对所有成员（含自己）按 `joinedAt` 升序排序，序号即床号；4 张床 ≥ 2 人永不冲突。新增 `bed-claim` 广播用于 join 顺序冲突时的仲裁（后到者换床）。
- **验收**：双开浏览器，A 先睡床 1，B 睡床 2；B 先离线再上线，仍睡床 2；两人永不重叠。
- **文件**：`game.ts`（删 hash 分床）、`main.ts`（presence sync 时计算床号并调 `game.assignBed(index)`）。

### P0.2 远端移动丝滑化（快照插值）

- **根因**：`remote.x += (target - x) * min(1, dt*9)` 指数趋近 + 170ms 节流，网络抖动时橡皮筋。
- **方案**：`RemotePlayer` 改为快照环形缓冲（容量 8，存 `{x, y, dir, activity, atLocalReceive}`）；渲染时刻 = `now - 120ms`，在缓冲中找夹住该时刻的两个快照做线性插值；缓冲空则保持最后位置。
- **验收**：dev 工具把 broadcast 人为延迟 300ms，远端猫仍平滑匀速，无瞬移无回弹。
- **文件**：`game.ts` 的 `addOrUpdateRemote` / `update`。

### P0.3 聊天改头顶气泡

- 气泡画在 Canvas 内（猫头顶，宽自适应、两行截断、4s 淡出 + 上浮 8px），底部面板保留但默认折叠，改名为"悄悄话记录"。
- **验收**：发消息后两人头顶都出气泡；连续发言气泡排队不互相覆盖（每人最多 2 条堆叠）。
- **文件**：`game.ts` 新增 `bubbles: Map<playerId, Bubble[]>` 并在 `drawCat` 后绘制；`main.ts` `addMessage` 同步推入气泡。

**P0 出口标准**：三个验收全过，`npm run build` 无错，打 tag `p0-polish`。

---

## 5. P1 —— 关系层与持久层最小闭环（预计 3–4 天，本方案核心）

> 完成标志：**TA 不在线时，打开庭院能看到 TA 的影子猫、能留纸条、上线能看到"你不在时"回放。**

### P1.1 持久身份与入口

- 首次进入弹一层像素风"认领你的猫"面板：输入名字 + 随机外观（可重 roll），确认后写 `localStorage(meow.identity)`，upsert `players` 表。
- URL 口令：`#k=<约定口令>`，错误/缺失时显示"这扇门你打不开"并停在前院画面（不连接 Realtime）。口令写死在 `.env` 的 `VITE_ROOM_SECRET`，客户端哈希比对（`crypto.subtle.digest`）。
- **文件**：新增 `src/identity.ts`；`main.ts` 启动流程改造。

### P1.2 影子猫（离线留痕）

- 连接成功后 `select * from players where room='our-yard' and id != me`；对 `last_seen < now() - 90s` 的记录渲染影子猫：位置=快照坐标，活动=快照活动（sleep 就真睡在床上）。
- 视觉处理：不透明度 85% + 名字牌改为"TA（不在）"；戳影子猫（右键）它抬头看你 1.5s 再继续原动作（本地动画，不广播）。
- 自己下线时：`pagehide` 里 `navigator.sendBeacon` / supabase upsert 最终快照 + `presence_log leave`。
- **文件**：新增 `src/persistence.ts`（封装三张表读写）；`game.ts` 增加 `renderGhost(snapshot)` 渲染分支（复用 drawCat + ctx.globalAlpha）。

### P1.3 留言（纸条 + 小鱼干）

- 交互：点工具栏"留纸条"→ 输入 ≤200 字 → 选庭院位置（点击地面）→ 插 `notes` 表 + 广播 `note-placed`。
- 呈现：地上一个像素纸条图标，对方在线时头顶弹"！"提示；右键纸条 → 拆开动画（纸条展开成全屏小卡片）→ 更新 `opened_at` + 广播 `note-opened`，发送方看到"TA 拆了你的纸条"。
- 小鱼干：`kind='treat'`，固定文案"给你留了小鱼干"，一键放置，拆时对方的猫做一个吃播动作（复用 eat 动画 2s）。
- **文件**：`persistence.ts`、`game.ts`（地面道具渲染层）、`main.ts`（UI 流程）。

### P1.4 上线回放（"你不在时"）

- 进入庭院后查询 `presence_log where at > my_last_leave order by at`：聚合为一句话横幅（8s 淡出）：
  > "你不在的 2 天 3 小时里，TA 来过 3 次；昨晚 23:40 在书桌前坐了半小时；给你留了 1 张纸条。"
- 同时查询未拆 `notes` 数量，"！"角标引到纸条位置。
- **文件**：`persistence.ts` 新增 `getRecap(since)`；`main.ts` 横幅组件。

### P1.5 指标落地

- `presence_log` join/leave 写入后，`weekly_online_minutes` 视图即出数；Supabase 后台收藏该查询，每周一看一眼即可。

**P1 出口标准**：双浏览器实测完整闭环——A 离线 → B 上线看到 A 影子猫 → B 留纸条下线 → A 上线看到回放 + 拆纸条 → B 再上线收到"已拆"提示。打 tag `p1-companion`。

---

## 6. P2 —— 双人互动与素材管线重做（预计 5–7 天，可与 P1 并行拆分）

### P2.1 双人互动动作（2–3 天）

- **蹭头（nuzzle）**：走近对方猫（<48px）右键 → 菜单"蹭蹭 TA"→ 广播 `interact-invite` → 对方屏幕弹邀请（5s 自动接受可设置）→ 两只猫相向走 2 步 → 播放碰头动画 + 头顶爱心粒子（canvas 绘制，复用灯笼发光思路）。
- **同眠（cosleep）**：双方都在线且一方已睡 → 另一方右键对方床 → "一起睡"→ 对方接受后两只猫在同一床内左右错位 12px 渲染。P0 的床位认领保证默认不撞床，cosleep 是显式动作。
- **快捷表情**：数字键 1–6 触发头顶表情（爱心/问号/zzZ/小鱼干/生气/星星），广播 `emote`。
- **文件**：`types.ts` 事件、`game.ts`（双猫动画编排器 `startDuet(kind, partnerId)`）、`main.ts`（交互菜单）。
- **验收**：两猫蹭头动画帧同步偏差 <200ms；同眠无穿模；一方中途移动则优雅退出互动。

### P2.2 素材管线重做（未商业化前不急改造）

- **规格**：Aseprite / LibreSprite 建 48×48 单元格标准图集；4 方向走路各 4 帧（脚部落点对齐网格）、idle 2 帧、sleep 2 帧、sit 1 帧、eat 2 帧、play 2 帧、蹭头 2×2 帧（双猫各一）。
- **换色**：素材用 12 色固定索引调色板绘制；构建期脚本（`scripts/tint-atlas.mjs`）读调色板映射表离线生成 12 种毛色图集 PNG，运行时按毛色直接 `drawImage`——删除 `coatFilter` 与全部 `ctx.filter` 调用。
- **渲染改造**：`game.ts` 删除硬编码 `atlasColumns/atlasRows`，改读 JSON 帧描述文件（`public/assets/cat-atlas.json`，由 Aseprite 导出）。
- **验收**：走路帧无抖动错位；12 种毛色边界干净（奶牛猫色块锐利）；移动端/低端机 drawImage 无 filter 后帧率提升可测。

**P2 出口标准**：互动三件套 + 新图集上线，打 tag `p2-duet`。

---

## 7. P3 —— 留存内容层（方案细化待定，先立方向）

- **共同种植**：院子角落一株两人共养植物，`garden` 表记录浇水事件；双方都浇才生长，单人浇只能保鲜；7 个生长阶段对应 7 张像素贴图。
- **每日合照**：双方同屏时可发起"拍张照"，canvas 合成像素卡片（当天日期 + 天气角标），存 Supabase Storage + `photos` 表，庭院里做一个"纪念墙"展示区。
- **天气/时间同步**：接入一个天气 API，双方各自显示自己城市的实时天气叠加在庭院上；夜晚场景开灯、可"并排看星星"（配合 cosleep 同款双猫编排器）。
- **区域解锁**：庭院等级 = 共同在线小时数，解锁屋顶/温室贴图区域（纯客户端逻辑 + 一行 `rooms.level`）。

P3 启动前先回看 P1/P2 的北极星数据：如果"打开频次低"是瓶颈 → 先做合照与种植（给打开理由）；如果"单次时长短"是瓶颈 → 先做区域与天气（给停留内容）。

---

## 8. 里程碑与节奏建议

| 里程碑 | 内容          | 出口                          | 预计    |
| --- | ----------- | --------------------------- | ----- |
| M0  | P0 全部       | 双开验收 + tag `p0-polish`      | 1.5 天 |
| M1  | P1 全部       | 异步闭环实测 + tag `p1-companion` | +4 天  |
| M2  | P2 全部       | 互动+新素材 + tag `p2-duet`      | +7 天  |
| M3  | P3 选型 1–2 项 | 视北极星数据定                     | 另议    |

依赖关系：P0 → P1（床位认领是同眠前提）；P1 与 P2.2 素材管线可并行（不同文件域）；P2.1 互动动画依赖 P2.2 的新图集帧，若素材未就绪可先用临时色块帧跑通协议。

## 9. 明确不做清单（防止自由发挥）

- 不做注册/登录/邮箱验证；不做多房间与邀请码管理。
- 不做移动端专项适配；不做素材合规审查；不做数据导出/解除关系流程。
- 不做服务端函数（Edge Functions）；所有逻辑在前端 + 三张表内完成。
- 不引入任何状态管理库、游戏引擎或 UI 框架，维持 vanilla TS + Canvas 2D。
