const $ = (selector) => document.querySelector(selector);
const apiKeyInput = $("#apiKey");
const loadShelfButton = $("#loadShelf");
const exportButton = $("#exportPng");
const bookClassSelect = $("#bookClassSelect");
const lookupIsbnButton = $("#lookupIsbn");
const exportNotesButton = $("#exportNotes");
const exportResult = $("#exportResult");
const syncProgress = $("#syncProgress");
const syncStage = $("#syncStage");
const syncPercent = $("#syncPercent");
const syncBar = $("#syncBar");
const syncDetail = $("#syncDetail");
const todayStamp = $("#todayStamp");
const ratingInput = $("#ratingInput");
const ratingValue = $("#ratingValue");
const statusLine = $(".status-line");
const statusText = $("#statusText");
const metaText = $("#metaText");
const bookList = $("#bookList");
const receipt = $("#receipt");
const filterInput = $("#filter");
const monthTime = $("#monthTime");
const monthDays = $("#monthDays");
const yearTime = $("#yearTime");
const yearDays = $("#yearDays");
const shelfTotal = $("#shelfTotal");
const shelfMix = $("#shelfMix");
const noteTotal = $("#noteTotal");
const noteBooks = $("#noteBooks");
const longestList = $("#longestList");
const categoryBars = $("#categoryBars");
const notesList = $("#notesList");
const preferWord = $("#preferWord");
let books = [];
let selectedBook = null;
let notebookMap = new Map();
let monthStats = null;
let currentRating = Number(ratingInput.value);
todayStamp.textContent = "今天 " + new Date().toLocaleString("zh-CN", {hour12:false});
const storedKey = sessionStorage.getItem("weread_api_key");
if (storedKey) apiKeyInput.value = storedKey;
function setStatus(message, type = "normal") { statusText.textContent = message; statusLine.classList.toggle("error", type === "error"); }
function apiKey() { return apiKeyInput.value.trim(); }
async function weread(body) {
  const response = await fetch("/api/weread", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(Object.assign({apiKey: apiKey()}, body)) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { throw new Error(text || "HTTP " + response.status); }
  if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
  if (data.errcode && data.errcode !== 0) throw new Error(data.errmsg || "微信读书接口错误：" + data.errcode);
  if (data.upgrade_info) throw new Error(data.upgrade_info.message || "微信读书 skill 需要升级。");
  return data;
}
function formatDate(value) { if (!value) return "未记录"; const d = new Date(Number(value) * 1000); return Number.isNaN(d.getTime()) ? "未记录" : d.toISOString().slice(0, 10); }
function formatDuration(seconds, compact = false) { const total = Number(seconds || 0); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); return compact ? h + "h " + String(m).padStart(2,"0") + "m" : h + "小时" + String(m).padStart(2,"0") + "分"; }
function readDaysOf(book) { return Math.max(0, Math.ceil(Number(book.progress?.book?.recordReadingTime || 0) / 86400)); }
function shortCategory(value) { const text = String(value || "未分类").replace(/[\s·•]+/g, "-"); return text.length > 12 ? text.slice(0, 12) + "…" : text; }
function progressOf(book) { return Number((book.progress && book.progress.book && book.progress.book.progress) || book.readingProgress || 0); }
function shelfOf(book) { return book?.shelf || book || {}; }
function titleOf(book) { return book?.info?.title || shelfOf(book).title || book?.notebook?.book?.title || "未命名"; }
function authorOf(book) { return book?.info?.author || shelfOf(book).author || book?.notebook?.book?.author || "未知作者"; }
function coverOf(book) { return book?.info?.cover || shelfOf(book).cover || book?.notebook?.book?.cover || ""; }
function categoryOf(book) { return book?.info?.category || shelfOf(book).category || "未分类"; }
function classOf(book) { return book?.bookClass === "document" ? "document" : "publication"; }

