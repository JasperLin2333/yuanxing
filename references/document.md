# 交互式需求文档与交付数据

需求文档按作者的讲解顺序组织正文、页面和组件，可混用上下排列、左右分栏与对照表格。画布表达页面关系，完整原型体验流程，文档说明业务规则；三个视图引用同一份项目页面。

## 编辑来源

`artifact/workbench.json` 的可选 `document` 保存自由编排。旧项目没有该字段时，工作台临时按模块上下排列页面与说明；首次编辑才保存，不在打开时改写项目。这只是兼容阅读入口，Agent 应结合实际正文按功能组织，不把逐页列表当作完整 PRD。新文档也可使用空的 `blocks` 从头编排。

已有 PRD 先交代其背景、目标及本期功能，再展开对应模块。长说明用纵向正文，短说明与控件可左右对照，字段或条件比较再用表格；不统一套双栏。已有细化内容引用到所属章节，不压缩成画布摘要。画布的 `summary` 与详细 `description`／`rules` 分开；未设置摘要的旧对象仍读取原说明，编辑画布只保存摘要，不抹去原细节。

左侧目录自动按正文标题和引用 PRD 的子标题生成，点击定位到对应章节，滚动时高亮当前阅读位置。修改、移动或删除标题后同步目录，不另存一份导航内容。通过左上角与画布相同的侧栏图标收起或展开；窄屏默认收起。本地工作台与离线 HTML 均保留此定位能力。

```json
{
  "document": {
    "version": 1,
    "title": "客户分配需求",
    "blocks": [
      {"id":"goal","type":"text","format":"heading1","text":"本次目标"},
      {"id":"intro","type":"text","text":"管理员选中客户后，为客户指定负责成员。"},
      {"id":"requirements","type":"source","path":"需求.md","section":"3.2 选择负责成员","nodes":["assign"]},
      {
        "id":"comparison","type":"table","widths":[56,44],
        "rows":[{
          "id":"assignment-row",
          "cells":[
            {"id":"page-cell","blocks":[{"id":"form-preview","type":"prototype","node":"assign"}]},
            {"id":"detail-cell","blocks":[{"id":"form-details","type":"description","node":"assign"}]}
          ]
        }]
      },
      {"id":"component-title","type":"text","format":"heading2","text":"成员选择"},
      {"id":"member-component","type":"prototype","node":"assign","selector":"#assignee"}
    ]
  }
}
```

所有文档块、分栏、表格行和单元格的 `id` 在文档中唯一，增量修改保持稳定。`document.title` 可省略，省略时使用项目标题。

| 内容类型 | 字段与用途 |
| --- | --- |
| `text` | `text` 为支持加粗、斜体、行内代码、列表、表格和本地图片的正文；`format` 可选 `paragraph`、`heading1`、`heading2`、`heading3`、`quote` |
| `description` | 用 `node` 或 `edge` 引用详细说明，编辑写回该对象；或用 `rule` 引用现有公共规则，由 Agent 在源规则修改 |
| `source` | `path` 为项目根目录内 Markdown 路径；`section` 可指定完整标题，包含其子章节，省略则引用全文；`omitHeading` 可隐藏该节标题，`nodes` 可关联页面。直接文字修订写回原文对应行，章节与布局由 Agent 调整；不把副本存入编排 |
| `prototype` | `node` 引用 HTML 或截图；按可用宽度、页面或组件比例自动适配。可选 `selector` 聚焦真实组件；`frameScale` 保存外框相对默认尺寸的比例（0.2～2，默认 1），实际尺寸受可用宽度和最小可操作范围限制。旧 `height` 仍兼容；不在界面暴露像素尺寸和引用模式控件 |
| `image` | `path` 为 `assets/` 下 PNG、JPEG 或 WebP；`alt` 为图片说明 |
| `columns` | `columns: [{id,width,blocks}]` 定义 2～4 列，`width` 为相对宽度；每列可放任意内容块 |
| `table` | `rows: [{id,cells:[{id,blocks}]}]`；所有行列数一致，`widths` 为各列相对宽度。单元格可放正文、页面、组件或其他布局 |

页面和组件引用现有节点；只为本次确需的独立组件建立新节点。`canvas: false` 可让组件页保留在播放和导出中，同时不占流程画布。删除页面或操作会清理对应文档引用；删除文档块不会删除源页面。

`source` 加载时按完整标题定位；缺失或重名会报错，不默默读取别节。只把被引用的章节及其本地图片放入 `documentSources` 与导出文件，不带入未引用的文档内容。该对象以 `JSON.stringify([path, section || "", !!omitHeading])` 为键，同一章节重复引用共用正文，复制或移动块不会丢失内容。来源文件和图片必须在项目内；工作区外输入先复制到用户选定的项目位置。源 Markdown 保持唯一正文，自由说明继续存入 `text`。源正文缺失的背景或关键规则只根据已确认材料补充。

