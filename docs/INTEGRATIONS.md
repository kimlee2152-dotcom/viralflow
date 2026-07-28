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

上传视频上限为 200 MB，商品图和模特图每张上限为 12 MB。分析完成后，本地临时文件和上传到 Gemini 的临时文件会自动删除，只保存分析结果。视频生成使用后台任务，页面会自动刷新进度并在完成后提供下载。

## 生产安全

公网部署必须配置访问密码、会话密钥和数据加密密钥。系统不会在状态接口中返回任何服务密钥。配置 `DATABASE_URL` 后，项目、TikTok 授权令牌和增长快照会加密保存在 PostgreSQL；没有数据库时才使用 `DATA_DIR` 下的本地文件。Render Blueprint 会自动创建并连接数据库。
