# 掘金/CSDN 文章简洁提取器

一个用于 Tampermonkey 的文章提取脚本，支持在掘金和 CSDN 文章页提取正文，并导出为 Markdown、Markdown 图片包 ZIP、Word 或 PDF。

## 功能

- 一键提取当前文章正文
- 复制正文内容
- 保存为 Markdown，图片保留网络链接
- 保存为 `MD+图片 ZIP`，图片会下载到 `images/` 目录，并自动替换 Markdown 图片路径
- 保存为 Word `.doc` 文件，图片会尽量内嵌到文档中
- 保存为 PDF，导出前会尽量内嵌图片，并通过浏览器打印窗口另存为 PDF
- 支持掘金文章页和 CSDN 文章页

## 支持网站

- CSDN：`https://blog.csdn.net/*/article/details/*`
- CSDN 子域名：`https://*.blog.csdn.net/article/details/*`

## 安装方法

1. 安装浏览器扩展 Tampermonkey。
2. 打开 `juejin-csdn-article-extractor.user.js`。
3. 复制全部脚本内容。
4. 在 Tampermonkey 中新建脚本，粘贴内容并保存。
5. 打开掘金或 CSDN 的文章页，页面右侧会出现 `提取文章` 按钮。

## 使用方法

1. 点击页面右侧的 `提取文章` 按钮。
2. 面板打开后会自动提取文章正文。
3. 根据需要点击底部按钮：
   - `复制`：复制文章内容。
   - `存为 MD`：保存 Markdown 文件，图片使用网络链接。
   - `MD+图片 ZIP`：保存 Markdown 和本地图片压缩包。
   - `存为 Word`：保存为 `.doc` 文档，图片会尽量保存到文档中。
   - `存为 PDF`：打开打印窗口，选择 `另存为 PDF`。

## 项目结构

```text
juejin-csdn-article-extractor/
├── juejin-csdn-article-extractor.user.js
├── README.md
├── CHANGELOG.md
├── LICENSE
└── screenshots/
```

## 截图

截图可以放在 `screenshots/` 目录中，例如：

- `screenshots/panel.png`
- `screenshots/export.png`

## 注意事项

- 第一次安装后，Tampermonkey 可能会提示脚本需要跨域请求权限，这是为了下载文章图片。
- `MD+图片 ZIP` 依赖图片站点是否允许下载，失败的图片会记录在压缩包内的 `failed-images.txt`。
- Word 文件是 HTML 格式的 `.doc`，推荐使用 Microsoft Word 或 WPS 打开。
- PDF 导出会打开浏览器打印窗口，需要在打印目标中选择 `另存为 PDF`。
- 如果页面内容没有加载完成，请等待文章加载完后点击 `重新执行`。

## 许可证

本项目使用 MIT License。