## 文档内的原型

HTML 使用真实输入、选择器、Tabs 和浮层。每个嵌入项有独立的演示上下文，跨页跳转保留该嵌入项内已绑定字段，其他嵌入项不被切换。截图继续使用原有热点。

文档中的页面和组件放入有边界的查看画布，默认完整适应。右下角可拖动等比缩放整个外框，改变其在文档中占用的宽度和高度，内部原型随之完整适应；在可操作范围内可缩至默认的 1/2 或 1/3。本地工作台松手后保存比例，离线分享可临时调整，均保留当前输入；取消拖动恢复原尺寸。外框拖动点获得焦点后，方向键微调，Home 恢复默认大小。每个嵌入项独立调整。

底部提供缩小、放大、当前比例、适应画布和拖动开关；也可用触控板捏合或 ⌘/Ctrl + 滚轮缩放、空格 + 拖动平移。这些操作只改变框内查看状态，保留外框尺寸和文档排版。缩放与平移有边界，一键适应恢复完整显示；操作不重建 HTML 或清空输入。普通滚轮保留页面内部列表滚动，到边界后续接外层文档；图片处继续滚动正文。项目扩展按嵌入项独立创建，局部操作交给原播放器，异步结果与导航留在当前嵌入项。

局部组件的 `selector` 对应源 HTML 中真实元素。嵌入保留源页面的布局和依赖，按元素范围显示；浮层超出原组件区域或项目扩展有特别挂载要求时，选择合适的组件根或制作独立组件页面。静态 DOM 提取片段不能自动获得源交互。

正文、标题及页面说明支持直接修订文字并自动保存；引用 PRD 的文字写回原文件对应行，表格只更新被编辑的单元格，标题改名同步相关引用。源段落已被其他工具修改时保留输入并提示合并。文档不提供顶部工具栏、插入、标题样式、正文块操作、正文块拖拽或列宽调整；增减内容和布局交给 Agent 通过 `apply` 修改 `document`。离线分享保持正文与源数据只读。

## 离线交付

```sh
node "<Skill目录>/scripts/yuanxing.mjs" export --root "<项目目录>" --view document
```

默认输出 `dist/document.html`。画布、完整原型和需求文档的导出都包含三个视图，打开时进入所选视图。导出文件只读；原型局部交互仍可体验，文档正文继续在项目源编辑。

所有导出均提供可直接解析的入口，无需执行文件中的 JavaScript：

```html
<script id="yuanxing-artifact" type="application/json">
{"manifest":{"requirements":[]},"files":{},"yuanxing":{}}
</script>
```

- `manifest.requirements[]` 包含 `id/title/states/transitions/logic`；每组恰好一个初始状态。状态的 `html` 指向 `files` 中的相对路径。
- `files` 保存已内嵌资源的状态 HTML，常规跳转绑定实际元素的 `data-transition-id`，说明绑定 `data-logic-id`，组件原有身份标记保留。
- 实际相连的跨模块页面放入同一组，以保留基础协议只能在组内跳转的约束；纯画布关系不转换为可执行操作。
- `yuanxing.model/document/documentSources/images` 保留原生结构、自由正文、选中源章节和图片；源章节及独立规则也进入基础 `logic`，`nodes` 对应的正文关联到指定页面。`bindings` 保留选择器、条件与上下文变化。原生播放器继续读取 `YUANXING_BOOT`，展示和交互不受兼容字段限制。
- 导出时，`YUANXING_BOOT.sharedStrings` 可用文件名和字符串范围引用 `files` 中已有的图片、页面及公共片段；离线启动先无损还原，再交给播放器。外部工具继续直接读取上述 `yuanxing-artifact` JSON，`manifest/files` 不压缩、不替换为共享引用；无需执行页面脚本或升级解析器。
- 基础协议没有条件分支：这类控件只标关联逻辑，并在 `data-yuanxing-transition-ids`、`bindings` 中保留全部候选目标；不假设一个固定目标。超出基础格式、无法静态匹配的选择器或缺失控件写入 `limitations`。
- 转换支持稳定的标签、ID、class、属性、后代/子元素及常用位置选择器。源中不能直接静态解析的选择器留给原生绑定，不凭近似元素补标记。

这套入口对齐提供的 manifest/files 数据结构。接收方实际使用的解析器、扩展语义和验收要求需以其工具的真实读取结果为依据；程序能提取 JSON、原型可播放和研发已接入分别确认。
