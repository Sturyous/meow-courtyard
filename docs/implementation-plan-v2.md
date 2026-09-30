# 喵庭 2.0 → 3.0 实施执行方案（v2）：星露谷小花园

> 在 v1（P0–P2.1 已落地）之上新增的 P3 方向：共同种植。读者：cosphy、sturyous（Codex 执行）。
> 编写日期：2026-09-30。基线代码：commit `882915e` 之后（双场景 + 昼夜 + 纸条跨场景 + 多设备认领）。

---

## 0. 已确认的产品决策（2026-09-30 对齐）

| # | 问题 | 结论 | 对方案的影响 |
| - | --- | ---- | ----------- |
| 1 | 花园定位 | **小农场**，星露谷物语感，但首批只上 3 种花 | 多种类图鉴不做；渲染走代码绘制的像素花，规格先行 |
| 2 | 空间结构 | **新开辟 garden 场景**：庭院上方的门 → 小屋，下方的门 → 花园 | SceneId 扩为三值；导航与木牌提示做三场景适配 |
| 3 | 花的出口 | **三个全要**：插纸条送出 / 种在门口当装饰 / 别在喵头上 | 头戴花涉及跟随动效，按「做就做好」标准实现：跟随头部 bob、方向适配、睡觉不丢、换装不丢 |
| 4 | 枯萎机制 | 不浇只停滞、永不死；**停滞 3 天花朵低头耷拉**，浇水救活 | 耷拉是渲染态（由 last_watered_at 推导），不写库 |
| 5 | 北极星现状 | presence_log 已出数，不另加单次时长内容 | 本轮只做花园一条线 |

工程总原则不变：直接、非保守；旧版本打 tag 保留回滚； vanilla TS + Canvas 2D，不引新依赖。

---

## 1. 核心循环设计（一句话）

**播种 → 两人轮流浇水（异步接力）→ 五天五阶 → 盛开收获 → 花进入花袋 → 三个出口消耗（送礼 / 装饰 / 佩戴）→ 再种。**

关键规则（v1 方案雏形的定稿）：

1. **双方都浇才长一阶**：`watered_by` 集齐两个不同玩家且距上一阶 ≥18h，阶段 +1 并重置浇水记录；单人浇只保鲜。
2. **每人每阶段只能浇一次**：`watered_by` 已含自己就显示「你已经浇过了」。12h 时差恰好形成早晚轮班。
3. **停滞不惩罚**：`last_watered_at` 超过 72h → 渲染为低头耷拉（棕色、弯茎），任一浇水即恢复，阶段不退。
4. **永不枯萎删除**：花不会死，归零负罪感。

五阶生长：`种子 → 发芽 → 幼苗 → 花苞 → 盛开`，每阶一张代码绘制的像素贴图。首批花种：**向日葵 / 郁金香 / 玫瑰**，调色各异，花茎共用。

---

## 2. 数据模型（schema.sql 追加，全部幂等）

```sql
-- 2.1 花圃：6 个花位，一行一坑
create table if not exists garden_plots (
  room             text not null default 'mossbell-courtyard',
  plot             int  not null,               -- 0..5
  flower           text,                        -- 'sunflower' | 'tulip' | 'rose'；null = 空坑
  stage            int  not null default 0,     -- 0..4
  planted_by       text,
  stage_at         timestamptz,                 -- 进入当前阶段的时间（防双人在线连浇冲阶段）
  watered_by       text[] not null default '{}',-- 本阶段已浇水的玩家
  last_watered_at  timestamptz,
  last_watered_by  text,
  primary key (room, plot)
);

-- 2.2 门口/场景装饰花：从花袋种到任意场景地面
create table if not exists decor (
  id         uuid primary key default gen_random_uuid(),
  room       text not null default 'mossbell-courtyard',
  flower     text not null,
  scene      text not null default 'yard',
  x          int not null,
  y          int not null,
  placed_by  text not null,
  placed_at  timestamptz not null default now()
);

-- 2.3 花袋：挂在 players 行上（upsert 只写固定列，不会互相覆盖）
alter table players add column if not exists flowers jsonb not null default '{}';

-- 2.4 纸条可附一朵花
alter table notes add column if not exists flower text;

alter table garden_plots disable row level security;
alter table decor disable row level security;
```

**必须让 sturyous 在 Supabase SQL Editor 重跑一次 schema.sql**（全部 `if not exists` / `add column if not exists`，可重复执行）。

---

## 3. 事件协议扩展（types.ts）

```ts
export type SceneId = 'yard' | 'cabin' | 'garden';
export type FlowerId = 'sunflower' | 'tulip' | 'rose';

// NoteData 增加：flower: FlowerId | null
// PlayerSnapshot 增加：headFlower: FlowerId | null

export interface GardenPlot {
  plot: number;
  flower: FlowerId | null;
  stage: number;             // 0..4
  plantedBy: string | null;
  stageAt: string | null;
  wateredBy: string[];
  lastWateredAt: string | null;
  lastWateredBy: string | null;
}

export interface DecorItem {
  id: string; flower: FlowerId; scene: SceneId;
  x: number; y: number; placedBy: string;
}

// RoomEvent 新增：
| { type: 'garden-updated'; plot: GardenPlot }   // 播种/浇水/收获后广播整行
| { type: 'decor-placed'; decor: DecorItem }
| { type: 'decor-removed'; decorId: string; returnedTo: string }
```

DB 是唯一事实源；广播只做即时刷新，后进场的端在 `afterJoin` 全量拉取。

---

## 4. 场景与导航

