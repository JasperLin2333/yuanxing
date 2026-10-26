# 工作台内嵌依赖

- libavoid 纯 JavaScript 引擎与路由适配核心：https://github.com/jgraph/drawio/tree/9034053fba80a435e27d68d374bc564b83917ae9/src/main/webapp/js/libavoid-js。保留上游文件，不手工修改压缩引擎；许可证见 `LIBAVOID-LICENSE`，上游 C++ 源码见 https://github.com/mjwybrow/adaptagrams 。
- fflate 0.8.2：`fflate.min.js` 为 npm `fflate@0.8.2` 的原始 `umd/index.js`，仅离线导出内嵌使用其 gzip 解压能力；上游 https://github.com/101arrowz/fflate ，MIT 许可证见 `FFLATE-LICENSE`。下载时核对 npm 包的 SHA-512 integrity；文件 SHA-256 为 `c3b34f2e9f5e74d4d7d64e01cac7a0c01954c6c406414d42185c7b53d6875ddf`。

这些依赖随工具保存，并随分享 HTML 内嵌，不依赖 CDN、浏览器原生解压 API 或额外下载。连线引擎负责路径计算，fflate 负责还原无损压缩的数据；业务数据和原型交互仍由本项目维护。
