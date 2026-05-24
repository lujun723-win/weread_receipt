import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
const DATA_DIR = resolve(process.env.WEREAD_DATA_DIR || "/Users/lujun/Documents/阅读相关/微信读书数据");
const EXPORT_DIR = resolve(process.env.WEREAD_EXPORT_DIR || "/Users/lujun/Documents/阅读相关/微信读书笔记");
function safeName(value) { return String(value || "未命名").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名"; }
function safeId(value) { return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_"); }
function ymd(ts) { if (!ts) return "未记录"; const d = new Date(Number(ts) * 1000); return Number.isNaN(d.getTime()) ? "未记录" : d.toISOString().slice(0, 10); }
function mdEscape(value) { return String(value ?? "").replace(/\r\n/g, "\n").trim(); }
function totalNotes(item = {}) { return Number(item.reviewCount || 0) + Number(item.noteCount || 0) + Number(item.bookmarkCount || 0); }
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; } }
function chapterTitle(chapters, uid) { const found = (chapters || []).find(chapter => String(chapter.chapterUid) === String(uid)); return found ? found.title : "未分章节"; }
function noteMarkdown(item, bookmarkData, reviewsData) {
  const book = item.book || bookmarkData.book || {};
  const chapters = bookmarkData.chapters || [];
  const bookmarks = (bookmarkData.updated || []).slice().sort((a,b) => Number(a.createTime || 0) - Number(b.createTime || 0));
  const reviews = (reviewsData || []).map(entry => entry.review || entry).filter(Boolean).sort((a,b) => Number(a.createTime || 0) - Number(b.createTime || 0));
  const lines = [];
  lines.push("# " + (book.title || "未命名"));
  lines.push("");
  lines.push("- 作者：" + (book.author || "未知作者"));
  lines.push("- 书籍 ID：" + (item.bookId || book.bookId || ""));
  lines.push("- 阅读进度：" + (item.readingProgress ?? "未知"));
  lines.push("- 笔记总数：" + totalNotes(item));
  lines.push("- 划线：" + Number(item.noteCount || 0));
  lines.push("- 想法/点评：" + Number(item.reviewCount || 0));
  lines.push("- 书签：" + Number(item.bookmarkCount || 0));
  lines.push("- 导出日期：" + new Date().toISOString().slice(0, 10));
  lines.push("");
  lines.push("## 划线");
  lines.push("");
  if (!bookmarks.length) lines.push("无划线内容。");
  for (const mark of bookmarks) { lines.push("### " + chapterTitle(chapters, mark.chapterUid)); lines.push(""); lines.push("> " + mdEscape(mark.markText).replace(/\n/g, "\n> ")); lines.push(""); lines.push("- 时间：" + ymd(mark.createTime)); lines.push("- 位置：" + (mark.range || "未记录")); lines.push(""); }
  lines.push("## 想法与点评");
  lines.push("");
  if (!reviews.length) lines.push("无想法或点评内容。");
  for (const review of reviews) { lines.push("### " + (review.chapterName || "整本书")); lines.push(""); if (review.abstract) { lines.push("> " + mdEscape(review.abstract).replace(/\n/g, "\n> ")); lines.push(""); } lines.push(mdEscape(review.content || "无内容")); lines.push(""); lines.push("- 时间：" + ymd(review.createTime)); if (review.star !== undefined && review.star !== -1) lines.push("- 评分：" + review.star); lines.push(""); }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n");
}
if (!existsSync(join(DATA_DIR, "index.json"))) {
  console.error("本地还没有同步数据。先在网页点击同步数据，或启动服务调用 /api/sync-local。");
  process.exit(1);
}
await mkdir(EXPORT_DIR, {recursive:true});
const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
let count = 0;
for (const entry of index.books || []) {
  const record = await readJson(join(DATA_DIR, "books", safeId(entry.bookId) + ".json"), null);
  if (!record?.notebook) continue;
  const book = record.notebook.book || record.shelf || {};
  const fileName = safeName((book.title || "未命名") + " - " + (book.author || "未知作者")) + ".md";
  await writeFile(join(EXPORT_DIR, fileName), noteMarkdown(record.notebook, record.bookmarks || {}, record.reviews || []), "utf8");
  count += 1;
}
console.log("完成：" + count + " 本，目录：" + EXPORT_DIR);
