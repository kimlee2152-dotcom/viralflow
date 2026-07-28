# ViralFlow

面向 TikTok Shop 美区卖家的内容分析、原创脚本与 AI 视频工作台。

## 当前可用功能

- 上传真实商品视频，提取关键画面和语音，并结合评论完成内容分析。
- 从商品资料直接生成原创美式 UGC 脚本和 AI 视频提示词。
- 自动保存分析和脚本项目，支持继续创建 Sora 视频任务并下载成片。
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

- `OPENAI_API_KEY`
- `VIRALFLOW_ADMIN_PASSWORD`
- `SESSION_SECRET`
- `DATA_ENCRYPTION_KEY`

Render Blueprint 会自动创建并连接 PostgreSQL，`DATABASE_URL` 无需手动填写。首次部署只要求填写网站访问密码；OpenAI 和 TikTok 密钥可在服务上线后从 Render 环境变量中添加。

TikTok 和 Creatify 的配置可以后续补充。健康检查地址为 `/api/health`。
