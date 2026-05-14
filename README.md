# DeepSeek Usage+ — 官方用量页增强仪表盘

[![Version](https://img.shields.io/badge/version-1.7.0-blue)](https://github.com/codex/dsapi)

DeepSeek 官方用量页只展示了几个基础数字和一张简表。这个油猴脚本在其基础上扩展为完整的数据分析仪表盘——费用细分、Token 构成、交互图表、模型明细，全部在页面内展开。

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

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. [点击安装脚本](https://greasyfork.org/zh-CN/scripts/578066-deepseek-usage-%E5%AE%98%E6%96%B9api%E7%94%A8%E9%87%8F%E9%A1%B5%E5%A2%9E%E5%BC%BA%E4%BB%AA%E8%A1%A8%E7%9B%98) 或从 [Github](https://github.com/MiaoA88/dsapi) 下载
3. 访问 [DeepSeek 开放平台用量页](https://platform.deepseek.com/usage) 并登录

## 兼容性

- 浏览器：Chrome / Firefox / Edge（Tampermonkey 或 Violentmonkey）
- 页面：`https://platform.deepseek.com/usage*`

## 技术栈

- 纯 JavaScript（无框架依赖）
- [ECharts 5.6](https://echarts.apache.org/)（通过 CDN 加载，`@require` 声明）

## License

MIT
