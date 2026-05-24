import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const PORT = Number(process.env.PORT || 5177);
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = resolve(process.env.WEREAD_DATA_DIR || join(ROOT, "data"));
const EXPORT_DIR = resolve(process.env.WEREAD_EXPORT_DIR || join(ROOT, "exports"));
const GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const VERSION = "1.0.3";
const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8" };
function send(res, code, body, headers = {}) { res.writeHead(code, headers); res.end(body); }
function json(res, code, body) { send(res, code, JSON.stringify(body), {"Content-Type":"application/json; charset=utf-8"}); }
async function body(req) { const a=[]; for await (const c of req) a.push(c); return Buffer.concat(a).toString("utf8"); }
function blocked(host) { const h = host.toLowerCase(); return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local") || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h); }
function safeName(value) { return String(value || "未命名").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "未命名"; }
function safeId(value) { return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_"); }
function ymd(ts) { if (!ts) return "未记录"; const d = new Date(Number(ts) * 1000); return Number.isNaN(d.getTime()) ? "未记录" : d.toISOString().slice(0, 10); }
function mdEscape(value) { return String(value ?? "").replace(/\r\n/g, "\n").trim(); }
function totalNotes(item = {}) { return Number(item.reviewCount || 0) + Number(item.noteCount || 0) + Number(item.bookmarkCount || 0); }
function isbn13Checksum(first12) { const sum = first12.split("").reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0); return String((10 - (sum % 10)) % 10); }
function normalizeIsbn(value) {
  const raw = String(value || "").replace(/[^0-9Xx]/g, "");
  if (/^\d{13}$/.test(raw) && isbn13Checksum(raw.slice(0, 12)) === raw[12]) return raw;
  if (/^\d{9}[0-9Xx]$/.test(raw)) { const base = "978" + raw.slice(0, 9); return base + isbn13Checksum(base); }
  return "";
}
function compactText(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[\s　·•\-—_:：,，.。!！?？《》<>〈〉"'“”‘’()[\]【】]/g, "");
}
function sameTitle(target, candidate) {
  const a = compactText(target);
  const b = compactText(candidate);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}
function firstValidIsbn(text) {
  const source = String(text || "");
  const matches = source.match(/[0-9][0-9\-\s]{8,20}[0-9Xx]/g) || [];
  for (const match of matches) {
    const isbn = normalizeIsbn(match);
    if (isbn) return isbn;
  }
  return "";
}
const SEARCH_HEADERS = {
  "User-Agent":"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  "Accept-Language":"zh-CN,zh;q=0.9,en;q=0.7"
};
function lastReadOf(book) { return Number(book?.progress?.book?.updateTime || book?.shelf?.readUpdateTime || book?.shelf?.updateTime || 0); }
async function readJson(file, fallback) { try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; } }
async function writeJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2), "utf8"); }
async function ensureStore() { await mkdir(join(DATA_DIR, "books"), {recursive:true}); await mkdir(join(DATA_DIR, "stats"), {recursive:true}); }
async function callWeread(apiKey, payload) {
  const up = await fetch(GATEWAY, { method:"POST", headers:{"Authorization":"Bearer " + apiKey, "Content-Type":"application/json"}, body: JSON.stringify({skill_version:VERSION, ...payload}) }).catch(error => ({networkError:error}));
  if (up.networkError) throw new Error("连接微信读书接口失败：" + up.networkError.message);
  const text = await up.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(text || "HTTP " + up.status); }
  if (!up.ok) throw new Error(data.error || data.errmsg || "HTTP " + up.status);
  if (data.errcode && data.errcode !== 0) throw new Error(data.errmsg || "微信读书接口错误：" + data.errcode);
  if (data.upgrade_info) throw new Error(data.upgrade_info.message || "微信读书 skill 需要升级。");
  return data;
}
async function weread(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const apiKey = p.apiKey || process.env.WEREAD_API_KEY;
  if (!apiKey) { json(res, 400, {error:"缺少 API Key。"}); return; }
  const { apiKey: _x, ...rest } = p;
  if (!rest.api_name) { json(res, 400, {error:"缺少 api_name。"}); return; }
  try { json(res, 200, await callWeread(apiKey, rest)); } catch (error) { json(res, 502, {error:error.message}); }
}
async function image(req, res, url) {
  const raw = url.searchParams.get("url");
  let target; try { target = new URL(raw); } catch { json(res, 400, {error:"图片 URL 无效。"}); return; }
  if (!["http:", "https:"].includes(target.protocol) || blocked(target.hostname)) { json(res, 400, {error:"图片 URL 不允许访问。"}); return; }
  const up = await fetch(target).catch(error => ({networkError:error}));
  if (up.networkError) { json(res, 502, {error:"读取封面失败：" + up.networkError.message}); return; }
  if (!up.ok) { json(res, up.status, {error:"读取封面失败：HTTP " + up.status}); return; }
  send(res, 200, Buffer.from(await up.arrayBuffer()), {"Content-Type":up.headers.get("content-type") || "image/jpeg", "Cache-Control":"public, max-age=86400"});
}
async function loadAllNotebooks(apiKey) {
  const all = [];
  let lastSort;
  for (let page = 0; page < 100; page += 1) {
    const payload = { api_name:"/user/notebooks", count:100 };
    if (lastSort) payload.lastSort = lastSort;
    const data = await callWeread(apiKey, payload);
    const pageBooks = data.books || [];
    all.push(...pageBooks);
    if (!data.hasMore || pageBooks.length === 0) return {raw:data, books:all};
    lastSort = pageBooks[pageBooks.length - 1].sort;
  }
  return {raw:{}, books:all};
}
async function loadAllMineReviews(apiKey, bookId) {
  const all = [];
  let synckey = 0;
  for (let page = 0; page < 100; page += 1) {
    const data = await callWeread(apiKey, { api_name:"/review/list/mine", bookid:bookId, synckey, count:20 });
    all.push(...(data.reviews || []));
    if (!data.hasMore) return all;
    synckey = data.synckey;
    if (!synckey) return all;
  }
  return all;
}
async function fetchText(url) {
  const response = await fetch(url, {headers:SEARCH_HEADERS}).catch(() => null);
  if (!response?.ok) return "";
  return response.text().catch(() => "");
}
async function findIsbnOnline(book) {
  const title = book?.info?.title || book?.shelf?.title || book?.notebook?.book?.title || "";
  const author = book?.info?.author || book?.shelf?.author || book?.notebook?.book?.author || "";
  if (!title) return {isbn:"", source:""};
  const queries = [...new Set([title + " " + author, title + " " + author + " ISBN", title + " ISBN"].map(item => item.trim()).filter(Boolean))];
  for (const query of queries) {
    const google = await fetch("https://www.googleapis.com/books/v1/volumes?q=" + encodeURIComponent(query) + "&maxResults=5").catch(() => null);
    if (google?.ok) {
      const data = await google.json().catch(() => null);
      for (const item of data?.items || []) {
        const info = item?.volumeInfo || {};
        if (!sameTitle(title, [info.title, info.subtitle].filter(Boolean).join(" "))) continue;
        for (const id of info.industryIdentifiers || []) {
          const isbn = normalizeIsbn(id.identifier);
          if (isbn) return {isbn, source:"google-books"};
        }
      }
    }
    const openLibrary = await fetch("https://openlibrary.org/search.json?title=" + encodeURIComponent(title) + (author ? "&author=" + encodeURIComponent(author) : "") + "&limit=10").catch(() => null);
    if (openLibrary?.ok) {
      const data = await openLibrary.json().catch(() => null);
      for (const item of data?.docs || []) {
        if (!sameTitle(title, item.title)) continue;
        for (const id of item.isbn || []) {
          const isbn = normalizeIsbn(id);
          if (isbn) return {isbn, source:"openlibrary"};
        }
      }
    }
    const doubanSearch = await fetch("https://www.douban.com/search?cat=1001&q=" + encodeURIComponent(query), {headers:SEARCH_HEADERS}).catch(() => null);
    if (doubanSearch?.ok) {
      const html = await doubanSearch.text();
      const links = [...html.matchAll(/https:\/\/book\.douban\.com\/subject\/\d+\//g)].map(match => match[0]);
      for (const link of [...new Set(links)].slice(0, 3)) {
        const page = await fetch(link, {headers:SEARCH_HEADERS}).catch(() => null);
        if (!page?.ok) continue;
        const subject = await page.text();
        const subjectTitle = subject.match(/property="v:itemreviewed">([^<]+)/)?.[1] || subject.match(/<title>\s*([^<(]+)/)?.[1] || "";
        if (!sameTitle(title, subjectTitle)) continue;
        const isbn = firstValidIsbn(subject.match(/ISBN\s*:?<\/span>[\s\S]{0,80}/i)?.[0] || subject.match(/ISBN\s*[:：][\s\S]{0,40}/i)?.[0] || "");
        if (isbn) return {isbn, source:"douban"};
      }
    }
    const baikeHtml = await fetchText("https://baike.baidu.com/item/" + encodeURIComponent(title));
    if (baikeHtml && sameTitle(title, baikeHtml.match(/<title>([^<]+)/)?.[1] || title)) {
      const isbn = firstValidIsbn(baikeHtml.match(/ISBN[\s\S]{0,140}/i)?.[0] || "");
      if (isbn) return {isbn, source:"baidu-baike"};
    }
    const jdSearch = await fetchText("https://search.jd.com/Search?keyword=" + encodeURIComponent(query) + "&enc=utf-8");
    if (jdSearch) {
      const links = [...jdSearch.matchAll(/\/\/item\.jd\.com\/\d+\.html/g)].map(match => "https:" + match[0]);
      for (const link of [...new Set(links)].slice(0, 3)) {
        const page = await fetchText(link);
        if (!page || !sameTitle(title, page.match(/<title>([^<]+)/)?.[1] || "")) continue;
        const isbn = firstValidIsbn(page.match(/ISBN[\s\S]{0,160}/i)?.[0] || page);
        if (isbn) return {isbn, source:"jd"};
      }
    }
  }
  return {isbn:"", source:""};
}
function calendarDateKey(ts) {
  const date = new Date(Number(ts) * 1000);
  if (Number.isNaN(date.getTime())) return "";
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
function monthKeyFromBaseTime(baseTime) {
  const date = new Date(Number(baseTime) * 1000);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 7);
}
function compactBookInfo(book) {
  if (!book || typeof book !== "object" || !book.cover || !(book.bookId || book.title || book.name)) return null;
  return {bookId:book.bookId || "", title:book.title || book.name || "未命名", author:book.author || book.authorName || "", cover:book.cover || ""};
}
function datedBooksFromMonthly(monthly) {
  const dated = new Map();
  for (const item of monthly?.preferBooks || []) {
    const match = String(item.reason || "").match(/(20\d{2})[/-](\d{1,2})[/-](\d{1,2})/);
    const book = compactBookInfo(item.bookInfo);
    if (match && book) dated.set(match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0"), book);
  }
  return dated;
}
function exactReadTimeBooksFromMonthly(monthly) {
  const byTime = new Map();
  for (const item of monthly?.readLongest || []) {
    const readTime = Number(item.readTime || 0);
    const book = compactBookInfo(item.book || item.albumInfo);
    if (!readTime || !book) continue;
    byTime.set(readTime, byTime.has(readTime) ? null : book);
  }
  return byTime;
}
async function enrichMonthlyCalendar(monthly) {
  const base = new Date(Number(monthly?.baseTime || Date.now() / 1000) * 1000);
  const year = base.getFullYear();
  const month = base.getMonth() + 1;
  const readTimes = monthly?.readTimes || {};
  const datedBooks = datedBooksFromMonthly(monthly);
  const exactTimeBooks = exactReadTimeBooksFromMonthly(monthly);
  const days = [];
  for (const [ts, seconds] of Object.entries(readTimes).sort((a,b) => Number(a[0]) - Number(b[0]))) {
    const date = calendarDateKey(ts);
    if (!date) continue;
    const day = {date, timestamp:Number(ts), readTime:Number(seconds || 0), book:null};
    if (day.readTime > 0) {
      day.book = datedBooks.get(date) || exactTimeBooks.get(day.readTime) || null;
    }
    days.push(day);
  }
  return Object.assign({}, monthly, {calendar:{generatedAt:new Date().toISOString(), year, month, days}});
}
function bookSyncKey(shelfItem, notebookItem) {
  return JSON.stringify({readUpdateTime:shelfItem.readUpdateTime || 0, updateTime:shelfItem.updateTime || 0, finishReading:shelfItem.finishReading || 0, sort:notebookItem?.sort || 0, reviewCount:notebookItem?.reviewCount || 0, noteCount:notebookItem?.noteCount || 0, bookmarkCount:notebookItem?.bookmarkCount || 0});
}
async function writeIndex(records) {
  const sorted = records.slice().sort((a,b) => lastReadOf(b) - lastReadOf(a));
  await writeJson(join(DATA_DIR, "index.json"), {updatedAt:new Date().toISOString(), books:sorted.map(book => ({bookId:book.bookId,title:book.shelf?.title,author:book.shelf?.author,lastRead:lastReadOf(book),isbn:book.isbn || "",isbnSource:book.isbnSource || "",bookClass:book.bookClass || "publication"}))});
  return sorted;
}
function sendProgress(res, event) {
  res.write(JSON.stringify(event) + "\n");
}
async function syncLocalStream(req, res) {
  let p;
  try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const apiKey = p.apiKey || process.env.WEREAD_API_KEY;
  if (!apiKey) { json(res, 400, {error:"缺少 API Key。"}); return; }
  res.writeHead(200, {"Content-Type":"application/x-ndjson; charset=utf-8", "Cache-Control":"no-cache"});
  const emit = (stage, percent, detail = "") => sendProgress(res, {type:"progress", stage, percent, detail});
  try {
    await ensureStore();
    emit("读取书架和统计", 5, "正在请求微信读书官方接口");
    let [shelf, monthly, annually, notebooks] = await Promise.all([
      callWeread(apiKey, {api_name:"/shelf/sync"}),
      callWeread(apiKey, {api_name:"/readdata/detail", mode:"monthly"}),
      callWeread(apiKey, {api_name:"/readdata/detail", mode:"annually"}),
      loadAllNotebooks(apiKey)
    ]);
    emit("生成月历", 10, "按月度统计生成阅读日历");
    monthly = await enrichMonthlyCalendar(monthly);
    emit("保存基础数据", 12, "书架、统计、笔记索引写入本地");
    await writeJson(join(DATA_DIR, "shelf.json"), shelf);
    await writeJson(join(DATA_DIR, "notebooks.json"), notebooks);
    await writeJson(join(DATA_DIR, "stats", "monthly.json"), monthly);
    await writeJson(join(DATA_DIR, "stats", "annually.json"), annually);
    const notebookMap = new Map((notebooks.books || []).map(item => [String(item.bookId || item.book?.bookId), item]));
    const shelfBooks = shelf.books || [];
    const results = [];
    const sync = {updated:0, reused:0, isbnEnriched:0, isbnMissing:0, dataDir:DATA_DIR};
    for (let index = 0; index < shelfBooks.length; index += 1) {
      const shelfItem = shelfBooks[index];
      const bookId = String(shelfItem.bookId);
      const title = shelfItem.title || bookId;
      const basePercent = 12 + Math.round(index / Math.max(shelfBooks.length, 1) * 78);
      emit("同步图书", basePercent, (index + 1) + "/" + shelfBooks.length + " " + title);
      const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
      const existing = await readJson(file, null);
      const notebook = notebookMap.get(bookId) || null;
      const key = bookSyncKey(shelfItem, notebook);
      let record = existing;
      const bookClass = existing?.bookClass || "publication";
      if (!record || record.syncKey !== key) {
        const [progress, info] = await Promise.all([
          callWeread(apiKey, {api_name:"/book/getprogress", bookId}),
          callWeread(apiKey, {api_name:"/book/info", bookId})
        ]);
        let bookmarks = existing?.bookmarks || {updated:[], chapters:[]};
        let reviews = existing?.reviews || [];
        if (notebook && (!existing || JSON.stringify(existing.notebookCounts) !== JSON.stringify({reviewCount:notebook.reviewCount,noteCount:notebook.noteCount,bookmarkCount:notebook.bookmarkCount,sort:notebook.sort}))) {
          [bookmarks, reviews] = await Promise.all([
            callWeread(apiKey, {api_name:"/book/bookmarklist", bookId}),
            loadAllMineReviews(apiKey, bookId)
          ]);
        }
        record = {bookId, bookClass, shelf:shelfItem, notebook, progress, info, bookmarks, reviews, syncKey:key, notebookCounts:notebook ? {reviewCount:notebook.reviewCount,noteCount:notebook.noteCount,bookmarkCount:notebook.bookmarkCount,sort:notebook.sort} : null, updatedAt:new Date().toISOString(), isbn:normalizeIsbn(info.isbn || existing?.isbn), isbnSource:normalizeIsbn(info.isbn) ? "weread" : existing?.isbnSource || ""};
        sync.updated += 1;
      } else {
        sync.reused += 1;
      }
      if (record.bookClass !== "document" && !normalizeIsbn(record.isbn)) {
        emit("补全 ISBN", Math.min(basePercent + 1, 94), title);
        const found = await findIsbnOnline(record).catch(() => ({isbn:"", source:""}));
        if (found.isbn) { record.isbn = found.isbn; record.isbnSource = found.source; record.updatedAt = new Date().toISOString(); sync.isbnEnriched += 1; }
        else sync.isbnMissing += 1;
      }
      await writeJson(file, record);
      results.push(record);
    }
    emit("生成索引", 94, "按最近阅读时间排序");
    await writeIndex(results);
    emit("完成", 100, "更新 " + sync.updated + " 本，复用 " + sync.reused + " 本");
    sendProgress(res, {type:"done", data:{shelf, monthly, annually, notebooks, books:results, sync}});
    res.end();
  } catch (error) {
    sendProgress(res, {type:"error", error:error.message});
    res.end();
  }
}
async function syncLocal(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const apiKey = p.apiKey || process.env.WEREAD_API_KEY;
  if (!apiKey) { json(res, 400, {error:"缺少 API Key。"}); return; }
  try {
    await ensureStore();
    let [shelf, monthly, annually, notebooks] = await Promise.all([
      callWeread(apiKey, {api_name:"/shelf/sync"}),
      callWeread(apiKey, {api_name:"/readdata/detail", mode:"monthly"}),
      callWeread(apiKey, {api_name:"/readdata/detail", mode:"annually"}),
      loadAllNotebooks(apiKey)
    ]);
    monthly = await enrichMonthlyCalendar(monthly);
    await writeJson(join(DATA_DIR, "shelf.json"), shelf);
    await writeJson(join(DATA_DIR, "notebooks.json"), notebooks);
    await writeJson(join(DATA_DIR, "stats", "monthly.json"), monthly);
    await writeJson(join(DATA_DIR, "stats", "annually.json"), annually);
    const notebookMap = new Map((notebooks.books || []).map(item => [String(item.bookId || item.book?.bookId), item]));
    const results = [];
    const sync = {updated:0, reused:0, isbnEnriched:0, isbnMissing:0, dataDir:DATA_DIR};
    for (const shelfItem of shelf.books || []) {
      const bookId = String(shelfItem.bookId);
      const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
      const existing = await readJson(file, null);
      const notebook = notebookMap.get(bookId) || null;
      const key = bookSyncKey(shelfItem, notebook);
      let record = existing;
      const bookClass = existing?.bookClass || "publication";
      if (!record || record.syncKey !== key) {
        const [progress, info] = await Promise.all([
          callWeread(apiKey, {api_name:"/book/getprogress", bookId}),
          callWeread(apiKey, {api_name:"/book/info", bookId})
        ]);
        let bookmarks = existing?.bookmarks || {updated:[], chapters:[]};
        let reviews = existing?.reviews || [];
        if (notebook && (!existing || JSON.stringify(existing.notebookCounts) !== JSON.stringify({reviewCount:notebook.reviewCount,noteCount:notebook.noteCount,bookmarkCount:notebook.bookmarkCount,sort:notebook.sort}))) {
          [bookmarks, reviews] = await Promise.all([
            callWeread(apiKey, {api_name:"/book/bookmarklist", bookId}),
            loadAllMineReviews(apiKey, bookId)
          ]);
        }
        record = {bookId, bookClass, shelf:shelfItem, notebook, progress, info, bookmarks, reviews, syncKey:key, notebookCounts:notebook ? {reviewCount:notebook.reviewCount,noteCount:notebook.noteCount,bookmarkCount:notebook.bookmarkCount,sort:notebook.sort} : null, updatedAt:new Date().toISOString(), isbn:normalizeIsbn(info.isbn || existing?.isbn), isbnSource:normalizeIsbn(info.isbn) ? "weread" : existing?.isbnSource || ""};
        sync.updated += 1;
      } else {
        sync.reused += 1;
      }
      if (record.bookClass !== "document" && !normalizeIsbn(record.isbn)) {
        const found = await findIsbnOnline(record).catch(() => ({isbn:"", source:""}));
        if (found.isbn) { record.isbn = found.isbn; record.isbnSource = found.source; record.updatedAt = new Date().toISOString(); sync.isbnEnriched += 1; }
        else sync.isbnMissing += 1;
      }
      await writeJson(file, record);
      results.push(record);
    }
    await writeIndex(results);
    json(res, 200, {shelf, monthly, annually, notebooks, books:results, sync});
  } catch (error) {
    json(res, 502, {error:error.message});
  }
}
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
async function loadLocalData(req, res) {
  try {
    const index = await readJson(join(DATA_DIR, "index.json"), null);
    if (!index) { json(res, 200, {empty:true, dataDir:DATA_DIR, books:[]}); return; }
    const books = [];
    for (const entry of index.books || []) {
      const record = await readJson(join(DATA_DIR, "books", safeId(entry.bookId) + ".json"), null);
      if (record) books.push(record);
    }
    books.sort((a,b) => lastReadOf(b) - lastReadOf(a));
    json(res, 200, {empty:false,dataDir:DATA_DIR,shelf:await readJson(join(DATA_DIR,"shelf.json"),{books:[],albums:[]}),monthly:await readJson(join(DATA_DIR,"stats","monthly.json"),{}),annually:await readJson(join(DATA_DIR,"stats","annually.json"),{}),notebooks:await readJson(join(DATA_DIR,"notebooks.json"),{books:[]}),books,sync:{updated:0,reused:books.length,isbnEnriched:0,isbnMissing:0,dataDir:DATA_DIR}});
  } catch (error) { json(res, 502, {error:error.message}); }
}
async function calendarMonth(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const apiKey = p.apiKey || process.env.WEREAD_API_KEY;
  const year = Number(p.year || 0);
  const month = Number(p.month || 0);
  const baseTime = year && month ? Math.floor(new Date(year, month - 1, 1).getTime() / 1000) : Number(p.baseTime || 0);
  if (!apiKey) { json(res, 400, {error:"缺少 API Key。"}); return; }
  if (!baseTime) { json(res, 400, {error:"缺少月份。"}); return; }
  try {
    await ensureStore();
    const monthly = await callWeread(apiKey, {api_name:"/readdata/detail", mode:"monthly", baseTime});
    const enriched = await enrichMonthlyCalendar(monthly);
    await writeJson(join(DATA_DIR, "stats", "monthly-" + monthKeyFromBaseTime(baseTime) + ".json"), enriched);
    json(res, 200, enriched);
  } catch (error) { json(res, 502, {error:error.message}); }
}
async function syncBook(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const apiKey = p.apiKey || process.env.WEREAD_API_KEY;
  const bookId = String(p.bookId || "");
  if (!apiKey) { json(res, 400, {error:"缺少 API Key。"}); return; }
  if (!bookId) { json(res, 400, {error:"缺少 bookId。"}); return; }
  try {
    await ensureStore();
    const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
    const existing = await readJson(file, null);
    if (!existing) { json(res, 404, {error:"本地没有这本书，请先同步书架。"}); return; }
    const [shelf, notebooks, progress, info] = await Promise.all([
      callWeread(apiKey, {api_name:"/shelf/sync"}),
      loadAllNotebooks(apiKey),
      callWeread(apiKey, {api_name:"/book/getprogress", bookId}),
      callWeread(apiKey, {api_name:"/book/info", bookId})
    ]);
    await writeJson(join(DATA_DIR, "shelf.json"), shelf);
    await writeJson(join(DATA_DIR, "notebooks.json"), notebooks);
    const shelfItem = (shelf.books || []).find(item => String(item.bookId) === bookId) || existing.shelf || {bookId};
    const notebook = (notebooks.books || []).find(item => String(item.bookId || item.book?.bookId) === bookId) || existing.notebook || null;
    let bookmarks = existing.bookmarks || {updated:[], chapters:[]};
    let reviews = existing.reviews || [];
    if (notebook) {
      [bookmarks, reviews] = await Promise.all([
        callWeread(apiKey, {api_name:"/book/bookmarklist", bookId}),
        loadAllMineReviews(apiKey, bookId)
      ]);
    }
    const bookClass = existing.bookClass || "publication";
    const record = {bookId, bookClass, shelf:shelfItem, notebook, progress, info, bookmarks, reviews, syncKey:bookSyncKey(shelfItem, notebook), notebookCounts:notebook ? {reviewCount:notebook.reviewCount,noteCount:notebook.noteCount,bookmarkCount:notebook.bookmarkCount,sort:notebook.sort} : null, updatedAt:new Date().toISOString(), isbn:normalizeIsbn(info.isbn || existing.isbn), isbnSource:normalizeIsbn(info.isbn) ? "weread" : existing.isbnSource || ""};
    let isbnEnriched = 0;
    let isbnMissing = 0;
    if (record.bookClass !== "document" && !normalizeIsbn(record.isbn)) {
      const found = await findIsbnOnline(record);
      if (found.isbn) { record.isbn = found.isbn; record.isbnSource = found.source; isbnEnriched = 1; }
      else isbnMissing = 1;
    }
    await writeJson(file, record);
    const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
    const records = [];
    const seen = new Set([bookId]);
    records.push(record);
    for (const entry of index.books || []) {
      if (seen.has(String(entry.bookId))) continue;
      const other = await readJson(join(DATA_DIR, "books", safeId(entry.bookId) + ".json"), null);
      if (other) records.push(other);
    }
    const books = await writeIndex(records);
    json(res, 200, {book:record, books, sync:{updated:1,reused:Math.max(0, books.length - 1),isbnEnriched,isbnMissing,dataDir:DATA_DIR}});
  } catch (error) { json(res, 502, {error:error.message}); }
}
async function updateBookClass(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const bookId = String(p.bookId || "");
  const bookClass = p.bookClass === "document" ? "document" : "publication";
  if (!bookId) { json(res, 400, {error:"缺少 bookId。"}); return; }
  const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
  const record = await readJson(file, null);
  if (!record) { json(res, 404, {error:"本地没有这本书，请先同步。"}); return; }
  record.bookClass = bookClass;
  record.updatedAt = new Date().toISOString();
  await writeJson(file, record);
  const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
  for (const item of index.books || []) if (String(item.bookId) === bookId) item.bookClass = bookClass;
  await writeJson(join(DATA_DIR, "index.json"), index);
  json(res, 200, {bookId, bookClass});
}

async function updateBookClassBatch(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const bookIds = Array.isArray(p.bookIds) ? p.bookIds.map(String).filter(Boolean) : [];
  const bookClass = p.bookClass === "document" ? "document" : "publication";
  if (!bookIds.length) { json(res, 400, {error:"缺少 bookIds。"}); return; }
  let updated = 0;
  for (const bookId of bookIds) {
    const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
    const record = await readJson(file, null);
    if (!record) continue;
    record.bookClass = bookClass;
    record.updatedAt = new Date().toISOString();
    await writeJson(file, record);
    updated += 1;
  }
  const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
  const idSet = new Set(bookIds);
  for (const item of index.books || []) if (idSet.has(String(item.bookId))) item.bookClass = bookClass;
  await writeJson(join(DATA_DIR, "index.json"), index);
  json(res, 200, {bookIds, bookClass, updated});
}

async function recheckIsbn(req, res) {
  let p; try { p = JSON.parse(await body(req)); } catch { json(res, 400, {error:"请求体不是有效 JSON。"}); return; }
  const bookId = String(p.bookId || "");
  if (!bookId) { json(res, 400, {error:"缺少 bookId。"}); return; }
  const file = join(DATA_DIR, "books", safeId(bookId) + ".json");
  const record = await readJson(file, null);
  if (!record) { json(res, 404, {error:"本地没有这本书，请先同步。"}); return; }
  if (record.bookClass === "document") { json(res, 400, {error:"个人文档不需要补 ISBN。"}); return; }
  const found = await findIsbnOnline(record);
  if (found.isbn) {
    record.isbn = found.isbn;
    record.isbnSource = found.source;
    record.updatedAt = new Date().toISOString();
    await writeJson(file, record);
    const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
    for (const item of index.books || []) {
      if (String(item.bookId) === bookId) {
        item.isbn = found.isbn;
        item.isbnSource = found.source;
      }
    }
    await writeJson(join(DATA_DIR, "index.json"), index);
  }
  json(res, 200, found);
}

async function exportNotes(req, res) {
  try {
    await mkdir(EXPORT_DIR, {recursive:true});
    const bookDir = join(DATA_DIR, "books");
    if (!existsSync(bookDir)) { json(res, 400, {error:"本地还没有同步数据，请先点击同步数据。"}); return; }
    const index = await readJson(join(DATA_DIR, "index.json"), {books:[]});
    const files = [];
    for (const entry of index.books || []) {
      const record = await readJson(join(bookDir, safeId(entry.bookId) + ".json"), null);
      if (!record?.notebook) continue;
      const book = record.notebook.book || record.shelf || {};
      const fileName = safeName((book.title || "未命名") + " - " + (book.author || "未知作者")) + ".md";
      const filePath = join(EXPORT_DIR, fileName);
      await writeFile(filePath, noteMarkdown(record.notebook, record.bookmarks || {}, record.reviews || []), "utf8");
      files.push({title:book.title || "未命名", filePath, notes:totalNotes(record.notebook)});
    }
    json(res, 200, {exportDir:EXPORT_DIR, count:files.length, files});
  } catch (error) { json(res, 502, {error:error.message}); }
}
async function file(req, res, url) {
  const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safe = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) { send(res, 403, "Forbidden"); return; }
  try { send(res, 200, await readFile(filePath), {"Content-Type": MIME[extname(filePath)] || "application/octet-stream"}); } catch { send(res, 404, "Not Found"); }
}
createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://" + req.headers.host);
  try {
    if (req.method === "POST" && url.pathname === "/api/weread") return weread(req, res);
    if (req.method === "GET" && url.pathname === "/api/local-data") return loadLocalData(req, res);
    if (req.method === "POST" && url.pathname === "/api/calendar-month") return calendarMonth(req, res);
    if (req.method === "POST" && url.pathname === "/api/sync-book") return syncBook(req, res);
    if (req.method === "POST" && url.pathname === "/api/book-class") return updateBookClass(req, res);
    if (req.method === "POST" && url.pathname === "/api/book-class-batch") return updateBookClassBatch(req, res);
    if (req.method === "POST" && url.pathname === "/api/recheck-isbn") return recheckIsbn(req, res);
    if (req.method === "POST" && url.pathname === "/api/sync-local-stream") return syncLocalStream(req, res);
    if (req.method === "POST" && url.pathname === "/api/sync-local") return syncLocal(req, res);
    if (req.method === "POST" && url.pathname === "/api/export-notes") return exportNotes(req, res);
    if (req.method === "GET" && url.pathname === "/api/image") return image(req, res, url);
    if (req.method === "GET") return file(req, res, url);
    send(res, 405, "Method Not Allowed");
  } catch (error) { json(res, 500, {error:error.message}); }
}).listen(PORT, "127.0.0.1", () => console.log("WeRead poster tool: http://localhost:" + PORT));
