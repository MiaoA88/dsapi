# DeepSeek Usage+ — 官方API用量页增强仪表盘

[![Version](https://img.shields.io/badge/version-1.7.2-blue)](https://github.com/miaoa88/dsapi)

DeepSeek 官方API用量页只展示了几个基础数字和一张简表。本脚本在其基础上扩展为完整的数据分析仪表盘，包含费用细分、Token 构成、交互图表、缓存命中率等，并在 DeepSeek 对话页左上角补上直达入口，方便一键跳转到API用量页。

## 效果对比

| 官方页面 | 安装脚本后 |
|---------|-----------|
| 仅展示总用量数字 | 今日消费、本月费用、选中月份费用、平均单价、预估剩余额度 |
| 无输入/输出拆分 | 每项费用展示输入 vs 输出细分金额 |
| 无图表 | 5 张交互式 ECharts 图表 |
| 简表仅有 Token 总数 | 模型明细表含请求数、Token、输入/输出拆分、缓存命中率、费用 |
| 无缓存分析 | 缓存命中率趋势图 + 命中 Token 统计 |

## 功能

### 账户概览
6 项概览卡片，每项均有细分数据：

- 今日消费 — 自动定位当日数据，展示输入/输出费用
- 本月费用 — 输入/输出费用拆分
- 选中月份费用 — 同上，按月份选择器切换
- 平均消费 — 每百万 Token 输入/输出单价
- 本月用量 — 输入/输出 Token 数
- 预估可用 — 基于钱包余额和均价估算剩余 Token

### 交互式图表
- **API 请求趋势** — 每日请求量折线图，悬停显示当天各模型请求分布
- **Token 消耗堆叠图** — 输出 / 输入未缓存 / 输入缓存命中，一目了然
- **缓存命中率曲线** — 每日命中率变化趋势
- **费用构成** — 输入 vs 输出费用水平柱状图
- **模型分布饼图** — Top 8 模型 Token 消耗占比

### 模型明细表
每个模型一行，列包含：模型名、请求数、Tokens、输出 Token、输入未缓存、输入缓存命中、缓存命中占比、费用。

### 其他
- 自动跟随 DeepSeek 平台暗色模式
- 切换月份自动刷新数据
- 调试模式：点击按钮在控制台查看 API 返回结构
- 请求自动取消和 30 秒超时
- 在 DeepSeek 对话页左上角新增 API 用量入口按钮，点击后新标签页打开用量页

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点击安装脚本](https://greasyfork.org/zh-CN/scripts/578066-deepseek-usage-%E5%AE%98%E6%96%B9api%E7%94%A8%E9%87%8F%E9%A1%B5%E5%A2%9E%E5%BC%BA%E4%BB%AA%E8%A1%A8%E7%9B%98) 或从 [Github](https://github.com/MiaoA88/dsapi) 下载
3. 访问 [DeepSeek 开放平台用量页](https://platform.deepseek.com/usage) 并登录

## 兼容性

- 浏览器：Chrome / Firefox / Edge（Tampermonkey 或 Violentmonkey）
- 页面：`https://platform.deepseek.com/usage*`、`https://chat.deepseek.com/*`

## 技术栈

- 纯 JavaScript（无框架依赖）
- [ECharts 5.6](https://echarts.apache.org/)（通过 CDN 加载，`@require` 声明）

## License

MIT

## v1.7.2 更新日志

- 新增 DeepSeek 对话页入口：在左上角按钮组中新增加 API 用量按钮。
- 点击该按钮会在新标签页打开 `https://platform.deepseek.com/usage`。
- 新按钮不显示额外文字提示，避免与官网原生 tooltip 样式不一致。

## v1.7.1 更新日志

- 修复首次进入 DeepSeek 用量页时脚本未立即生效，需要手动刷新后才显示增强面板的问题。
- 修复扩展图表 tooltip 鼠标悬停不动时自动闪退的问题。
- 优化多个图表之间移动鼠标时的 tooltip 切换行为，避免旧悬浮窗残留。
- 清理 tooltip 相关冗余配置，提升交互稳定性。

## GitHub
[GitHub](https://github.com/MiaoA88/dsapi)
可提交issue、pr
