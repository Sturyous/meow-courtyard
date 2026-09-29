# 猫庭

一个无需注册、不会保存历史记录的多人像素猫咪庭院。玩家打开页面即获得一只随机小猫，关闭页面后由 Supabase Realtime Presence 自动移除。

在线版本：https://meow-one-weld.vercel.app/

## 本地运行

```bash
npm install
copy .env.example .env.local
npm run dev
```

在 `.env.local` 中填写 Supabase Project URL 和 publishable key。Supabase Dashboard 的 Realtime Settings 需要保持 `Enable Realtime service` 与 `Allow public access to channels` 开启。

## 架构

- Canvas 2D：庭院、猫咪、活动与移动
- DOM/CSS：聊天、状态和移动端控制
- Supabase Presence：在线成员与离线清理
- Supabase Broadcast：坐标、活动、换装和临时聊天
- 无数据库表、无持久化用户、无服务端函数

## 构建

```bash
npm run build
```

`dist/` 可以直接部署到 Vercel、Cloudflare Pages 或任意静态托管。

## 素材说明

本项目仅用于个人非商业娱乐。成品像素图使用生成式图像工具制作，并参考了以下由项目创建者指定的素材仓库：

- https://github.com/Huu-Yuu/StardewValley-Assets
- https://github.com/Huu-Yuu/PixelSRPG-Forge

原始参考素材与工作文件保留在本地 `tmp/` 中，不包含在本仓库内。
