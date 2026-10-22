# 项目与交互格式

## 文件结构

```text
我的原型/
  artifact/
    workbench.json       页面引用、位置、连线、说明、文档编排与普通批注
    pages/*.html         可继续编辑的页面
    assets/*             项目图片、CSS 或普通 JavaScript
  dist/                  可重复生成的离线交付
```

页面路径相对 `artifact`。本地 CSS、图片和普通 JavaScript 在加载和导出时内嵌；`<!-- include:components/shell.html -->` 可引用项目内公共片段。网络资源、嵌套 iframe、CSS `@import`、动态模块工程不直接支持，需要先适配为自包含页面。页面脚本在隔离的 iframe 内运行，没有父工作台的同源权限；使用真实接口、本地存储或顶层导航的代码不作为通用兼容能力。

## 最小项目

```json
{
  "version": 1,
  "title": "客户分配",
  "entryModule": "customers",
  "contextDefaults": {"role": "admin", "assignee": ""},
  "modules": [{"id": "customers", "title": "客户分配", "entry": "list"}],
  "nodes": [
    {"id":"list","module":"customers","title":"已有客户列表","kind":"image","path":"assets/list.png","width":1280,"height":800,"x":60,"y":60},
    {"id":"assign","module":"customers","title":"分配客户","kind":"html","path":"pages/assign.html","width":1280,"height":800,"x":560,"y":60}
  ],
  "edges": [
    {"id":"open","from":"list","to":"assign","label":"分配客户","rect":[0.86,0.14,0.1,0.06]},
    {"id":"cancel","from":"assign","to":"list","label":"取消","selector":"[data-yx-id='cancel']","overview":false}
  ],
  "flows": [{"id":"assignment","title":"管理员分配客户","entry":"list","context":{"role":"admin"}}],
  "annotations": []
}
```

## 页面与画布

- `modules` 为模块，`nodes` 为页面、截图或说明。`kind` 为 `html`、`image` 或 `note`；说明写入 `description`。`x/y` 是画布位置，`width/height` 是原页面尺寸，不能用缩略卡片尺寸替代。
- `canvasType: "pc" | "mobile"` 只决定卡片类型。移动 HTML 可按尺寸自动识别。
- `canvas: false` 将仍需播放的操作状态与画布展示分开，不出现在画布或回收站，导出时保留；Agent 可用它保存交互需要的中间状态。
- `overview: false` 且未设置 `canvas: false` 的普通节点进入回收站；导出时排除这些节点及关联连线、批注与专属资源。仍需在原型中跳转的状态应同时设置 `canvas: false`；需要归并到可见页面时使用 `overviewAlias`。
- 模块只用于画布组织。没有 `experiences` 时，完整原型从 `entryModule` 的首个有效页面进入，合并全部模块；既有 `modules[].entry` 仅作为兼容的入口线索，不提供手动设置按钮。
- 只有不同产品或平台才定义 `experiences: [{"id":"pc","title":"PC端","entry":"home"},{"id":"mobile","title":"移动端","entry":"mobile-home"}]`。入口由 Agent 依据已有设计选择，仍可跨模块跳转；选择器只在两个及以上入口时显示。
- 旧项目的 `flows` 作为显式场景入口保留兼容；新增项目使用产品或平台级 `experiences`，不要按模块自动生成场景。每个入口必须对应实际可体验页面，`context` 只影响演示条件。
- 后续编辑保留稳定标识、手调位置、`waypoints`、`labelPosition` 和普通批注；不要为了新增一个页面而重新排列整张画布。

## 跳转与分支

- HTML 用稳定选择器 `selector` 绑定控件；截图使用 `rect: [x,y,width,height]`，坐标和尺寸均为 0～1 的比例。HTML 也可用区域绑定，但元素选择器更能适应布局修改。
- `diagram: true` 只表达画布关系，不执行跳转。`navigation: true` 或 `overview: false` 隐藏普通导航的概览连线，保留页面内跳转。
- 同一按钮可对应多条边：`when: {"role":"admin"}` 指定分支条件；`setContext: {"hasSelected":true}` 记录演示选择。条件匹配只有一条时直接进入，多条时供查看者选择。没有匹配时停留当前页。
- 页面内的真实脚本可保留局部交互。绑定为跨页跳转的控件由播放器接管；不要同时在其脚本中实现另一次跨页跳转。
- `kind: "note", presentation: "branch"` 是画布分叉点，仅表达结构；实际按钮跳转仍绑定到原页面。
- `canvasFrom` 只改变连线在画布上的出发点。删除支线后应收拢已无分支作用的连接点；删除连接点应接回前后关系，保留原始 `from/to`、控件绑定、条件及业务说明，不能按普通页面删除连带清空主链。

