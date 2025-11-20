# Chrome Web Store 上架指南

本指南將協助您將 DeepWiki to Markdown Extension 上架到 Chrome Web Store。

## 前置準備

### 1. 開發者帳號註冊

1. 前往 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 使用 Google 帳號登入
3. 支付一次性註冊費用 $5 USD（需要信用卡或 Google Pay）
4. 填寫發布者資訊

### 2. 打包擴充功能

執行打包腳本：

```bash
chmod +x build-for-store.sh
./build-for-store.sh
```

這會生成 `deepwiki-md-extension-v0.1.3.zip` 文件。

## 上架步驟

### 步驟 1：創建新項目

1. 登入 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 點擊「New Item」（新增項目）
3. 上傳 `deepwiki-md-extension-v0.1.3.zip`
4. 等待系統處理（約 1-2 分鐘）

### 步驟 2：填寫商店資訊

#### 基本資訊

**商店名稱（Store listing name）：**
```
DeepWiki to Markdown
```

**簡短描述（Short description）：** (最多 132 字元)
```
Convert DeepWiki documentation to Markdown format. Download single pages or entire projects as MD files.
```

**詳細描述（Detailed description）：** (最多 16,000 字元)
```
# DeepWiki to Markdown Extension

Convert DeepWiki documentation pages to Markdown format for local editing, backup, and archiving.

## Key Features

✅ **Single Page Download** - Convert and save individual documentation pages as Markdown files

✅ **Batch Download (ZIP)** - Download entire documentation projects with all subpages organized in a ZIP archive

✅ **Single File Mode** - Merge all pages into one comprehensive Markdown document

✅ **Advanced Conversion**
   • Preserves code blocks with syntax highlighting
   • Converts Mermaid diagrams (flowcharts, sequence diagrams, etc.)
   • Maintains document structure and formatting
   • Handles tables, lists, and nested content
   • Extracts metadata (last indexed date)

## Perfect For

- Creating local backups of documentation
- Offline reading and reference
- Repurposing content for blogs or notes
- Preserving knowledge from GitHub repositories
- Importing documentation into note-taking apps

## How to Use

1. Visit any DeepWiki documentation page (https://deepwiki.com)
2. Click the extension icon in your toolbar
3. Choose your download option:
   - Download Current Page (single file)
   - Download All Pages (ZIP archive)
   - Download as one md file (merged document)

## Supported Sites

- https://deepwiki.com/*

## Privacy & Permissions

This extension only works on DeepWiki pages and requires minimal permissions:
- **downloads**: To save Markdown files to your computer
- **tabs**: To detect when you're on a DeepWiki page
- **webNavigation**: To interact with page content
- **host_permissions**: Limited to deepwiki.com only

No data is collected, stored, or transmitted to any external servers. All conversions happen locally in your browser.

## Open Source

This extension is open source and available on GitHub:
https://github.com/philipz/deepwiki-md-chrome-extension

Found a bug or have a feature request? Please open an issue on GitHub!

## Version

Current version: 0.1.3

## License

MIT License
```

#### 分類與語言

**類別（Category）：**
- 選擇「Productivity」（生產力）

**語言（Language）：**
- English (預設)
- 可稍後新增中文翻譯

### 步驟 3：上傳圖片資源

#### 圖標（已在 manifest.json 中設定）
- ✅ 16x16 (icon16.png)
- ✅ 48x48 (icon48.png)
- ✅ 128x128 (icon128.png)

#### 商店圖片（Store images）

**必要圖片：**

1. **截圖（Screenshots）** - 至少 1 張，最多 5 張
   - 尺寸：1280x800 或 640x400
   - 格式：PNG 或 JPEG
   - 建議提供：
     - UI 界面截圖（已有：images/UI.png - 需調整尺寸）
     - DeepWiki 原始頁面（已有：images/deepwiki-github.png）
     - 轉換後的 Markdown 結果（已有：images/deepwiki-markdown.png）

**推薦圖片（可選但建議提供）：**

2. **小型推廣用瓦片圖（Small promotional tile）**
   - 尺寸：440x280
   - 格式：PNG 或 JPEG
   - 用途：在 Chrome Web Store 搜尋結果中顯示

3. **大型推廣用瓦片圖（Large promotional tile）**
   - 尺寸：920x680
   - 格式：PNG 或 JPEG
   - 用途：在 Chrome Web Store 精選區顯示

4. **侯爵（Marquee promotional tile）**
   - 尺寸：1400x560
   - 格式：PNG 或 JPEG
   - 用途：在 Chrome Web Store 首頁精選

#### 準備截圖

使用現有圖片或創建新截圖：