function statusOf(book) { const p = progressOf(book); if (p === 100 && book.progress && book.progress.book && book.progress.book.finishTime) return "读完"; if (p > 0 || book.finishReading === 0) return "在读"; return "搁置"; }
function lastReadOf(book) { const shelf = shelfOf(book); return Number((book.progress && book.progress.book && book.progress.book.updateTime) || shelf.readUpdateTime || shelf.updateTime || 0); }
function normalizeBook(item) { return { type:"book", bookId:item.bookId, title:item.title, author:item.author || "未知作者", cover:item.cover, category:item.category || "", readUpdateTime:item.readUpdateTime || item.updateTime, updateTime:item.updateTime, finishReading:item.finishReading, secret:item.secret, progress:null, info:null }; }
async function attachBookData(book) { const [progress, info] = await Promise.all([weread({ api_name:"/book/getprogress", bookId:book.bookId }), weread({ api_name:"/book/info", bookId:book.bookId })]); return Object.assign({}, book, {progress, info}); }
function totalNotes(item) { return Number(item.reviewCount || 0) + Number(item.noteCount || 0) + Number(item.bookmarkCount || 0); }
async function loadAllNotebooks() {
  const all = [];
  let lastSort;
  for (let page = 0; page < 20; page += 1) {
    const body = { api_name:"/user/notebooks", count:100 };
    if (lastSort) body.lastSort = lastSort;
    const data = await weread(body);
    const pageBooks = data.books || [];
    all.push(...pageBooks);
    if (!data.hasMore || pageBooks.length === 0) return { raw:data, books:all };
    lastSort = pageBooks[pageBooks.length - 1].sort;
  }
  return { raw:{}, books:all };
}


function setSyncProgress(percent, stage, detail = "") {
  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  syncProgress.hidden = false;
  syncBar.style.width = value + "%";
  syncPercent.textContent = value + "%";
  syncStage.textContent = stage || "同步中";
  syncDetail.textContent = detail;
}
function applySyncData(data) {
  monthStats = data.monthly;
  renderSummary(data.shelf, data.monthly, data.annually, data.notebooks);
  books = (data.books || []).sort((a,b) => lastReadOf(b) - lastReadOf(a));
  selectedBook = null;
  renderLongest(data.monthly);
  renderList();
  renderReceipt();
  if (books.length) selectBook(books[0].bookId);
  metaText.textContent = "本地仓库：" + data.sync.dataDir + "；更新 " + data.sync.updated + " 本，复用 " + data.sync.reused + " 本，补全 ISBN " + data.sync.isbnEnriched + " 本。";
}


async function loadLocalDataOnOpen() {
  try {
    const response = await fetch("/api/local-data");
    const data = await response.json();
    if (!response.ok || data.empty) { setStatus("本地暂无数据，请同步。", data.empty ? "normal" : "error"); return; }
    applySyncData(data);
    setStatus("已载入本地数据。");
    syncProgress.hidden = true;
  } catch (error) {
    setStatus("本地数据读取失败：" + error.message, "error");
  }
}
async function saveSelectedClass() {
  if (!selectedBook) return;
  const bookClass = bookClassSelect.value;
  selectedBook.bookClass = bookClass;
  renderReceipt();
  lookupIsbnButton.disabled = bookClass === "document";
  try {
    await fetch("/api/book-class", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({bookId:selectedBook.bookId, bookClass})});
    setStatus(bookClass === "document" ? "已标记为个人文档。" : "已标记为出版物。");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

async function lookupSelectedIsbn() {
  if (!selectedBook || classOf(selectedBook) === "document") return;
  lookupIsbnButton.disabled = true;
  setStatus("正在按书名补 ISBN...");
  try {
    const response = await fetch("/api/recheck-isbn", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({bookId:selectedBook.bookId})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "ISBN 查询失败");
    if (!data.isbn) throw new Error("没有查到可校验的 ISBN。");
    selectedBook.isbn = data.isbn;
    selectedBook.isbnSource = data.source;
    renderReceipt();
    setStatus("已补全 ISBN：" + data.isbn + "（" + data.source + "）");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    lookupIsbnButton.disabled = !selectedBook || classOf(selectedBook) === "document";
  }
}

async function exportMarkdownNotes() {
  const key = apiKey();
  if (!key) { setStatus("先填 API Key。", "error"); return; }
  sessionStorage.setItem("weread_api_key", key);
  exportNotesButton.disabled = true;
  exportResult.hidden = true;
  setStatus("正在按图书导出 Markdown 笔记...");
  try {
    const response = await fetch("/api/export-notes", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({apiKey:key})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "导出失败");
    exportResult.hidden = false;
    exportResult.innerHTML = "已导出 <strong>" + data.count + "</strong> 本书的笔记到：<strong>" + escapeHtml(data.exportDir) + "</strong>";
    setStatus("Markdown 笔记导出完成。");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    exportNotesButton.disabled = false;
  }
}

async function loadShelf() {
  const key = apiKey();
  if (!key) { setStatus("先填 API Key。", "error"); return; }
  sessionStorage.setItem("weread_api_key", key);
  loadShelfButton.disabled = true;
  exportButton.disabled = true;
  setStatus("正在增量同步到本地...");
  metaText.textContent = "";
  setSyncProgress(0, "准备同步", "连接本地服务");
  try {
    const response = await fetch("/api/sync-local-stream", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({apiKey:key})
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "同步失败");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalData = null;
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream:true});
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.type === "progress") {
          setSyncProgress(event.percent, event.stage, event.detail);
          setStatus(event.stage + "...");
        } else if (event.type === "done") {
          finalData = event.data;
        } else if (event.type === "error") {
          throw new Error(event.error || "同步失败");
        }
      }
    }
    if (!finalData) throw new Error("同步没有返回最终数据。");
    applySyncData(finalData);
    setSyncProgress(100, "完成", "更新 " + finalData.sync.updated + " 本，复用 " + finalData.sync.reused + " 本");
    setStatus("增量同步完成。");
  } catch (error) {
    setStatus(error.message, "error");
    syncDetail.textContent = error.message;
  } finally {
    loadShelfButton.disabled = false;
  }
}

