# 为 BZ Hub 做贡献

感谢你愿意改进 BZ Hub。提交改动前，请先确认它适用于本地优先、跨 Windows 与 macOS 的产品方向。

## 开发流程

1. Fork 仓库并从 `main` 创建分支。
2. 安装 Node.js 20+、pnpm 10+ 和 Rust stable。
3. 执行 `pnpm install`，再用 `pnpm tauri dev` 启动桌面开发版。
4. 提交前运行：

```powershell
pnpm build
node wallpaper-engine/check.mjs
cd src-tauri
cargo fmt --check
cargo test
```

5. Pull Request 中请说明改动目的、验证方式及受影响的平台；界面改动建议附截图。

## 隐私与安全

- 不要提交 `.env`、API 密钥、登录令牌、真实日历/入口导出或本机绝对路径。
- 示例内容应使用虚构名称和通用路径。
- 新增同步字段时需同时考虑 Supabase RLS、旧数据兼容及离线行为。
- 请勿在公开 Issue 中披露安全漏洞，改用 [`SECURITY.md`](./SECURITY.md) 中的联系方式。