```bash
# 現有的圖片可以使用：
# - images/UI.png (需調整為 1280x800 或 640x400)
# - images/deepwiki-github.png
# - images/deepwiki-markdown.png
```

### 步驟 4：隱私權設定

**隱私權實踐（Privacy practices）：**

1. 點擊「Privacy practices」標籤
2. 回答以下問題：

**是否使用遠端程式碼？**
- ❌ No

**是否收集或傳輸個人資料？**
- ❌ No - This extension does not collect any user data

**Privacy Policy URL (if required):**
```
https://github.com/philipz/deepwiki-md-chrome-extension/blob/main/PRIVACY_POLICY.md
```

**Certification Statement:**
```
This extension operates entirely locally in the browser. All conversions from DeepWiki to Markdown happen client-side. No data is collected, stored, or transmitted to any external servers.

The extension only:
- Reads content from DeepWiki pages the user is actively viewing
- Converts content to Markdown format locally
- Saves files to the user's local download folder

No analytics, tracking, or data collection of any kind is performed.

Full privacy policy: https://github.com/philipz/deepwiki-md-chrome-extension/blob/main/PRIVACY_POLICY.md
```

### 步驟 5：定價與發布

**定價（Pricing）：**
- 選擇「Free」（免費）

**可見性選項（Visibility）：**
- **Public**：所有人都可以搜尋和安裝
- **Unlisted**：只有擁有連結的人可以安裝（適合測試）

建議先選擇「Unlisted」進行測試，確認無誤後再改為「Public」。

**地區限制（Regions）：**
- 選擇「All regions」（所有地區）

### 步驟 6：提交審查

1. 檢查所有資訊是否填寫完整
2. 點擊「Submit for review」（提交審查）
3. 等待 Google 審查（通常需要 1-3 個工作日，最長可能 7 天）

## 審查過程

### 審查時間

- 首次提交：通常 1-3 個工作日
- 更新版本：通常數小時到 1 天

### 可能被拒絕的原因

1. **隱私權問題**
   - 確保隱私政策清楚說明不收集資料

2. **權限過度要求**
   - ✅ 本專案已移除不必要的權限

3. **功能不符合描述**
   - 確保商店描述與實際功能相符

4. **圖片問題**
   - 確保所有圖片符合尺寸要求
   - 截圖必須真實反映擴充功能

### 如果被拒絕

1. 查看拒絕原因（會收到電子郵件通知）
2. 根據反饋修正問題
3. 重新提交審查

## 上架後管理

### 更新版本

1. 更新 `manifest.json` 中的版本號
2. 執行 `build-for-store.sh` 創建新的 ZIP
3. 在 Developer Dashboard 上傳新版本
4. 提交審查

### 監控指標

在 Developer Dashboard 中可以查看：
- 安裝數量
- 每週使用者數
- 評分和評論
- 使用統計

### 回應評論

- 及時回應使用者評論和問題
- 收集反饋以改進擴充功能

## 準備清單

上架前確認：

- [ ] manifest.json 版本號正確
- [ ] 所有功能正常運作
- [ ] 已執行打包腳本
- [ ] 準備好截圖（至少 1 張，建議 3-5 張）
- [ ] 準備好推廣圖片（可選）
- [ ] 商店描述文字已準備
- [ ] 已註冊開發者帳號並支付 $5 註冊費
- [ ] 隱私權說明已準備

## 常見問題

### Q: 需要多久才能通過審查？
A: 通常 1-3 個工作日，首次提交可能需要更長時間。

### Q: 可以在審查期間修改資訊嗎？
A: 提交後無法修改，必須等審查完成。如需重大修改，應取消審查後重新提交。

### Q: 如何處理使用者回報的問題？
A: 在 GitHub Issues 中追蹤問題，修復後發布新版本。

### Q: 是否需要提供隱私政策網頁？
A: 如果不收集任何資料，可以在商店頁面說明即可。但建議在 GitHub README 中也說明。

### Q: 可以更改擴充功能名稱嗎？
A: 可以，但需要重新審查。建議在上架前確定好名稱。

## 相關連結

- [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- [Chrome Web Store 開發者政策](https://developer.chrome.com/docs/webstore/program-policies/)
- [Chrome Web Store 發布指南](https://developer.chrome.com/docs/webstore/publish/)
- [最佳實踐指南](https://developer.chrome.com/docs/webstore/best_practices/)

## 聯絡支援

如遇到問題：

1. 查看 [Chrome Web Store 說明中心](https://support.google.com/chrome_webstore/)
2. 在專案 GitHub 開 Issue
3. 聯絡維護者：[@philipz](https://github.com/philipz)

---

**祝您上架順利！** 🚀
