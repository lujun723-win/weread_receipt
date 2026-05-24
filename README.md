# weread_receipt

微信读书阅读面板。它会把微信读书书架、阅读进度、统计数据和笔记同步到本地，并为单本书生成一张 iPhone 全屏比例的「阅读小票」图片。

## 功能

- 使用微信读书官方 skill API 同步书架、阅读进度、月度/年度统计和笔记索引。
- 本地持久化保存同步结果，页面再次打开会自动加载本地数据。
- 增量同步：未变化的图书复用本地 JSON，只更新变化的图书。
- 书架按最近阅读时间排序。
- 每本书可手动标记为「出版物」或「个人文档」。
- 支持批量勾选图书并修改为「出版物」或「个人文档」。
- 出版物支持 ISBN / EAN-13 条形码生成。
- 缺 ISBN 时可按书名和作者查询 Google Books、Open Library、豆瓣。
- 支持单本同步，更新当前图书的进度、阅读时长、已读天数、笔记和 ISBN。
- 个人文档会跳过 ISBN 检索，小票中显示专属文档码和「个人文档」标签。
- 支持 0 到 5 星评分，步进 0.5 星。
- 支持按图书导出 Markdown 笔记。
- 支持阅历月视图：用每天阅读最多的书籍封面填充月历格子。
- 阅读小票包含封面、标题、作者、进度、时长、已读天数、笔记数、分类、状态、条形码、星级和时间戳。

## 准备

需要 Node.js 18 或更高版本。

到微信读书官方页面获取 API Key：

<https://weread.qq.com/r/weread-skills>

也可以按官方方式安装 skill：

```bash
npx skills add Tencent/WeChatReading -g
```

这个项目本身通过微信读书官方 skill 网关请求数据：

```text
https://i.weread.qq.com/api/agent/gateway
```

## 启动

```bash
npm start
```

打开：

```text
http://127.0.0.1:5177
```

使用步骤：

1. 填入微信读书 API Key。
2. 点击「同步数据」。
3. 在左侧选择一本书。
4. 调整星级或图书类型。
5. 点击「下载票据」导出 PNG。

如果只想更新当前图书，选中图书后点击「同步本书」。它会重新读取这本书的进度、阅读时长、已读天数、笔记，并在需要时重新搜索 ISBN。

书架上可以勾选多本书，再批量设为「个人文档」或「出版物」。

## 本地数据

默认数据目录：

```text
./data
```

默认笔记导出目录：

```text
./exports
```

可以用环境变量修改：

```bash
WEREAD_DATA_DIR=/path/to/data WEREAD_EXPORT_DIR=/path/to/notes npm start
```

这些目录包含个人阅读数据，不应提交到 GitHub。

## 导出 Markdown 笔记

网页里点击「导出笔记」即可。

也可以命令行导出：

```bash
WEREAD_API_KEY=wrk-xxxxxxxx node export-notes.js
```

导出的 Markdown 按图书建档，包含书籍元信息、划线、想法/点评和时间信息。

## ISBN 规则

同步时会先读取微信读书 `/book/info` 返回的 ISBN。

如果没有有效 ISBN，且图书类型是「出版物」，会尝试按书名和作者查询：

- Google Books
- Open Library
- 豆瓣图书详情页
- 百度百科
- 京东图书

只有通过 ISBN-13 校验的结果才会写入本地数据库。不会伪造 ISBN。

如果条目是文章、PDF、自传文档或其他非出版物，建议标记为「个人文档」。之后同步时不会再反复搜索 ISBN。

手动分类会写入本地 JSON，同步时会保留，不会被自动改回默认类型。

## 阅读小票

导出尺寸：

```text
1170 x 2532
```

这是 iPhone 全屏比例。票面包含纸纹、阴影、可撕齿边、条形码、星级和时间戳。

## 阅历月视图

同步时会读取月度阅读统计，并对有阅读时长的日期尝试读取当天详情。

如果微信读书当天详情返回 `readLongest`，月历会用当天阅读最多的书籍封面填充对应日期。没有返回图书明细的日期，只显示当天阅读时长，不猜测封面。

## 项目结构

```text
.
├── export-notes.js
├── package.json
├── public
│   ├── app.js
│   ├── index.html
│   └── style.css
└── server.js
```

## 注意

- API Key 不会写入项目文件，网页只保存在当前浏览器 sessionStorage。
- 本项目是本地工具，不建议部署到公网。
- 如果要部署到服务器，请自行处理 HTTPS、鉴权和 API Key 存储问题。
