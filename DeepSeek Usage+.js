// ==UserScript==
// @name         DeepSeek Usage+ — 官方API用量页增强仪表盘
// @namespace    https://platform.deepseek.com/
// @version      1.11.0
// @description  DeepSeek 官方API用量页增强分析：在官方总览之外补充输入/输出拆分、缓存命中、均价、预估可用、模型明细表与结构图表，并在对话页提供用量入口。
// @author       miaoa88
// @match        https://platform.deepseek.com/*
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  const PANEL_ID = "dsapi-plus-panel";
  const STYLE_ID = "dsapi-plus-style";
  const CHAT_USAGE_BUTTON_ID = "dsapi-plus-chat-usage-button";
  const CHAT_STYLE_ID = "dsapi-plus-chat-style";
  const USAGE_PAGE_URL = "https://platform.deepseek.com/usage";
  const EXTRA_CHARTS_STORAGE_KEY = "dsapi-plus-extra-charts";
  const PANEL_COLLAPSED_STORAGE_KEY = "dsapi-plus-panel-collapsed";
  const TOKEN_TYPES = {
    request: "REQUEST",
    response: "RESPONSE_TOKEN",
    promptMiss: "PROMPT_CACHE_MISS_TOKEN",
    promptHit: "PROMPT_CACHE_HIT_TOKEN",
  };

  const DATE_PRESET_LABELS = {
    today: { zh: "今天", en: "Today" },
    yesterday: { zh: "昨天", en: "Yesterday" },
    last7Days: { zh: "近 7 天", en: "Last 7 days" },
    last30Days: { zh: "近 30 天", en: "Last 30 days" },
    thisMonth: { zh: "本月", en: "This month" },
    lastMonth: { zh: "上月", en: "Last month" },
    custom: { zh: "自定义", en: "Custom" },
  };

  const state = {
    selectedRangeKey: "",
    observer: null,
    refreshTimer: 0,
    mutationTimer: 0,
    routeTimer: 0,
    requestId: 0,
    tokenSource: "none",
    abortController: null,
    charts: [],
    chartResizeObserver: null,
    lastPanelData: null,
    booted: false,
    historyHooked: false,
    tooltipActive: false,
    tooltipKeeperTimer: 0,
    tooltipKeeperChart: null,
    tooltipKeeperPoint: null,
    pendingThemeUpdate: false,
    pendingPanelData: null,
    chatBooted: false,
    chatObserver: null,
    chatTimer: 0,
  };

  function isUsagePage() {
    return location.pathname === "/usage" || location.pathname.startsWith("/usage/");
  }

  function isChatPage() {
    return location.hostname === "chat.deepseek.com";
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .dsapi-plus-panel {
        --dsapi-plus-text: var(--dsw-alias-label-primary, rgb(15, 17, 21));
        --dsapi-plus-muted: var(--dsw-alias-label-secondary, rgb(87, 97, 135));
        --dsapi-plus-tertiary: var(--dsw-alias-label-tertiary, rgb(120, 128, 156));
        --dsapi-plus-caption: var(--dsw-alias-label-caption, rgb(150, 156, 176));
        --dsapi-plus-module: var(--dsw-alias-bg-module-platform, #f5f6f7);
        --dsapi-plus-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
        --dsapi-plus-border-soft: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
        --dsapi-plus-interactive: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
        --dsapi-plus-font: var(--dsw-font-family, inherit);
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 40px;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--dsapi-plus-text);
        font-family: var(--dsapi-plus-font);
        -webkit-user-select: text;
        user-select: text;
      }
      .dsapi-plus-panel.is-collapsed {
        margin-bottom: 16px;
      }
      .dsapi-plus-panel.is-collapsed .dsapi-plus-tagline,
      .dsapi-plus-panel.is-collapsed .dsapi-plus-body,
      .dsapi-plus-panel.is-collapsed .dsapi-plus-message {
        display: none;
      }
      .dsapi-plus-panel *,
      .dsapi-plus-panel *::before,
      .dsapi-plus-panel *::after {
        box-sizing: border-box;
      }
      .dsapi-plus-page-wide .b7e4e307,
      .dsapi-plus-page-wide main > div {
        max-width: none !important;
      }
      .dsapi-plus-page-wide ._6660b4d {
        padding-left: clamp(20px, 3vw, 40px) !important;
        padding-right: clamp(20px, 3vw, 40px) !important;
      }
      .dsapi-plus-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 0;
      }
      .dsapi-plus-title {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 8px 12px;
        min-width: 0;
      }
      .dsapi-plus-title strong {
        color: var(--dsapi-plus-text);
        font: var(--dsw-font-base-strong-16, 500 16px/24px inherit);
      }
      .dsapi-plus-subtitle {
        color: var(--dsw-alias-label-tertiary, var(--dsapi-plus-tertiary));
        font: var(--dsw-font-s-14, 14px/22px inherit);
      }
      .dsapi-plus-actions {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-shrink: 0;
      }
      .dsapi-plus-status {
        color: var(--dsw-alias-label-tertiary, var(--dsapi-plus-tertiary));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        white-space: nowrap;
      }
      .dsapi-plus-refresh {
        appearance: none;
        box-sizing: border-box;
        border: none;
        border-radius: 18px;
        min-width: 72px;
        height: 36px;
        padding: 0 14px;
        background: var(--dsw-alias-button-primary-fill, #3964fe);
        color: var(--dsw-alias-label-primary-foreground, #fff);
        cursor: pointer;
        font: var(--dsw-font-s-14, 14px/22px inherit);
        font-weight: 500;
        transition: background-color var(--ds-transition-duration, 0.15s) var(--ds-ease-in-out, ease);
        -webkit-user-select: none;
        user-select: none;
      }
      .dsapi-plus-refresh:hover {
        background: var(--dsw-alias-button-primary-hover, #2f54e0);
      }
      .dsapi-plus-debug,
      .dsapi-plus-collapse {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--dsw-alias-label-secondary, var(--dsapi-plus-muted));
        cursor: pointer;
        font: var(--dsw-font-s-14, 14px/22px inherit);
        padding: 0;
        -webkit-user-select: none;
        user-select: none;
      }
      .dsapi-plus-debug:hover,
      .dsapi-plus-collapse:hover {
        color: var(--dsapi-plus-text);
      }
      .dsapi-plus-body {
        margin-top: 24px;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .dsapi-plus-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: 12px;
        margin: 0;
      }
      .dsapi-plus-summary-item {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 12px;
        flex: 1 1 220px;
        min-width: 0;
        min-height: 100px;
        margin: 0;
        padding: 16px 20px;
        background: var(--dsapi-plus-module);
        border-radius: 16px;
      }
      .dsapi-plus-summary-label {
        color: var(--dsapi-plus-text);
        font: var(--dsw-font-s-14, 14px/22px inherit);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dsapi-plus-summary-value-row {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 6px;
        min-width: 0;
      }
      .dsapi-plus-summary-value {
        margin: 0;
        color: var(--dsapi-plus-text);
        font-size: 29px;
        font-weight: 500;
        line-height: 36px;
        font-variant-numeric: tabular-nums;
        overflow-wrap: anywhere;
      }
      .dsapi-plus-summary-unit {
        color: var(--dsw-alias-label-caption, var(--dsapi-plus-caption));
        font-size: 16px;
        font-weight: 400;
        line-height: 24px;
        margin: 0;
      }
      .dsapi-plus-summary-detail {
        color: var(--dsw-alias-label-secondary, var(--dsapi-plus-muted));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        margin-top: -4px;
        white-space: pre-line;
      }
      .dsapi-plus-section {
        margin: 0;
      }
      .dsapi-plus-section-head {
        display: flex;
        align-items: baseline;
        justify-content: flex-start;
        gap: 12px;
        margin-bottom: 16px;
      }
      .dsapi-plus-section-title {
        color: var(--dsapi-plus-text);
        font: var(--dsw-font-base-strong-16, 500 16px/24px inherit);
        margin: 0;
      }
      .dsapi-plus-section-meta {
        color: var(--dsw-alias-label-secondary, var(--dsapi-plus-muted));
        font: var(--dsw-font-s-14, 14px/22px inherit);
      }
      .dsapi-plus-tagline {
        color: var(--dsw-alias-label-tertiary, var(--dsapi-plus-tertiary));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        margin: 4px 0 0;
      }
      .dsapi-plus-chart-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .dsapi-plus-chart-grid--core .dsapi-plus-chart-block:last-child {
        grid-column: 1 / -1;
      }
      .dsapi-plus-chart-block {
        box-sizing: border-box;
        min-width: 0;
        background: var(--dsapi-plus-module);
        border-radius: 16px;
        padding: 20px 20px 12px;
      }
      .dsapi-plus-extra {
        box-sizing: border-box;
        background: var(--dsapi-plus-module);
        border-radius: 16px;
        padding: 12px 16px 16px;
      }
      .dsapi-plus-extra > summary {
        cursor: pointer;
        list-style: none;
        color: var(--dsapi-plus-text);
        font: var(--dsw-font-s-strong-14, 500 14px/22px inherit);
        user-select: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .dsapi-plus-extra > summary::-webkit-details-marker {
        display: none;
      }
      .dsapi-plus-extra > summary::after {
        content: "展开";
        color: var(--dsw-alias-label-tertiary, var(--dsapi-plus-tertiary));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        font-weight: 400;
      }
      .dsapi-plus-extra[open] > summary::after {
        content: "收起";
      }
      .dsapi-plus-extra-body {
        margin-top: 12px;
      }
      .dsapi-plus-chart-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 6px 4px;
        min-width: 0;
        margin: 0 0 12px;
      }
      .dsapi-plus-chart-heading-title {
        color: var(--dsapi-plus-text);
        font: var(--dsw-font-s-strong-14, 500 14px/22px inherit);
        text-overflow: ellipsis;
        white-space: nowrap;
        overflow: hidden;
      }
      .dsapi-plus-chart-heading-value {
        color: var(--dsw-alias-label-secondary, var(--dsapi-plus-muted));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        font-variant-numeric: tabular-nums;
        word-break: keep-all;
        flex-shrink: 0;
      }
      .dsapi-plus-chart-frame {
        height: 200px;
        position: relative;
        -webkit-user-select: none;
        user-select: none;
      }
      .dsapi-plus-chart {
        width: 100%;
        height: 200px;
        -webkit-user-select: none;
        user-select: none;
      }
      .dsapi-plus-table-card {
        box-sizing: border-box;
        min-width: 0;
        background: var(--dsapi-plus-module);
        border-radius: 16px;
        padding: 12px 8px 8px;
        overflow: hidden;
      }
      .dsapi-plus-table-wrap {
        overflow-x: auto;
        border: 0;
        border-radius: 0;
      }
      .dsapi-plus-table {
        width: 100%;
        min-width: 680px;
        border-collapse: collapse;
        font: var(--dsw-font-s-14, 14px/22px inherit);
      }
      .dsapi-plus-table th,
      .dsapi-plus-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--dsapi-plus-border-soft);
        text-align: right;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
        color: var(--dsapi-plus-text);
      }
      .dsapi-plus-table th:first-child,
      .dsapi-plus-table td:first-child {
        max-width: 230px;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dsapi-plus-table th {
        color: var(--dsw-alias-label-tertiary, var(--dsapi-plus-tertiary));
        background: transparent;
        font-weight: 500;
      }
      .dsapi-plus-table tbody tr:hover td {
        background: var(--dsapi-plus-interactive);
      }
      .dsapi-plus-table tr:last-child td {
        border-bottom: 0;
      }
      .dsapi-plus-message {
        border: 1px solid var(--dsapi-plus-border-soft);
        border-radius: 16px;
        background: var(--dsapi-plus-module);
        color: var(--dsw-alias-label-secondary, var(--dsapi-plus-muted));
        font: var(--dsw-font-s-14, 14px/22px inherit);
        padding: 16px 20px;
      }
      .dsapi-plus-detail-layout {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(300px, 28%);
        gap: 12px;
        align-items: start;
      }
      .dsapi-plus-model-donut {
        box-sizing: border-box;
        min-width: 0;
        background: var(--dsapi-plus-module);
        border-radius: 16px;
        padding: 20px 20px 12px;
      }
      .dsapi-plus-model-donut .dsapi-plus-chart-heading {
        margin-bottom: 8px;
      }
      .dsapi-plus-model-donut .dsapi-plus-chart-frame {
        height: 220px;
      }
      .dsapi-plus-model-donut .dsapi-plus-chart {
        height: 220px;
      }
      .dsapi-plus-error {
        border-color: var(--dsw-alias-state-error-secondary, rgba(214, 69, 65, 0.28));
        color: var(--dsw-alias-state-error-primary, rgb(170, 49, 45));
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d64541) 6%, transparent);
      }
      @media (max-width: 920px) {
        .dsapi-plus-chart-grid {
          grid-template-columns: 1fr;
        }
        .dsapi-plus-chart-grid--core .dsapi-plus-chart-block:last-child {
          grid-column: auto;
        }
        .dsapi-plus-detail-layout {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 560px) {
        .dsapi-plus-head,
        .dsapi-plus-section-head,
        .dsapi-plus-actions {
          align-items: flex-start;
          flex-direction: column;
        }
        .dsapi-plus-summary-item {
          flex-basis: 100%;
        }
        .dsapi-plus-summary-value {
          font-size: 24px;
          line-height: 32px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function formatInteger(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(number);
  }

  function formatDecimal(value, digits = 4) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0";
    return new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(number);
  }

  function formatPercent(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return "0%";
    return `${formatDecimal(number * 100, 2)}%`;
  }

  function formatMoney(item) {
    if (!item) return "0";
    const currency = item.currency || "";
    const symbol = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
    return `${symbol}${formatDecimal(item.amount ?? item.balance ?? 0, 6)}${currency ? ` ${currency}` : ""}`;
  }

  function formatCnyValue(value, digits = 4) {
    return `¥${formatDecimal(value, digits)}`;
  }

  function formatCnyAmount(value, digits = 4) {
    return `${formatCnyValue(value, digits)} CNY`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getBizData(json) {
    const unwrapped = unwrapApiPayload(json);
    return parseMaybeJson(unwrapped);
  }

  function unwrapApiPayload(value) {
    let current = parseMaybeJson(value);
    const seen = new Set();

    for (let i = 0; i < 8; i += 1) {
      current = parseMaybeJson(current);
      if (!current || typeof current !== "object" || seen.has(current)) return current;
      seen.add(current);

      if (Object.prototype.hasOwnProperty.call(current, "biz_data")) {
        current = current.biz_data;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, "bizData")) {
        current = current.bizData;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, "data")) {
        const data = parseMaybeJson(current.data);
        if (data && typeof data === "object") {
          current = data;
          continue;
        }
      }
      if (Object.prototype.hasOwnProperty.call(current, "result")) {
        current = current.result;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(current, "payload")) {
        current = current.payload;
        continue;
      }

      return current;
    }

    return current;
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed || !/^[{[]/.test(trimmed)) return value;
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      return value;
    }
  }

  async function fetchJson(path, signal) {
    const { token, source } = getStoredAuthToken();
    state.tokenSource = source;
    const headers = { accept: "application/json, text/plain, */*" };
    const appVersion = document.querySelector('meta[name="commit-id"]')?.content;

    if (appVersion) headers["X-App-Version"] = appVersion;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(path, {
      credentials: "include",
      headers,
      signal,
    });

    let json = null;
    try {
      json = await response.json();
    } catch (error) {
      throw new Error(`接口返回不是 JSON：${path}`);
    }

    if (!response.ok) {
      const message = json?.message || json?.msg || response.statusText || "请求失败";
      throw new Error(`${response.status} ${message}`);
    }

    const businessCode = json?.code ?? json?.status_code ?? json?.status;
    if (
      businessCode != null &&
      ![0, 200, "0", "200", "success", "SUCCESS", true].includes(businessCode)
    ) {
      const message = json?.message || json?.msg || json?.error_msg || "业务接口返回失败";
      throw new Error(`${businessCode} ${message}`);
    }

    return json;
  }

  function getStoredAuthToken() {
    const candidates = [];

    collectTokenCandidates(candidates, "localStorage", window.localStorage);
    collectTokenCandidates(candidates, "sessionStorage", window.sessionStorage);

    candidates.sort((a, b) => b.score - a.score || b.token.length - a.token.length);
    const best = candidates[0];
    return best ? { token: best.token, source: best.source } : { token: "", source: "none" };
  }

  function collectTokenCandidates(candidates, storageName, storage) {
    if (!storage) return;

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;

      let raw = "";
      try {
        raw = storage.getItem(key) || "";
      } catch (error) {
        continue;
      }

      const loweredKey = key.toLowerCase();
      if (!loweredKey.includes("token") && loweredKey !== "usertoken") continue;
      if (/(hcaptcha|captcha|turnstile|apdid|csrf|xsrf|apple|google)/i.test(key)) continue;

      const parsed = parseMaybeJson(raw);
      const exactKeyScore = loweredKey === "usertoken" ? 100 : 0;
      findTokenStrings(parsed, `${storageName}.${key}`, exactKeyScore, candidates);
    }
  }

  function findTokenStrings(value, source, baseScore, candidates, depth = 0) {
    if (depth > 6 || value == null) return;

    if (typeof value === "string") {
      const token = normalizeTokenString(value);
      if (looksLikeAuthToken(token)) {
        candidates.push({ token, source, score: baseScore + scoreTokenSource(source, token) });
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, index) => findTokenStrings(item, `${source}[${index}]`, baseScore, candidates, depth + 1));
      return;
    }

    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const keyScore = /^(token|userToken|access_token|accessToken)$/i.test(key) ? 80 : 0;
        findTokenStrings(child, `${source}.${key}`, baseScore + keyScore, candidates, depth + 1);
      }
    }
  }

  function normalizeTokenString(value) {
    return String(value || "")
      .trim()
      .replace(/^Bearer\s+/i, "")
      .replace(/^"|"$/g, "");
  }

  function looksLikeAuthToken(value) {
    if (!value || value === "null" || value === "undefined") return false;
    if (value.length < 16 || value.length > 4096) return false;
    if (/\s/.test(value)) return false;
    return /^[A-Za-z0-9._~+/=-]+$/.test(value);
  }

  function scoreTokenSource(source, token) {
    let score = 0;
    if (/userToken/i.test(source)) score += 80;
    if (/access[_-]?token|token$/i.test(source)) score += 40;
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) score += 20;
    return score;
  }

  function formatUtcYmd(date) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseUtcYmd(ymd) {
    const matched = String(ymd || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!matched) return null;
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  function ymdToStartSec(ymd) {
    const date = parseUtcYmd(ymd);
    if (!date) return 0;
    return Math.floor(date.getTime() / 1000);
  }

  function ymdToEndSecExclusive(ymd) {
    return ymdToStartSec(ymd) + 86400;
  }

  function utcToday(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  function addUtcDays(date, days) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
  }

  function resolvePresetRange(preset, now = new Date()) {
    const today = utcToday(now);
    switch (preset) {
      case "today":
        return { startDate: formatUtcYmd(today), endDate: formatUtcYmd(today) };
      case "yesterday": {
        const day = addUtcDays(today, -1);
        return { startDate: formatUtcYmd(day), endDate: formatUtcYmd(day) };
      }
      case "last7Days":
        return { startDate: formatUtcYmd(addUtcDays(today, -6)), endDate: formatUtcYmd(today) };
      case "last30Days":
        return { startDate: formatUtcYmd(addUtcDays(today, -29)), endDate: formatUtcYmd(today) };
      case "thisMonth":
        return {
          startDate: formatUtcYmd(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))),
          endDate: formatUtcYmd(today),
        };
      case "lastMonth": {
        const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
        const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
        return { startDate: formatUtcYmd(start), endDate: formatUtcYmd(end) };
      }
      default:
        return resolvePresetRange("last30Days", now);
    }
  }

  function presetLabel(preset) {
    const item = DATE_PRESET_LABELS[preset] || DATE_PRESET_LABELS.custom;
    return item.zh;
  }

  function buildRange({ preset = "custom", startDate, endDate, label }) {
    const start = startDate;
    const end = endDate || startDate;
    const key = `${preset}:${start}:${end}`;
    return {
      preset,
      startDate: start,
      endDate: end,
      label: label || presetLabel(preset),
      key,
      startSec: ymdToStartSec(start),
      endSec: ymdToEndSecExclusive(end),
    };
  }

  function rangeFromPreset(preset, now = new Date()) {
    const { startDate, endDate } = resolvePresetRange(preset, now);
    return buildRange({ preset, startDate, endDate, label: presetLabel(preset) });
  }

  function formatRangeSubtitle(range) {
    if (!range) return "UTC";
    if (range.startDate === range.endDate) {
      return `${range.label} · ${range.startDate} UTC`;
    }
    return `${range.label} · ${range.startDate} ~ ${range.endDate} UTC`;
  }

  function normalizeFilterText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function matchPresetFromLabel(text) {
    const value = normalizeFilterText(text).toLowerCase();
    if (!value) return null;

    const rules = [
      { preset: "today", patterns: ["今天", "today"] },
      { preset: "yesterday", patterns: ["昨天", "yesterday"] },
      { preset: "last7Days", patterns: ["近 7 天", "近7天", "last 7 days", "last7days"] },
      { preset: "last30Days", patterns: ["近 30 天", "近30天", "last 30 days", "last30days"] },
      { preset: "thisMonth", patterns: ["本月", "this month"] },
      { preset: "lastMonth", patterns: ["上月", "last month"] },
      { preset: "custom", patterns: ["自定义", "custom"] },
    ];

    for (const rule of rules) {
      if (rule.patterns.some((pattern) => value === pattern.toLowerCase() || value.includes(pattern.toLowerCase()))) {
        return rule.preset;
      }
    }
    return null;
  }

  function parseCustomDateRangeText(text) {
    const value = normalizeFilterText(text);
    if (!value) return null;

    const isoPairs = value.match(/(\d{4}-\d{1,2}-\d{1,2})/g);
    if (isoPairs && isoPairs.length >= 2) {
      return finalizeCustomRange(isoPairs[0], isoPairs[1]);
    }
    if (isoPairs && isoPairs.length === 1 && !/[~～至到\-]/.test(value.replace(isoPairs[0], ""))) {
      return finalizeCustomRange(isoPairs[0], isoPairs[0]);
    }

    const slashPairs = [...value.matchAll(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/g)].map((match) => (
      `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`
    ));
    if (slashPairs.length >= 2) {
      return finalizeCustomRange(slashPairs[0], slashPairs[1]);
    }

    return null;
  }

  function finalizeCustomRange(startRaw, endRaw) {
    const start = parseUtcYmd(normalizeLooseYmd(startRaw));
    const end = parseUtcYmd(normalizeLooseYmd(endRaw));
    if (!start || !end || end < start) return null;
    const days = Math.round((end - start) / 86400000) + 1;
    if (days > 31) return null;
    return buildRange({
      preset: "custom",
      startDate: formatUtcYmd(start),
      endDate: formatUtcYmd(end),
      label: DATE_PRESET_LABELS.custom.zh,
    });
  }

  function normalizeLooseYmd(value) {
    const matched = String(value || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!matched) return value;
    return `${matched[1]}-${String(matched[2]).padStart(2, "0")}-${String(matched[3]).padStart(2, "0")}`;
  }

  function readOfficialTimeFilterLabel() {
    const root = document.querySelector("#usage-board") || document.querySelector("main") || document.body;
    if (!root) return "";

    const nodes = Array.from(root.querySelectorAll("span, div, button, [role='button']"));
    for (const node of nodes) {
      if (node.closest(`#${PANEL_ID}`)) continue;
      const text = normalizeFilterText(node.textContent);
      if (text !== "时间维度" && text.toLowerCase() !== "time range" && text.toLowerCase() !== "date range") {
        continue;
      }

      const row = node.closest("[role='button']") || node.parentElement;
      if (!row) continue;
      const parts = Array.from(row.querySelectorAll("span, div"))
        .map((el) => normalizeFilterText(el.textContent))
        .filter(Boolean);
      const label = parts.find((part) => (
        part !== "时间维度" &&
        part.toLowerCase() !== "time range" &&
        part.toLowerCase() !== "date range" &&
        part.length < 80
      ));
      if (label) return label;
    }

    // 回退：找筛选胶囊中的已知预设文案
    const board = document.querySelector("#usage-board") || root;
    const candidates = Array.from(board.querySelectorAll("[role='button'] span, [role='button'] div"));
    for (const el of candidates) {
      if (el.closest(`#${PANEL_ID}`)) continue;
      const text = normalizeFilterText(el.textContent);
      if (matchPresetFromLabel(text) || parseCustomDateRangeText(text)) return text;
    }
    return "";
  }

  function getSelectedRange() {
    const officialLabel = readOfficialTimeFilterLabel();
    if (officialLabel) {
      const preset = matchPresetFromLabel(officialLabel);
      if (preset && preset !== "custom") {
        return rangeFromPreset(preset);
      }
      const custom = parseCustomDateRangeText(officialLabel);
      if (custom) return custom;
      if (preset === "custom") {
        const fallbackCustom = parseCustomDateRangeText(officialLabel);
        if (fallbackCustom) return fallbackCustom;
      }
    }

    // 兼容旧版月份 select
    const selects = Array.from(document.querySelectorAll("select"));
    for (const select of selects) {
      const value = select.value || select.selectedOptions?.[0]?.value || "";
      const matched = String(value).match(/^(\d{4})-(\d{1,2})$/);
      if (!matched) continue;
      const year = Number(matched[1]);
      const month = Number(matched[2]);
      const start = new Date(Date.UTC(year, month - 1, 1));
      const end = new Date(Date.UTC(year, month, 0));
      return buildRange({
        preset: "custom",
        startDate: formatUtcYmd(start),
        endDate: formatUtcYmd(end),
        label: `${year}-${month}`,
      });
    }

    return rangeFromPreset("last30Days");
  }

  async function loadData(range, signal) {
    const query = `start=${encodeURIComponent(range.startSec)}&end=${encodeURIComponent(range.endSec)}&tz=0`;
    const [summaryJson, amountJson, costJson] = await Promise.all([
      fetchJson("/api/v0/users/get_user_summary", signal),
      fetchJson(`/api/v0/usage/by_api_key/amount?${query}`, signal),
      fetchJson(`/api/v0/usage/by_api_key/cost?${query}`, signal),
    ]);

    return {
      range,
      period: range.key,
      rangeLabel: formatRangeSubtitle(range),
      summary: normalizeSummary(getBizData(summaryJson)),
      amount: normalizeAmount(getBizData(amountJson)),
      cost: normalizeCost(getBizData(costJson)),
      debug: {
        auth: { tokenFound: state.tokenSource !== "none", tokenSource: state.tokenSource },
        range,
        summary: summarizeShape(summaryJson),
        amount: summarizeShape(amountJson),
        cost: summarizeShape(costJson),
      },
    };
  }

  function normalizeSummary(raw) {
    const data = findObjectWithKeys(raw, [
      "current_token",
      "currentToken",
      "total_usage",
      "totalUsage",
      "monthly_usage",
      "monthlyUsage",
      "normal_wallets",
      "normalWallets",
    ]) || {};
    return {
      currentToken: firstValue(data, ["current_token", "currentToken"]) ?? 0,
      totalUsage: firstValue(data, ["total_usage", "totalUsage"]) ?? 0,
      monthlyUsage: firstValue(data, ["monthly_usage", "monthlyUsage"]) ?? 0,
      totalAvailableTokenEstimation:
        firstValue(data, ["total_available_token_estimation", "totalAvailableTokenEstimation"]) ?? 0,
      monthlyCosts: asArray(firstValue(data, ["monthly_costs", "monthlyCosts"])),
      normalWallets: asArray(firstValue(data, ["normal_wallets", "normalWallets"])),
      bonusWallets: asArray(firstValue(data, ["bonus_wallets", "bonusWallets"])),
    };
  }

  function emptyAggregate() {
    return { request: 0, response: 0, promptMiss: 0, promptHit: 0, tokens: 0 };
  }

  function addAggregates(a, b) {
    return {
      request: a.request + b.request,
      response: a.response + b.response,
      promptMiss: a.promptMiss + b.promptMiss,
      promptHit: a.promptHit + b.promptHit,
      tokens: a.tokens + b.tokens,
    };
  }

  function normalizeAmount(raw) {
    const data =
      findObjectWithKeys(raw, ["series", "bucket", "start", "end"]) ||
      findUsageDataObject(raw) ||
      {};

    if (Array.isArray(data.series)) {
      return normalizeAmountFromByApiKey(data);
    }

    const totals = asArray(firstValue(data, ["total", "totals", "models", "model_usage", "modelUsage"]));
    const days = asArray(firstValue(data, ["days", "daily", "daily_usage", "dailyUsage"]));
    const models = totals.map((item) => normalizeModelUsage(getModelName(item), getUsageList(item)));
    const aggregate = models.reduce((sum, model) => addAggregates(sum, model), emptyAggregate());

    return {
      raw: data,
      models,
      days: normalizeDailyUsage(days),
      aggregate,
    };
  }

  function normalizeAmountFromByApiKey(data) {
    const series = asArray(data.series);
    const modelMap = new Map();
    const dayMap = new Map();

    for (const item of series) {
      const modelName = getModelName(item);
      const buckets = asArray(firstValue(item, ["buckets", "bucket", "data"]));
      for (const bucket of buckets) {
        const usage = firstValue(bucket, ["usage", "usages"]) ?? bucket;
        const modelUsage = normalizeModelUsage(modelName, usage);
        const date = bucketTimeToDate(firstValue(bucket, ["time", "date", "day", "timestamp"]));

        const prevModel = modelMap.get(modelName) || emptyModelUsage(modelName);
        modelMap.set(modelName, mergeModelUsage(prevModel, modelUsage));

        if (!date) continue;
        const day = dayMap.get(date) || {
          date,
          models: new Map(),
          ...emptyAggregate(),
        };
        const dayModelPrev = day.models.get(modelName) || emptyModelUsage(modelName);
        day.models.set(modelName, mergeModelUsage(dayModelPrev, modelUsage));
        Object.assign(day, addAggregates(day, modelUsage));
        dayMap.set(date, day);
      }
    }

    // 若 series 为空，尝试 models 汇总字段
    if (!modelMap.size) {
      for (const item of asArray(data.models)) {
        const modelUsage = normalizeModelUsage(getModelName(item), getUsageList(item).length ? getUsageList(item) : item);
        modelMap.set(modelUsage.model, mergeModelUsage(modelMap.get(modelUsage.model) || emptyModelUsage(modelUsage.model), modelUsage));
      }
    }

    const models = Array.from(modelMap.values());
    const days = Array.from(dayMap.values())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map((day) => ({
        date: day.date,
        models: Array.from(day.models.values()),
        request: day.request,
        response: day.response,
        promptMiss: day.promptMiss,
        promptHit: day.promptHit,
        tokens: day.tokens,
      }));

    return {
      raw: data,
      models,
      days,
      aggregate: models.reduce((sum, model) => addAggregates(sum, model), emptyAggregate()),
    };
  }

  function emptyModelUsage(model) {
    return {
      model: model || "unknown",
      request: 0,
      response: 0,
      promptMiss: 0,
      promptHit: 0,
      promptTotal: 0,
      tokens: 0,
      cacheHitRate: 0,
    };
  }

  function mergeModelUsage(a, b) {
    const request = a.request + b.request;
    const response = a.response + b.response;
    const promptMiss = a.promptMiss + b.promptMiss;
    const promptHit = a.promptHit + b.promptHit;
    const promptTotal = promptMiss + promptHit;
    const tokens = response + promptMiss + promptHit;
    return {
      model: a.model || b.model || "unknown",
      request,
      response,
      promptMiss,
      promptHit,
      promptTotal,
      tokens,
      cacheHitRate: promptTotal > 0 ? promptHit / promptTotal : 0,
    };
  }

  function bucketTimeToDate(time) {
    if (time == null || time === "") return "";
    if (typeof time === "string") {
      if (/^\d{4}-\d{1,2}-\d{1,2}/.test(time)) {
        return normalizeLooseYmd(time.slice(0, 10));
      }
      const asNumber = Number(time);
      if (Number.isFinite(asNumber)) return bucketTimeToDate(asNumber);
      return time;
    }
    const number = Number(time);
    if (!Number.isFinite(number)) return String(time);
    const ms = number > 1e12 ? number : number * 1000;
    return formatUtcYmd(new Date(ms));
  }

  function normalizeDailyUsage(days) {
    return days.map((day, index) => {
      const data = asArray(firstValue(day, ["data", "models", "usage", "usages"]));
      const aggregate = data.reduce(
        (sum, item) => {
          const model = normalizeModelUsage(getModelName(item), getUsageList(item));
          return {
            request: sum.request + model.request,
            response: sum.response + model.response,
            promptMiss: sum.promptMiss + model.promptMiss,
            promptHit: sum.promptHit + model.promptHit,
            tokens: sum.tokens + model.tokens,
          };
        },
        { request: 0, response: 0, promptMiss: 0, promptHit: 0, tokens: 0 }
      );

      return {
        date: firstValue(day, ["date", "day"]) || String(index + 1),
        models: data.map((item) => normalizeModelUsage(getModelName(item), getUsageList(item))),
        ...aggregate,
      };
    });
  }

  function normalizeModelUsage(model, usage) {
    const usageMap = usageToMap(usage);
    const request = pickUsageValue(usageMap, [TOKEN_TYPES.request, "request", "REQUEST"]);
    const response = pickUsageValue(usageMap, [TOKEN_TYPES.response, "responseToken", "response_token", "RESPONSE_TOKEN", "response"]);
    const promptMiss = pickUsageValue(usageMap, [TOKEN_TYPES.promptMiss, "promptCacheMissToken", "prompt_cache_miss_token", "PROMPT_CACHE_MISS_TOKEN"]);
    const promptHit = pickUsageValue(usageMap, [TOKEN_TYPES.promptHit, "promptCacheHitToken", "prompt_cache_hit_token", "PROMPT_CACHE_HIT_TOKEN"]);
    const promptTotal = promptMiss + promptHit;
    const tokens = response + promptMiss + promptHit;

    return {
      model: model || "unknown",
      request,
      response,
      promptMiss,
      promptHit,
      promptTotal,
      tokens,
      cacheHitRate: promptTotal > 0 ? promptHit / promptTotal : 0,
    };
  }

  function pickUsageValue(map, keys) {
    for (const key of keys) {
      if (map[key] != null && map[key] !== "") return Number(map[key]) || 0;
    }
    return 0;
  }

  function usageToMap(usage) {
    const map = {};
    if (Array.isArray(usage)) {
      for (const item of usage) {
        const type = firstValue(item, ["type", "usage_type", "usageType", "name", "key"]);
        if (!type) continue;
        map[type] = Number(firstValue(item, ["amount", "value", "count", "total"]) || 0);
      }
      return map;
    }
    if (!usage || typeof usage !== "object") return map;
    for (const [key, value] of Object.entries(usage)) {
      if (value && typeof value === "object" && !Array.isArray(value)) continue;
      const number = Number(value);
      if (Number.isFinite(number)) map[key] = number;
    }
    return map;
  }

  function normalizeCost(raw) {
    const root =
      findObjectWithKeys(raw, ["data", "series", "bucket", "start", "end"]) ||
      findUsageDataObject(raw) ||
      raw ||
      {};
    const list = Array.isArray(raw)
      ? raw
      : asArray(firstValue(root, ["cost", "costs", "currencies", "data"]));

    if (list.some(isByApiKeyCostBlock)) {
      return list.filter(isByApiKeyCostBlock).map(normalizeCostBlockFromSeries);
    }

    return list.map((currencyBlock) => {
      const total = asArray(firstValue(currencyBlock, ["total", "totals", "models", "model_cost", "modelCost"]));
      const days = normalizeDailyCostData(
        asArray(firstValue(currencyBlock, ["days", "daily", "daily_cost", "dailyCost"]))
      );
      const modelCosts = total.map((item) => {
        const usage = getUsageList(item);
        const usageCostMap = usageToMap(usage);
        const amount = usage.length
          ? usage.reduce((sum, usageItem) => sum + Number(firstValue(usageItem, ["amount", "value", "cost"]) || 0), 0)
          : Number(firstValue(item, ["amount", "value", "cost"]) || 0);
        return { model: getModelName(item), amount, usageCostMap };
      });
      const amount = modelCosts.reduce((sum, item) => sum + item.amount, 0);

      return {
        currency: firstValue(currencyBlock, ["currency", "currency_code", "currencyCode"]) || "",
        amount,
        modelCosts,
        days,
      };
    });
  }

  function isByApiKeyCostBlock(block) {
    if (!block || typeof block !== "object") return false;
    const series = asArray(firstValue(block, ["series"]));
    if (!series.length) return false;
    return series.some((item) => (
      firstValue(item, ["model", "model_name", "modelName"]) != null ||
      asArray(firstValue(item, ["buckets", "bucket"])).length > 0
    ));
  }

  function normalizeCostBlockFromSeries(currencyBlock) {
    const series = asArray(firstValue(currencyBlock, ["series"]));
    const modelMap = new Map();
    const dayMap = new Map();

    for (const item of series) {
      const modelName = getModelName(item);
      const buckets = asArray(firstValue(item, ["buckets", "bucket", "data"]));
      for (const bucket of buckets) {
        const extracted = extractBucketCost(firstValue(bucket, ["cost", "amount", "value"]) ?? bucket);
        const date = bucketTimeToDate(firstValue(bucket, ["time", "date", "day", "timestamp"]));

        const prev = modelMap.get(modelName) || { model: modelName, amount: 0, usageCostMap: {} };
        prev.amount += extracted.amount;
        prev.usageCostMap = mergeUsageCostMap(prev.usageCostMap, extracted.usageCostMap);
        modelMap.set(modelName, prev);

        if (!date) continue;
        dayMap.set(date, (dayMap.get(date) || 0) + extracted.amount);
      }
    }

    const modelCosts = Array.from(modelMap.values());
    const amount = modelCosts.reduce((sum, item) => sum + item.amount, 0);
    const days = Array.from(dayMap.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([date, dayAmount]) => ({ date, amount: dayAmount }));

    return {
      currency: firstValue(currencyBlock, ["currency", "currency_code", "currencyCode"]) || "",
      amount,
      modelCosts,
      days,
    };
  }

  function extractBucketCost(cost) {
    if (cost == null) return { amount: 0, usageCostMap: {} };
    if (typeof cost === "number" || typeof cost === "string") {
      return { amount: Number(cost) || 0, usageCostMap: {} };
    }
    if (typeof cost !== "object") return { amount: 0, usageCostMap: {} };

    const direct = firstValue(cost, ["amount", "value", "cost", "total"]);
    if (direct != null && (typeof direct === "number" || typeof direct === "string")) {
      const usageCostMap = usageToMap(cost);
      const amount = Number(direct) || 0;
      return { amount, usageCostMap };
    }

    const usageCostMap = usageToMap(cost);
    const amount = Object.values(usageCostMap).reduce((sum, value) => sum + (Number(value) || 0), 0);
    return { amount, usageCostMap };
  }

  function mergeUsageCostMap(a, b) {
    const result = { ...a };
    for (const [key, value] of Object.entries(b || {})) {
      result[key] = (Number(result[key]) || 0) + (Number(value) || 0);
    }
    return result;
  }

  function normalizeDailyCostData(days) {
    return days.map((day) => {
      const date = firstValue(day, ["date", "day"]) || "";
      let amount = Number(firstValue(day, ["amount", "value", "cost", "total"]) || 0);

      if (!amount) {
        const models = asArray(firstValue(day, ["models", "data", "costs", "model_cost", "modelCost"]));
        amount = models.reduce((sum, model) => {
          const usage = getUsageList(model);
          if (usage.length) {
            return sum + usage.reduce((s, u) => s + Number(firstValue(u, ["amount", "value", "cost"]) || 0), 0);
          }
          return sum + Number(firstValue(model, ["amount", "value", "cost"]) || 0);
        }, 0);
      }

      return { date, amount };
    });
  }

  function findUsageDataObject(raw) {
    return findObjectWithKeys(raw, ["total", "totals", "days", "daily", "models", "model_usage", "modelUsage"]);
  }

  function findObjectWithKeys(value, keys) {
    const root = parseMaybeJson(value);
    const queue = [root];
    const seen = new Set();

    while (queue.length) {
      const current = parseMaybeJson(queue.shift());
      if (!current || typeof current !== "object" || seen.has(current)) continue;
      seen.add(current);

      if (!Array.isArray(current) && keys.some((key) => Object.prototype.hasOwnProperty.call(current, key))) {
        return current;
      }

      const children = Array.isArray(current) ? current : Object.values(current);
      for (const child of children) {
        if (child && (typeof child === "object" || typeof child === "string")) queue.push(child);
      }
    }

    return null;
  }

  function firstValue(object, keys) {
    if (!object || typeof object !== "object") return undefined;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
    }
    return undefined;
  }

  function asArray(value) {
    const parsed = parseMaybeJson(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return Object.values(parsed);
    return [];
  }

  function getModelName(item) {
    return firstValue(item, ["model", "model_name", "modelName", "name", "id"]) || "unknown";
  }

  function getUsageList(item) {
    return asArray(firstValue(item, ["usage", "usages", "amounts", "values", "data"]));
  }

  function summarizeShape(value, depth = 0) {
    const parsed = parseMaybeJson(value);
    if (depth > 2) return "...";
    if (Array.isArray(parsed)) {
      return {
        type: "array",
        length: parsed.length,
        first: parsed.length ? summarizeShape(parsed[0], depth + 1) : null,
      };
    }
    if (!parsed || typeof parsed !== "object") return { type: typeof parsed };
    const keys = Object.keys(parsed);
    const result = { type: "object", keys: keys.slice(0, 20) };
    for (const key of keys.slice(0, 6)) result[key] = summarizeShape(parsed[key], depth + 1);
    return result;
  }

  function renderPanelHeadActions(statusText, refreshLabel = "刷新") {
    return `
      <div class="dsapi-plus-actions">
        <span class="dsapi-plus-status">${escapeHtml(statusText)}</span>
        <button type="button" class="dsapi-plus-collapse" aria-expanded="true">收起</button>
        <button type="button" class="dsapi-plus-debug">调试数据</button>
        <button type="button" class="dsapi-plus-refresh">${escapeHtml(refreshLabel)}</button>
      </div>
    `;
  }

  function renderSkeleton(panel, range) {
    const subtitleText = formatRangeSubtitle(range);
    if (state.charts.length > 0) {
      const subtitle = panel.querySelector(".dsapi-plus-subtitle");
      const status = panel.querySelector(".dsapi-plus-status");
      if (subtitle) subtitle.textContent = subtitleText;
      if (status) status.textContent = "加载中...";
      const banner = panel.querySelector(".dsapi-plus-error-banner");
      if (banner) banner.remove();
      applyCollapsedState(panel);
      return;
    }

    disposeCharts();
    panel.innerHTML = `
      <div class="dsapi-plus-head">
        <div class="dsapi-plus-title">
          <strong>扩展分析</strong>
          <span class="dsapi-plus-subtitle">${escapeHtml(subtitleText)}</span>
        </div>
        ${renderPanelHeadActions("加载中...")}
      </div>
      <div class="dsapi-plus-message">正在读取 DeepSeek 用量接口。</div>
    `;
    bindPanelControls(panel);
  }

  function errorBannerHTML(message, isAuth) {
    return `
      <div class="dsapi-plus-message dsapi-plus-error dsapi-plus-error-banner">
        ${
          isAuth
            ? "当前脚本没有读到 DeepSeek 登录 token，或 token 已失效。请确认脚本运行在 https://platform.deepseek.com/usage 页面并已登录。"
            : "接口读取失败。"
        }
        <br>${escapeHtml(message)}
      </div>
    `;
  }

  function renderError(panel, range, error) {
    const message = String(error?.message || error || "未知错误");
    const isAuth = /\b(401|403|40002)\b|missing token/i.test(message);
    const subtitleText = formatRangeSubtitle(range);
    panel.__dsapiPlusDebug = {
      auth: { tokenFound: state.tokenSource !== "none", tokenSource: state.tokenSource },
      range,
      error: message,
    };

    if (state.charts.length > 0) {
      const subtitle = panel.querySelector(".dsapi-plus-subtitle");
      const status = panel.querySelector(".dsapi-plus-status");
      if (subtitle) subtitle.textContent = subtitleText;
      if (status) status.textContent = "加载失败";
      const existing = panel.querySelector(".dsapi-plus-error-banner");
      if (existing) existing.remove();
      const body = panel.querySelector(".dsapi-plus-body");
      if (body) {
        body.insertAdjacentHTML("afterbegin", errorBannerHTML(message, isAuth));
      }
      applyCollapsedState(panel);
      return;
    }

    disposeCharts();
    panel.innerHTML = `
      <div class="dsapi-plus-head">
        <div class="dsapi-plus-title">
          <strong>扩展分析</strong>
          <span class="dsapi-plus-subtitle">${escapeHtml(subtitleText)}</span>
        </div>
        ${renderPanelHeadActions("加载失败", "重试")}
      </div>
      ${errorBannerHTML(message, isAuth)}
    `;
    bindPanelControls(panel);
  }

  function buildPanelData(data) {
    const { range, period, rangeLabel, summary, amount, cost } = data;
    const monthlyCostText = summary.monthlyCosts.length
      ? summary.monthlyCosts.map(formatMoney).join(" + ")
      : "0";
    const monthCostText = cost.length ? cost.map(formatMoney).join(" + ") : "0";
    const sortedModels = amount.models.slice().sort((a, b) => b.tokens - a.tokens || b.request - a.request);
    const tokenTotal = amount.aggregate.tokens;
    const monthCnyCost = sumCurrencyAmount(cost, "CNY", "amount");
    const monthlyCnyCost = sumCurrencyAmount(summary.monthlyCosts, "CNY", "amount");
    const cnyCostBreakdown = getCostBreakdown(cost, "CNY");
    const walletCnyBalance =
      sumCurrencyAmount(summary.normalWallets, "CNY", "balance") +
      sumCurrencyAmount(summary.bonusWallets, "CNY", "balance");
    const averageCostPerMillion = computeAverageCostPerMillion({
      preferredCost: monthCnyCost,
      preferredTokens: tokenTotal,
      fallbackCost: monthlyCnyCost,
      fallbackTokens: Number(summary.monthlyUsage || 0),
    });
    const averageInputCostPerMillion = computeAverageCostPerMillion({
      preferredCost: cnyCostBreakdown.input,
      preferredTokens: amount.aggregate.promptMiss + amount.aggregate.promptHit,
      fallbackCost: monthCnyCost || monthlyCnyCost,
      fallbackTokens: tokenTotal || Number(summary.monthlyUsage || 0),
    });
    const averageOutputCostPerMillion = computeAverageCostPerMillion({
      preferredCost: cnyCostBreakdown.output,
      preferredTokens: amount.aggregate.response,
      fallbackCost: monthCnyCost || monthlyCnyCost,
      fallbackTokens: tokenTotal || Number(summary.monthlyUsage || 0),
    });
    const estimatedAvailableTokens = averageCostPerMillion > 0
      ? Math.floor(walletCnyBalance / averageCostPerMillion * 1000000)
      : 0;
    const averageCostDetail = `输入 ${formatCnyAmount(averageInputCostPerMillion)} /1M\n输出 ${formatCnyAmount(averageOutputCostPerMillion)} /1M`;

    const daysArr = amount.days;
    const now = new Date();
    const todayYmd = formatUtcYmd(now);
    const todayDay = now.getUTCDate();
    let today = daysArr.find((day) => bucketTimeToDate(day.date) === todayYmd) || null;
    if (!today) {
      // 兼容仅有日号的旧数据
      today = daysArr.find((day) => {
        const match = String(day.date || "").match(/(\d{1,2})$/);
        return match && Number(match[1]) === todayDay && String(day.date).length <= 2;
      }) || null;
    }
    if (!today) {
      for (let i = daysArr.length - 1; i >= 0; i--) {
        if (daysArr[i].tokens > 0 || daysArr[i].request > 0) {
          today = daysArr[i];
          break;
        }
      }
      if (!today) today = daysArr.length ? daysArr[daysArr.length - 1] : null;
    }
    // 从 cost API 每日数据中获取今天的实际消费金额
    let todayActualCost = 0;
    for (const costBlock of cost) {
      if (costBlock.currency !== "CNY") continue;
      for (const dayCost of (costBlock.days || [])) {
        const dayDate = bucketTimeToDate(dayCost.date);
        if (dayDate === todayYmd) {
          todayActualCost += (dayCost.amount || 0);
          continue;
        }
        const match = String(dayCost.date || "").match(/(\d{1,2})$/);
        if (match && Number(match[1]) === todayDay && String(dayCost.date).length <= 2) {
          todayActualCost += (dayCost.amount || 0);
        }
      }
    }

    const todayInputTokens = today ? (today.promptMiss || 0) + (today.promptHit || 0) : 0;
    const todayOutputTokens = today ? (today.response || 0) : 0;
    // 先用均价估算作为基准
    const todayInputCostEstimated = averageInputCostPerMillion > 0 ? averageInputCostPerMillion * todayInputTokens / 1000000 : 0;
    const todayOutputCostEstimated = averageOutputCostPerMillion > 0 ? averageOutputCostPerMillion * todayOutputTokens / 1000000 : 0;
    const todayTotalCostEstimated = todayInputCostEstimated + todayOutputCostEstimated;

    // 优先使用 cost API 的实际每日数据，估算值作为 fallback
    let todayTotalCost, todayInputCost, todayOutputCost;
    if (todayActualCost > 0) {
      todayTotalCost = todayActualCost;
      // 按实际总额等比缩放输入/输出估算值以保持细分一致
      if (todayTotalCostEstimated > 0) {
        const scale = todayActualCost / todayTotalCostEstimated;
        todayInputCost = todayInputCostEstimated * scale;
        todayOutputCost = todayOutputCostEstimated * scale;
      } else {
        todayInputCost = 0;
        todayOutputCost = 0;
      }
    } else {
      todayTotalCost = todayTotalCostEstimated;
      todayInputCost = todayInputCostEstimated;
      todayOutputCost = todayOutputCostEstimated;
    }

    const todayCostText = formatCnyAmount(todayTotalCost);
    const todayCostDetail = `输入 ${formatCnyAmount(todayInputCost)}\n输出 ${formatCnyAmount(todayOutputCost)}`;
    const costDetail = (cnyCostBreakdown.input || cnyCostBreakdown.output)
      ? `输入 ${formatCnyAmount(cnyCostBreakdown.input)}\n输出 ${formatCnyAmount(cnyCostBreakdown.output)}`
      : "";
    const usageInput = amount.aggregate.promptMiss + amount.aggregate.promptHit;
    const usageOutput = amount.aggregate.response;
    const usageDetail = `输出 ${formatInteger(usageOutput)} tokens`;
    const cacheRateValue = cacheHitRate(amount.aggregate);
    const cacheDetail = `命中 ${formatInteger(amount.aggregate.promptHit)}\n未命中 ${formatInteger(amount.aggregate.promptMiss)}`;
    const extraChartsOpen = isExtraChartsOpen();

    const updateTime = new Date().toLocaleTimeString("zh-CN");
    const resolvedRangeLabel = rangeLabel || formatRangeSubtitle(range);

    const html = `
      <div class="dsapi-plus-head">
        <div class="dsapi-plus-title">
          <strong>扩展分析</strong>
          <span class="dsapi-plus-subtitle">${escapeHtml(resolvedRangeLabel)}，数据可能有约 5 分钟延迟</span>
        </div>
        ${renderPanelHeadActions(`已更新 ${updateTime}`)}
      </div>
      <div class="dsapi-plus-tagline">补充官方未展示的拆分、缓存命中、均价与模型明细</div>

      <div class="dsapi-plus-body">
        <div class="dsapi-plus-summary">
          ${renderSummaryCards({
            todayTotalCost,
            todayCostDetail,
            monthCnyCost,
            costDetail,
            averageCostPerMillion,
            averageCostDetail,
            cacheRateValue,
            cacheDetail,
            usageInput,
            usageDetail,
            estimatedAvailableTokens,
          })}
        </div>

        <div class="dsapi-plus-chart-grid dsapi-plus-chart-grid--core">
          <div class="dsapi-plus-chart-block">
            ${chartHeading("缓存命中率", formatPercent(cacheRateValue))}
            <div class="dsapi-plus-chart-frame">
              <div class="dsapi-plus-chart" data-dsapi-chart="cacheRate"></div>
            </div>
          </div>

          <div class="dsapi-plus-chart-block">
            ${chartHeading("Token 构成", `缓存命中 ${formatPercent(cacheRateValue)}`)}
            <div class="dsapi-plus-chart-frame">
              <div class="dsapi-plus-chart" data-dsapi-chart="composition"></div>
            </div>
          </div>

          <div class="dsapi-plus-chart-block">
            ${chartHeading("Token 结构趋势", formatInteger(tokenTotal))}
            <div class="dsapi-plus-chart-frame">
              <div class="dsapi-plus-chart" data-dsapi-chart="tokens"></div>
            </div>
          </div>
        </div>

        <details class="dsapi-plus-extra"${extraChartsOpen ? " open" : ""}>
          <summary>更多图表 · 请求趋势</summary>
          <div class="dsapi-plus-extra-body">
            <div class="dsapi-plus-chart-block" style="padding:0;background:transparent;">
              ${chartHeading("API 请求趋势", formatInteger(amount.aggregate.request))}
              <div class="dsapi-plus-chart-frame">
                <div class="dsapi-plus-chart" data-dsapi-chart="requests"></div>
              </div>
            </div>
          </div>
        </details>

        <div class="dsapi-plus-section">
          <div class="dsapi-plus-section-head">
            <div class="dsapi-plus-section-title">模型增强明细</div>
            <div class="dsapi-plus-section-meta">含缓存命中与费用</div>
          </div>
          <div class="dsapi-plus-detail-layout">
            <div>
              ${
                sortedModels.length
                  ? renderModelTable(sortedModels, cost)
                  : '<div class="dsapi-plus-message">当前区间暂无请求或 Token 用量。</div>'
              }
            </div>
            <div class="dsapi-plus-model-donut">
              ${chartHeading("模型 Token 占比", sortedModels.length ? `${sortedModels.length} 个活跃模型` : "暂无模型用量")}
              <div class="dsapi-plus-chart-frame">
                ${sortedModels.length ? '<div class="dsapi-plus-chart" data-dsapi-chart="models"></div>' : '<div class="dsapi-plus-message">当前区间暂无模型用量。</div>'}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    return {
      range,
      period,
      rangeLabel: resolvedRangeLabel,
      summary,
      amount,
      cost,
      monthlyCostText,
      monthCostText,
      monthlyCnyCost,
      monthCnyCost,
      todayTotalCost,
      todayCostText,
      todayCostDetail,
      costDetail,
      usageInput,
      usageOutput,
      usageDetail,
      cacheRateValue,
      cacheDetail,
      sortedModels,
      tokenTotal,
      averageCostPerMillion,
      averageCostDetail,
      estimatedAvailableTokens,
      updateTime,
      html,
    };
  }

  function renderPanel(panel, data) {
    const panelData = buildPanelData(data);
    panel.__dsapiPlusDebug = data.debug;
    state.lastPanelData = panelData;
    const expectedChartCount = panelData.sortedModels.length ? 5 : 4;

    if (state.charts.length > 0 && state.charts.length === expectedChartCount) {
      updatePanelIncremental(panel, panelData);
      updateChartsData(panelData);
      return;
    }

    disposeCharts();
    panel.innerHTML = panelData.html;
    bindPanelControls(panel);
    initCharts(panel, panelData);
  }

  function formatWallet(item) {
    const tokenEstimation = item && item.token_estimation != null
      ? `，约 ${formatInteger(item.token_estimation)} Tokens`
      : "";
    return `${formatMoney(item)}${tokenEstimation}`;
  }

  function summaryItem(label, value, unit = "", detail = "") {
    return `
      <div class="dsapi-plus-summary-item">
        <div class="dsapi-plus-summary-label">${escapeHtml(label)}</div>
        <div>
          <div class="dsapi-plus-summary-value-row">
            <span class="dsapi-plus-summary-value">${escapeHtml(value)}</span>
            ${unit ? `<span class="dsapi-plus-summary-unit">${escapeHtml(unit)}</span>` : ""}
          </div>
          ${detail ? `<div class="dsapi-plus-summary-detail">${escapeHtml(detail)}</div>` : ""}
        </div>
      </div>
    `;
  }

  function renderSummaryCards(input) {
    const {
      todayTotalCost,
      todayCostDetail,
      monthCnyCost,
      costDetail,
      averageCostPerMillion,
      averageCostDetail,
      cacheRateValue,
      cacheDetail,
      usageInput,
      usageDetail,
      estimatedAvailableTokens,
    } = input;

    return (
      summaryItem("今日消费", formatCnyValue(todayTotalCost), "CNY", todayCostDetail) +
      summaryItem("区间费用", formatCnyValue(monthCnyCost), "CNY", costDetail) +
      summaryItem("平均单价", formatCnyValue(averageCostPerMillion), "CNY /1M", averageCostDetail) +
      summaryItem("缓存命中", formatPercent(cacheRateValue), "", cacheDetail) +
      summaryItem("输入 Tokens", formatInteger(usageInput), "", usageDetail) +
      summaryItem(
        "预估可用",
        estimatedAvailableTokens ? formatInteger(estimatedAvailableTokens) : "无法估算",
        estimatedAvailableTokens ? "Tokens" : ""
      )
    );
  }

  function isExtraChartsOpen() {
    try {
      return localStorage.getItem(EXTRA_CHARTS_STORAGE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function setExtraChartsOpen(open) {
    try {
      localStorage.setItem(EXTRA_CHARTS_STORAGE_KEY, open ? "1" : "0");
    } catch (error) {
      // ignore quota / privacy mode
    }
  }

  function bindExtraChartsToggle(panel) {
    const details = panel.querySelector(".dsapi-plus-extra");
    if (!details || details.dataset.bound === "1") return;
    details.dataset.bound = "1";
    details.addEventListener("toggle", () => {
      setExtraChartsOpen(details.open);
      resizeAllCharts();
    });
  }

  function isPanelCollapsed() {
    try {
      return localStorage.getItem(PANEL_COLLAPSED_STORAGE_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function setPanelCollapsed(collapsed) {
    try {
      localStorage.setItem(PANEL_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    } catch (error) {
      // ignore
    }
  }

  function resizeAllCharts() {
    window.requestAnimationFrame(() => {
      for (const { instance } of state.charts) {
        if (!instance.isDisposed()) instance.resize();
      }
    });
  }

  function applyCollapsedState(panel, collapsed = isPanelCollapsed()) {
    if (!panel) return;
    panel.classList.toggle("is-collapsed", collapsed);
    const button = panel.querySelector(".dsapi-plus-collapse");
    if (button) {
      button.textContent = collapsed ? "展开" : "收起";
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    if (!collapsed) resizeAllCharts();
  }

  function bindCollapse(panel) {
    const button = panel.querySelector(".dsapi-plus-collapse");
    if (!button || button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", () => {
      const next = !panel.classList.contains("is-collapsed");
      setPanelCollapsed(next);
      applyCollapsedState(panel, next);
    });
    applyCollapsedState(panel);
  }

  function bindPanelControls(panel) {
    bindRefresh(panel);
    bindCollapse(panel);
    bindExtraChartsToggle(panel);
  }

  function sumCurrencyAmount(items, currency, amountKey) {
    return asArray(items)
      .filter((item) => item && item.currency === currency)
      .reduce((sum, item) => sum + Number(item[amountKey] || 0), 0);
  }

  function computeAverageCostPerMillion(input) {
    const preferredCost = Number(input.preferredCost || 0);
    const preferredTokens = Number(input.preferredTokens || 0);
    if (preferredCost > 0 && preferredTokens > 0) return preferredCost / preferredTokens * 1000000;

    const fallbackCost = Number(input.fallbackCost || 0);
    const fallbackTokens = Number(input.fallbackTokens || 0);
    if (fallbackCost > 0 && fallbackTokens > 0) return fallbackCost / fallbackTokens * 1000000;

    return 0;
  }

  function getCostBreakdown(costBlocks, currency) {
    const outputTypes = new Set([
      TOKEN_TYPES.response,
      "responseToken",
      "response_token",
      "RESPONSE_TOKEN",
      "response",
    ]);
    const inputTypes = new Set([
      TOKEN_TYPES.promptMiss,
      TOKEN_TYPES.promptHit,
      "promptCacheMissToken",
      "promptCacheHitToken",
      "prompt_cache_miss_token",
      "prompt_cache_hit_token",
      "PROMPT_CACHE_MISS_TOKEN",
      "PROMPT_CACHE_HIT_TOKEN",
    ]);
    const result = { input: 0, output: 0 };

    for (const block of costBlocks) {
      if (!block || block.currency !== currency) continue;
      for (const modelCost of block.modelCosts || []) {
        for (const [type, amount] of Object.entries(modelCost.usageCostMap || {})) {
          if (outputTypes.has(type)) result.output += Number(amount || 0);
          if (inputTypes.has(type)) result.input += Number(amount || 0);
        }
      }
    }

    return result;
  }

  function chartHeading(title, value) {
    return `
      <div class="dsapi-plus-chart-heading">
        <span class="dsapi-plus-chart-heading-title">${escapeHtml(title)}</span>
        <span class="dsapi-plus-chart-heading-value">${escapeHtml(value)}</span>
      </div>
    `;
  }

  function cacheHitRate(aggregate) {
    const promptTotal = aggregate.promptMiss + aggregate.promptHit;
    return promptTotal > 0 ? aggregate.promptHit / promptTotal : 0;
  }

  function renderModelTable(models, costBlocks) {
    const rows = models
      .map((model) => {
        const costText = costForModel(costBlocks, model.model);
        return `
          <tr>
            <td title="${escapeHtml(model.model)}">${escapeHtml(model.model)}</td>
            <td>${formatInteger(model.request)}</td>
            <td>${formatInteger(model.tokens)}</td>
            <td>${formatInteger(model.response)}</td>
            <td>${formatInteger(model.promptMiss)}</td>
            <td>${formatInteger(model.promptHit)}</td>
            <td>${formatPercent(model.cacheHitRate)}</td>
            <td>${escapeHtml(costText)}</td>
          </tr>
        `;
      })
      .join("");

    return `
      <div class="dsapi-plus-table-card">
        <div class="dsapi-plus-table-wrap">
          <table class="dsapi-plus-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>请求数</th>
                <th>Tokens</th>
                <th>输出</th>
                <th>输入未缓存</th>
                <th>输入缓存命中</th>
                <th>缓存命中占比</th>
                <th>费用</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  function compactNumber(value) {
    const number = Number(value || 0);
    if (number >= 100000000) return `${formatDecimal(number / 100000000, 1)}亿`;
    if (number >= 10000) return `${formatDecimal(number / 10000, 1)}万`;
    return formatInteger(number);
  }

  function shortDateLabel(value) {
    const ymd = bucketTimeToDate(value);
    const matched = String(ymd || value || "").match(/(\d{1,2})$/);
    if (matched) {
      const monthMatch = String(ymd || value || "").match(/-(\d{1,2})-\d{1,2}$/);
      if (monthMatch) return `${Number(monthMatch[1])}/${Number(matched[1])}`;
      return `${matched[1]}日`;
    }
    return String(value || "");
  }

  function isDarkTheme() {
    return document.body.classList.contains("dark")
      || document.body.hasAttribute("data-ds-dark-theme")
      || document.documentElement.hasAttribute("data-ds-dark-theme");
  }

  function getChartTextColor() {
    return isDarkTheme() ? "rgba(180, 184, 198, 0.9)" : "rgba(15, 17, 21, 0.55)";
  }

  function getChartGridColor() {
    return isDarkTheme() ? "rgba(255, 255, 255, 0.12)" : "rgba(0, 0, 0, 0.1)";
  }

  function getTooltipCss() {
    return [
      "padding: 12px 24px",
      "min-width: 200px",
      "background-color: var(--dsw-alias-bg-layer-1, #fff)",
      "border: 1px solid var(--dsw-alias-border-inverted, rgba(0,0,0,0.08))",
      "border-radius: 24px",
      "box-shadow: var(--dsw-shadow-lv3, 0 0 1px 0 rgba(0,0,0,.2), 0 0 4px 0 rgba(0,0,0,.02), 0 12px 32px 0 rgba(0,0,0,.08))",
      "font-family: var(--dsw-font-family, inherit)",
    ].join(";") + ";";
  }

  function getTooltipPosition(point, params, dom, rect, size) {
    const gap = 12;
    const width = dom?.offsetWidth || 180;
    const height = dom?.offsetHeight || 90;
    const viewWidth = size?.viewSize?.[0] || window.innerWidth;
    const viewHeight = size?.viewSize?.[1] || window.innerHeight;
    let x = point[0] + gap;
    let y = point[1] + gap;
    if (x + width > viewWidth) x = point[0] - width - gap;
    if (y + height > viewHeight) y = point[1] - height - gap;
    return [Math.max(0, x), Math.max(0, y)];
  }

  function tooltipInteractionOption() {
    return {
      triggerOn: "mousemove|click",
      showDelay: 0,
      enterable: false,
      hideDelay: 0,
      renderMode: "html",
      appendToBody: true,
      position: getTooltipPosition,
    };
  }

  function chartBaseOption() {
    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    return {
      animation: false,
      grid: { left: 44, right: 12, top: 8, bottom: 24 },
      tooltip: {
        confine: true,
        trigger: "axis",
        ...tooltipInteractionOption(),
        extraCssText: getTooltipCss(),
        axisPointer: { lineStyle: { color: gridColor } },
      },
      xAxis: {
        type: "category",
        axisTick: { show: false },
        axisLabel: { color: textColor, interval: "auto", formatter: shortDateLabel },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "value",
        splitNumber: 1,
        splitLine: { lineStyle: { color: gridColor } },
        axisLabel: { color: textColor, align: "left", margin: 34, formatter: compactNumber },
      },
    };
  }

  function getEcharts() {
    return Promise.resolve(window.echarts);
  }

  function disposeCharts() {
    stopTooltipKeeper();
    if (state.chartResizeObserver) {
      state.chartResizeObserver.disconnect();
      state.chartResizeObserver = null;
    }
    for (const { instance } of state.charts) instance.dispose();
    state.charts = [];
  }

  function isTextSelecting() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    return selection.type === "Range" || String(selection).length > 0;
  }

  function startTooltipKeeper(instance, event) {
    if (!instance || instance.isDisposed()) return;
    // 文字拖选时不要反复 showTip，否则会破坏选区
    if (isTextSelecting()) {
      stopTooltipKeeper();
      return;
    }
    if (state.tooltipKeeperChart !== instance && state.tooltipKeeperTimer) {
      window.clearInterval(state.tooltipKeeperTimer);
      state.tooltipKeeperTimer = 0;
    }
    for (const entry of state.charts) {
      const chart = entry.instance;
      if (chart !== instance && !chart.isDisposed()) {
        chart.dispatchAction({ type: "hideTip" });
      }
    }

    state.tooltipActive = true;
    state.tooltipKeeperChart = instance;
    state.tooltipKeeperPoint = [event.offsetX, event.offsetY];

    instance.dispatchAction({
      type: "showTip",
      x: state.tooltipKeeperPoint[0],
      y: state.tooltipKeeperPoint[1],
    });

    if (state.tooltipKeeperTimer) return;
    state.tooltipKeeperTimer = window.setInterval(() => {
      const chart = state.tooltipKeeperChart;
      const point = state.tooltipKeeperPoint;
      if (!state.tooltipActive || !chart || chart.isDisposed() || !point || isTextSelecting()) {
        stopTooltipKeeper();
        return;
      }
      chart.dispatchAction({ type: "showTip", x: point[0], y: point[1] });
    }, 250);
  }

  function stopTooltipKeeper(instance) {
    if (instance && state.tooltipKeeperChart !== instance) {
      if (!instance.isDisposed()) instance.dispatchAction({ type: "hideTip" });
      return false;
    }

    if (state.tooltipKeeperTimer) {
      window.clearInterval(state.tooltipKeeperTimer);
      state.tooltipKeeperTimer = 0;
    }
    const chart = state.tooltipKeeperChart;
    if (chart && !chart.isDisposed()) {
      chart.dispatchAction({ type: "hideTip" });
    }
    state.tooltipKeeperChart = null;
    state.tooltipKeeperPoint = null;
    state.tooltipActive = false;
    return true;
  }

  function buildChartOption(key, panelData) {
    const { amount, sortedModels } = panelData;
    switch (key) {
      case "requests": return buildRequestChartOption(amount.days);
      case "tokens": return buildTokensChartOption(amount.days);
      case "cacheRate": return buildCacheRateChartOption(amount.days);
      case "composition": return buildCompositionChartOption(amount.aggregate);
      case "models": return buildModelsChartOption(sortedModels.slice(0, 8));
      default: return null;
    }
  }

  function updateChartTheme() {
    if (!state.lastPanelData) return;
    if (state.tooltipActive) {
      state.pendingThemeUpdate = true;
      return;
    }
    for (const entry of state.charts) {
      if (entry.instance.isDisposed()) continue;
      const option = buildChartOption(entry.key, state.lastPanelData);
      if (option) entry.instance.setOption(option, { notMerge: true });
    }
  }

  function flushPendingChartUpdates() {
    if (state.tooltipActive) return;

    if (state.pendingThemeUpdate && state.lastPanelData) {
      state.pendingThemeUpdate = false;
      updateChartTheme();
    }

    if (state.pendingPanelData) {
      const pending = state.pendingPanelData;
      state.pendingPanelData = null;
      updateChartsData(pending);
    }
  }

  function startThemeObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && (m.attributeName === "class" || m.attributeName === "data-ds-dark-theme")) {
          updateChartTheme();
          break;
        }
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "data-ds-dark-theme"] });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
  }

  function updatePanelIncremental(panel, panelData) {
    const {
      range,
      rangeLabel,
      amount,
      cost,
      monthCnyCost,
      todayTotalCost,
      todayCostDetail,
      costDetail,
      usageInput,
      usageDetail,
      cacheRateValue,
      cacheDetail,
      sortedModels,
      tokenTotal,
      averageCostPerMillion,
      averageCostDetail,
      estimatedAvailableTokens,
      updateTime,
    } = panelData;

    const subtitle = panel.querySelector(".dsapi-plus-subtitle");
    const status = panel.querySelector(".dsapi-plus-status");
    if (subtitle) subtitle.textContent = `${rangeLabel || formatRangeSubtitle(range)}，数据可能有约 5 分钟延迟`;
    if (status) status.textContent = `已更新 ${updateTime}`;

    const summaryEl = panel.querySelector(".dsapi-plus-summary");
    if (summaryEl) {
      summaryEl.innerHTML = renderSummaryCards({
        todayTotalCost,
        todayCostDetail,
        monthCnyCost,
        costDetail,
        averageCostPerMillion,
        averageCostDetail,
        cacheRateValue,
        cacheDetail,
        usageInput,
        usageDetail,
        estimatedAvailableTokens,
      });
    }

    // 顺序：缓存命中率、Token 构成、Token 结构趋势、请求趋势、模型占比
    const headingValues = panel.querySelectorAll(".dsapi-plus-chart-heading-value");
    const headingTexts = [
      formatPercent(cacheRateValue),
      `缓存命中 ${formatPercent(cacheRateValue)}`,
      formatInteger(tokenTotal),
      formatInteger(amount.aggregate.request),
      sortedModels.length ? `${sortedModels.length} 个活跃模型` : "暂无模型用量",
    ];
    headingValues.forEach((el, i) => {
      if (headingTexts[i] != null) el.textContent = headingTexts[i];
    });
    bindPanelControls(panel);

    const detailLayout = panel.querySelector(".dsapi-plus-detail-layout");
    if (detailLayout && detailLayout.children[0]) {
      detailLayout.children[0].innerHTML = sortedModels.length
        ? renderModelTable(sortedModels, cost)
        : '<div class="dsapi-plus-message">当前区间暂无请求或 Token 用量。</div>';
    }

    const donut = panel.querySelector(".dsapi-plus-model-donut");
    if (donut) {
      const frame = donut.querySelector(".dsapi-plus-chart-frame");
      if (frame) {
        const hasChart = !!frame.querySelector('[data-dsapi-chart="models"]');
        if (sortedModels.length && !hasChart) {
          frame.innerHTML = '<div class="dsapi-plus-chart" data-dsapi-chart="models"></div>';
        } else if (!sortedModels.length && hasChart) {
          frame.innerHTML = '<div class="dsapi-plus-message">当前区间暂无模型用量。</div>';
        }
      }
    }
  }

  function updateChartsData(panelData) {
    if (state.tooltipActive) {
      state.pendingPanelData = panelData;
      return;
    }
    const remaining = [];
    for (const entry of state.charts) {
      const option = buildChartOption(entry.key, panelData);
      if (!option || entry.instance.isDisposed()) {
        entry.instance.dispose();
        continue;
      }
      entry.instance.setOption(option, { notMerge: true });
      remaining.push(entry);
    }
    state.charts = remaining;
  }

  function initCharts(panel, panelData) {
    getEcharts()
      .then((echarts) => {
        if (!panel.isConnected) return;

        // 核心图优先；请求趋势在折叠区内，仍初始化，展开时 resize
        const keys = ["cacheRate", "composition", "tokens", "requests", "models"];
        for (const key of keys) {
          const container = panel.querySelector(`[data-dsapi-chart="${key}"]`);
          const option = buildChartOption(key, panelData);
          if (!container || !option) continue;
          const instance = echarts.init(container, null, { renderer: "svg" });
          const zr = instance.getZr();
          zr.on("mousemove", (event) => {
            startTooltipKeeper(instance, event);
          });
          zr.on("globalout", () => {
            if (stopTooltipKeeper(instance)) {
              flushPendingChartUpdates();
            }
          });
          instance.setOption(option);
          state.charts.push({ key, instance });
        }

        state.chartResizeObserver = new ResizeObserver(() => {
          for (const { instance } of state.charts) instance.resize();
        });
        state.chartResizeObserver.observe(panel);

        // 若「更多图表」默认展开，补一次 resize 修正宽度
        window.requestAnimationFrame(() => {
          for (const { instance } of state.charts) {
            if (!instance.isDisposed()) instance.resize();
          }
        });
      })
      .catch((error) => {
        console.error("[DeepSeek Usage Panel Plus] ECharts init failed", error);
      });
  }

  function buildRequestChartOption(days) {
    const option = chartBaseOption();
    const x = days.map((day) => day.date);
    option.xAxis.data = x;
    option.tooltip.formatter = (params) => {
      const item = params[0];
      const day = days[item.dataIndex] || {};
      const modelRows = (day.models || [])
        .filter((model) => model.request > 0)
        .sort((a, b) => b.request - a.request)
        .map((model, index) => ({
          color: chartPalette(index),
          label: model.model,
          value: formatInteger(model.request),
        }));
      return tooltipHtml(item.axisValue, modelRows.length ? modelRows : [
        { color: "#FF810C", label: "API 请求趋势", value: formatInteger(item.value) },
      ]);
    };
    option.series = [
      {
        data: days.map((day) => day.request),
        type: "line",
        smooth: true,
        showSymbol: false,
        itemStyle: { color: "#FF810C" },
        lineStyle: { color: "#FF810C", width: 1.5 },
        areaStyle: { color: "rgba(255, 129, 12, 0.22)" },
        emphasis: { disabled: true },
      },
    ];
    return option;
  }

  function buildCacheRateChartOption(days) {
    const option = chartBaseOption();
    option.xAxis.data = days.map((day) => day.date);
    option.yAxis.axisLabel.formatter = (value) => `${formatDecimal(value * 100, 0)}%`;
    option.yAxis.max = 1;
    option.tooltip.formatter = (params) => {
      const item = params[0];
      const day = days[item.dataIndex] || {};
      return tooltipHtml(item.axisValue, [
        { color: "#FF810C", label: "缓存命中率", value: formatPercent(item.value) },
        { color: "#FFA10A", label: "缓存命中 Tokens", value: formatInteger(day.promptHit || 0) },
        { color: "#FFC14D", label: "输入 Tokens", value: formatInteger((day.promptHit || 0) + (day.promptMiss || 0)) },
      ]);
    };
    option.series = [
      {
        data: days.map((day) => {
          const total = day.promptHit + day.promptMiss;
          return total > 0 ? day.promptHit / total : 0;
        }),
        type: "line",
        smooth: true,
        showSymbol: false,
        itemStyle: { color: "#FF810C" },
        lineStyle: { color: "#FF810C", width: 1.5 },
        areaStyle: { color: "rgba(255, 129, 12, 0.22)" },
        emphasis: { disabled: true },
      },
    ];
    return option;
  }

  function buildTokensChartOption(days) {
    const option = chartBaseOption();
    option.xAxis.data = days.map((day) => day.date);
    option.tooltip.formatter = (params) => {
      const rows = params
        .slice()
        .reverse()
        .map((item) => ({ color: item.color, label: item.seriesName, value: `${formatInteger(item.value)} tokens` }));
      return tooltipHtml(params[0]?.axisValue || "", rows);
    };
    option.series = [
      tokenBarSeries("输出 Tokens", days.map((day) => day.response), "#FF810C"),
      tokenBarSeries("输入未缓存", days.map((day) => day.promptMiss), "#FFA10A"),
      tokenBarSeries("输入缓存命中", days.map((day) => day.promptHit), "#FFC14D"),
    ];
    return option;
  }

  function tokenBarSeries(name, data, color) {
    return {
      name,
      data,
      type: "bar",
      stack: "tokens",
      barMaxWidth: 12,
      itemStyle: { color },
      emphasis: { disabled: true },
    };
  }

  function buildCompositionChartOption(aggregate) {
    return buildHorizontalBarOption([
      { name: "输出 Tokens", value: aggregate.response, color: "#FF810C" },
      { name: "输入未缓存", value: aggregate.promptMiss, color: "#FFA10A" },
      { name: "输入缓存命中", value: aggregate.promptHit, color: "#FFC14D" },
    ]);
  }

  function buildModelsChartOption(models) {
    if (!models.length) return null;
    const textColor = getChartTextColor();
    const mutedColor = isDarkTheme() ? "rgba(180, 184, 198, 0.9)" : "rgba(15, 17, 21, 0.55)";
    const ringBorder = isDarkTheme() ? "rgba(30, 32, 38, 1)" : "#f5f6f7";
    const totalTokens = models.reduce((sum, model) => sum + (Number(model.tokens) || 0), 0);
    const data = models.map((model, index) => ({
      name: model.model,
      value: model.tokens,
      itemStyle: { color: chartPalette(index) },
    }));

    return {
      animation: false,
      tooltip: {
        confine: true,
        trigger: "item",
        ...tooltipInteractionOption(),
        extraCssText: getTooltipCss(),
        formatter: (params) => tooltipHtml(params.name, [
          { color: params.color, label: "Tokens", value: formatInteger(params.value) },
          { color: params.color, label: "占比", value: `${formatDecimal(params.percent, 2)}%` },
        ]),
      },
      legend: {
        type: "scroll",
        orient: "horizontal",
        bottom: 0,
        left: "center",
        width: "92%",
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 10,
        icon: "circle",
        textStyle: {
          color: textColor,
          fontSize: 11,
          lineHeight: 14,
        },
        pageIconColor: textColor,
        pageTextStyle: { color: mutedColor },
        formatter: (name) => {
          const short = name.length > 16 ? `${name.slice(0, 14)}…` : name;
          return short;
        },
      },
      series: [{
        type: "pie",
        name: "模型 Token 占比",
        radius: ["48%", "72%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        padAngle: 1.5,
        minAngle: 2,
        itemStyle: {
          borderWidth: 2,
          borderColor: ringBorder,
          borderRadius: 4,
        },
        label: { show: false },
        labelLine: { show: false },
        data,
        emphasis: {
          scale: true,
          scaleSize: 6,
          itemStyle: {
            shadowBlur: 12,
            shadowColor: "rgba(0, 0, 0, 0.12)",
          },
        },
      }],
      // 环心展示总量
      graphic: [
        {
          type: "text",
          left: "center",
          top: "38%",
          style: {
            text: compactNumber(totalTokens),
            fill: textColor,
            fontSize: 16,
            fontWeight: 600,
            align: "center",
            verticalAlign: "middle",
          },
        },
        {
          type: "text",
          left: "center",
          top: "48%",
          style: {
            text: "Tokens",
            fill: mutedColor,
            fontSize: 12,
            align: "center",
            verticalAlign: "middle",
          },
        },
      ],
    };
  }

  function buildHorizontalBarOption(items) {
    const textColor = getChartTextColor();
    const gridColor = getChartGridColor();
    return {
      animation: false,
      grid: { left: 94, right: 56, top: 8, bottom: 8 },
      tooltip: {
        confine: true,
        trigger: "axis",
        ...tooltipInteractionOption(),
        axisPointer: { type: "shadow", shadowStyle: { color: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04))" } },
        extraCssText: getTooltipCss(),
        formatter: (params) => tooltipHtml(params[0]?.name || "", [
          { color: params[0]?.color || "#FF810C", label: "Tokens", value: formatInteger(params[0]?.value || 0) },
        ]),
      },
      xAxis: {
        type: "value",
        splitNumber: 1,
        splitLine: { lineStyle: { color: gridColor } },
        axisLabel: { color: textColor, formatter: compactNumber },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: items.map((item) => item.name),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: textColor,
          width: 86,
          overflow: "truncate",
        },
      },
      series: [{
        type: "bar",
        barMaxWidth: 12,
        data: items.map((item) => ({ value: item.value, itemStyle: { color: item.color } })),
        label: {
          show: true,
          position: "right",
          color: textColor,
          formatter: (params) => compactNumber(params.value),
        },
        emphasis: { disabled: true },
      }],
    };
  }

  function chartPalette(index) {
    return [
      "#FF810C",
      "#FFA10A",
      "#FFC14D",
      "#3964FE",
      "#60B3FE",
      "#A0DCFD",
      "#54D2B6",
      "#A7B8FF",
    ][index % 8];
  }

  function tooltipHtml(title, rows) {
    const body = rows.map((row) => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:24px;min-width:0;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14,14px/22px inherit);font-variant-numeric:tabular-nums;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
          <div style="flex:0 0 auto;width:12px;height:12px;border-radius:2px;background:${row.color};"></div>
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(row.label)}</div>
        </div>
        <div style="flex:0 0 auto;">${escapeHtml(row.value)}</div>
      </div>
    `).join("");
    return `
      <div style="display:flex;flex-direction:column;min-width:0;gap:4px;">
        <div style="color:var(--dsw-alias-label-primary);font:var(--dsw-font-base-strong-16,500 16px/24px inherit);font-variant-numeric:tabular-nums;">${escapeHtml(title)}</div>
        <div style="display:flex;flex-direction:column;gap:2px;">${body}</div>
      </div>
    `;
  }

  function costForModel(costBlocks, modelName) {
    const parts = [];
    for (const block of costBlocks) {
      const hit = block.modelCosts.find((item) => item.model === modelName);
      if (!hit || !hit.amount) continue;
      parts.push(formatMoney({ currency: block.currency, amount: hit.amount }));
    }
    return parts.length ? parts.join(" + ") : "0";
  }

  function bindRefresh(panel) {
    const button = panel.querySelector(".dsapi-plus-refresh");
    if (button) button.addEventListener("click", () => refresh(true));

    const debugButton = panel.querySelector(".dsapi-plus-debug");
    if (debugButton) {
      debugButton.addEventListener("click", () => {
        const debug = panel.__dsapiPlusDebug || { message: "数据尚未加载完成，请先点刷新。" };
        console.log("[DeepSeek Usage Panel Plus] API shape summary", debug);
      });
    }
  }

  function injectChatStyles() {
    if (document.getElementById(CHAT_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = CHAT_STYLE_ID;
    style.textContent = `
      #${CHAT_USAGE_BUTTON_ID} {
        box-sizing: border-box;
        width: 34px !important;
        min-width: 34px !important;
        max-width: 34px !important;
        height: 34px !important;
        min-height: 34px !important;
        max-height: 34px !important;
        flex: 0 0 34px !important;
        position: relative !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        user-select: none;
      }
      #${CHAT_USAGE_BUTTON_ID} .ds-button__background {
        position: absolute !important;
        inset: 0 !important;
        left: 0 !important;
        top: 0 !important;
        right: auto !important;
        bottom: auto !important;
        width: 100% !important;
        height: 100% !important;
        border-radius: 9999px !important;
        transform: none !important;
        transform-origin: center center !important;
      }
      #${CHAT_USAGE_BUTTON_ID}:hover .ds-button__background {
        background: var(--dsw-alias-interactive-bg-hover, rgba(2, 14, 54, 0.06));
      }
      body.dark #${CHAT_USAGE_BUTTON_ID}:hover .ds-button__background,
      body[data-ds-dark-theme] #${CHAT_USAGE_BUTTON_ID}:hover .ds-button__background {
        background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
      }
      #${CHAT_USAGE_BUTTON_ID}:focus-visible {
        outline: 2px solid rgba(57, 100, 254, 0.7);
        outline-offset: 2px;
      }
      #${CHAT_USAGE_BUTTON_ID} .ds-button__icon,
      #${CHAT_USAGE_BUTTON_ID} .ds-icon {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #${CHAT_USAGE_BUTTON_ID} svg {
        width: 16px;
        height: 16px;
        display: block;
      }
    `;
    document.head.appendChild(style);
  }

  function createChatUsageButton() {
    const button = document.createElement("div");
    button.id = CHAT_USAGE_BUTTON_ID;
    button.className = "ds-button ds-button--iconLabelPrimary ds-button--icon ds-button--capsule ds-button--m ds-button--icon-relative-m _4f3769f";
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("aria-label", "API用量");
    button.style.setProperty("--dsl-button-height", "34px");
    button.innerHTML = `
      <div class="ds-button__background"></div>
      <div class="ds-button__icon ds-button__icon--last-child">
        <div class="ds-icon" style="font-size: inherit;">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2.4 13.85C2.041 13.85 1.75 13.559 1.75 13.2V2.8C1.75 2.441 2.041 2.15 2.4 2.15C2.759 2.15 3.05 2.441 3.05 2.8V12.55H13.6C13.959 12.55 14.25 12.841 14.25 13.2C14.25 13.559 13.959 13.85 13.6 13.85H2.4Z" fill="currentColor"></path>
            <path d="M5.15 10.85C4.791 10.85 4.5 10.559 4.5 10.2V7.3C4.5 6.941 4.791 6.65 5.15 6.65C5.509 6.65 5.8 6.941 5.8 7.3V10.2C5.8 10.559 5.509 10.85 5.15 10.85Z" fill="currentColor"></path>
            <path d="M8 10.85C7.641 10.85 7.35 10.559 7.35 10.2V4.85C7.35 4.491 7.641 4.2 8 4.2C8.359 4.2 8.65 4.491 8.65 4.85V10.2C8.65 10.559 8.359 10.85 8 10.85Z" fill="currentColor"></path>
            <path d="M10.85 10.85C10.491 10.85 10.2 10.559 10.2 10.2V6.05C10.2 5.691 10.491 5.4 10.85 5.4C11.209 5.4 11.5 5.691 11.5 6.05V10.2C11.5 10.559 11.209 10.85 10.85 10.85Z" fill="currentColor"></path>
          </svg>
        </div>
      </div>
    `;
    button.addEventListener("click", openUsagePage);
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openUsagePage();
    });
    return button;
  }

  function openUsagePage() {
    window.open(USAGE_PAGE_URL, "_blank", "noopener,noreferrer");
  }

  function isVisibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getToolbarButtons(toolbar) {
    return Array.from(toolbar.children).filter((child) => (
      child instanceof HTMLElement &&
      child.id !== CHAT_USAGE_BUTTON_ID &&
      child.matches('[role="button"].ds-button')
    ));
  }

  function findChatToolbar() {
    const knownToolbar = document.querySelector("#root .e5bf614e");
    if (knownToolbar instanceof HTMLElement && getToolbarButtons(knownToolbar).length >= 3) {
      return knownToolbar;
    }

    const buttons = Array.from(document.querySelectorAll('#root [role="button"].ds-button'));
    const candidates = [];
    const seenParents = new Set();
    for (const button of buttons) {
      const parent = button.parentElement;
      if (!parent || seenParents.has(parent)) continue;
      seenParents.add(parent);

      const siblingButtons = getToolbarButtons(parent);
      if (siblingButtons.length < 3 || !siblingButtons.slice(0, 3).every(isVisibleElement)) continue;

      const rect = parent.getBoundingClientRect();
      const isTopLeft = rect.top >= -10 &&
        rect.top < Math.min(140, window.innerHeight * 0.25) &&
        rect.left < Math.min(360, window.innerWidth * 0.45);
      const firstThreeAreIconButtons = siblingButtons.slice(0, 3).every((item) => (
        item.querySelector(".ds-button__icon") && !(item.textContent || "").trim()
      ));

      if (isTopLeft && firstThreeAreIconButtons) {
        candidates.push({ element: parent, top: rect.top, left: rect.left });
      }
    }

    candidates.sort((a, b) => (a.top - b.top) || (a.left - b.left));
    return candidates[0]?.element || null;
  }

  function ensureChatUsageButton() {
    if (!isChatPage()) return null;
    injectChatStyles();

    const toolbar = findChatToolbar();
    if (!toolbar) return null;

    let button = document.getElementById(CHAT_USAGE_BUTTON_ID);
    if (!button) button = createChatUsageButton();

    const toolbarButtons = getToolbarButtons(toolbar);
    const newChatButton = toolbarButtons[2];
    if (!button.isConnected) {
      if (newChatButton) {
        newChatButton.after(button);
      } else {
        toolbar.appendChild(button);
      }
    } else if (button.parentElement !== toolbar) {
      if (newChatButton) {
        newChatButton.after(button);
      } else {
        toolbar.appendChild(button);
      }
    } else if (newChatButton && button.previousElementSibling !== newChatButton) {
      newChatButton.after(button);
    }

    return button;
  }

  function scheduleChatUsageButton() {
    window.clearTimeout(state.chatTimer);
    state.chatTimer = window.setTimeout(ensureChatUsageButton, 120);
  }

  function bootChatButton() {
    if (state.chatBooted) {
      scheduleChatUsageButton();
      return;
    }

    state.chatBooted = true;
    ensureChatUsageButton();
    state.chatObserver = new MutationObserver(scheduleChatUsageButton);
    state.chatObserver.observe(document.body, { childList: true, subtree: true });
  }

  function teardownChatButton() {
    window.clearTimeout(state.chatTimer);
    if (state.chatObserver) {
      state.chatObserver.disconnect();
      state.chatObserver = null;
    }
    const button = document.getElementById(CHAT_USAGE_BUTTON_ID);
    if (button) button.remove();
    state.chatBooted = false;
  }

  function ensurePanel() {
    if (!isUsagePage()) return null;
    injectStyles();
    document.body.classList.add("dsapi-plus-page-wide");

    let panel = document.getElementById(PANEL_ID);
    const reference = findInsertionReference();
    if (!reference) return null;

    if (!panel) {
      panel = document.createElement("section");
      panel.id = PANEL_ID;
      panel.className = "dsapi-plus-panel";
    }

    // 已挂载则不要反复 insertBefore，否则会打断用户文字选区
    if (!panel.isConnected) {
      const parent = reference.parentNode;
      if (!parent) return null;
      if (reference.id === PANEL_ID || reference === panel) {
        parent.appendChild(panel);
      } else if (reference.id === "usage-board" || reference.hasAttribute?.("data-usage-layout-root")) {
        parent.insertBefore(panel, reference.id === "usage-board" ? reference : reference.nextSibling);
      } else if (reference.matches?.('[role="heading"]') || reference.getAttribute?.("aria-level") === "1") {
        reference.after(panel);
      } else {
        parent.insertBefore(panel, reference);
      }
    } else if (panel.parentNode !== reference.parentNode && reference !== panel && reference.id !== PANEL_ID) {
      // 父节点被 SPA 重建时再迁移一次
      if (reference.id === "usage-board") {
        reference.parentNode?.insertBefore(panel, reference);
      } else if (reference.matches?.('[role="heading"]') || reference.getAttribute?.("aria-level") === "1") {
        reference.after(panel);
      } else {
        reference.parentNode?.insertBefore(panel, reference);
      }
    }

    return panel;
  }

  function findInsertionReference() {
    // 优先：官方时间筛选/看板之前 → 落在余额卡之后
    const usageBoard = document.getElementById("usage-board");
    if (usageBoard && usageBoard.parentElement) return usageBoard;

    const layoutRoot = document.querySelector('[data-usage-layout-root="true"]');
    if (layoutRoot) {
      let sibling = layoutRoot.nextElementSibling;
      while (sibling && sibling.id === PANEL_ID) sibling = sibling.nextElementSibling;
      if (sibling) return sibling;
      return layoutRoot.nextElementSibling || layoutRoot;
    }

    const monthlyTitle = findExactTextElement("每月用量");
    if (monthlyTitle) return climbToSectionRow(monthlyTitle);

    const usageTitle = findExactTextElement("用量信息");
    if (usageTitle && usageTitle.parentElement) {
      let sibling = usageTitle.nextElementSibling;
      while (sibling && sibling.id === PANEL_ID) {
        sibling = sibling.nextElementSibling;
      }
      if (sibling) return sibling;
      return usageTitle;
    }

    const main = document.querySelector("main");
    return main && main.firstElementChild ? main.firstElementChild : null;
  }

  function findExactTextElement(text) {
    const root = document.querySelector("main") || document.body;
    const elements = Array.from(root.querySelectorAll("div, span, h1, h2, h3, [role='heading']"));
    return elements.find((element) => {
      if (element.id === PANEL_ID || element.closest(`#${PANEL_ID}`)) return false;
      const value = (element.textContent || "").trim();
      return value === text;
    });
  }

  function climbToSectionRow(element) {
    let node = element;
    for (let i = 0; i < 4 && node.parentElement; i += 1) {
      const parent = node.parentElement;
      const text = (parent.textContent || "").trim();
      if (text.includes("每月用量") && parent.children.length > 1) return parent;
      node = parent;
    }
    return element;
  }

  async function refresh(force) {
    if (!isUsagePage()) return;
    const panel = ensurePanel();
    if (!panel) return;

    const range = getSelectedRange();
    if (!force && state.selectedRangeKey === range.key && ["1", "error", "loading"].includes(panel.dataset.loaded)) {
      return;
    }

    state.selectedRangeKey = range.key;
    panel.dataset.loaded = "loading";
    const requestId = ++state.requestId;
    renderSkeleton(panel, range);

    state.abortController?.abort();
    state.abortController = new AbortController();
    const { signal } = state.abortController;
    const timeoutId = setTimeout(() => state.abortController.abort(), 30000);

    try {
      const data = await loadData(range, signal);
      clearTimeout(timeoutId);
      if (requestId !== state.requestId) return;
      panel.dataset.loaded = "1";
      renderPanel(panel, data);
    } catch (error) {
      clearTimeout(timeoutId);
      if (requestId !== state.requestId) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (state.abortController && state.abortController.signal !== signal) return;
        panel.dataset.loaded = "error";
        renderError(panel, range, new Error("请求超时（30 秒）"));
        return;
      }
      panel.dataset.loaded = "error";
      renderError(panel, range, error);
      console.error("[DeepSeek Usage Panel Plus]", error);
    }
  }

  function scheduleRefresh(force) {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => refresh(force), 120);
  }

  function teardownUsage() {
    window.clearTimeout(state.refreshTimer);
    window.clearTimeout(state.mutationTimer);
    window.clearTimeout(state.routeTimer);
    state.abortController?.abort();
    state.abortController = null;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    disposeCharts();
    state.lastPanelData = null;
    state.selectedRangeKey = "";
    state.booted = false;
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
  }

  function startObservers() {
    document.addEventListener("change", (event) => {
      const target = event.target;
      if (target instanceof HTMLSelectElement && /^\d{4}-\d{1,2}$/.test(target.value || "")) {
        scheduleRefresh(true);
      }
    });

    state.observer = new MutationObserver((mutations) => {
      // 忽略面板内部与 ECharts tooltip 的 DOM 变动，避免拖选文字时反复 ensurePanel
      const relevant = mutations.some((mutation) => {
        const target = mutation.target;
        if (!(target instanceof Node)) return false;
        const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
        if (!element) return false;
        if (element.closest?.(`#${PANEL_ID}`)) return false;
        if (element.closest?.("div[_echarts_instance_], div[class*='echarts']")) return false;
        return true;
      });
      if (!relevant) return;
      if (isTextSelecting()) return;

      window.clearTimeout(state.mutationTimer);
      state.mutationTimer = window.setTimeout(() => {
        if (isTextSelecting()) return;
        const panel = ensurePanel();
        if (!panel) return;
        const range = getSelectedRange();
        if (range.key !== state.selectedRangeKey || !panel.dataset.loaded) {
          scheduleRefresh(range.key !== state.selectedRangeKey);
        }
      }, 250);
    });

    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function bootUsage() {
    if (state.booted) return;
    state.booted = true;
    ensurePanel();
    startObservers();
    startThemeObserver();
    scheduleRefresh(true);
  }

  function handleRouteChange() {
    if (isUsagePage()) {
      bootUsage();
    } else if (state.booted) {
      teardownUsage();
    }

    if (isChatPage()) {
      bootChatButton();
    } else if (state.chatBooted) {
      teardownChatButton();
    }
  }

  function installRouteObserver() {
    if (!state.historyHooked) {
      state.historyHooked = true;
      const notifyRouteChange = () => {
        window.clearTimeout(state.routeTimer);
        state.routeTimer = window.setTimeout(handleRouteChange, 50);
      };

      const wrapHistoryMethod = (name) => {
        const original = history[name];
        history[name] = function (...args) {
          const result = original.apply(this, args);
          notifyRouteChange();
          return result;
        };
      };

      wrapHistoryMethod("pushState");
      wrapHistoryMethod("replaceState");
      window.addEventListener("popstate", notifyRouteChange);
      window.addEventListener("hashchange", notifyRouteChange);
      new MutationObserver(notifyRouteChange).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    }

    handleRouteChange();
  }

  function boot() {
    installRouteObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