## 可选声明式局部交互

简单页面可以完全不写脚本：

```html
<button data-yx-action="show" data-yx-target="#dialog">打开弹窗</button>
<section id="dialog" hidden>
  <input data-yx-bind="customerName" aria-label="客户名称">
  <button data-yx-action="hide" data-yx-target="#dialog">关闭</button>
</section>
<span data-yx-text="customerName"></span>
<button data-yx-action="tab" data-yx-target="#history" data-yx-group="[data-yx-panel]">历史</button>
<section id="history" data-yx-panel hidden>历史内容</section>
```

- `show / hide / toggle` 控制 `data-yx-target` 匹配的元素。
- `tab` 仅展示目标面板，其余 `data-yx-group` 匹配的面板隐藏；同组按钮更新 `active` 和 `aria-selected`。
- `set` 配合 `data-yx-key / data-yx-value` 设置演示上下文的字符串值。
- `data-yx-bind` 把输入值保存在本次体验的上下文中，跨页保留；复选框为布尔值。`data-yx-text` 展示对应值；`data-yx-visible="role" data-yx-value="admin"` 按值控制显示。
- 上下文键使用英文字母开头的字母、数字、下划线或连字符。仅允许字符串、布尔值和有限数字。
- 产品或平台切换时使用其默认演示上下文；跨页跳转保留已绑定字段。工作台不提供“重新开始”操作。

## 普通批注

```json
{"id":"pin-1","node":"assign","point":[0.5,0.4],"text":"此处说明分配规则。"}
```

HTML 批注可增加 `selector` 和 `offset: [0.5,0.5]` 以跟随元素，`point` 可作为位置参考。截图批注与热点可记录 `imagePath`；替换图片后，旧标记需重新核对。批注仅供阅读、编辑和删除，不作为 AI 执行指令。

## 说明数据与局部 UI 交付

已有 `rules` 正文及节点、连线的 `rule` 引用继续用于读取说明；用户不必维护逻辑标识。直接编辑当前对象时，合并后的说明写入该对象的 `description`，解除该对象原有 `rule` 引用，其他对象不变。跨页面修改由 Agent 按用户指定范围查找语义相关的源页面、说明和交互，同步实际内容；不能只改某个 `rules[id]` 就声称已覆盖全部相关位置。编排修改沿用下方的并行保存入口。

开发交付模式是浏览器内临时状态，不写入编排，导出后默认关闭。可选的项目扩展 `handoffContext(node)` 返回 `{sources: ["artifact/modules/page.html", "scripts/build.py"]}`，用于指出实际编辑源文件；不把生成的预览页冒充唯一源文件。选择范围只读取 DOM、样式和必要依赖，不更改业务文件。

## 导入、连接与导出

```sh
node "<Skill目录>/scripts/yuanxing.mjs" add --root "<项目目录>" --source "旧页面.html" --id old-page --title "已有页面"
node "<Skill目录>/scripts/yuanxing.mjs" connect --root "<项目目录>" --from old-page --to next-page --selector "#submit" --label "提交"
node "<Skill目录>/scripts/yuanxing.mjs" check --root "<项目目录>"
node "<Skill目录>/scripts/yuanxing.mjs" export --root "<项目目录>" --view prototype --flow assignment
```

`add` 复制输入并内嵌直接资源，不改输入原件。PNG 可读取原尺寸；JPEG / WebP 需显式给出宽高。命令通过文件版本核对保存；外部修改冲突时停止，重新读取后再落实当前范围。

## 并行编辑与自动更新

- 编辑端保存携带当前修改前的 `baseModel` 和 `revision`；服务按节点标识及字段做三方合并。不同字段自动合并，同字段、删除对修改或相互冲突的排序返回 409，响应保留外部 `model`、`revision` 和 `conflicts`。没有共同基线的过期写入仍拒绝覆盖。
- 网页与 CLI 共用项目写锁，临时写入完成后核对版本再原子替换。冲突时网页保留本地修改，提供选择冲突项和导出双方修改；选择只处理冲突项，其他独立修改继续合并。
- Agent 修改已有 `artifact/workbench.json` 时，先在临时目录保存修改前的原始 JSON 字节和修改后 JSON，再执行以下命令。基线必须来自本次实际读取，不能用改完后的文件充当基线。完成后清理本轮临时文件；冲突时保留输入，读取命令返回的双方内容处理，禁止直接整份覆盖。

```sh
node scripts/yuanxing.mjs apply --root <项目目录> --base <修改前JSON> --model <修改后JSON>
```

