# 工作台连线依赖

- libavoid 纯 JavaScript 引擎与路由适配核心：https://github.com/jgraph/drawio/tree/9034053fba80a435e27d68d374bc564b83917ae9/src/main/webapp/js/libavoid-js。保留上游文件，不手工修改压缩引擎；许可证见 `LIBAVOID-LICENSE`，上游 C++ 源码见 https://github.com/mjwybrow/adaptagrams 。

这些文件在本地加载，并随分享 HTML 内嵌，不依赖 CDN 或额外资源。引擎负责连线路径计算，工作台业务数据和原型交互仍由本项目维护。
