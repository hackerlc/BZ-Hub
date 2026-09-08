# BZ Hub

[![License: MIT](https://img.shields.io/badge/License-MIT-5f9ea0.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB.svg)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://react.dev/)

BZ Hub 是一个本地优先、面向 Windows 与 macOS 的桌面启动器。它把网页、应用、文件、文件夹和项目集中到同一个面板，并提供分类、搜索、组合启动、日历、天气、跨设备同步及可选的 AI 对话控制。

当前版本为 `0.1.0`，适合自行构建和测试。Windows 免安装测试版不会提交到源码仓库，后续可通过 GitHub Releases 单独发布。

## 主要功能

- 从 Windows 系统托盘或 macOS 菜单栏快速打开主面板
- 通过系统选择器添加应用、文件、文件夹和项目，自动补全名称、类型及可用图标
- 常用、全部、收藏和自定义分类；支持拖动排序
- 模糊搜索、拼音首字母和自定义别名
- 组合入口、子目标开关、顺序启动和独立启动延迟
- 本地打开统计、最近使用和下一项重要日程提示
- 独立日历页面、重要/普通事项及中国节假日信息
- 和风天气当前天气展示与详情悬浮层
- 版本化 JSON 导出、合并导入和全部替换
- 可选 Supabase 邮箱验证码登录与 Windows/macOS 数据同步
- 可选的 BZ Hub Skill 与本地 MCP 桥接，通过 AI 对话打开既有入口和管理日程
- Windows 保持屏幕唤醒、回收站入口和实验性任务栏透明
- Wallpaper Engine 山谷气象动态桌面与本机天气联动

## 平台支持

| 能力 | Windows | macOS |
| --- | :---: | :---: |
| 入口、搜索、分类、组合启动 | ✅ | ✅ |
| 日历、天气、数据导入导出 | ✅ | ✅ |
| Supabase 同步 | ✅ | ✅ |
| 系统托盘 / 菜单栏 | ✅ | ✅ |
| 保持屏幕唤醒 | ✅ | ✅ |
| 回收站、任务栏透明 | ✅ | — |
| Wallpaper Engine 联动 | ✅ | — |

## 开发环境

- Node.js 20+
- pnpm 10+
- Rust stable
- Windows：Microsoft C++ Build Tools、Windows SDK 与 WebView2
- macOS：Xcode Command Line Tools

```powershell
pnpm install
pnpm tauri dev
```

只预览前端：

```powershell
pnpm dev
```

## Supabase 同步

1. 在 Supabase 创建项目。
2. 在 SQL Editor 中执行 [`supabase/schema.sql`](./supabase/schema.sql)。
3. 将 [`.env.example`](./.env.example) 复制为 `.env`。
4. 在 `.env` 中填写项目 URL 和 publishable key；旧项目也可以使用 anon key。

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

5. 在应用“设置 → 同步”中使用邮箱验证码登录。两台电脑使用相同的 Supabase 项目配置和邮箱账户即可同步。

`.env` 已加入忽略规则。不要将 `service_role`、secret key、登录令牌或真实用户数据提交到仓库；桌面客户端只应使用 publishable/anon key，并依靠 Row Level Security 限制每位用户的数据。

## 天气

在“设置 → 天气”中填写和风天气控制台提供的专属 API Host、API Key 和城市。BZ Hub 只读取地理位置与当前天气基础接口，并在本地缓存结果。配置不会包含在数据导出、Wallpaper Engine 项目或 AI 控制请求中。

## AI 对话控制

仓库内置 [`skills/bz-hub`](./skills/bz-hub/) Skill 与本地 MCP 桥接。AI 不直接修改应用存储或执行任意系统命令，而是把经过约束的入口和日历请求交给正在运行的 BZ Hub。

基本流程：

1. 将 `skills/bz-hub` 安装到 Codex 的个人 Skills 目录。
2. 注册 `skills/bz-hub/scripts/bz-hub-mcp.mjs` 为本地 MCP 服务。
3. 在“设置 → 通用 → AI 控制”中启用授权。
4. 之后可以说“用 BZ Hub 打开微信”或“在 BZ Hub 中添加明天下午 3 点的重要日程”。

授权令牌仅保存在当前电脑，不同步、不导出。AI 只能按应用返回的入口 ID 打开已经配置的目标。

## Wallpaper Engine 动态桌面

Web Wallpaper 项目位于 [`wallpaper-engine/bz-hub-landscape`](./wallpaper-engine/bz-hub-landscape/)，包含 3440×1440 的清晨、白天、黄昏、夜晚、雾、雨和雪场景，以及水面、降水、飘絮、雾层和本地合成环境声。

它可以独立运行：Wallpaper Engine 属性面板提供“时间场景”和“天气场景”，可跟随本地时间、固定时段或选择固定天气。安装 BZ Hub 后，还可以通过仅监听 `127.0.0.1` 的只读桥接获得真实天气与模拟场景，API Key 不会进入壁纸文件。

导入与创意工坊发布方式见 [壁纸说明](./wallpaper-engine/bz-hub-landscape/README.md) 和 [发布指南](./docs/PUBLISHING.md)。Wallpaper Engine 官方桌面版目前仅支持 Windows。

## 构建

Windows 安装包：

```powershell
pnpm tauri build
```

只生成免安装 Windows 可执行文件：

```powershell
pnpm tauri build --no-bundle
```

不要直接运行不带 `custom-protocol` 特性的 `cargo build --release`，否则程序会尝试连接开发服务器，而不是加载打包后的页面。

macOS `.app` / `.dmg` 必须在 Mac 或 macOS CI 上构建：

```bash
pnpm install
pnpm tauri build
```

公开分发时应配置 Windows 代码签名，以及 macOS 签名与公证。

## 数据与安全说明

- 启动器数据默认保存在本机；同步为可选功能。
- 外部入口只在用户点击或 AI 请求命中既有入口后启动。
- Windows 11 任务栏透明属于实验性功能：它会将随程序编译的 XAML 桥接 DLL 加载到当前用户的 Explorer 进程，并在关闭开关或退出 BZ Hub 时恢复系统默认外观。
- 动态桌面桥接只监听本机回环地址，不对局域网或互联网开放。
- 发布前请确保 `.env`、个人数据导出、日志及构建目录没有被加入 Git。

## 验证

```powershell
pnpm build
node wallpaper-engine/check.mjs
cd src-tauri
cargo test
```

## 项目结构

```text
src/                         React 界面与业务逻辑
src-tauri/                   Tauri / Rust 桌面能力
supabase/                    数据库表与 RLS 配置
skills/bz-hub/               Codex Skill 与本地 MCP 桥接
wallpaper-engine/            Web Wallpaper、素材与离线检查
docs/PUBLISHING.md           GitHub、创意工坊与演示视频发布流程
```

## 致谢

项目使用了 Tauri、React、Supabase、和风天气及 Wallpaper Engine 提供的能力。Windows 11 XAML 任务栏处理方式参考了 [TranslucentTB](https://github.com/TranslucentTB/TranslucentTB) 的公开实现思路。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始前请阅读 [`CONTRIBUTING.md`](./CONTRIBUTING.md)；安全问题请按照 [`SECURITY.md`](./SECURITY.md) 私下报告，不要在公开 Issue 中附带密钥、令牌、邮箱或本机路径。

## 许可证

本项目使用 [MIT License](./LICENSE) 开源。
