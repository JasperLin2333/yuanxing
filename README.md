# 元形 Yuanxing

**AI 时代的 Axure。用自然语言，把想法变成可评审、可体验的产品流程。**

复用已有截图与 HTML，只设计这次变化。把页面、操作和分支连成流程，随时切换画布与完整原型，再导出一个 HTML 文件交给同事。

**[直接体验](https://jasperlin2333.github.io/yuanxing/demo/prototype.html) · [查看画布](https://jasperlin2333.github.io/yuanxing/demo/review.html) · [开始使用](#start) · [产品介绍](https://jasperlin2333.github.io/yuanxing/) · [查看发布](https://github.com/JasperLin2333/yuanxing/releases/latest)**

[![元形：截图与 HTML 组成同一份可编辑项目，在流程画布和完整原型间切换](assets/readme-hero.png)](assets/readme-hero.svg)

## 只设计这次变化，也能看清整个流程

旧系统只增加一个弹窗，原型却得从整页复刻开始；AI 生成了几个漂亮页面，评审时还是要口头解释怎么走；方案讨论完了，同事拿到文件却没法实际体验。

元形把这些工作放进同一个原型项目：**不变的页面继续复用，需要变化的部分用 AI 完成，完整的用户路径在画布和原型里表达。**

| 你要推进的工作 | 元形帮你怎么做 |
| --- | --- |
| **在已有产品上加功能** | 保留截图或 HTML，补上这次改动的页面与交互 |
| **把流程想清楚、讲明白** | 在画布上组织页面、连线、分支和批注，推演入口到结果 |
| **让评审者实际试一遍** | 切到完整原型，点击、选择、输入，连续走完已经设计的路径 |
| **发给同事继续讨论** | 导出单个 HTML，离线打开即可查看和体验 |

新产品也可以从空白开始。你用自然语言描述意图，AI 负责组织页面与交互；你也可以直接拖动、连线、打点批注，继续打磨同一份设计。

## 先看全局，再实际操作

### 流程画布：把入口、分支和结果放在一起

页面关系一眼可见。拖动整理布局、连接操作路径、在页面上打点说明；局部修改保留已有的人工整理。

[![元形公开示例的真实流程画布：已有客户列表连接到分配表单、完成页和普通成员提示](assets/readme-canvas.png)](https://jasperlin2333.github.io/yuanxing/demo/review.html)

**[打开这个流程画布 →](https://jasperlin2333.github.io/yuanxing/demo/review.html)**

### 完整原型：从入口到结果，像使用产品一样体验

一键切换视图，直接操作页面中的控件。输入、选择和跳转保留真实交互；按 Esc 回到画布，继续推演和讨论。

[![元形公开示例的真实完整原型：从客户列表进入分配表单，实际选择负责成员](assets/readme-prototype.png)](https://jasperlin2333.github.io/yuanxing/demo/prototype.html)

**[直接体验这个原型 →](https://jasperlin2333.github.io/yuanxing/demo/prototype.html)**

截图来自公开的“客户分配”示例，界面与数据均为虚构。两种视图共用[同一份可编辑项目](examples/product-iteration/)。

## 拿一个已有功能，走完一段完整流程

**需求：给已有客户列表增加“分配客户”。**

| 阶段 | 怎么设计 |
| --- | --- |
| **复用旧页面** | 保留客户列表截图，为“分配客户”按钮设置热点 |
| **补上新操作** | 用 HTML 生成分配表单，让管理员选择负责成员 |
| **串起操作结果** | 确认后展示所选成员，再返回客户列表 |
| **讲清关键分支** | 普通成员从同一入口进入，展示对应权限提示 |

不必先准备完整 PRD，也不必一次重画全部页面。先让这次变化表达清楚，再沿着同一份源项目继续迭代。

## 一份设计，两种离线交付

| 流程评审工作台 | 完整原型 |
| --- | --- |
| 看页面关系、条件分支和说明 | 从指定入口连续操作 |
| 适合推演、讲解和方案评审 | 适合演示、试用和收集反馈 |
| 保留流程画布与页面批注 | 专注产品页面与真实操作 |

两种视图都能导出为**单个 HTML 文件**，内含页面、图片、脚本和样式。接收者在浏览器打开即可使用，无需安装元形或启动服务。

## 多个项目，放进同一个工作台

对 AI 说：“再建一个用户门户项目，加到当前工作台。”它会创建并登记项目；顶栏切换项目，各自保存页面、画布、批注和导出。

同一产品的多个模块可以组成完整原型，由 AI 串联已设计的按钮与导航。产品设计继续保存在项目目录中，通过共享运行时和项目扩展维护各自的交互。

<a id="start"></a>

## 开始使用

把这段话发给能够读写本地文件、运行命令的 AI 助手：

```text
请安装 https://github.com/JasperLin2333/yuanxing 中的元形 Skill。
先阅读 SKILL.md，按当前宿主的 Skill 目录规范安装，保留随包运行时与资源。
安装后，基于我提供的已有产品界面，只设计这次功能改动，生成流程画布和可独立体验的原型。
```

也可以在项目目录中运行，按提示选择 AI 助手：

```sh
npx skills add JasperLin2333/yuanxing --skill yuanxing
```

安装后，从一个具体需求开始：

> 使用元形。基于这张已有客户列表，只设计“分配客户”这次改动，保留其他区域。把管理员和普通成员的流程放到画布上，并导出能独立体验的原型。

**需要 Node.js 20+。使用你现有的 AI 助手，无需额外配置模型 API Key，也无需安装 npm 运行依赖。**

## 为持续迭代准备的工程能力

| 已有能力 | 可以直接查看的依据 |
| --- | --- |
| **156 项自动化测试** | 覆盖连线与分叉、撤销、交互状态、多项目隔离、版本冲突和离线导出：[测试代码](test/) |
| **同源的两种单文件交付** | 画布与完整原型共用项目数据，导出内嵌所需资源：[导出与独立使用测试](test/portable.test.mjs) |
| **3 个 Skill 构建通道** | 标准、SkillHub、WorkBuddy 包脱离源码后创建项目、检查和导出：[分发测试](test/distribution.test.mjs) |
| **共享内核与项目扩展** | 通用运行时统一维护，专用交互随项目保存：[项目格式与扩展](references/project-format.md#项目扩展) |

工作方式与操作细节见[工作台手册](references/workbench.md)，各宿主的能力适配与市场打包见[Agent 接入与分发](references/agent-adaptation.md)。

<details>
<summary><strong>先在本地跑一个案例</strong></summary>

```sh
git clone https://github.com/JasperLin2333/yuanxing.git
cd yuanxing
node scripts/yuanxing.mjs init ./my-iteration --template iteration
node scripts/yuanxing.mjs serve --root ./my-iteration --open
```

打开后直接整理画布，或让 AI 阅读 [SKILL.md](SKILL.md)，继续修改项目。新建空白项目可使用：

```sh
node scripts/yuanxing.mjs init ./my-prototype --name "我的产品"
```

</details>

<details>
<summary><strong>手动安装、导出与开发</strong></summary>

把完整 Skill 安装到宿主的技能目录；目标目录存在时会保留原安装并停止：

```sh
node scripts/install.mjs --target "/你的宿主/skills/yuanxing"
```

导出当前项目：

```sh
node scripts/yuanxing.mjs export --root ./my-iteration --view review
node scripts/yuanxing.mjs export --root ./my-iteration --view prototype
```

文件保存到项目的 `dist/`，顶栏“导出 HTML”菜单也提供这两种方式。

多项目工作区：

```sh
node scripts/yuanxing.mjs workspace add --workspace ./my-workspace.json --root ./my-iteration --id crm
node scripts/yuanxing.mjs workspace add --workspace ./my-workspace.json --root ./my-portal --id portal
node scripts/yuanxing.mjs serve --workspace ./my-workspace.json --open
```

验证与构建：

```sh
npm test
npm run check
npm run build:demo
npm run pack:generic
npm run pack
npm run pack:workbuddy
```

市场包分别保存在 `dist/<通道>/yuanxing.zip`。构建格式、宿主接入与市场提交要求见[分发说明](references/agent-adaptation.md#分发与版本)。

</details>

<details>
<summary><strong>输入材料、文件保存与批注</strong></summary>

当前支持自包含 HTML、本地 CSS、图片、普通 JavaScript，以及 PNG、JPEG、WebP 截图。框架工程、外部 CDN、真实登录和网络接口需要先适配，具体见[项目格式](references/project-format.md)。

项目文件保存在你选择的本地目录。工作台只监听本机地址；模型如何处理输入材料，取决于你使用的 AI 宿主与模型服务。

批注用来说明与评审，保留在同一份项目中，不会自动转成 AI 的修改指令。

</details>

---

**先拿一个你熟悉的功能试试。** [体验完整原型](https://jasperlin2333.github.io/yuanxing/demo/prototype.html)，或在 [Issues](https://github.com/JasperLin2333/yuanxing/issues) 分享你的具体场景和改进建议。

主代码采用 [MIT](LICENSE) 许可证；附带组件的来源与许可见[第三方说明](THIRD_PARTY_NOTICES.md)。