- `serve` 启动带监视的子进程，后端依赖变动时优雅重启，保持令牌并只首次打开浏览器。前端轮询工作台及扩展代码版本，连续两次探测稳定的新版本后，等待编辑、保存、上传、弹窗和原型体验结束再自动重载并恢复位置；离线导出不轮询。
- 项目内容依旧按轻量版本轮询更新。正在编辑或有未提交原型输入时不替换页面；其他页面资源变化不会重建当前未变化的页面。
- 普通 HTML 源文件仍由 Agent 局部修改；同一源文件被其他编辑器直接同时覆盖不属于编排合并范围。并行修改编排使用上述共同基线入口。

## 需求文档与交付数据

自由编排的需求文档保存在可选 `document` 中，正文、表格单元格和原型引用的格式及 HTML 数据读取入口见[交互式需求文档](document.md)。页面与说明保持引用关系，按本轮范围编辑，不从阅读布局反推业务分组。

## 多项目工作区

项目彼此独立，不把多个项目塞进一份 `workbench.json`。工作区文件只登记入口，路径相对该文件；扩展路径相对项目根目录。

```json
{"version":1,"defaultProject":"crm","projects":[{"id":"crm","title":"客户管理","root":"./crm"},{"id":"portal","title":"用户门户","root":"./portal","extension":"scripts/yuanxing"}]}
```

Agent 使用 `workspace add --workspace <文件> --root <项目> --id <标识>` 登记，使用 `serve --workspace <文件> --open` 打开。顶栏切换项目时先等待保存，保存失败或冲突时留在原项目。项目分别使用 `/p/<id>/` URL、保存版本、视图偏好和项目扩展，避免串数据。新增项目登记后刷新工作台即可出现在选择器；离线导出仅内嵌当前项目，不携带整个工作区。

## 项目扩展

通用工作台只维护 `runtime/` 一份实现。项目自己的页面、数据和专用交互放在项目目录，通过启动参数加载扩展；不复制或修改另一份工作台内核。普通项目无需扩展。

```sh
node scripts/yuanxing.mjs serve --root ./my-project --extension ./my-project/extension --open
node scripts/yuanxing.mjs export --root ./my-project --extension ./my-project/extension --view review
```

扩展目录用 `extension.json` 列出依赖与入口，顺序为依赖在前、入口最后：

```json
{
  "entry": "index.mjs",
  "files": ["state.mjs", "index.mjs"],
  "declarative": true
}
```

入口导出 `createProjectExtension(host)`，不依赖工作台文件的私有变量。`host` 提供 `getState`、`node`、`openNode`、`measure`、`visibleRect`、`renderOverlays`、`renderInspector` 与 `download`。`getState()` 返回当前模型、页面、iframe、交互模式、缩放和节点，回调执行时应重新读取当前状态，`experience` 表示当前是否为完整原型。

可返回的扩展钩子：

| 属性或函数 | 用途 |
| --- | --- |
| `declarative: true` | 使用禁止页面脚本的声明式页面，与清单中的设置保持一致 |
| `nativeInteraction: true` | 完整原型直接使用声明式 iframe 内的真实控件，停用外层透明热点与替身输入框；评审画布继续使用原有打点机制 |
| `nativeInput(event, type)` / `nativeKeyDown(event)` | 原生输入、change 与键盘事件；页面内跳转由内核直接绑定实际元素 |
| `styles` | 扩展的控件样式 |
| `bindHotspots: false` | 项目自行维护控件绑定时，收起通用点击区域编辑入口 |
| `layout(doc, node)` / `mount(doc, node)` | 排版缩略图、挂载打开后的页面 |
| `outgoing(edges, doc, id)` | 合并项目声明的页面操作 |
| `travel(edge)` | 处理扩展操作；返回 `true` 表示已处理 |
| `renderOverlays(info, renderHotspots)` | 绘制项目表单或局部控件，调用 `renderHotspots()` 复用通用热点 |
| `decorateHotspot(button, edges, frame)` / `bindStage({stage})` | 补充按住、滚动等项目交互 |
| `skipMeasurement(element)` | 跳过项目暂时隐藏的控件 |

扩展仅在明确指定后加载，浏览器只可读取清单内的脚本。依赖必须使用相对导入并按清单顺序列出，不支持动态导入。导出项目时，指定的扩展会与通用内核一起内嵌；普通导出和 Skill 安装包不会自动携带其他项目的扩展或数据。

已有项目使用 Python 组装固定状态时，可加 `--builder scripts/build.py`；导出检查脚本可通过 `--validator scripts/check.py` 指定，校验时会带上 `--validate`。脚本路径相对项目根目录。