- **garden 场景**：960×640 同规格。背景图 `public/assets/garden-bg.png`（ImageGen 生成星露谷风像素花园：草地、木栅栏、顶部回庭院的石板路、萤火虫/小木牌，**不画花圃土坑**——土坑代码绘制以保证可交互对位）。加载失败走代码兜底背景（与庭院兜底同风格）。
- **导航**：
  - 庭院上方门 → 小屋（不变）；**庭院下方门口（底栅栏缺口 x≈420–542）→ 花园**，落点花园顶部路中央。
  - 花园顶部路 → 回庭院，落点庭院下方门口。
  - dock 场景按钮文案情境化：庭院「进屋」/ 小屋「回院子」/ 花园「回院子」；花园主要靠走过去，按钮仅兜底。
- **木牌提示**三场景适配：TA 在别的场景、别的场景有 TA 留的东西/种的花，都在对应门口立牌。

---

## 5. 交互设计

### 5.1 花圃（garden 场景内右键土坑 → 花圃面板）

弹出花圃面板（overlay，非右键菜单——状态信息多，菜单放不下）：

- 空坑：三个播种按钮（🌻 向日葵 / 🌷 郁金香 / 🌹 玫瑰）。
- 生长中：显示花名、阶段进度条（5 格）、本阶段浇水情况（「你已浇 ✓ / TA 未浇」）、下一阶段条件。
  - 「浇水」按钮：不可用时说明原因（浇过了 / 距上一阶未满 18h 时浇水仍保鲜但不推进）。
  - 耷拉态：面板与坑位都显示「花蔫了，浇浇水吧」。
- 盛开：「收获」按钮 → 花入袋，坑变空。

浇水/收获动作时猫走向坑位（autoTarget），到位后播放浇水动效（蓝色水滴粒子 1s）+ 广播新行。顺手 `recordPresence('activity:water')`，让上线回放能说出「TA 给花浇了水」。

### 5.2 花袋（dock 新增 ❀ 按钮）

袋面板列出持有花（图标 + 数量），每朵三个出口：

1. **插在纸条上**：跳转账纸条面板，附花栏预选该花；纸条落地后图标上别着小花；TA 拆开纸条时**花转入 TA 的花袋**（这才是送礼闭环）。
2. **种在门口**：进入摆放模式（同纸条摆放），点击任意场景地面落装饰；右键自己种的装饰可收回花袋。
3. **别在头上**：写入 `PlayerSnapshot.headFlower` 并广播 + 持久化；再点一次取下。

### 5.3 头戴花渲染标准（「做就做好」验收点）

- 跟随头部 bob：复用 drawCat 的 breathe 计算，花在头顶随呼吸/走路起伏。
- 方向适配：left/right 时花别在靠前侧耳后（x 偏移 ±12），up 时藏到脑后（不画），down 时居中偏侧。
- 全状态兼容：睡觉（放枕边 2px 偏移）、蹭头、同眠、影子猫（快照含 headFlower 自然带出）、换装（独立绘制不受 coatFilter 影响）。
- 微动效：花瓣 2px 正弦轻颤（周期 1.4s），影子猫透明度继承。

---

## 6. 渲染分层（game.ts 改动点）

1. `draw()` 场景分支加 `drawGarden(ctx, frame)`（背景图 → 代码土坑 → 装饰花）。
2. 土坑固定 6 位：两行三列（x: 200/480/760，y: 300/460），代码绘制翻土色块 + 作物贴图，**长在背景之上、猫之下**（y 排序：猫在坑后时可走到上排坑的下方遮挡——坑按静态层先画即可，庭院已有同样处理）。
3. 昼夜：garden 复用 yard 的 multiply 叠色 + 两处萤火虫光点（夜晚 glow）。
4. `drawCat` 末尾按 `headFlower` 绘制（导出 `drawHeadFlower` 自 garden.ts）。
5. 装饰花作为地面道具层与纸条同层绘制，呼吸光环不需要（不是待办物）。

---

## 7. persistence.ts 新增函数

| 函数 | 作用 |
| --- | --- |
| `fetchGarden()` | 全量拉 6 坑（无行补空坑） |
| `upsertPlot(plot)` | 播种/浇水/收获后写整行 |
| `fetchDecor()` / `insertDecor()` / `deleteDecor()` | 装饰花读写 |
| `fetchFlowers(myId)` / `writeFlowers(myId, bag)` | 花袋读写（players.flowers） |
| `insertNote` 加 `flower` 参数；`toNote` 透出 | 附花纸条 |

---

## 8. 验收清单（本地双开实测）

- [ ] 庭院下方走进门口进花园，花园顶部走回庭院；木牌三场景提示正确。
- [ ] A 播种 → B 上线看到坑与阶段；A 浇水 → B 看到「TA 已浇」；B 浇水 → 阶段 +1 且双方画面同步。
- [ ] 同一玩家同阶段重复浇水被拒；两人 18h 内连浇不冲阶段（本地可改库时间验证，或把常量临时调小实测后调回）。
- [ ] 耷拉：库中把 last_watered_at 改到 4 天前 → 花低头变棕；浇水即恢复。
- [ ] 收获入袋 → 三个出口各走一遍：附花纸条送出后 TA 拆开入 TA 袋；装饰落地与收回；头戴花双端可见、走路/睡觉/换装均正常。
- [ ] 离线影子猫带头戴花；重进后花袋数量正确。
- [ ] `npm run build` 零错误；打 tag `p3-garden`。

## 9. 明确不做

- 不做种子购买/金币系统（播种免费无限）；不做除 3 种外花种；不做枯萎删除。
- 不做花园里的家具/装饰编辑模式；不做偷菜。
- 不做服务端定时任务（生长全部读时推导 + 写时推进）。
