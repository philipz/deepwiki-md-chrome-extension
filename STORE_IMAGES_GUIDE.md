# Chrome Web Store 圖片準備指南

本指南說明如何準備上架 Chrome Web Store 所需的圖片資源。

## 📸 必要圖片

### 1. 截圖（Screenshots）

**規格要求：**
- **尺寸**：1280x800 或 640x400（推薦 1280x800）
- **格式**：PNG 或 JPEG
- **數量**：至少 1 張，最多 5 張
- **用途**：展示擴充功能的實際使用情況

**建議截圖內容：**

#### 截圖 1：擴充功能 UI 介面
- 展示 popup 視窗的完整介面
- 包含三個主要按鈕
- 建議使用 images/UI.png，但需調整尺寸

#### 截圖 2：DeepWiki 原始頁面
- 顯示在 DeepWiki 頁面上使用擴充功能
- 展示轉換前的文件頁面
- 可使用 images/deepwiki-github.png 作為參考

#### 截圖 3：轉換後的 Markdown
- 展示下載的 Markdown 文件內容
- 顯示程式碼區塊和格式保留
- 可使用 images/deepwiki-markdown.png 作為參考

#### 截圖 4：批次下載過程（可選）
- 顯示批次下載的進度
- 展示「處理中」的狀態

#### 截圖 5：ZIP 檔案結果（可選）
- 顯示下載的 ZIP 檔案結構
- 展示生成的 README.md 索引

## 🎨 推薦圖片（可選但建議提供）

### 2. 小型推廣圖（Small Promotional Tile）

**規格：**
- **尺寸**：440x280
- **格式**：PNG 或 JPEG
- **用途**：Chrome Web Store 搜尋結果中顯示

**設計建議：**
```
+------------------------------------------+
|                                          |
|     [圖示]  DeepWiki to Markdown        |
|                                          |
|     Convert documentation to MD          |
|     ✓ Single page  ✓ Batch download     |
|                                          |
+------------------------------------------+
```

### 3. 大型推廣圖（Marquee Promotional Tile）

**規格：**
- **尺寸**：1400x560
- **格式**：PNG 或 JPEG
- **用途**：Chrome Web Store 首頁精選展示

**設計建議：**
- 左側：擴充功能圖示和名稱
- 中間：核心功能說明（3 個要點）
- 右側：使用截圖或效果展示

## 🛠️ 製作工具建議

### 線上工具
- [Canva](https://www.canva.com/) - 免費，有現成模板
- [Figma](https://www.figma.com/) - 專業設計工具
- [Photopea](https://www.photopea.com/) - 免費的線上 Photoshop

### 桌面工具
- GIMP（免費）
- Adobe Photoshop
- Sketch（Mac）

### 截圖工具
- Chrome 內建截圖（Ctrl/Cmd + Shift + P → "Capture screenshot"）
- Windows：Snipping Tool / Snip & Sketch
- Mac：Cmd + Shift + 4
- Linux：GNOME Screenshot / Flameshot

## 📐 調整現有圖片尺寸

### 使用 ImageMagick（命令列）

安裝 ImageMagick 後執行：

```bash
# 調整 UI 圖片為 1280x800
convert images/UI.png -resize 1280x800 -background white -gravity center -extent 1280x800 screenshot-ui.png

# 調整其他截圖
convert images/deepwiki-github.png -resize 1280x800 screenshot-original.png
convert images/deepwiki-markdown.png -resize 1280x800 screenshot-result.png
```

### 使用 Python（PIL/Pillow）

```python
from PIL import Image

def resize_for_store(input_path, output_path, size=(1280, 800)):
    img = Image.open(input_path)

    # 保持長寬比例，填充白色背景
    img.thumbnail(size, Image.Resampling.LANCZOS)

    # 創建白色背景
    background = Image.new('RGB', size, (255, 255, 255))

    # 置中貼上
    offset = ((size[0] - img.size[0]) // 2, (size[1] - img.size[1]) // 2)
    background.paste(img, offset)

    background.save(output_path)

# 使用範例
resize_for_store('images/UI.png', 'screenshot-ui.png')
```

## ✅ 圖片檢查清單

上傳前確認：

### 截圖
- [ ] 至少準備 1 張截圖（建議 3-5 張）
- [ ] 尺寸為 1280x800 或 640x400
- [ ] 格式為 PNG 或 JPEG
- [ ] 圖片清晰，無模糊或失真
- [ ] 截圖真實反映擴充功能實際使用情況
- [ ] 沒有個人敏感資訊

### 推廣圖片（可選）
- [ ] 小型推廣圖 440x280（如有）
- [ ] 大型推廣圖 1400x560（如有）
- [ ] 設計專業，符合品牌風格
- [ ] 文字清晰可讀

## 🎯 設計要點

1. **保持簡潔**：避免過多文字和複雜元素
2. **突出功能**：清楚展示擴充功能的核心價值
3. **真實呈現**：使用實際的介面截圖，不要過度美化
4. **品牌一致**：使用統一的配色和圖示
5. **高解析度**：確保圖片清晰，避免模糊

## 📁 建議的檔案命名

```
store-images/
├── screenshot-01-ui.png           (擴充功能介面)
├── screenshot-02-original.png     (DeepWiki 原始頁面)
├── screenshot-03-result.png       (Markdown 結果)
├── screenshot-04-batch.png        (批次下載過程，可選)
├── screenshot-05-zip.png          (ZIP 結果，可選)
├── promo-small-440x280.png        (小型推廣圖，可選)
└── promo-large-1400x560.png       (大型推廣圖，可選)
```

## 💡 快速開始

### 最小需求（僅使用現有圖片）

1. 調整 `images/UI.png` 為 1280x800
2. 上傳到 Chrome Web Store 作為唯一截圖
3. 完成上架

### 建議方案（3 張截圖）

1. UI 介面截圖（調整 images/UI.png）
2. 使用範例截圖（新建或調整現有圖片）
3. 轉換結果截圖（調整 images/deepwiki-markdown.png）

### 完整方案（5 張 + 推廣圖）

1. 5 張不同角度的功能截圖
2. 設計 440x280 小型推廣圖
3. 設計 1400x560 大型推廣圖

## 🔍 範例參考

可以參考這些優秀的 Chrome 擴充功能：
- [Grammarly](https://chrome.google.com/webstore/detail/grammarly)
- [Todoist](https://chrome.google.com/webstore/detail/todoist)
- [ColorZilla](https://chrome.google.com/webstore/detail/colorzilla)

觀察他們的：
- 截圖風格和數量
- 推廣圖片設計
- 文字說明方式

## 📞 需要協助？

如果在準備圖片時遇到問題：

1. 查看 [Chrome Web Store 圖片要求](https://developer.chrome.com/docs/webstore/images/)
2. 在專案 GitHub 開 Issue
3. 聯絡維護者：[@philipz](https://github.com/philipz)

---

**提示**：圖片品質直接影響使用者的第一印象，建議花時間準備高品質的截圖和推廣圖片。
