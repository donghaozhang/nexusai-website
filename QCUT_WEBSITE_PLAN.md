# QCut 网站改版计划

## 目标

将 NexusAI 网站改版为 **QCut** 品牌官网，展示 QCut 视频编辑器和 video-agent-skill AI 内容生成能力。

---

## 一、品牌定位

### 原网站：NexusAI
- 通用 AI 解决方案公司
- 企业级定位

### 新网站：QCut
- **口号**: "Free, Open-Source Video Editor with AI Superpowers"
- **定位**: 面向创作者的免费视频编辑工具
- **核心卖点**:
  1. 完全免费，无水印
  2. 隐私优先，本地处理
  3. AI 驱动的内容生成
  4. 开源透明

---

## 二、页面结构规划

### 2.1 首页 (index.html)

| 区块 | 原内容 | 新内容 |
|------|--------|--------|
| Hero | NexusAI 介绍 | QCut 编辑器展示 + 下载按钮 |
| Features | AI Agent 解决方案 | QCut 核心功能 (时间轴、AI生成等) |
| Technology | 技术架构 | AI 模型能力 (40+ 模型) |
| Stats | 通用统计 | 用户数、模型数、处理视频数 |
| CTA | 联系销售 | 立即下载 / GitHub Star |

### 2.2 Solutions → Features (solutions.html)

**改为功能详情页**

| 功能模块 | 描述 |
|----------|------|
| 🎬 时间轴编辑 | 多轨道、拖放、精确剪辑 |
| 🤖 AI 文生视频 | 输入文字 → 生成视频 |
| 🎨 AI 文生图 | FLUX, Imagen 4, Nano Banana |
| 🔄 AI 图生视频 | Veo 3, Kling, Sora 2 |
| 🗣️ AI 配音 | ElevenLabs 20+ 语音 |
| 👤 AI Avatar | 数字人视频生成 |
| 🎵 音效库 | Freesound 集成 |
| 📝 字幕生成 | AI 自动转录 |

### 2.3 About (about.html)

| 区块 | 内容 |
|------|------|
| Mission | 让每个人都能免费创作专业视频 |
| Why QCut | CapCut 越来越贵，我们提供免费替代 |
| Open Source | GitHub 仓库链接、贡献指南 |
| Tech Stack | Electron + React + FFmpeg + AI |

### 2.4 Blog (blog.html)

**改为文档/教程页**

| 教程 | 描述 |
|------|------|
| 快速开始 | 5分钟上手 QCut |
| AI 功能指南 | 如何使用 AI 生成功能 |
| API 配置 | 配置 FAL/ElevenLabs API |
| 开发者指南 | 如何贡献代码 |

### 2.5 Case Studies (case-studies.html)

**改为作品展示页**

- 用户创作的视频作品
- AI 生成示例
- Before/After 对比

---

## 三、设计修改

### 3.1 品牌元素

| 元素 | 原值 | 新值 |
|------|------|------|
| Logo | NexusAI | QCut Logo (从 qcut 仓库获取) |
| 主色调 | 蓝色渐变 | 紫色/粉色渐变 (创意感) |
| 字体 | Orbitron + Inter | 保持或微调 |
| Favicon | NexusAI | QCut |

### 3.2 Hero 区域设计

```
┌─────────────────────────────────────────────────────┐
│                      QCut                            │
│     Free Video Editor with AI Superpowers           │
│                                                      │
│  [编辑器截图/动画展示]                               │
│                                                      │
│  [⬇️ Download for Windows]  [⭐ Star on GitHub]     │
│                                                      │
│  ✓ 100% Free  ✓ No Watermark  ✓ AI Powered         │
└─────────────────────────────────────────────────────┘
```

