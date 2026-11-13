# Web 交互与离线兼容

编写或修改原型、工作台交互时，只读并应用本次涉及的小节。复用现有组件与真实控件，保留用户确认的外观和操作；以下指导不要求迁移已有实现，也不增加业务规则、确认步骤、动画或整站适配。

## 输入和快捷键

- 自定义 Enter 提交、确认或结束编辑时，先识别输入法组合输入：`event.isComposing` 为真时不执行；需要兼容相关 Safari 输入法事件顺序时，再判断 `event.keyCode === 229`。组合输入期间不要拦截确认选字，也不要清空、提交或结束编辑。浏览器原生表单提交无需额外模拟一次。
- 页面级快捷键避开输入框、文本域、选择器和可编辑内容，除非该快捷键本就属于当前编辑器；不要让画布的删除、空格拖动或方向键打断输入。按钮及输入保留可识别的名称和键盘焦点。
- 仅在已有业务规则要求时做必填与校验；不要把浏览器技术建议变成新的必填项、错误提示或提交规则。

## 弹窗、菜单与浮层

- 沿用已有实现；新建时可优先考虑合适的原生控件。阻断式弹窗与普通菜单、提示层的行为不同，按实际设计选择，不能只因看起来像弹窗就套同一种关闭规则。
- 弹窗应有可识别的标题或名称，打开后让焦点可到达内容，关闭后在原触发控件仍存在且适合时恢复焦点。原生 `dialog.showModal()` 已提供焦点约束和 Escape 等行为，不再叠加冲突的焦点陷阱；是否允许取消、点击外部关闭或保护未保存输入，以已有业务规则为准。
- 菜单、下拉框和工具按钮保留可见焦点及已有键盘操作；使用 `aria-expanded` 等状态时与实际显示同步。普通按钮组不冒充 `menu`，只有实现相应键盘行为时才使用对应角色。浮层跟随触发对象，靠近边缘时避免被视口或容器裁切；注意工作台中缩放、滚动和嵌入页面的坐标。

## 拖拽、排序与画布

- 不让拖拽拦截卡片内的输入、按钮和文字选择；有这些内容时从现有专用把手或指定区域开始。限制触摸手势和文字选择时只作用于必要区域，避免影响周围页面滚动与操作。
- 记录发起的指针和相对位置，区分点击与拖动；指针离开把手后仍能结束本次操作。处理 `pointerup`、`pointercancel`、捕获丢失或窗口失焦时清理监听和临时状态；取消时按该功能既有规则恢复或保留，不把取消当成成功提交。
- 排序或移动有交互内容时，保留已有节点及其输入、焦点、滚动与页面状态；视觉顺序和实际读取、键盘顺序应一致。已有键盘或点击替代操作要继续可用；确需为核心拖拽补替代操作时，选不改变业务流程的方式。
- 工作台画布可能以缩放和变换组织坐标，保持现有坐标系、跨页面绑定与交互，不因通用指南建议重写成滚动容器。对依赖原生滚动的区域也不要用视觉变换冒充滚动位置。

## 重绘、内容与动效

- 局部更新优先保留未变的输入、选区、焦点、滚动位置和打开状态；包含 iframe 的页面尤其要避免不必要的销毁或重建。移动节点时，`moveBefore()` 可在支持的浏览器保留更多状态；先检测能力，普通 DOM 移动可能令 iframe 重载或焦点丢失，不能把它当成等价降级，必要时避免移动或明确处理受影响状态。
- 普通用户文字按文本插入；确需展示富文本时沿用项目已有的可信渲染与校验方式，避免把未处理的输入直接拼到可执行 HTML。保留元形对原型页面的既有隔离和消息校验，不把正常的原型 HTML 误当普通文字清除。
- 修改或新增动效时考虑减少动态效果的系统偏好；移除或缩短动效后仍能到达最终状态，不依赖永远不会触发的动画结束事件完成关键操作。
- 本轮确需处理大画布或长列表的卡顿时，合并高频重绘，避免在逐项更新中反复交替读取与写入布局；优化后仍保留可见内容、阅读顺序、输入与定位能力。

## 浏览器与离线交付

- 以已知的目标浏览器和交付方式为准；未知时优先保持已有可运行方案，不为此打断任务。新 API 必要时做能力检测并提供不破坏核心交互的降级；浏览器支持数据会变化，不把某个新 API 或当前版本号当成永久前提。
- 元形分享文件及需要离线打开的原型继续自包含；不为套用建议引入在线 CDN、运行时网络请求或构建依赖。功能无法等价降级时，保留既有可用方案并说明差异，不静默丢失输入、图片或交互。
- 检查本轮相关语法、引用与行为边界；真实浏览器操作、截图和验收继续遵循当前用户授权与宿主规则。静态检查不能代替输入法、焦点、拖拽或离线运行的实际验收。

## 来源

以上为对 Google Chrome 团队及贡献者的 [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance) 指南所作的筛选与改写，依 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) 标注来源。原文包括 [输入法](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/forms/ime-safe-enter-submit.md)、[弹窗](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-components/dialog.md)、[浮层定位](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-atoms/viewport-aware-dropdowns.md)、[拖拽](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/drag.md)、[排序](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/drag-and-drop.md)、[动态排序](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/dynamic-sort.md)、[二维平移](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/2d-panning.md)、[移动节点](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/move-dom-element-without-losing-state.md)、[安全渲染](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/security/sanitize-untrusted-html.md)和[动效](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/ui-behaviors/motion.md)。未照搬上游强制选用新 API、外部依赖或安装其 CLI 的要求。
