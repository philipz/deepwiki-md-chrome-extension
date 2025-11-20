# Chrome Web Store 上架指南（繁體中文）

本指南將協助您將 DeepWiki to Markdown Extension 上架到 Chrome Web Store。

## 📋 前置準備

### 1. 開發者帳號註冊

1. 前往 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 使用 Google 帳號登入
3. 支付一次性註冊費用 **$5 USD**（需要信用卡或 Google Pay）
4. 填寫發布者資訊

### 2. 打包擴充功能

執行打包腳本：

```bash
chmod +x build-for-store.sh
./build-for-store.sh
```

這會生成 `deepwiki-md-extension-v0.1.3.zip` 檔案。

## 🚀 上架步驟

### 步驟 1：建立新專案

1. 登入 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. 點擊「**New Item**」（新增項目）
3. 上傳 `deepwiki-md-extension-v0.1.3.zip`
4. 等待系統處理（約 1-2 分鐘）

### 步驟 2：填寫商店資訊

#### 基本資訊

**商店名稱：**
```
DeepWiki to Markdown
```

**簡短描述：** (最多 132 字元)
```
將 DeepWiki 文件轉換為 Markdown 格式。下載單一頁面或整個專案為 MD 檔案。
```

**詳細描述：**
```
# DeepWiki to Markdown Extension

將 DeepWiki 文件頁面轉換為 Markdown 格式，方便本地編輯、備份和封存。

## 主要功能

✅ **單頁下載** - 將當前文件頁面轉換並儲存為 Markdown 檔案

✅ **批次下載（ZIP）** - 下載整個文件專案，包含所有子頁面，並組織成 ZIP 壓縮檔

✅ **單檔模式** - 將所有頁面合併為一個完整的 Markdown 文件

✅ **進階轉換**
   • 保留程式碼區塊和語法高亮
   • 轉換 Mermaid 圖表（流程圖、序列圖等）
   • 維持文件結構和格式
   • 處理表格、清單和巢狀內容
   • 擷取中繼資料（最後索引日期）

## 適用情境

- 建立文件的本地備份
- 離線閱讀和參考
- 將內容用於部落格或筆記
- 保存 GitHub 專案的知識庫
- 將文件匯入筆記軟體

## 使用方法

1. 造訪任何 DeepWiki 文件頁面（https://deepwiki.com）
2. 點擊瀏覽器工具列中的擴充功能圖示
3. 選擇下載選項：
   - 下載當前頁面（單一檔案）
   - 下載所有頁面（ZIP 壓縮檔）
   - 下載為單一 md 檔案（合併文件）

## 支援網站

- https://deepwiki.com/*

## 隱私權與權限

此擴充功能僅在 DeepWiki 頁面上運作，需要最少的權限：
- **downloads**：將 Markdown 檔案儲存到您的電腦
- **tabs**：偵測您是否在 DeepWiki 頁面上
- **webNavigation**：與頁面內容互動
- **host_permissions**：僅限於 deepwiki.com

不會收集、儲存或傳輸任何資料到外部伺服器。所有轉換都在您的瀏覽器本地執行。

## 開源專案

此擴充功能是開源的，可在 GitHub 上取得：
https://github.com/philipz/deepwiki-md-chrome-extension

發現錯誤或有功能建議？歡迎在 GitHub 上開啟 Issue！

## 版本

目前版本：0.1.3

## 授權

MIT License
```

#### 類別與語言

**類別：** Productivity（生產力）

**語言：**
- English（預設）
- 繁體中文（可稍後新增）

### 步驟 3：上傳圖片

#### 必要截圖

需要至少 **1 張截圖**，建議 **3-5 張**：

- **尺寸**：1280x800 或 640x400
- **格式**：PNG 或 JPEG

**建議截圖內容：**
1. 擴充功能 UI 介面
2. DeepWiki 原始頁面範例
3. 轉換後的 Markdown 結果
4. 批次下載過程
5. 單檔模式結果

#### 可選推廣圖片

1. **小型推廣圖**（440x280）- 出現在搜尋結果
2. **大型推廣圖**（920x680）- 出現在精選區
3. **橫幅推廣圖**（1400x560）- 出現在首頁

### 步驟 4：隱私權設定

