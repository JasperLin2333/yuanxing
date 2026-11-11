# 贡献与维护

README 面向元形的使用者，介绍原型设计、流程体验、交付方式与安装使用。平台适配、市场包、构建和上架属于维护者工作，放在本文及对应技术资料中，不作为用户功能宣传。

## 源码与验证

通用 Skill 维护在 `SKILL.md`，共享运行时维护在 `runtime/`。项目页面与专用交互随项目保存，通过显式扩展使用同一内核；格式与扩展约定见[项目格式](references/project-format.md#项目扩展)。

维护 CLI、运行时、数据协议或分发时运行 `npm test`（全套约 2 秒，已使用 dot 精简输出），新增行为补对应用例；调试单个问题时可先跑相关文件，例如 `node --test --test-reporter=dot test/locate.test.mjs`，收口仍跑全套。成功输出精简，失败保留报错；`npm run check` 只在公开示例受影响时使用。测试文件不随安装包分发。

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

分别构建标准、腾讯 SkillHub 和 WorkBuddy 包，输出到 `dist/<通道>/yuanxing.zip`（等价于 `node scripts/pack.mjs --target generic|skillhub|workbuddy`）。这些包用于维护者提交与适配；普通使用者按 README 安装通用 Skill。`pack.mjs`、`package.json` 与 `test/` 只在源码仓库，不进入安装包。

打包使用明确的运行文件清单，排除官网、演示导出、测试、Git 与个人项目；`generic` 是标准目录包，市场包按通道调整元数据和许可文件引用。每个包必须脱离源码目录仍可创建空项目、检查与导出。打包成功只证明包能生成和本地执行，不代表市场审核或宿主实际调用已通过。

- 通用格式以 [Agent Skills 规范](https://agentskills.io/specification) 为依据，标准 frontmatter 仅保留标准字段；版本与作者在 `metadata` 中。
- WorkBuddy 市场字段依据其[技能文档](https://open.workbuddy.cn/docs/skill)注入，市场字段变化只改打包适配。
- SkillHub 的本次适配保留当前发布字段与已确认的文件限制；提交时以[平台说明](https://skillhub.cn/announcements)及实际校验结果为准。
- 豆包工作等未核实的市场不猜测安装目录、额外字段或打包限制；先使用通用包，在拿到该平台规范与实际执行结果后增加通道。不能因同为 Skill 就声称已经兼容。

新增渠道先核对其现行规范与实际执行方式，保留通用核心，不为每个渠道维护另一套产品正文。发布前检查包不含个人项目、真实业务材料、凭据和本机路径；验证脱离源码后的创建、检查与离线导出。构建完成、客户端实际调用与市场审核分别确认，交付时区分实际检查、用户验收和外部平台验证。

按用户或维护者的本次授权提交、推送和上架。更新 README、官网、示例或安装方法时，同步受影响的实际入口；未涉及的项目与配置保持原状。
