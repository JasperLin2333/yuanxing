# 贡献与维护

README 面向元形的使用者，介绍原型设计、流程体验、交付方式与安装使用。平台适配、市场包、构建和上架属于维护者工作，放在本文及对应技术资料中，不作为用户功能宣传。

## 源码与验证

通用 Skill 维护在 `SKILL.md`，共享运行时维护在 `runtime/`。项目页面与专用交互随项目保存，通过显式扩展使用同一内核；格式与扩展约定见[项目格式](references/project-format.md#项目扩展)。

维护 CLI、运行时、数据协议或分发时运行 `npm test`（全套约 2 秒），新增行为补对应用例；调试时可先跑单个测试文件，收口仍跑全套，见[按影响验证](references/agent-adaptation.md#按影响验证)。成功输出精简，失败保留报错；`npm run check` 只在公开示例受影响时使用。

更新本机已安装的 Skill 时先 `node scripts/install.mjs --target <安装目录> --check` 查看差异，再用 `--update` 备份后替换，不直接覆盖安装目录。

普通项目的原型与需求修改按影响检查语法、引用及正文一致性，不执行本仓库全部测试，不自动刷新所有演示或打包所有渠道。

示例源在 `examples/product-iteration/`，更新公开演示前核对源项目，再重新导出：

```sh
npm run build:demo
```

同一示例生成 `demo/review.html`、`demo/prototype.html` 与 `demo/document.html`。文档使用源页面和说明引用，兼容数据由导出器生成；不直接编辑导出副本。

修改前读取当前文件，保留已有改动。按本次范围核对交互、资源路径、源与导出的一致性；只有取得对应证据才声明运行或验收通过。

## 渠道适配与发布

维护一份通用 Skill 与运行时，在打包时处理市场专用元数据，不为每个渠道维护另一套产品正文。

```sh
npm run pack:generic
npm run pack
npm run pack:workbuddy
```

分别构建标准、腾讯 SkillHub 和 WorkBuddy 包，输出到 `dist/<通道>/yuanxing.zip`。这些包用于维护者提交与适配；普通使用者按 README 安装通用 Skill。

字段来源、能力降级与包约束统一维护在[Agent 接入与分发](references/agent-adaptation.md#分发与版本)，此处不复制另一套协议。新增渠道先核对其现行规范与实际执行方式，保留通用核心。

发布前检查包不含个人项目、真实业务材料、凭据和本机路径；验证脱离源码后的创建、检查与离线导出。构建完成、客户端实际调用与市场审核分别确认。

按用户或维护者的本次授权提交、推送和上架。更新 README、官网、示例或安装方法时，同步受影响的实际入口；未涉及的项目与配置保持原状。
