# ViralFlow

面向 TikTok Shop 美区卖家的内容分析、原创脚本与 AI 视频工作台。

## 当前可用功能

- 上传真实商品视频，由 Gemini 同时理解画面、口播、声音和节奏，并结合评论完成内容分析。
- 从商品资料直接生成原创美式 UGC 脚本和 AI 视频提示词。
- 自动保存分析和脚本项目，可选择 Gemini Omni Flash、Seedance 2、Runway Gen-4.5 或 Runway Product UGC 生成 9:16 视频并下载成片。
- 可上传商品参考图和已获授权的成人模特参考图；Product UGC 可直接生成带模特和原生口播的电商短视频。
- 接入 TikTok Shop 官方 Bestsellers 数据；未授权或审核未通过时不会显示假数据。
- 生产环境使用访问密码，令牌和项目文件支持加密保存。
- 云端使用 PostgreSQL 保存项目、授权状态和增长快照，容器重启不会丢失。

## 本地启动

双击 `启动ViralFlow.bat`，或运行：

```powershell
npm.cmd install
npm.cmd run dev
```

然后打开 `http://127.0.0.1:5173/`。

## 配置

复制 `.env.example` 为 `.env.local`，填写需要使用的服务密钥。密钥只保存在服务器，不会发送到浏览器。

详细说明见 [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md)。

## 云端部署

仓库已经包含 `Dockerfile` 和 `render.yaml`。生产环境必须设置：

- `GEMINI_API_KEY`
- `RUNWAYML_API_SECRET`（使用 Seedance、Gen-4.5 或 Product UGC 时需要）
- `VIRALFLOW_ADMIN_PASSWORD`
- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`

Render Blueprint 会自动创建并连接 PostgreSQL，`DATABASE_URL` 无需手动填写。首次部署只要求填写网站访问密码；Gemini 和 TikTok 密钥可在服务上线后从 Render 环境变量中添加。

TikTok 的配置可以后续补充。健康检查地址为 `/api/health`。
