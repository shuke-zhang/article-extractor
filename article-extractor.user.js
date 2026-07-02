// ==UserScript==
// @name         掘金文章简洁提取器
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  提取掘金/CSDN文章正文，支持复制、保存网络图 Markdown、保存本地图 Markdown 图片包和保存 Word 文档。
// @author       You
// @match        https://juejin.cn/post/*
// @match        https://blog.csdn.net/*/article/details/*
// @match        https://*.blog.csdn.net/article/details/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @connect      byteimg.com
// @connect      *.byteimg.com
// @connect      p9-xtjj-sign.byteimg.com
// @connect      csdnimg.cn
// @connect      *.csdnimg.cn
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict'

  if (window.top !== window.self)
    return

  const ROOT_ID = 'juejin-simple-extractor-root'
  const MAX_WORD_IMAGE_WIDTH = 720
  const IMAGE_TIMEOUT = 12000
  const ZIP_TIMEOUT = 60000
  const IMAGE_ZIP_FOLDER = 'images'

  let extracted = null
  let panelOpen = false

  boot()

  function boot() {
    if (document.getElementById(ROOT_ID))
      return

    const root = document.createElement('div')
    root.id = ROOT_ID
    root.innerHTML = `
      <button id="jse-trigger" type="button" title="打开提取器"><span>提取文章</span></button>
      <section id="jse-panel" aria-live="polite">
        <header id="jse-header">
          <button id="jse-extract" class="jse-tab is-active" type="button">一键提取</button>
          <button id="jse-rerun" class="jse-ghost" type="button">重新执行</button>
          <button id="jse-clear" class="jse-ghost" type="button">清空</button>
          <button id="jse-close" class="jse-close" type="button" title="关闭">×</button>
        </header>
        <main id="jse-content">
          <div id="jse-empty">点击“一键提取”获取当前文章正文。</div>
          <article id="jse-preview"></article>
        </main>
        <footer id="jse-footer">
          <button id="jse-copy" class="jse-action" type="button">复制</button>
          <button id="jse-md" class="jse-action" type="button">存为 MD</button>
          <button id="jse-zip" class="jse-action" type="button">MD+图片 ZIP</button>
          <button id="jse-word" class="jse-action jse-primary" type="button">存为 Word</button>
        </footer>
        <div id="jse-toast"></div>
      </section>
    `

    const style = document.createElement('style')
    style.textContent = getStyle()

    document.documentElement.appendChild(root)
    document.head.appendChild(style)

    bindEvents(root)
  }

  function bindEvents(root) {
    const trigger = root.querySelector('#jse-trigger')
    const panel = root.querySelector('#jse-panel')
    const btnExtract = root.querySelector('#jse-extract')
    const btnRerun = root.querySelector('#jse-rerun')
    const btnClear = root.querySelector('#jse-clear')
    const btnClose = root.querySelector('#jse-close')
    const btnCopy = root.querySelector('#jse-copy')
    const btnMd = root.querySelector('#jse-md')
    const btnZip = root.querySelector('#jse-zip')
    const btnWord = root.querySelector('#jse-word')

    trigger.addEventListener('click', () => {
      panelOpen = !panelOpen
      panel.classList.toggle('is-open', panelOpen)
      if (panelOpen)
        extractAndRender()
    })

    btnClose.addEventListener('click', () => {
      panelOpen = false
      panel.classList.remove('is-open')
    })

    btnExtract.addEventListener('click', extractAndRender)
    btnRerun.addEventListener('click', extractAndRender)

    btnClear.addEventListener('click', () => {
      extracted = null
      renderEmpty()
      showToast('已清空')
    })

    btnCopy.addEventListener('click', copyExtracted)
    btnMd.addEventListener('click', saveMarkdown)
    btnZip.addEventListener('click', saveMarkdownZip)
    btnWord.addEventListener('click', saveWord)
  }

  async function extractAndRender() {
    try {
      setBusy('正在提取...')

      const article = getArticleElement()
      if (!article)
        throw new Error('没有找到文章正文，请等待页面加载完成后重试。')

      const title = getArticleTitle()
      const clone = article.cloneNode(true)
      cleanArticleNode(clone)
      normalizeImages(clone)

      const markdown = buildMarkdown(title, domToMarkdown(clone))
      const html = clone.innerHTML

      extracted = { title, html, markdown }
      renderExtracted(extracted)
      showToast('提取完成')
    }
    catch (err) {
      console.error('[juejin-simple-extractor]', err)
      showToast(err instanceof Error ? err.message : String(err))
    }
    finally {
      setBusy('')
    }
  }

  function renderExtracted(data) {
    const empty = document.querySelector('#jse-empty')
    const preview = document.querySelector('#jse-preview')

    empty.style.display = 'none'
    preview.style.display = 'block'
    preview.innerHTML = `<h1>${escapeHtml(data.title)}</h1>${data.html}`
  }

  function renderEmpty() {
    const empty = document.querySelector('#jse-empty')
    const preview = document.querySelector('#jse-preview')

    empty.style.display = 'block'
    preview.style.display = 'none'
    preview.innerHTML = ''
  }

  async function copyExtracted() {
    if (!extracted) {
      showToast('暂无可复制内容')
      return
    }

    try {
      const html = `<h1>${escapeHtml(extracted.title)}</h1>${extracted.html}`

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([extracted.markdown], { type: 'text/plain' }),
        })])
      }
      else {
        await navigator.clipboard.writeText(extracted.markdown)
      }

      showToast('已复制')
    }
    catch (err) {
      console.warn('[juejin-simple-extractor] 复制失败，降级选择文本', err)
      await navigator.clipboard.writeText(extracted.markdown)
      showToast('已复制 Markdown')
    }
  }

  function saveMarkdown() {
    if (!extracted) {
      showToast('暂无可保存内容')
      return
    }

    const blob = new Blob(['\uFEFF', extracted.markdown], { type: 'text/markdown;charset=utf-8' })
    downloadBlob(blob, `${safeFileName(extracted.title)}.md`)
    showToast('已保存 Markdown')
  }

  async function saveMarkdownZip() {
    if (!extracted) {
      showToast('暂无可保存内容')
      return
    }

    const btn = document.querySelector('#jse-zip')
    const oldText = btn.textContent

    if (btn.dataset.processing === 'true')
      return

    try {
      btn.dataset.processing = 'true'
      btn.disabled = true
      btn.textContent = '准备图片...'

      const localImages = collectMarkdownImages(extracted.markdown)
      let localMarkdown = extracted.markdown
      let done = 0
      let success = 0
      const failures = []
      const files = []

      await runWithConcurrency(localImages, 4, async (image) => {
        try {
          const fileData = await withTimeout(
            fetchImageArrayBuffer(image.url),
            IMAGE_TIMEOUT + 2000,
            `图片下载无响应：${image.url}`,
          )
          files.push({
            name: `${IMAGE_ZIP_FOLDER}/${image.localName}`,
            data: new Uint8Array(fileData),
          })
          localMarkdown = localMarkdown.split(image.url).join(`${IMAGE_ZIP_FOLDER}/${image.localName}`)
          success++
        }
        catch (err) {
          failures.push(`${image.url}\n${err instanceof Error ? err.message : String(err)}`)
          console.warn('[juejin-simple-extractor] 图片写入 zip 失败：', image.url, err)
        }
        finally {
          done++
          btn.textContent = localImages.length ? `图片 ${done}/${localImages.length}` : '生成 ZIP...'
        }
      })

      files.unshift({
        name: `${safeFileName(extracted.title)}.md`,
        data: textToUint8Array(`\uFEFF${localMarkdown}`),
      })

      if (failures.length > 0) {
        files.push({
          name: 'failed-images.txt',
          data: textToUint8Array([
            `成功写入图片：${success}/${localImages.length}`,
            '',
            failures.join('\n\n---\n\n'),
            '',
          ].join('\n')),
        })
      }

      btn.textContent = '生成 ZIP...'

      const zipBlob = await withTimeout(
        Promise.resolve().then(() => buildZipBlob(files)),
        ZIP_TIMEOUT,
        'ZIP 生成超时',
      )

      downloadBlob(zipBlob, `${safeFileName(extracted.title)}.zip`)
      showToast('已保存 MD 图片包')
    }
    catch (err) {
      console.error('[juejin-simple-extractor] 保存 ZIP 失败', err)
      showToast('保存 ZIP 失败')
    }
    finally {
      delete btn.dataset.processing
      btn.disabled = false
      btn.textContent = oldText
    }
  }

  async function saveWord() {
    if (!extracted) {
      showToast('暂无可保存内容')
      return
    }

    const btn = document.querySelector('#jse-word')
    const oldText = btn.textContent

    try {
      btn.disabled = true
      btn.textContent = '处理图片...'

      const docNode = document.createElement('article')
      docNode.innerHTML = `<h1>${escapeHtml(extracted.title)}</h1>${extracted.html}`

      await inlineImagesForWord(docNode, (done, total) => {
        btn.textContent = total ? `处理图片 ${done}/${total}` : '生成 Word...'
      })

      btn.textContent = '生成 Word...'

      const html = buildWordHtml(extracted.title, docNode.innerHTML)
      const blob = new Blob(['\uFEFF', html], { type: 'application/msword;charset=utf-8' })

      downloadBlob(blob, `${safeFileName(extracted.title)}.doc`)
      showToast('已保存 Word')
    }
    catch (err) {
      console.error('[juejin-simple-extractor] 保存 Word 失败', err)
      showToast('保存 Word 失败')
    }
    finally {
      btn.disabled = false
      btn.textContent = oldText
    }
  }

  async function inlineImagesForWord(root, onProgress) {
    const imgs = [...root.querySelectorAll('img')]
      .map(img => ({ img, src: getImageSrc(img) }))
      .filter(item => item.src && !item.src.startsWith('data:'))

    let done = 0
    onProgress(done, imgs.length)

    await runWithConcurrency(imgs, 5, async ({ img, src }) => {
      try {
        const url = toAbsoluteUrl(sanitizeImageUrl(src))
        const dataUrl = await fetchImageAsBase64(url, MAX_WORD_IMAGE_WIDTH)
        img.src = dataUrl
        img.removeAttribute('srcset')
        img.removeAttribute('data-src')
        img.removeAttribute('data-original')
        img.removeAttribute('loading')
      }
      catch (err) {
        console.warn('[juejin-simple-extractor] 图片转 base64 失败，保留原图链接：', src, err)
      }
      finally {
        done++
        onProgress(done, imgs.length)
      }
    })
  }

  function fetchImageAsBase64(url, maxWidth) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'blob',
        timeout: IMAGE_TIMEOUT,
        ontimeout: () => reject(new Error(`图片下载超时：${url}`)),
        onerror: err => reject(err),
        onload: (response) => {
          if (response.status !== 200) {
            reject(new Error(`图片请求失败：${response.status}`))
            return
          }

          const blob = response.response
          const objectUrl = URL.createObjectURL(blob)
          const img = new Image()

          img.onload = () => {
            try {
              let width = img.width
              let height = img.height

              if (width > maxWidth) {
                height = Math.round((maxWidth / width) * height)
                width = maxWidth
              }

              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height

              const ctx = canvas.getContext('2d')
              ctx.fillStyle = '#ffffff'
              ctx.fillRect(0, 0, width, height)
              ctx.drawImage(img, 0, 0, width, height)

              const dataUrl = canvas.toDataURL('image/jpeg', 0.88)
              URL.revokeObjectURL(objectUrl)
              resolve(dataUrl)
            }
            catch (err) {
              URL.revokeObjectURL(objectUrl)
              reject(err)
            }
          }

          img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl)
            reject(err)
          }

          img.src = objectUrl
        },
      })
    })
  }

  function fetchImageArrayBuffer(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        responseType: 'arraybuffer',
        timeout: IMAGE_TIMEOUT,
        ontimeout: () => reject(new Error(`图片下载超时：${url}`)),
        onerror: err => reject(err),
        onload: (response) => {
          if (response.status >= 200 && response.status < 300 && response.response) {
            resolve(response.response)
          }
          else {
            reject(new Error(`图片请求失败：${response.status}`))
          }
        },
      })
    })
  }

  function collectMarkdownImages(markdown) {
    const result = []
    const seen = new Set()
    const regex = /!\[[^\]]*\]\(([^)]+)\)/g
    let match

    while ((match = regex.exec(markdown))) {
      const url = sanitizeImageUrl(match[1])
      if (!url || url.startsWith('data:') || seen.has(url))
        continue

      seen.add(url)
      result.push({
        url,
        localName: `image-${String(result.length + 1).padStart(3, '0')}.${getImageExt(url)}`,
      })
    }

    return result
  }

  function buildWordHtml(title, bodyHtml) {
    return `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
          <meta charset="utf-8">
          <title>${escapeHtml(title)}</title>
          <style>
            body { font-family: "Times New Roman", "SimSun", serif; font-size: 12pt; line-height: 1.65; color: #111827; }
            h1 { font-size: 20pt; font-weight: bold; margin: 0 0 16pt; }
            h2 { font-size: 17pt; font-weight: bold; margin: 18pt 0 8pt; color: #0f766e; }
            h3 { font-size: 15pt; font-weight: bold; margin: 14pt 0 6pt; }
            p, li { font-size: 12pt; margin: 6pt 0; }
            img { max-width: 600px; height: auto; display: block; margin: 10pt 0; }
            pre { background: #f3f4f6; padding: 8pt; white-space: pre-wrap; }
            code { font-family: "Courier New", monospace; background: #f3f4f6; }
            blockquote { border-left: 4px solid #0f766e; padding-left: 10pt; color: #4b5563; }
            table { border-collapse: collapse; width: 100%; }
            td, th { border: 1px solid #d1d5db; padding: 6pt; }
          </style>
        </head>
        <body>${bodyHtml}</body>
      </html>
    `
  }

  function getArticleTitle() {
    const selectors = [
      'h1.article-title',
      '.article-title',
      '#articleContentId',
      '.title-article',
      'h1',
      'title',
    ]

    for (const selector of selectors) {
      const el = document.querySelector(selector)
      const text = el?.innerText || el?.textContent
      if (text && text.trim())
        return cleanText(text.trim())
    }

    return 'juejin-article'
  }

  function getArticleElement() {
    const selectors = [
      '.markdown-body',
      'article .markdown-body',
      '.article-content',
      '#content_views',
      '#article_content',
      '.blog-content-box article',
      '.article_content',
      'article',
      '.main-area .article',
    ]

    for (const selector of selectors) {
      const el = document.querySelector(selector)
      const text = el?.innerText || el?.textContent || ''
      if (el && text.trim().length > 50)
        return el
    }

    return null
  }

  function cleanArticleNode(root) {
    const removeSelectors = [
      'script',
      'style',
      'iframe',
      'button',
      '.copy-code-btn',
      '.code-block-extension-header',
      '.image-viewer-box',
      '.article-suspended-panel',
      '.extension',
      '.comment-list-box',
      '.author-info-block',
      '.recommend-box',
      '.csdn-side-toolbar',
      '.blog-footer-bottom',
      '.recommend-right',
      '.more-toolbox',
      '.hide-article-box',
    ]

    root.querySelectorAll(removeSelectors.join(',')).forEach(el => el.remove())
  }

  function normalizeImages(root) {
    root.querySelectorAll('img').forEach((img) => {
      const src = getImageSrc(img)
      if (!src)
        return

      img.src = toAbsoluteUrl(sanitizeImageUrl(src))
      img.removeAttribute('srcset')
      img.removeAttribute('data-src')
      img.removeAttribute('data-original')
      img.loading = 'lazy'
    })
  }

  function domToMarkdown(root) {
    const parts = []

    root.childNodes.forEach((node) => {
      const md = nodeToMarkdown(node, 0)
      if (md && md.trim())
        parts.push(md.trim())
    })

    return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  function nodeToMarkdown(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE)
      return normalizeText(node.textContent || '')

    if (node.nodeType !== Node.ELEMENT_NODE)
      return ''

    const el = node
    const tag = el.tagName.toLowerCase()

    if (tag === 'br')
      return '\n'

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.substring(1))
      return `${'#'.repeat(level)} ${childrenToMarkdown(el, depth).trim()}`
    }

    if (tag === 'p')
      return childrenToMarkdown(el, depth).trim()

    if (tag === 'strong' || tag === 'b')
      return wrapInline(childrenToMarkdown(el, depth), '**')

    if (tag === 'em' || tag === 'i')
      return wrapInline(childrenToMarkdown(el, depth), '*')

    if (tag === 'del' || tag === 's')
      return wrapInline(childrenToMarkdown(el, depth), '~~')

    if (tag === 'code') {
      if (el.closest('pre'))
        return el.textContent || ''
      const text = el.textContent || ''
      return text ? `\`${text.replace(/`/g, '\\`')}\`` : ''
    }

    if (tag === 'pre') {
      const codeEl = el.querySelector('code')
      const code = codeEl ? codeEl.textContent : el.textContent
      const lang = getCodeLanguage(codeEl || el)
      return `\`\`\`${lang}\n${(code || '').replace(/\n+$/g, '')}\n\`\`\``
    }

    if (tag === 'blockquote') {
      return childrenToMarkdown(el, depth)
        .split('\n')
        .map(line => (line.trim() ? `> ${line}` : '>'))
        .join('\n')
    }

    if (tag === 'ul')
      return listToMarkdown(el, depth, false)

    if (tag === 'ol')
      return listToMarkdown(el, depth, true)

    if (tag === 'li')
      return childrenToMarkdown(el, depth).trim()

    if (tag === 'a') {
      const text = childrenToMarkdown(el, depth).trim() || el.href
      const href = el.getAttribute('href') || ''
      return href ? `[${escapeMd(text)}](${toAbsoluteUrl(href)})` : text
    }

    if (tag === 'img') {
      const src = getImageSrc(el)
      if (!src)
        return ''
      const alt = el.getAttribute('alt') || 'image'
      return `![${escapeMd(alt)}](${toAbsoluteUrl(sanitizeImageUrl(src))})`
    }

    if (tag === 'table')
      return tableToMarkdown(el)

    if (tag === 'hr')
      return '---'

    return childrenToMarkdown(el, depth)
  }

  function childrenToMarkdown(node, depth = 0) {
    const parts = []

    node.childNodes.forEach((child) => {
      const md = nodeToMarkdown(child, depth)
      if (md !== '')
        parts.push(md)
    })

    return parts.join('').replace(/[ \t]+\n/g, '\n')
  }

  function listToMarkdown(listEl, depth, ordered) {
    const items = [...listEl.children].filter(el => el.tagName?.toLowerCase() === 'li')

    return items.map((li, index) => {
      const prefix = ordered ? `${index + 1}. ` : '- '
      const indent = '  '.repeat(depth)
      const text = childrenToMarkdown(li, depth + 1).trim()

      return text
        .split('\n')
        .map((line, lineIndex) => (lineIndex === 0 ? `${indent}${prefix}${line}` : `${indent}  ${line}`))
        .join('\n')
    }).join('\n')
  }

  function tableToMarkdown(tableEl) {
    const rows = [...tableEl.querySelectorAll('tr')].map(tr => (
      [...tr.children].map(cell => (
        (cell.innerText || '')
          .replace(/\n/g, ' ')
          .replace(/\|/g, '\\|')
          .trim()
      ))
    ))

    if (!rows.length)
      return ''

    const header = rows[0]
    const divider = header.map(() => '---')
    const body = rows.slice(1)

    return [
      `| ${header.join(' | ')} |`,
      `| ${divider.join(' | ')} |`,
      ...body.map(row => `| ${row.join(' | ')} |`),
    ].join('\n')
  }

  function getImageSrc(img) {
    return (
      img.currentSrc
      || img.getAttribute('src')
      || img.getAttribute('data-src')
      || img.getAttribute('data-original')
      || img.getAttribute('data-url')
      || getFirstSrcsetUrl(img.getAttribute('srcset') || '')
      || ''
    )
  }

  function getCodeLanguage(codeEl) {
    if (!codeEl)
      return ''

    const match = String(codeEl.className || '').match(/language-([\w-]+)/)
    return match ? match[1] : ''
  }

  function buildMarkdown(title, content) {
    return [
      `# ${title}`,
      '',
      `> 原文链接：${location.href}`,
      '',
      '---',
      '',
      content,
      '',
    ].join('\n')
  }

  async function runWithConcurrency(list, limit, worker) {
    let index = 0
    const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (index < list.length) {
        const currentIndex = index++
        await worker(list[currentIndex], currentIndex)
      }
    })

    await Promise.all(runners)
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')

    a.href = url
    a.download = filename
    a.style.display = 'none'

    document.body.appendChild(a)
    a.click()

    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 3000)
  }

  function setBusy(text) {
    const btn = document.querySelector('#jse-extract')
    if (!btn)
      return

    btn.textContent = text || '一键提取'
    btn.disabled = Boolean(text)
  }

  function showToast(message) {
    const toast = document.querySelector('#jse-toast')
    if (!toast)
      return

    toast.textContent = message
    toast.classList.add('is-show')

    clearTimeout(showToast.timer)
    showToast.timer = setTimeout(() => {
      toast.classList.remove('is-show')
    }, 2200)
  }

  function withTimeout(promise, timeout, message) {
    let timer = null

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message))
      }, timeout)
    })

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer)
        clearTimeout(timer)
    })
  }

  function buildZipBlob(files) {
    const localParts = []
    const centralParts = []
    let offset = 0

    files.forEach((file) => {
      const nameBytes = textToUint8Array(file.name.replace(/\\/g, '/'))
      const data = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data)
      const crc = crc32(data)
      const localHeader = createZipLocalHeader(nameBytes, data.length, crc)
      const centralHeader = createZipCentralHeader(nameBytes, data.length, crc, offset)

      localParts.push(localHeader, nameBytes, data)
      centralParts.push(centralHeader, nameBytes)

      offset += localHeader.length + nameBytes.length + data.length
    })

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
    const centralOffset = offset
    const endRecord = createZipEndRecord(files.length, centralSize, centralOffset)

    return new Blob([...localParts, ...centralParts, endRecord], { type: 'application/zip' })
  }

  function createZipLocalHeader(nameBytes, size, crc) {
    const header = new Uint8Array(30)
    const view = new DataView(header.buffer)

    writeUint32(view, 0, 0x04034B50)
    writeUint16(view, 4, 20)
    writeUint16(view, 6, 0x0800)
    writeUint16(view, 8, 0)
    writeUint16(view, 10, getDosTime())
    writeUint16(view, 12, getDosDate())
    writeUint32(view, 14, crc)
    writeUint32(view, 18, size)
    writeUint32(view, 22, size)
    writeUint16(view, 26, nameBytes.length)
    writeUint16(view, 28, 0)

    return header
  }

  function createZipCentralHeader(nameBytes, size, crc, offset) {
    const header = new Uint8Array(46)
    const view = new DataView(header.buffer)

    writeUint32(view, 0, 0x02014B50)
    writeUint16(view, 4, 20)
    writeUint16(view, 6, 20)
    writeUint16(view, 8, 0x0800)
    writeUint16(view, 10, 0)
    writeUint16(view, 12, getDosTime())
    writeUint16(view, 14, getDosDate())
    writeUint32(view, 16, crc)
    writeUint32(view, 20, size)
    writeUint32(view, 24, size)
    writeUint16(view, 28, nameBytes.length)
    writeUint16(view, 30, 0)
    writeUint16(view, 32, 0)
    writeUint16(view, 34, 0)
    writeUint16(view, 36, 0)
    writeUint32(view, 38, 0)
    writeUint32(view, 42, offset)

    return header
  }

  function createZipEndRecord(fileCount, centralSize, centralOffset) {
    const record = new Uint8Array(22)
    const view = new DataView(record.buffer)

    writeUint32(view, 0, 0x06054B50)
    writeUint16(view, 4, 0)
    writeUint16(view, 6, 0)
    writeUint16(view, 8, fileCount)
    writeUint16(view, 10, fileCount)
    writeUint32(view, 12, centralSize)
    writeUint32(view, 16, centralOffset)
    writeUint16(view, 20, 0)

    return record
  }

  function crc32(data) {
    let crc = 0xFFFFFFFF

    for (let i = 0; i < data.length; i++) {
      crc ^= data[i]
      for (let j = 0; j < 8; j++)
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1))
    }

    return (crc ^ 0xFFFFFFFF) >>> 0
  }

  function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true)
  }

  function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true)
  }

  function getDosTime() {
    const now = new Date()
    return (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  }

  function getDosDate() {
    const now = new Date()
    return ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  }

  function textToUint8Array(text) {
    return new TextEncoder().encode(text)
  }

  function toAbsoluteUrl(url) {
    try {
      return new URL(url, location.href).href
    }
    catch {
      return url
    }
  }

  function sanitizeImageUrl(url) {
    return String(url || '')
      .replace(/&amp;/g, '&')
      .replace(/<[^>]*>.*$/s, '')
      .trim()
  }

  function getFirstSrcsetUrl(srcset) {
    const first = String(srcset || '').split(',')[0]?.trim()
    return first ? first.split(/\s+/)[0] : ''
  }

  function getImageExt(url) {
    try {
      const pathname = new URL(url, location.href).pathname.toLowerCase()
      if (pathname.includes('.jpg') || pathname.includes('.jpeg'))
        return 'jpg'
      if (pathname.includes('.png'))
        return 'png'
      if (pathname.includes('.gif'))
        return 'gif'
      if (pathname.includes('.webp') || pathname.includes('.awebp'))
        return 'webp'
      if (pathname.includes('.svg'))
        return 'svg'
    }
    catch {}

    return 'png'
  }

  function safeFileName(name) {
    const cleaned = String(name || 'article')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 120)
      .trim()

    return cleaned || 'juejin-article'
  }

  function cleanText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim()
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+/g, ' ')
  }

  function wrapInline(text, marker) {
    const clean = String(text || '').trim()
    return clean ? `${marker}${clean}${marker}` : ''
  }

  function escapeMd(text) {
    return String(text || '')
      .replace(/\[/g, '\\[')
      .replace(/\]/g, '\\]')
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function getStyle() {
    return `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      }

      #jse-trigger {
        position: fixed;
        right: 18px;
        top: 42vh;
        width: 124px;
        height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 16px 0 14px;
        border: 1px solid rgba(255, 255, 255, .32);
        border-radius: 999px;
        color: #f8feff;
        background: linear-gradient(135deg, #0891b2 0%, #22d3ee 100%);
        box-shadow: 0 14px 30px rgba(8, 145, 178, .26), 0 4px 12px rgba(15, 23, 42, .14);
        pointer-events: auto;
        cursor: pointer;
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 0;
        text-align: center;
        transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
      }

      #jse-trigger::before {
        content: "";
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #ecfeff;
        box-shadow: 0 0 0 4px rgba(236, 254, 255, .18);
      }

      #jse-trigger span {
        white-space: nowrap;
      }

      #jse-trigger:hover {
        transform: translateY(-1px);
        background: linear-gradient(135deg, #0e7490 0%, #06b6d4 100%);
        box-shadow: 0 18px 38px rgba(8, 145, 178, .32), 0 6px 14px rgba(15, 23, 42, .16);
      }

      #jse-panel {
        position: fixed;
        right: 18px;
        top: 5vh;
        width: min(640px, calc(100vw - 28px));
        height: 90vh;
        min-height: 440px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        color: #f8fafc;
        background:
          linear-gradient(180deg, rgba(36, 48, 67, .97), rgba(30, 41, 59, .98)),
          radial-gradient(circle at 18% 0%, rgba(34, 211, 238, .10), transparent 34%);
        border: 1px solid rgba(148, 163, 184, .20);
        border-radius: 18px;
        box-shadow: 0 28px 78px rgba(15, 23, 42, .46), 0 0 28px rgba(20, 228, 244, .10);
        backdrop-filter: blur(16px);
        pointer-events: auto;
        transform: translateX(calc(100% + 32px));
        transition: transform .28s cubic-bezier(.2, .8, .2, 1);
        resize: both;
      }

      #jse-panel.is-open {
        transform: translateX(0);
      }

      #jse-header {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(148, 163, 184, .18);
        background: rgba(15, 23, 42, .20);
      }

      #jse-header button,
      #jse-footer button {
        height: 46px;
        border: 0;
        border-radius: 9px;
        color: #e5e7eb;
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0;
        cursor: pointer;
      }

      .jse-tab {
        padding: 0 20px;
        background: rgba(20, 184, 166, .22);
        color: #28f2ff !important;
      }

      .jse-tab.is-active {
        background: linear-gradient(135deg, rgba(8, 145, 178, .55), rgba(20, 184, 166, .35));
      }

      .jse-ghost {
        padding: 0 14px;
        background: transparent;
        color: #aeb8ca !important;
      }

      .jse-ghost:hover,
      .jse-close:hover {
        background: rgba(148, 163, 184, .12);
        color: #fff !important;
      }

      .jse-close {
        margin-left: auto;
        width: 46px;
        min-width: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        font-size: 30px !important;
        line-height: 1;
        padding: 0;
      }

      #jse-content {
        flex: 1 1 auto;
        overflow: auto;
        padding: 24px 18px 26px;
        scrollbar-color: rgba(148, 163, 184, .55) transparent;
      }

      #jse-content::-webkit-scrollbar {
        width: 10px;
      }

      #jse-content::-webkit-scrollbar-track {
        background: transparent;
      }

      #jse-content::-webkit-scrollbar-thumb {
        border: 3px solid rgba(30, 41, 59, .98);
        border-radius: 999px;
        background: rgba(148, 163, 184, .62);
      }

      #jse-empty {
        margin-top: 40px;
        color: #cbd5e1;
        font-size: 16px;
        line-height: 1.8;
      }

      #jse-preview {
        display: none;
        color: #f8fafc;
        font-size: 16px;
        line-height: 1.78;
        overflow-wrap: anywhere;
      }

      #jse-preview h1 {
        margin: 0 0 22px;
        color: #22f2ff;
        font-size: 28px;
        line-height: 1.32;
        font-weight: 900;
      }

      #jse-preview h2 {
        margin: 26px 0 12px;
        color: #22f2ff;
        font-size: 22px;
        line-height: 1.35;
        font-weight: 900;
      }

      #jse-preview h3 {
        margin: 20px 0 10px;
        color: #7dd3fc;
        font-size: 19px;
        line-height: 1.4;
      }

      #jse-preview p {
        margin: 0 0 14px;
      }

      #jse-preview a {
        color: #67e8f9;
      }

      #jse-preview img {
        display: block;
        max-width: min(100%, 520px);
        height: auto;
        margin: 14px 0 18px;
        border-radius: 10px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, .32);
      }

      #jse-preview ul,
      #jse-preview ol {
        padding-left: 1.4em;
        margin: 8px 0 16px;
      }

      #jse-preview li {
        margin: 4px 0;
      }

      #jse-preview pre {
        overflow: auto;
        padding: 12px;
        border-radius: 10px;
        background: rgba(15, 23, 42, .72);
      }

      #jse-preview code {
        color: #f9a8d4;
        font-family: "Cascadia Code", Consolas, monospace;
      }

      #jse-preview blockquote {
        margin: 16px 0;
        padding: 8px 12px;
        border-left: 4px solid #22d3ee;
        background: rgba(14, 165, 233, .10);
        color: #cbd5e1;
      }

      #jse-footer {
        flex: 0 0 auto;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        padding: 16px;
        border-top: 1px solid rgba(148, 163, 184, .18);
        background: rgba(15, 23, 42, .18);
      }

      .jse-action {
        background: rgba(148, 163, 184, .20);
      }

      .jse-action:hover {
        background: rgba(148, 163, 184, .28);
      }

      .jse-primary {
        color: #ffffff !important;
        background: linear-gradient(135deg, #06b6d4, #22d3ee);
        box-shadow: 0 10px 28px rgba(6, 182, 212, .25);
      }

      .jse-primary:hover {
        background: linear-gradient(135deg, #0891b2, #06b6d4);
      }

      #jse-toast {
        position: absolute;
        left: 50%;
        bottom: 92px;
        transform: translateX(-50%) translateY(8px);
        max-width: calc(100% - 32px);
        padding: 9px 14px;
        border-radius: 999px;
        color: #fff;
        background: rgba(15, 23, 42, .92);
        box-shadow: 0 10px 28px rgba(0, 0, 0, .22);
        font-size: 13px;
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s ease, transform .2s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      #jse-toast.is-show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      @media (max-width: 700px) {
        #jse-trigger {
          right: 12px;
          width: 108px;
          height: 44px;
          font-size: 14px;
          padding: 0 13px;
        }

        #jse-panel {
          right: 10px;
          top: 3vh;
          width: calc(100vw - 20px);
          height: 94vh;
          border-radius: 14px;
        }

        #jse-header {
          gap: 6px;
          padding: 8px;
        }

        #jse-header button,
        #jse-footer button {
          height: 42px;
          font-size: 13px;
        }

        .jse-tab,
        .jse-ghost {
          padding: 0 10px;
        }

        #jse-preview {
          font-size: 15px;
        }

        #jse-preview h1 {
          font-size: 24px;
        }

        #jse-preview h2 {
          font-size: 20px;
        }
      }
    `
  }
})()
