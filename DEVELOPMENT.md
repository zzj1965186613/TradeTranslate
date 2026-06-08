# TradeTranslate 开发指南 (Developer Guide)

> 本文档记录开发过程中踩过的坑和最佳实践，避免重复犯错浪费算力。

---

## ⚠️ 核心规则：文件编码

### PowerShell 写文件会破坏 UTF-8 编码

**严重程度：🔴 高 — 会导致 UI 乱码和代码注释损坏**

**问题描述：**
PowerShell 的 `Set-Content` 默认使用系统 locale 编码（Windows 中文系统通常是 GBK/GB2312），而不是 UTF-8。当文件包含中文、日文、韩文、emoji 等多字节字符时，这些字符会被写成 `?` 或乱码。

**受影响场景：**
- popup.html 中的语言名称（简体中文、日本語、한국어、Español 等）全部变成 `???`
- background.ts / content.ts 中的中文注释被破坏
- 即使文件头声明了 `<meta charset="UTF-8">`，内容已经是乱码，声明无效

**错误示例：**
```
# ❌ 错误：默认编码，会破坏多字节字符
Set-Content -Path "popup.html" -Value $content -NoNewline

# ❌ 错误：-Encoding utf8 在某些 PowerShell 版本中会加 BOM
Set-Content -Path "popup.html" -Value $content -Encoding utf8
```

**正确做法：**
```
# ✅ 正确：使用 .NET 方法，强制 UTF-8 无 BOM
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))

# ✅ 正确：使用 Node.js（天然 UTF-8）
node -e "require('fs').writeFileSync('file.html', content, 'utf8')"

# ✅ 正确：写成 .js 脚本文件用 node 执行，避免 PowerShell 转义和编码问题
```

**检测方法：**
修改文件后，用以下命令检查是否出现乱码：
```
Select-String -Path "dist\popup.html" -Pattern "简体中文|한국어|Español"
# 应该能匹配到内容，如果匹配不到说明已被破坏
```

**已知教训：**
本项目在 v1.1.1 开发过程中，连续多轮修改都因 Set-Content 导致 popup.html 乱码，
最终不得不 git checkout 恢复原始文件后用 Node.js 重新应用所有修改。
**浪费了大量对话轮次和算力。**

---

## ⚠️ 核心规则：翻译 API 请求结构

### system prompt 不要单独依赖 system role

**严重程度：🟡 中 — 模型可能忽略 system prompt，返回对话回答而非翻译**

**问题描述：**
部分模型（如 Xiaomi MiMo）对 OpenAI 兼容 API 中的 system role 不敏感，会忽略
system prompt，把 user message 当成对话问题来回答。输入"你是谁"会返回模型自我介绍。

**错误示例：**
```json
{
  "messages": [
    { "role": "system", "content": "Translate to English..." },
    { "role": "user", "content": "你是谁" }
  ]
}
```

**正确做法：**
将翻译指令和原文合并到 user message 中：
```json
{
  "messages": [
    { "role": "user", "content": "Translate the following Chinese text to English. Output the translation only, nothing else.\n\n你是谁" }
  ]
}
```

---

## ⚠️ 拼音输入法兼容性

### 不要对每个 input 事件立即发翻译请求

**严重程度：🟡 中 — 导致大量无意义 API 调用**

**问题描述：**
中文拼音输入法每输入一个字母都会触发 input 事件。
打"你是谁"会产生十几个中间态："你" → "你s" → "你sh" → "你是sh" → … → "你是谁"。

**正确做法：**
- 统一使用 debounce（建议 300ms），等待用户停止输入后再翻译
- 加去重机制：cachedSource === text 或 lastPreTranslateText === text 时跳过
- 发送期间（isProcessingSend）忽略所有 input 事件
- 发送完成的 finally 块中清除 debounce timer（但不清 lastPreTranslateText）

---

## ⚠️ WhatsApp Lexical 编辑器兼容性

### setInputText 触发的 input 事件会被误处理

**严重程度：🟡 中 — 发送后出现重复翻译请求**

**问题描述：**
setInputText() 通过 dispatch beforeinput 事件替换输入框文本，这会触发 input 事件
监听器。如果 isProcessingSend 已重置为 false，debouncedPreTranslate 会被触发，
对刚翻译完的文本再发一次请求。

**正确做法：**
- input 事件监听器必须检查 isProcessingSend
- finally 块中清除 debounce timer
- 加 cachedTranslation === text 检查：输入框内容跟翻译结果一样则跳过

---

## 构建与验证检查清单

每次修改后重新构建时：

1. **编码检查**：确认 popup.html 中多字节字符未被破坏
2. **构建**：npm run build 无报错
3. **manifest.json**：确认 <all_urls> 在 host_permissions 中
4. **Console 测试**：发送中文消息，确认无重复 Pre-cached 条目
5. **翻译正确性**：确认返回的是翻译而不是模型回答
