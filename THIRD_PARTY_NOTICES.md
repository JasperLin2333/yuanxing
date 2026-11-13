# 第三方材料与组件

元形的第三方运行时组件保存在 `runtime/`，保留上游文件，不修改压缩引擎。

- `libavoid.min.js`：libavoid 的纯 JavaScript 构建，许可证见 `runtime/LIBAVOID-LICENSE`（LGPL 2.1）。
- `libavoid-routing.js`：draw.io 的路由适配层，许可证见 `runtime/DRAWIO-LICENSE`（Apache 2.0）；上游声明见 `runtime/DRAWIO-NOTICE`。
- `fflate.min.js`：fflate 0.8.2 原始 UMD 构建，离线导出使用其 gzip 解压器，许可证见 `runtime/FFLATE-LICENSE`（MIT）；上游 https://github.com/101arrowz/fflate 。
- 固定来源：[draw.io 9034053 的 libavoid-js 目录](https://github.com/jgraph/drawio/tree/9034053fba80a435e27d68d374bc564b83917ae9/src/main/webapp/js/libavoid-js)。libavoid 的 C++ 源码见 [Adaptagrams](https://github.com/mjwybrow/adaptagrams)。

这些依赖与元形主代码分开保存。离线导出同时内嵌其原许可证和来源说明；开发者可在 `runtime/routing.mjs` 更换路由适配实现。

- `references/web-interactions.md` 的部分交互指导改编自 [GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance) 的指南，作者为 Google Chrome 团队及贡献者，采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；已按元形原型、工作台与离线交付场景筛选和改写，具体来源见该参考资料。
