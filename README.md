# 猫庭 · Meow Courtyard

两个人（可扩展到好友小群）的私人像素猫庭院。每人在浏览器里认领一只小猫，异地也能一起趴在院子里晒太阳——TA 不在线时，TA 的猫还在原地睡着。

在线版本：https://meow-one-weld.vercel.app/

## 玩法速览

- **认领你的猫**：首次打开弹出自定义面板（毛色 / 花色 / 名字），身份存于浏览器 `localStorage`，无需注册。
- **动作**：底部 dock 选择学习 / 吃饭 / 上厕所；点「睡觉」就地蜷下，右键自己可「去窝里睡」「换身毛」。
- **互动**：右键对方的猫 → 蹭蹭 TA（对方确认后两猫相向贴贴）/ 一起睡（同窝盖被）；数字键 `1-6` 发快捷表情。
- **留物**：dock 的 ✎ 留纸条 / 小鱼干，院子和小屋都能钉；TA 留的东西带呼吸光环与「!」提示，在门口木牌上也会预告另一个场景里有 TA 留的东西。
- **上线回放**：进入庭院会告诉你不在的这段时间 TA 来过几次、做了什么。
- **影子猫**：TA 离线后，TA 的猫按最后的姿态留在原地（名牌带「不在」）。右键影子猫可以「戳一下」互动，旧设备残留的猫可以「送走这只猫」。
- **多设备认领**：身份存在浏览器里，换新设备首次打开时会列出院子里已登记的猫，点「这是我」即可认领回同一只猫，不会变出新猫。
- **三个场景**：庭院、小屋与花园；走庭院顶门进屋、底门去花园；小屋里同眠有专属像素被窝。
- **小花园**：庭院下方的门通向花园。右键空坑播种（向日葵 / 郁金香 / 玫瑰），**两个人都浇过水且满 18 小时才长一阶**；每人的本阶段生长贡献只计一次，重复浇水仍可保鲜。提前浇完后，下次打开花圃或操作时由数据库推进；72 小时未浇水只会蔫，浇水即可恢复。盛开后收获入花袋。
- **花的三个出口**：花袋（dock ❀）里每一朵都能 **插在纸条上送给 TA**（TA 拆开时花进 TA 的花袋）、**种在任意场景门口当装饰**（右键可收回）、**别在自己头上**（TA 也看得见，会跟着猫的呼吸轻轻晃；右键自己取下）。
- **昼夜与时间**：天色按真实时钟变化（清晨 / 白天 / 黄昏 / 夜晚），夜晚灯笼亮起。顶栏 🌗 可切换 `跟随本地 / TA的天空 / 白天 / 黄昏 / 夜晚`——「TA的天空」按对方时区渲染（对方在线时自动获取其时区，离线时用 `VITE_PARTNER_TZ` 兜底），只影响自己的屏幕。

## 本地运行

```bash
npm install
copy .env.example .env.local   # macOS/Linux: cp .env.example .env.local
npm run dev
```

`.env.local` 配置项：

| 变量 | 说明 |
| --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase 项目地址与 publishable key；不填则进入单猫离线模式 |
| `VITE_ROOM_ID` | 房间频道名，两人一致即可 |
| `VITE_ROOM_SECRET` | 门口令：设置后需以 `#k=口令` 访问才能进入庭院 |
| `VITE_PARTNER_TZ` | 「TA的天空」离线兜底时区（IANA 名称，如 `America/New_York`） |

### 数据库初始化（一次）

P1 起的持久化功能（影子猫 / 纸条 / 回放 / 在线时长）与 P3 的小花园（花圃 / 装饰花 / 花袋 / 附花纸条）依赖数据库，在 Supabase Dashboard 的 SQL Editor 中执行一次 [`supabase/schema.sql`](supabase/schema.sql) 即可。**脚本全部幂等**（`create table if not exists` / `add column if not exists`），已建过表的部署可重复执行以补齐花园相关表与列。

接着执行 [`supabase/transactions.sql`](supabase/transactions.sql)，安装花袋、佩戴、纸条、装饰和花圃的事务函数。这两个脚本都可重复执行。新版客户端依赖这些函数；上线时先迁移数据库，再发布客户端。

Supabase Dashboard 的 Realtime Settings 需保持 `Enable Realtime service` 与 `Allow public access to channels` 开启。

现有版本仍采用匿名房间和客户端身份，门口令不是数据库权限控制。事务修复物品一致性，不代表已经完成身份认证和 RLS；不要把此版本当成经过权限隔离的公共服务。

## 架构

- **Canvas 2D**：庭院 / 小屋 / 花园三场景、猫咪渲染、活动动画、花圃与花的五阶生长、粒子与光影
- **DOM/CSS**：顶栏、dock、聊天记录、认领 / 纸条 / 花圃 / 花袋面板
- **Supabase Presence**：在线成员、影子猫心跳、时区上报
- **Supabase Broadcast**：坐标快照（带序列号 + 客户端插值缓冲）、活动、换装、互动邀请与临时聊天、花圃与装饰花的即时同步
- **Postgres**（`players` / `notes` / `presence_log` / `garden_plots` / `decor`）：身份快照与花袋、留物与附花纸条、在场记录与北极星指标（周均在线时长）、花圃状态与装饰花
- 断开页面时经 PostgREST `fetch keepalive` 补写离线事件

## 构建

```bash
npm run build
```

## 回归检查

Node.js 22.13+：`npm test` 运行动作与真实 PostgreSQL SQL 回归。PGlite 仅用于开发检查，不进入网页生产包。它使用单连接，不能替代生产 PostgreSQL 的多连接并发与 Supabase 权限验收。

角色帧、锚点与素材来源见 [`docs/action-assets.md`](docs/action-assets.md)。网页检查至少覆盖两个独立身份及 1024×768、1280×720，包含保存拒绝、刷新佩戴、重复领取、跨场景邀请和中断动作。

本轮本地验收结果与尚未执行的上线检查见 [`docs/verification.md`](docs/verification.md)。

`dist/` 可直接部署到 Vercel、Cloudflare Pages 或任意静态托管；环境变量在托管平台后台另行配置。

## 素材说明

本项目仅用于个人非商业娱乐。成品像素图使用生成式图像工具制作，并参考了以下由项目创建者指定的素材仓库：

- https://github.com/Huu-Yuu/StardewValley-Assets
- https://github.com/Huu-Yuu/PixelSRPG-Forge

生成底稿与处理脚本归档在 `docs/asset-src/`。
