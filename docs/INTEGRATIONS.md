# 真实服务接入说明

## 客户注册与登录

公网环境默认开放客户自行注册。客户填写姓名、邮箱和至少 10 个字符的密码后即可进入工作台，每个客户的项目数据独立保存，不能通过项目地址读取其他客户的数据。

- 密码经过独立加盐的慢速算法处理，不保存明文。
- 登录状态保存在服务器，浏览器只保存 `HttpOnly` 安全 Cookie。
- 注册和登录都有限速保护，退出后服务器会立即撤销登录状态。
- 原来的 `VIRALFLOW_ADMIN_PASSWORD` 继续作为管理员入口，模型连接测试和 TikTok 授权等平台操作只允许管理员执行。
- 账户、登录记录和客户项目使用 `DATA_ENCRYPTION_KEY` 加密保存；在 Render 上由 PostgreSQL 持久化。

当前版本不发送注册验证邮件或找回密码邮件。正式收费运营前应继续接入邮件验证、找回密码、套餐额度和支付功能。

## TikTok Shop 官方数据

系统只申请并使用平台公开榜单所需的最小权限：

- `Bestsellers`：官方畅销视频榜单
- `Shop Authorized Information`：获得调用榜单所需的美国市场上下文

不读取订单、客户资料、商家私有视频或店铺经营数据。

在 TikTok Shop Partner Center 中，把正式回调地址设置为：

`https://你的公网域名/api/tiktok/oauth/callback`

服务器需要配置：

- `TIKTOK_SHOP_APP_KEY`
- `TIKTOK_SHOP_APP_SECRET`
- `TIKTOK_SHOP_SERVICE_ID`

美国数据安全审核和权限审核通过后，在网站的“TikTok 数据”页面完成一次授权即可。首次同步只建立数据快照；系统积累 3 天或 7 天快照后，才会计算真实增长率。GMV 是平台返回的脱敏区间，不是精确销售额。

## Google Gemini

服务器使用 Google Gemini 完成：

- 完整视频的画面、口播、声音、字幕与节奏理解
- 商品资料、评论与消费顾虑分析
- 原创英文带货脚本和视频提示词
- Gemini Omni Flash 9:16 竖屏视频、原生英语口播和声音
- 商品参考图和成人模特参考图驱动的视频生成

配置项：

- `GEMINI_API_KEY`
- `GEMINI_ANALYSIS_MODEL`（默认 `gemini-3.6-flash`）
- `GEMINI_VIDEO_MODEL`（默认 `gemini-omni-flash-preview`）

上传视频上限为 200 MB，商品图和模特图每张上限为 5 MB。分析完成后，本地临时文件和上传到 Gemini 的临时文件会自动删除，只保存分析结果。视频生成使用后台任务，页面会自动刷新进度并在完成后提供下载。

## Seedance 与 Runway 视频模型

一枚 Runway 官方密钥可以启用三个视频入口：

- `Seedance 2`：国内模型，支持商品图和模特图多参考、原生声音，适合电商短视频。
- `Runway Gen-4.5`：海外模型，适合写实画面、产品质感和镜头运动；口播建议后续添加。
- `Runway Product UGC`：商品图和已获授权的成人模特图直出带口播的 9:16 UGC 成片。

配置项：

- `RUNWAYML_API_SECRET`
- `RUNWAY_API_BASE_URL`（默认 `https://api.dev.runwayml.com`）
- `RUNWAY_API_VERSION`（默认 `2024-11-06`）
- `SEEDANCE_VIDEO_MODEL`（默认 `seedance2`）
- `RUNWAY_VIDEO_MODEL`（默认 `gen4.5`）

商品图和模特图只作为本次生成任务的输入，提交后服务器立即删除临时文件。请仅上传自己拥有或已获得本人授权的成人模特图片。

## 生产安全

公网部署必须配置访问密码、会话密钥和数据加密密钥。系统不会在状态接口中返回任何服务密钥。配置 `DATABASE_URL` 后，项目、TikTok 授权令牌和增长快照会加密保存在 PostgreSQL；没有数据库时才使用 `DATA_DIR` 下的本地文件。Render Blueprint 会自动创建并连接数据库。