function renderSummary(shelf, monthly, annually, notebooks) {
  const bookCount = (shelf.books || []).length;
  const albumCount = (shelf.albums || []).length;
  const mpCount = shelf.mp ? 1 : 0;
  shelfTotal.textContent = String(bookCount + albumCount + mpCount);
  shelfMix.textContent = bookCount + " 本电子书 / " + albumCount + " 个有声内容" + (mpCount ? " / 文章收藏" : "");
  monthTime.textContent = formatDuration(monthly.totalReadTime || 0);
  monthDays.textContent = (monthly.readDays || 0) + " 个有效阅读日";
  yearTime.textContent = formatDuration(annually.totalReadTime || 0);
  yearDays.textContent = (annually.readDays || 0) + " 个有效阅读日";
  renderCategories(annually.preferCategory || monthly.preferCategory || [], annually.preferCategoryWord || monthly.preferCategoryWord || "偏好分布");
  if (notebooks.error) { noteTotal.textContent = "--"; noteBooks.textContent = "笔记读取失败"; notesList.textContent = notebooks.error.message; return; }
  notebookMap = new Map((notebooks.books || []).map(item => [item.bookId, item]));
  const total = notebooks.books.reduce((sum, item) => sum + totalNotes(item), 0);
  noteTotal.textContent = String(total);
  noteBooks.textContent = (notebooks.raw.totalBookCount || notebooks.books.length || 0) + " 本有笔记";
  renderNotes(notebooks.books || []);
}
function renderLongest(data) {
  const items = (data.readLongest || []).slice(0,5);
  if (!items.length) { longestList.className = "rank-list empty-text"; longestList.textContent = "暂无排行数据"; return; }
  longestList.className = "rank-list";
  longestList.innerHTML = items.map((item, index) => {
    const book = item.book || item.albumInfo || {};
    return '<div class="rank-item"><div class="rank-no">' + (index + 1) + '</div><div><div class="rank-title">' + escapeHtml(book.title || book.name || "未命名") + '</div><div class="rank-sub">' + escapeHtml(book.author || book.authorName || "") + '</div></div><div class="rank-value">' + formatDuration(item.readTime || 0, true) + '</div></div>';
  }).join("");
}
function renderCategories(items, title) {
  preferWord.textContent = title || "偏好分布";
  const list = items.filter(item => item.categoryTitle).slice(0,6);
  if (!list.length) { categoryBars.className = "category-bars empty-text"; categoryBars.textContent = "暂无偏好数据"; return; }
  const max = Math.max(...list.map(item => Number(item.readingTime || 0)), 1);
  categoryBars.className = "category-bars";
  categoryBars.innerHTML = list.map(item => {
    const pct = Math.max(4, Math.round(Number(item.readingTime || 0) / max * 100));
    return '<div class="cat-row"><div class="cat-name">' + escapeHtml(item.categoryTitle) + '</div><div class="cat-track"><div class="cat-fill" style="width:' + pct + '%"></div></div><div class="cat-time">' + formatDuration(item.readingTime || 0, true) + '</div></div>';
  }).join("");
}
function renderNotes(items) {
  const list = items.slice().sort((a,b) => totalNotes(b) - totalNotes(a)).slice(0,5);
  if (!list.length) { notesList.className = "rank-list empty-text"; notesList.textContent = "暂无笔记数据"; return; }
  notesList.className = "rank-list";
  notesList.innerHTML = list.map((item, index) => {
    const book = item.book || {};
    return '<div class="rank-item"><div class="rank-no">' + (index + 1) + '</div><div><div class="rank-title">' + escapeHtml(book.title || "未命名") + '</div><div class="rank-sub">划线 ' + Number(item.noteCount || 0) + ' / 想法 ' + Number(item.reviewCount || 0) + '</div></div><div class="rank-value">' + totalNotes(item) + '</div></div>';
  }).join("");
}
function proxiedImage(url) { return "/api/image?url=" + encodeURIComponent(url || ""); }
function renderList() {
  const keyword = filterInput.value.trim().toLowerCase();
  const visible = books.filter(book => (titleOf(book) + " " + authorOf(book)).toLowerCase().includes(keyword));
  bookList.replaceChildren(...visible.map(book => {
    const row = document.createElement("button"); row.type = "button"; row.className = "book-row" + (selectedBook && selectedBook.bookId === book.bookId ? " active" : ""); row.addEventListener("click", () => selectBook(book.bookId));
    const img = document.createElement("img"); img.alt = titleOf(book); img.src = proxiedImage(coverOf(book));
    const info = document.createElement("div");
    const title = document.createElement("div"); title.className = "book-title"; title.textContent = titleOf(book);
    const author = document.createElement("div"); author.className = "book-author"; author.textContent = authorOf(book);
    const date = document.createElement("div"); date.className = "book-date"; date.textContent = "已读 " + readDaysOf(book) + " 天";
    info.append(title, author, date);
    const progress = document.createElement("div"); progress.className = "book-progress"; progress.textContent = progressOf(book) + "%";
    row.append(img, info, progress); return row;
  }));
}
function selectBook(bookId) { selectedBook = books.find(book => book.bookId === bookId) || null; if (selectedBook) bookClassSelect.value = classOf(selectedBook); renderList(); renderReceipt(); exportButton.disabled = !selectedBook; lookupIsbnButton.disabled = !selectedBook || classOf(selectedBook) === "document"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function isbn13FromBook(book) {
  const raw = String(book.isbn || (book.info && book.info.isbn) || "").replace(/[^0-9Xx]/g, "");
  if (/^\d{13}$/.test(raw)) return raw;
  if (/^\d{9}[0-9Xx]$/.test(raw)) {
    const base = "978" + raw.slice(0, 9);
    return base + ean13Checksum(base);
  }
  return "";
}
function ean13Checksum(first12) {
  const sum = first12.split("").reduce((acc, digit, index) => acc + Number(digit) * (index % 2 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
const EAN_LEFT_ODD = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_LEFT_EVEN = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_RIGHT = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PARITY = ["OOOOOO","OOEOEE","OOEEOE","OOEEEO","OEOOEE","OEEOOE","OEEEOO","OEOEOE","OEOEEO","OEEOEO"];
function ean13Bits(code) {
  if (!/^\d{13}$/.test(code)) return "";
  if (ean13Checksum(code.slice(0, 12)) !== code[12]) return "";
  const parity = EAN_PARITY[Number(code[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i += 1) bits += (parity[i - 1] === "O" ? EAN_LEFT_ODD : EAN_LEFT_EVEN)[Number(code[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i += 1) bits += EAN_RIGHT[Number(code[i])];
  bits += "101";
  return bits;
}
function documentBits(book) {
  const seed = String(book?.bookId || titleOf(book) || "document");
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  let bits = "101010111000";
  for (let i = 0; i < 72; i += 1) bits += ((hash >>> (i % 24)) + i * 7) % 3 === 0 ? "0" : "1";
  bits += "000111010101";
  return bits;
}
function documentCodeHtml(book) {
  const bars = documentBits(book).split("").map((bit, index) => bit === "1" ? '<span class="bar" style="height:' + (56 + ((index * 13) % 42)) + 'px;width:4px"></span>' : '<span style="width:4px;height:1px"></span>').join("");
  return '<div class="doc-code"><div class="doc-code-bars">' + bars + '</div><div class="doc-code-label">个人文档</div></div>';
}
function barcodeBars(book) {
  if (classOf(book) === "document") return documentCodeHtml(book);
  const code = isbn13FromBook(book);
  const bits = ean13Bits(code);
  if (!bits) return '<div class="empty-text">无有效 ISBN</div>';
  return bits.split("").map((bit, index) => bit === "1" ? '<span class="bar" style="height:' + ((index < 3 || (index >= 45 && index < 50) || index >= 92) ? 104 : 92) + 'px;width:4px"></span>' : '<span style="width:4px;height:1px"></span>').join("") + '<div class="barcode-label">ISBN ' + code + '</div>';
}
function starText(rating) {
  const value = Math.max(0, Math.min(5, Number(rating || 0)));
  return Array.from({length:5}, (_, i) => {
    const diff = value - i;
    const cls = diff >= 1 ? "full" : diff >= 0.5 ? "half" : "empty";
    return '<span class="star ' + cls + '">★</span>';
  }).join("");
}
function renderReceipt() {
  if (!selectedBook) { receipt.className = "receipt empty"; receipt.innerHTML = '<div class="empty-state">同步后选择一本书</div>'; return; }
  const p = progressOf(selectedBook); const seconds = selectedBook.progress?.book?.recordReadingTime || 0; const recent = lastReadOf(selectedBook); const state = statusOf(selectedBook); const active = state === "在读" ? 0 : state === "搁置" ? 1 : 2; const note = notebookMap.get(selectedBook.bookId) || selectedBook.notebook; const noteCount = note ? totalNotes(note) : 0;
  const tabs = ["在读", "搁置", "读完"].map((label, i) => '<span class="' + (i === active ? 'active' : '') + '">' + label + '</span>').join("");
  receipt.className = "receipt";
  receipt.innerHTML = '<div class="ticket-block"></div><div class="ticket-tab"></div><div class="hatch left"></div><div class="hatch right"></div><div class="ticket-top">WECHAT READING RECEIPT</div><div class="cover-wrap"><img alt="' + escapeHtml(titleOf(selectedBook)) + '" src="' + proxiedImage(coverOf(selectedBook)) + '"></div><h2>' + escapeHtml(titleOf(selectedBook)) + '</h2><div class="author">' + escapeHtml(authorOf(selectedBook)) + '</div><div class="dash"></div><div class="stats"><div><div class="stat-label">进度</div><div class="stat-value">' + p + '%</div></div><div><div class="stat-label">时长</div><div class="stat-value">' + formatDuration(seconds) + '</div></div><div><div class="stat-label">已读天数</div><div class="stat-value">' + readDaysOf(selectedBook) + '天</div></div></div><div class="mini-stats"><div><span>笔记</span><strong>' + noteCount + '</strong></div><div><span>分类</span><strong>' + escapeHtml(shortCategory(categoryOf(selectedBook))) + '</strong></div></div><div class="state-tabs">' + tabs + '</div><div class="dash"></div><div class="barcode">' + barcodeBars(selectedBook) + '</div><div class="stars">' + starText(currentRating) + '</div><div class="receipt-date">日期：' + new Date().toISOString().slice(0,10) + '</div>';
}
async function loadImage(src) { const image = new Image(); image.crossOrigin = "anonymous"; image.decoding = "async"; image.src = src; await image.decode(); return image; }
function drawCover(ctx, image, x, y, w, h) { const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight); const sw = w / scale; const sh = h / scale; ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, w, h); }
function dash(ctx, x, y, w) { ctx.strokeStyle = "#333"; ctx.lineWidth = 3; ctx.setLineDash([12,10]); ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke(); ctx.setLineDash([]); }
function star(ctx, cx, cy, r, fillRatio) { ctx.save(); ctx.beginPath(); for (let i=0;i<10;i+=1) { const a = -Math.PI/2 + i*Math.PI/5; const rr = i%2===0 ? r : r*.45; const x = cx + Math.cos(a)*rr; const y = cy + Math.sin(a)*rr; if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y); } ctx.closePath(); ctx.lineWidth=6; ctx.strokeStyle="#111"; ctx.stroke(); if (fillRatio > 0) { ctx.clip(); ctx.fillStyle="#111"; ctx.fillRect(cx-r, cy-r, r*2*fillRatio, r*2); } ctx.restore(); }
function tabs(ctx, state) { const labels=["在读","搁置","读完"]; const active=labels.indexOf(state); const x=300,y=1095,w=480,h=70; ctx.strokeStyle="#999"; ctx.lineWidth=3; ctx.strokeRect(x,y,w,h); labels.forEach((label,i)=>{ const cell=x+i*w/3; if(i===active){ctx.fillStyle="#aaa";ctx.fillRect(cell,y,w/3,h);} ctx.fillStyle=i===active?"#fff":"#111"; ctx.textAlign="center"; ctx.font="34px system-ui,sans-serif"; ctx.fillText(label,cell+w/6,y+47); }); }
function ticketPath(ctx, x, y, w, h, r = 13, step = 34) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let cx = x + r + 10; cx < x + w - r; cx += step) {
    ctx.lineTo(cx - r, y);
    ctx.arc(cx, y, r, Math.PI, 0, true);
  }
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  for (let cx = x + w - r - 10; cx > x + r; cx -= step) {
    ctx.lineTo(cx + r, y + h);
    ctx.arc(cx, y + h, r, 0, Math.PI, true);
  }
  ctx.lineTo(x, y + h);
  ctx.closePath();
}
function barcode(ctx, book, x = 395, y = 1615, module = 4) { if (classOf(book) === "document") { const bits = documentBits(book); for (let i = 0; i < bits.length; i += 1) { if (bits[i] === "1") { ctx.fillStyle = "#111"; ctx.fillRect(x + i * module, y, module, 78 + ((i * 13) % 50)); } } ctx.textAlign = "center"; ctx.font = "28px ui-monospace,Menlo,monospace"; ctx.fillText("个人文档", 585, y + 154); return; } const code = isbn13FromBook(book); const bits = ean13Bits(code); if (!bits) { ctx.textAlign = "center"; ctx.font = "26px system-ui,sans-serif"; ctx.fillText("无有效 ISBN", 585, y + 84); return; } for (let i = 0; i < bits.length; i += 1) { if (bits[i] === "1") { const guard = i < 3 || (i >= 45 && i < 50) || i >= 92; ctx.fillStyle = "#111"; ctx.fillRect(x, y, module, guard ? 132 : 112); } x += module; } ctx.textAlign = "center"; ctx.font = "28px ui-monospace,Menlo,monospace"; ctx.fillText("ISBN " + code, 585, y + 156); }
async function exportSelected() {
  if (!selectedBook) return;
  exportButton.disabled = true;
  setStatus("正在生成阅读小票...");
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1170;
    canvas.height = 2532;
    const ctx = canvas.getContext("2d");
    const p = progressOf(selectedBook);
    const seconds = selectedBook.progress?.book?.recordReadingTime || 0;
    const recent = lastReadOf(selectedBook);
    const note = notebookMap.get(selectedBook.bookId) || selectedBook.notebook;
    const noteCount = note ? totalNotes(note) : 0;
    const image = await loadImage(proxiedImage(coverOf(selectedBook)));

    ctx.fillStyle = "#e9dfd0";
    ctx.fillRect(0, 0, 1170, 2532);
    ctx.save();
    ctx.shadowColor = "rgba(35, 28, 20, .34)";
    ctx.shadowBlur = 46;
    ctx.shadowOffsetX = 24;
    ctx.shadowOffsetY = 30;
    ctx.fillStyle = "#fbfaf4";
    ticketPath(ctx, 90, 96, 990, 2292);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(75,75,75,.64)";
    ctx.lineWidth = 3;
    ticketPath(ctx, 90, 96, 990, 2292);
    ctx.stroke();
    drawTicketDetails(ctx);

    ctx.save();
    ticketPath(ctx, 90, 96, 990, 2292);
    ctx.clip();
    ctx.fillStyle = "rgba(96,72,42,.08)";
    for (let i = 0; i < 1500; i += 1) {
      const x = (i * 97) % 990 + 90;
      const y = (i * 193) % 2292 + 96;
      ctx.fillRect(x, y, 1 + (i % 2), 1);
    }
    ctx.restore();

    ctx.fillStyle = "#222";
    ctx.textAlign = "center";
    ctx.font = "28px ui-monospace,Menlo,monospace";
    ctx.fillText("WECHAT READING RECEIPT", 585, 182);
    ctx.filter = "grayscale(1)";
    drawCover(ctx, image, 370, 232, 430, 616);
    ctx.filter = "none";
    drawCenteredLines(ctx, titleOf(selectedBook), 585, 910, 58, 820, 2);
    ctx.font = "38px system-ui,sans-serif";
    ctx.fillText(authorOf(selectedBook), 585, 1038);
    dash(ctx, 170, 1124, 830);

    ctx.font = "38px system-ui,sans-serif";
    ["进度", "时长", "已读天数"].forEach((v, i) => ctx.fillText(v, 280 + i * 305, 1168));
    ctx.font = "46px system-ui,sans-serif";
    [p + "%", formatDuration(seconds), readDaysOf(selectedBook) + "天"].forEach((v, i) => ctx.fillText(v, 280 + i * 305, 1238));

    ctx.font = "32px system-ui,sans-serif";
    ctx.fillText("笔记 " + noteCount + " 条 / " + shortCategory(categoryOf(selectedBook)), 585, 1328);
    drawCanvasTabs(ctx, statusOf(selectedBook), 310, 1388, 550, 76);
    dash(ctx, 170, 1548, 830);

    barcode(ctx, selectedBook, 395, 1615, 4);
    for (let i = 0; i < 5; i += 1) star(ctx, 407 + i * 88, 1910, 34, currentRating - i >= 1 ? 1 : currentRating - i >= .5 ? .5 : 0);

    ctx.textAlign = "right";
    ctx.font = "36px system-ui,sans-serif";
    ctx.fillText("时间：" + new Date().toLocaleString("zh-CN", {hour12:false}), 960, 2208);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("生成 PNG 失败。");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = titleOf(selectedBook) + "-阅读小票.png";
    link.click();
    URL.revokeObjectURL(url);
    setStatus("阅读小票已生成。");
  } catch(error) {
    setStatus(error.message, "error");
  } finally {
    exportButton.disabled = !selectedBook;
  }
}
function drawTicketDetails(ctx) {
  ctx.save();
  ctx.fillStyle = "#555";
  ctx.fillRect(90, 2210, 92, 40);
  ctx.fillRect(1062, 2044, 18, 82);
  ctx.fillStyle = "rgba(90,90,90,.65)";
  for (let i = 0; i < 12; i += 1) { ctx.fillRect(205 + i * 8, 1898 - i % 2 * 2, 3, 26); ctx.fillRect(878 + i * 8, 1898 - i % 2 * 2, 3, 26); }
  ctx.restore();
}
function drawCenteredLines(ctx, text, cx, y, size, maxWidth, maxLines) {
  ctx.font = size + "px system-ui,sans-serif";
  const chars = String(text || "").split("");
  const lines = [];
  let current = "";
  for (const char of chars) {
    const next = current + char;
    if (ctx.measureText(next).width > maxWidth && current) { lines.push(current); current = char; }
    else current = next;
  }
  if (current) lines.push(current);
  const finalLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) finalLines[maxLines - 1] = finalLines[maxLines - 1].slice(0, -1) + "…";
  finalLines.forEach((line, index) => ctx.fillText(line, cx, y + index * (size + 10)));
}
function drawCanvasTabs(ctx, state, x, y, w, h) {
  const labels = ["在读", "搁置", "读完"];
  const active = labels.indexOf(state);
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  labels.forEach((label, i) => {
    const cell = x + i * w / 3;
    if (i === active) { ctx.fillStyle = "#aaa"; ctx.fillRect(cell, y, w / 3, h); }
    ctx.fillStyle = i === active ? "#fff" : "#111";
    ctx.textAlign = "center";
    ctx.font = "38px system-ui,sans-serif";
    ctx.fillText(label, cell + w / 6, y + 54);
  });
}

ratingInput.addEventListener("input", () => { currentRating = Number(ratingInput.value); ratingValue.textContent = currentRating.toFixed(1); renderReceipt(); });
bookClassSelect.addEventListener("change", saveSelectedClass);
lookupIsbnButton.addEventListener("click", lookupSelectedIsbn);
exportNotesButton.addEventListener("click", exportMarkdownNotes);
loadShelfButton.addEventListener("click", loadShelf); exportButton.addEventListener("click", exportSelected); filterInput.addEventListener("input", renderList);

loadLocalDataOnOpen();