### 3.3 功能展示卡片

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  🎬 Timeline │ │  🤖 AI Gen   │ │  🎨 Effects  │
│              │ │              │ │              │
│ Multi-track  │ │ Text→Video  │ │ Filters     │
│ Drag & Drop  │ │ Image→Video │ │ Transitions │
│ Precise Cut  │ │ Text→Image  │ │ Text Overlay│
└──────────────┘ └──────────────┘ └──────────────┘
```

---

## 四、AI 模型展示

### 4.1 模型分类展示

```html
<!-- 新增 AI Models 区块 -->
<section id="ai-models">
  <h2>40+ AI Models at Your Fingertips</h2>
  
  <div class="model-categories">
    <!-- Text to Image -->
    <div class="category">
      <h3>🖼️ Text to Image</h3>
      <ul>
        <li>FLUX.1 Dev - $0.003</li>
        <li>Imagen 4 - $0.002</li>
        <li>Nano Banana Pro - $0.002</li>
      </ul>
    </div>
    
    <!-- Image to Video -->
    <div class="category">
      <h3>🎥 Image to Video</h3>
      <ul>
        <li>Veo 3 - $2.50-6.00</li>
        <li>Sora 2 - $0.40-1.20</li>
        <li>Kling 2.6 Pro - $0.50-1.00</li>
      </ul>
    </div>
    
    <!-- 更多类别... -->
  </div>
</section>
```

### 4.2 价格透明展示

| 功能 | 价格范围 | 说明 |
|------|----------|------|
| 文生图 | $0.001-0.004 | 每张图 |
| 图生视频 | $0.08-6.00 | 取决于模型 |
| Avatar | $0.02-0.25 | 取决于分辨率 |
| TTS | 按字符计费 | ElevenLabs |

---

## 五、文件修改清单

### 5.1 HTML 文件

| 文件 | 修改内容 |
|------|----------|
| `index.html` | Hero、Features、Stats、CTA |
| `about.html` | Mission、Team、Tech Stack |
| `solutions.html` | → 重命名为功能页 |
| `blog.html` | → 改为文档/教程 |
| `case-studies.html` | → 改为作品展示 |

### 5.2 新增文件

| 文件 | 用途 |
|------|------|
| `download.html` | 下载页面 |
| `docs/` | 文档目录 |
| `pricing.html` | AI 模型定价 (可选) |

### 5.3 资源文件

| 文件 | 来源 |
|------|------|
| `assets/logo.png` | 从 qcut 仓库复制 |
| `assets/screenshots/` | QCut 编辑器截图 |
| `assets/demo.mp4` | 演示视频 (可选) |

---

## 六、实施步骤

### Phase 1: 品牌替换 (1-2小时)
- [ ] 替换 Logo 和 Favicon
- [ ] 更新页面标题和 meta
- [ ] 修改导航栏
- [ ] 更新页脚

### Phase 2: 首页改版 (2-3小时)
- [ ] Hero 区域重写
- [ ] Features 卡片重写
- [ ] Stats 数据更新
- [ ] CTA 按钮更新

### Phase 3: 功能页面 (2-3小时)
- [ ] solutions.html → features.html
- [ ] 添加 AI 模型展示
- [ ] 添加功能详情

### Phase 4: 其他页面 (1-2小时)
- [ ] About 页面更新
- [ ] Blog → Docs 改造
- [ ] Case Studies → Gallery

### Phase 5: 优化完善 (1-2小时)
- [ ] 响应式检查
- [ ] 中英文切换
- [ ] 深色/浅色模式
- [ ] 性能优化

---

## 七、内容素材需求

### 7.1 文案

| 内容 | 状态 |
|------|------|
| Hero 标语 | 待定 |
| 功能描述 | 可从 README 提取 |
| About 故事 | 待定 |

### 7.2 图片

| 素材 | 来源 |
|------|------|
| QCut Logo | `qcut/apps/web/public/assets/logo-v4.png` |
| 编辑器截图 | 需要截图 |
| AI 生成示例 | 可用 mock 图片 |

### 7.3 视频 (可选)

| 素材 | 描述 |
|------|------|
| Demo Video | 30秒产品演示 |
| Tutorial | 快速上手教程 |

---

## 八、技术注意事项

1. **保持原有架构** - Tailwind CSS + 原生 JS
2. **中英文支持** - 保留语言切换功能
3. **深色模式** - 保留主题切换
4. **响应式** - 确保移动端适配
5. **SEO** - 更新 meta 标签

---

## 九、参考资源

- **QCut 仓库**: `ignore/qcut/`
- **video-agent-skill**: `ignore/video-agent-skill/`
- **原网站**: 当前 `index.html` 等文件
- **QCut Logo**: `ignore/qcut/apps/web/public/assets/logo-v4.png`

---

## 下一步

1. 确认计划内容
2. 开始 Phase 1: 品牌替换
3. 逐步完成各阶段

**预计总时间**: 8-12 小时

---

*计划创建时间: 2026-02-03*
*分支: qcut*
