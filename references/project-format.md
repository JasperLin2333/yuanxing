# 项目与交互格式

## 文件结构

```text
我的原型/
  artifact/
    workbench.json       页面引用、位置、连线、规则与普通批注
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
- `overview: false` 可隐藏不需要在画布重复展示的状态，仍可作为跳转目标。需要归并到可见页面时使用 `overviewAlias`。
- `modules[].entry` 是模块体验入口。`flows` 可定义多个用户任务；每个流程必须有现存页面作为入口，`context` 只影响演示条件。
- 后续编辑保留稳定标识、手调位置、`waypoints`、`labelPosition` 和普通批注；不要为了新增一个页面而重新排列整张画布。

## 跳转与分支

- HTML 用稳定选择器 `selector` 绑定控件；截图使用 `rect: [x,y,width,height]`，坐标和尺寸均为 0～1 的比例。HTML 也可用区域绑定，但元素选择器更能适应布局修改。
- `diagram: true` 只表达画布关系，不执行跳转。`navigation: true` 或 `overview: false` 隐藏普通导航的概览连线，保留页面内跳转。
- 同一按钮可对应多条边：`when: {"role":"admin"}` 指定分支条件；`setContext: {"hasSelected":true}` 记录演示选择。条件匹配只有一条时直接进入，多条时供查看者选择。没有匹配时停留当前页。
- 页面内的真实脚本可保留局部交互。绑定为跨页跳转的控件由播放器接管；不要同时在其脚本中实现另一次跨页跳转。
- `kind: "note", presentation: "branch"` 是画布分叉点，仅表达结构；实际按钮跳转仍绑定到原页面。

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
- 重新开始会清空本次体验的输入，恢复项目与当前流程默认值。

## 普通批注

```json
{"id":"pin-1","node":"assign","point":[0.5,0.4],"text":"此处说明分配规则。"}
```

HTML 批注可增加 `selector` 和 `offset: [0.5,0.5]` 以跟随元素，`point` 可作为位置参考。截图批注与热点可记录 `imagePath`；替换图片后，旧标记需重新核对。批注仅供阅读、编辑和删除，不作为 AI 执行指令。

## 导入、连接与导出

```sh
node "<Skill目录>/scripts/yuanxing.mjs" add --root "<项目目录>" --source "旧页面.html" --id old-page --title "已有页面"
node "<Skill目录>/scripts/yuanxing.mjs" connect --root "<项目目录>" --from old-page --to next-page --selector "#submit" --label "提交"
node "<Skill目录>/scripts/yuanxing.mjs" check --root "<项目目录>"
node "<Skill目录>/scripts/yuanxing.mjs" export --root "<项目目录>" --view prototype --flow assignment
```

`add` 复制输入并内嵌直接资源，不改输入原件。PNG 可读取原尺寸；JPEG / WebP 需显式给出宽高。命令通过文件版本核对保存；外部修改冲突时停止，重新读取后再落实当前范围。
