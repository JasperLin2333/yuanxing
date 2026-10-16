# 第三方组件

元形的第三方连线组件保存在 `runtime/`，保留上游文件，不修改压缩引擎。

- `libavoid.min.js`：libavoid 的纯 JavaScript 构建，许可证见 `runtime/LIBAVOID-LICENSE`（LGPL 2.1）。
- `libavoid-routing.js`：draw.io 的路由适配层，许可证见 `runtime/DRAWIO-LICENSE`（Apache 2.0）；上游声明见 `runtime/DRAWIO-NOTICE`。
- 固定来源：[draw.io 9034053 的 libavoid-js 目录](https://github.com/jgraph/drawio/tree/9034053fba80a435e27d68d374bc564b83917ae9/src/main/webapp/js/libavoid-js)。libavoid 的 C++ 源码见 [Adaptagrams](https://github.com/mjwybrow/adaptagrams)。

这些依赖与元形主代码分开保存。离线导出同时内嵌其原许可证和来源说明；开发者可在 `runtime/routing.mjs` 更换路由适配实现。
