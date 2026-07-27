# 真实服务接入说明

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

## OpenAI

服务器使用 OpenAI 完成：

- 视频语音转文字
- 关键画面、台词与评论分析
- 原创英文带货脚本和视频提示词
- Sora 视频任务、状态查询和成片下载

配置项：

- `OPENAI_API_KEY`
- `OPENAI_ANALYSIS_MODEL`
- `OPENAI_TRANSCRIBE_MODEL`
- `OPENAI_VIDEO_MODEL`

上传文件上限为 200 MB。分析完成后，临时视频、音轨和抽帧会自动删除；只保存分析结果。

## Creatify（可选）

需要 AI 模特商品视频时配置：

- `CREATIFY_API_ID`
- `CREATIFY_API_KEY`

同时需要一个可公开访问的商品链接。未配置时，网站仍可使用 OpenAI 分析、脚本和 Sora 视频功能。

## 生产安全

公网部署必须配置访问密码、会话密钥和数据加密密钥。系统不会在状态接口中返回任何服务密钥。配置 `DATABASE_URL` 后，项目、TikTok 授权令牌和增长快照会加密保存在 PostgreSQL；没有数据库时才使用 `DATA_DIR` 下的本地文件。Render Blueprint 会自动创建并连接数据库。