**回答以下問題：**

- ❌ 是否使用遠端程式碼？**否**
- ❌ 是否收集或傳輸個人資料？**否**

**隱私政策 URL（如需要）：**
```
https://github.com/philipz/deepwiki-md-chrome-extension/blob/main/PRIVACY_POLICY.md
```

或使用繁體中文版：
```
https://github.com/philipz/deepwiki-md-chrome-extension/blob/main/PRIVACY_POLICY.zh-TW.md
```

**認證說明文字：**
```
本擴充功能完全在瀏覽器本地運作。所有從 DeepWiki 到 Markdown 的轉換都在
客戶端進行。不會收集、儲存或傳輸任何資料到外部伺服器。

擴充功能僅：
- 讀取使用者正在檢視的 DeepWiki 頁面內容
- 在本地將內容轉換為 Markdown 格式
- 將檔案儲存到使用者的本地下載資料夾

不執行任何分析、追蹤或資料收集。

完整隱私政策：https://github.com/philipz/deepwiki-md-chrome-extension/blob/main/PRIVACY_POLICY.md
```

### 步驟 5：定價與發布

- **定價：** 免費（Free）
- **可見性：** 建議先選「Unlisted」測試，確認無誤後改為「Public」
- **地區：** 所有地區（All regions）

### 步驟 6：提交審查

1. ✅ 檢查所有資訊是否填寫完整
2. 點擊「**Submit for review**」
3. 等待審查（通常 1-3 個工作日）

## ⏱️ 審查時程

- **首次提交**：1-3 個工作日
- **版本更新**：數小時到 1 天
- **最長等待**：最多 7 天

## ⚠️ 可能被拒絕的原因

1. ❌ 隱私權問題 → 確保說明清楚
2. ❌ 權限過多 → 已移除不必要權限
3. ❌ 功能不符 → 確保描述與實際相符
4. ❌ 圖片問題 → 確保尺寸正確且真實

## 📝 準備清單

上架前確認：

- [ ] ✅ manifest.json 版本號正確（0.1.3）
- [ ] ✅ 所有功能正常運作
- [ ] ✅ 已執行打包腳本
- [ ] 準備 1-5 張截圖（1280x800 或 640x400）
- [ ] 準備推廣圖片（可選但建議）
- [ ] 商店描述文字已準備
- [ ] 已註冊開發者帳號並支付 $5
- [ ] 隱私權說明已準備

## 📦 打包清單

ZIP 檔案包含：

✅ manifest.json
✅ popup.html, popup.js
✅ background.js
✅ content.js
✅ utils.js
✅ styles.css
✅ icons/ 目錄
✅ lib/ 目錄（jszip.min.js）

❌ 不包含：
- .git/
- test/
- images/
- README.md
- 文件檔案

## 🔄 版本更新流程

1. 更新 `manifest.json` 版本號
2. 執行 `./build-for-store.sh`
3. 在 Developer Dashboard 上傳新 ZIP
4. 提交審查

## 📊 上架後管理

可在 Dashboard 查看：
- 📈 安裝數量
- 👥 每週使用者數
- ⭐ 評分和評論
- 📉 使用統計

## ❓ 常見問題

**Q: 需要多久通過審查？**
A: 通常 1-3 個工作日，首次可能更長。

**Q: 審查中可以修改嗎？**
A: 不行，需等審查完成或取消後重新提交。

**Q: 需要隱私政策網頁嗎？**
A: 不收集資料的話，在商店說明即可。

**Q: 可以改名稱嗎？**
A: 可以，但需重新審查。建議上架前確定。

## 🔗 相關連結

- [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
- [開發者政策](https://developer.chrome.com/docs/webstore/program-policies/)
- [發布指南](https://developer.chrome.com/docs/webstore/publish/)
- [最佳實踐](https://developer.chrome.com/docs/webstore/best_practices/)

## 💬 需要協助？

1. 查看 [Chrome Web Store 說明中心](https://support.google.com/chrome_webstore/)
2. 在 [GitHub](https://github.com/philipz/deepwiki-md-chrome-extension) 開 Issue
3. 聯絡維護者：[@philipz](https://github.com/philipz)

---

**祝您上架順利！** 🎉
