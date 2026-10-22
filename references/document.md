# 交互式需求文档与交付数据

需求文档按作者的讲解顺序组织正文、页面和组件，可混用上下排列、左右分栏与对照表格。画布表达页面关系，完整原型体验流程，文档说明业务规则；三个视图引用同一份项目页面。

## 编辑来源

`artifact/workbench.json` 的可选 `document` 保存自由编排。旧项目没有该字段时，工作台临时按模块生成页面与说明的对照布局；首次编辑才保存，不在打开时改写项目。新文档也可使用空的 `blocks` 从头编排。

```json
{
  "document": {
    "version": 1,
    "title": "客户分配需求",
    "blocks": [
      {"id":"goal","type":"text","format":"heading1","text":"本次目标"},
      {"id":"intro","type":"text","text":"管理员选中客户后，为客户指定负责成员。"},
      {
        "id":"comparison","type":"table","widths":[56,44],
        "rows":[{
          "id":"assignment-row",
          "cells":[
            {"id":"page-cell","blocks":[{"id":"form-preview","type":"prototype","node":"assign","height":480}]},
            {"id":"detail-cell","blocks":[{"id":"form-details","type":"description","node":"assign"}]}
          ]
        }]
      },
      {"id":"component-title","type":"text","format":"heading2","text":"成员选择"},
      {"id":"member-component","type":"prototype","node":"assign","selector":"#assignee","height":240}
    ]
  }
}
```

所有文档块、分栏、表格行和单元格的 `id` 在文档中唯一，增量修改保持稳定。`document.title` 可省略，省略时使用项目标题。

| 内容类型 | 字段与用途 |
| --- | --- |
| `text` | `text` 为支持加粗、斜体、行内代码、列表、表格和本地图片的正文；`format` 可选 `paragraph`、`heading1`、`heading2`、`heading3`、`quote` |
| `description` | 用 `node` 或 `edge` 引用一个页面或操作的说明；编辑写回该对象，不复制文字 |
| `prototype` | `node` 引用 HTML 或截图节点；`height` 为视口高度，120～20000px。可选 `selector` 聚焦 HTML 内局部组件 |
| `image` | `path` 为 `assets/` 下 PNG、JPEG 或 WebP；`alt` 为图片说明 |
| `columns` | `columns: [{id,width,blocks}]` 定义 2～4 列，`width` 为相对宽度；每列可放任意内容块 |
| `table` | `rows: [{id,cells:[{id,blocks}]}]`；所有行列数一致，`widths` 为各列相对宽度。单元格可放正文、页面、组件或其他布局 |

页面和组件引用现有节点；只为本次确需的独立组件建立新节点。`canvas: false` 可让组件页保留在播放和导出中，同时不占流程画布。删除页面或操作会清理对应文档引用；删除文档块不会删除源页面。

## 文档内的原型

HTML 使用真实输入、选择器、Tabs 和浮层。每个嵌入项有独立的演示上下文，跨页跳转保留该嵌入项内已绑定字段，其他嵌入项不被切换。截图继续使用原有热点。

局部组件的 `selector` 对应源 HTML 中真实元素。嵌入保留源页面的布局和依赖，按元素范围显示；浮层超出原组件区域或项目扩展有特别挂载要求时，选择合适的组件根或制作独立组件页面。静态 DOM 提取片段不能自动获得源交互。

文档支持直接输入、基础文字格式、粘贴图片、拖动块、跨单元格移动、分栏与表格列宽调整、增删表格行列。也可让 Agent 通过 `apply` 修改 `document`；同一正文发生并发修改时按既有冲突机制处理。

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
- `yuanxing.model/document/images` 保留原生结构、自由正文和图片；`bindings` 保留选择器、条件与上下文变化。原生播放器继续读取 `YUANXING_BOOT`，展示和交互不受兼容字段限制。
- 基础协议没有条件分支：这类控件只标关联逻辑，并在 `data-yuanxing-transition-ids`、`bindings` 中保留全部候选目标；不假设一个固定目标。超出基础格式、无法静态匹配的选择器或缺失控件写入 `limitations`。
- 转换支持稳定的标签、ID、class、属性、后代/子元素及常用位置选择器。源中不能直接静态解析的选择器留给原生绑定，不凭近似元素补标记。

这套入口对齐提供的 manifest/files 数据结构。接收方实际使用的解析器、扩展语义和验收要求需以其工具的真实读取结果为依据；程序能提取 JSON、原型可播放和研发已接入分别确认。
