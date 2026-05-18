# Weft 产品介绍

> Find the right Claude skill in seconds.
> See where your tokens go.
> Re-read every conversation.
>
> 全本地、零联网、开源 MIT。

<p align="center">
  <img src="../assets/banner.png" width="780" />
</p>

---

## 一、它解决什么问题

当你成为 Claude Code 重度用户后，三件事会同时变成困扰：

| 痛点 | 你会做什么 | 实际感受 |
|---|---|---|
| **Skill 太多记不住** | 翻 `~/.claude/skills/` 列表，从 50 个里挑一个 | "我装过那个能 ××× 的吗？" |
| **Token 消耗看不到** | 月底打开账单"咦怎么这么多" | 不知道哪天花得最凶、哪个项目最烧 |
| **历史对话翻不动** | 想找"上周和 Claude 讨论的方案"，靠记忆撞日期 | 知道一定写过，就是找不到 |

Weft 是一个 macOS 原生应用，把这三件事在一个窗口里解决。

---

## 二、三个 Tab，三件事

### 📦 Skills — 你的技能库管理台

- **模糊搜索**：`⌘K` 一下，搜技能名、描述、触发词全打中
- **使用频次统计**：扫描你的会话历史，告诉你哪些 skill 真用了几十次、哪些一次都没用
- **自动分组**：常用 / 从未使用 / 元工具 / 设计 / 生活场景 …… 一目了然
- **启用 / 禁用**：不想用的不删，移到 `skills.disabled/`，Claude Code 看不到，想用了一键还原
- **批量操作**：进入选择模式 → "选未使用" → "禁用选中"，30 秒清掉长尾
- **删除到废纸篓**：误删可恢复，键入名字二次确认才能删
- **一键备份 / 恢复**：把整套 skills + commands + settings 打包成 tar.gz 存到 ~/Documents/，换电脑用得上

### 📊 统计 — Token 消耗仪表盘

参考下面这张图，本地数据：

- 顶部 KPI：总 Token / 消息数 / 会话数
- 明细：输入 / 输出 / 缓存读 / 缓存写四列
- 每日柱状图：7 / 14 / 30 / 90 天窗口切换
- Token / 消息 双视图切换
- 按模型聚合表：Opus 4.7 烧了多少、Sonnet 4.6 烧了多少

> 数据来源：`~/.claude/projects/*/*.jsonl` 里 Claude Code 自己记录的 `usage` 字段。完全本地计算，不查 API。

### 📜 历史 — 你的所有对话

- **项目树**：按你的工作目录区分，最近用的排在最上
- **会话列表**：每条带首条 user 消息预览 + 时间 + 字节数
- **完整消息流**：user / assistant 渲染 markdown、工具调用以卡片形式展开
- **全局搜索**：搜"那次讨论的 Pareto 前沿" → 跨所有项目所有会话命中

---

## 三、为什么用它，不用别的

| | Claude Code 自带 | Weft |
|---|---|---|
| Skill 浏览 | 文件夹列表，名字看到就完事 | 描述、触发词、使用频次、可视化分组 |
| Skill 管理 | 手动 `mv`、`rm` | 启用/禁用、批量、删到废纸篓 |
| Token 统计 | ❌ | ✅ 每日柱图 + 模型分布 |
| 历史浏览 | 命令行 grep jsonl | 双栏 UI + 全局搜索 |
| 备份配置 | ❌ | ✅ 一键 tar.gz |
| 隐私 | ✅（本地）| ✅（本地） |

---

## 四、技术与隐私

- **Tauri 2 + React + TypeScript** 原生 macOS 应用，~6.5 MB，启动 <1s
- **Rust 后端**做文件读取和聚合，不用任何第三方服务
- **不联网**：所有数据来自 `~/.claude/`，整个 App 没有 API 客户端
- **开源 MIT**：代码在 GitHub，欢迎 PR

---

## 五、安装

### 推荐：从 Releases 下载

<https://github.com/WyattLee-nanami/weft/releases/latest>

1. 下载 `Weft_x.x.x_aarch64.dmg`（Apple Silicon）
2. 打开 DMG，把 Weft.app 拖到 Applications
3. 第一次打开：**系统设置 → 隐私与安全性 → 仍要打开**

### 或者从源码构建

```bash
git clone https://github.com/WyattLee-nanami/weft
cd weft
npm install
npm run tauri build
open src-tauri/target/release/bundle/macos/Weft.app
```

需要 Node 18+、Rust stable、Xcode CLT。

---

## 六、版本历史

| 版本 | 主要功能 |
|---|---|
| v0.1.x | Skill 浏览 + 搜索 + 使用频次统计 |
| v0.2.0 | 删除 skill 到废纸篓 |
| v0.3.0 | 启用/禁用、批量操作、备份/恢复 |
| **v0.5.0** | **统计仪表盘 + 历史浏览 + 全局搜索** |

---

## 七、Roadmap

- [ ] **v0.6** — Skill 内联编辑（frontmatter + body 实时预览）
- [ ] **v0.7** — 重复检测（embedding 相似度找重叠 skill）
- [ ] **v0.8** — Team 模式（把你的 skill 库以只读 HTML 分享给同事）
- [ ] **v0.9** — Hooks / Commands 管理（同样三栏 UI）

---

## 八、给团队/朋友介绍时的一段话

> 如果你是 Claude Code 重度用户，过去几个月可能装了几十个 skill、跑过上百个会话——但你不知道哪个 skill 真用过、token 都花在了哪、上次写的那段方案在哪条会话里。
>
> Weft 是一个 macOS 原生 App，把这三件事都解决了：管 skill 像管 App、查 token 像查账单、翻历史像翻聊天记录。完全本地、零联网、开源 MIT。
>
> 👉 https://github.com/WyattLee-nanami/weft

---

<p align="center">
  <sub>开源于 2026/05，作者 <a href="https://github.com/WyattLee-nanami">@WyattLee-nanami</a></sub>
</p>
