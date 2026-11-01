const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l4-1 4 15-4 1z"/>',
  project: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 5V3h8v2M3 11h18M9 11v3h6v-3"/>',
  wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v12H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v5h5M16.5 14.5h.1"/>',
  backup: '<path d="M5 16v4h14v-4M12 3v12M7 8l5-5 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
  external: '<path d="M13 4h7v7M20 4L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  in: '<path d="M7 4v12M3 12l4 4 4-4M13 7h7M13 12h7M4 20h16"/>',
  out: '<path d="M7 16V4M3 8l4-4 4 4M13 7h7M13 12h7M4 20h16"/>',
  chart: '<path d="M4 3v18h17M8 16l4-5 4 2 5-7"/>',
  check: '<path d="m5 12 4 4L19 6"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M5 16v4h14v-4M12 3v12M7 10l5 5 5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = value => /^https?:\/\//i.test(value || '') ? h(value) : '#';
const money = cents => (Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const statuses = { idea: '构思中', active: '进行中', paused: '已暂停', done: '已完成' };
const navItems = [['overview', 'grid', '概览'], ['resources', 'library', '资源库'], ['inspirations', 'star', '项目灵感'], ['projects', 'project', '项目任务'], ['ledger', 'wallet', '收支记录'], ['backup', 'backup', '数据备份']];
const main = document.querySelector('#main');
const modal = document.querySelector('#modal');
let state;
let route = 'overview';
let filters = { resourceSearch: '', category: '', favorites: false, projectSearch: '', projectStatus: '', ledgerProject: '', ledgerType: '' };
let ideaFilters = { search: '', category: '', favorites: false };
const allCatalogItems = () => [...state.resources, ...(state.inspirations || [])];
const resourceFavoriteCount = () => state.resources.filter(r => state.favorites.includes(r.id)).length;
let pendingBackup = null;
let backupReadVersion = 0;
let transactionUploads = [];
let transactionSaving = false;
let toastTimer;
let mutationPending = false;

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function toast(message, error = false) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), error ? 6000 : 3000);
}
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `请求失败（${response.status}）`);
  return data;
}
async function mutate(url, method, body, message) {
  if (mutationPending) throw new Error('上一项操作正在保存，请稍候。');
  mutationPending = true;
  document.querySelector('#save-state').innerHTML = '<span class="local-dot"></span>正在保存…';
  let saved = false;
  try {
    state = await request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    saved = true;
    render();
    if (message) toast(message);
    return state;
  } finally {
    mutationPending = false;
    document.querySelector('#save-state').innerHTML = saved ? '<span class="local-dot"></span>数据已保存在本机' : '上次操作未保存，请重试';
  }
}
function totals(transactions = state.transactions) {
  return transactions.reduce((result, t) => { result[t.type] += t.amountCents; return result; }, { income: 0, expense: 0 });
}
function pageHeading(eyebrow, title, description, actions = '') {
  return `<section class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</section>`;
}
function empty(iconName, title, description, action = '', full = false) {
  return `<div class="empty${full ? ' full' : ''}"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${description}</p>${action}</div>`;
}
function button(label, action, cls = 'primary', iconName = 'plus', attributes = '') {
  return `<button type="button" class="button ${cls}" data-action="${action}" ${attributes}>${icon(iconName)}${label}</button>`;
}
function projectOptions(value = '', emptyLabel = '全部项目') {
  return `<option value="">${emptyLabel}</option>` + state.projects.map(p => `<option value="${h(p.id)}" ${value === p.id ? 'selected' : ''}>${h(p.name)}</option>`).join('');
}
function statusOptions(value = '', all = false) {
  return (all ? '<option value="">全部状态</option>' : '') + Object.entries(statuses).map(([key, label]) => `<option value="${key}" ${value === key ? 'selected' : ''}>${label}</option>`).join('');
}

function renderNavigation() {
  document.querySelector('#navigation').innerHTML = navItems.map(([id, ico, label]) => `<a href="#${id}" class="nav-item${route === id ? ' active' : ''}" ${route === id ? 'aria-current="page"' : ''}>${icon(ico)}<span>${label}</span>${id === 'resources' || id === 'inspirations' ? `<span class="nav-count">${id === 'resources' ? state.resources.length : state.inspirations.length}</span>` : ''}</a>`).join('');
  document.querySelector('#page-name').textContent = navItems.find(item => item[0] === route)[2];
  document.title = `${navItems.find(item => item[0] === route)[2]} · 聚金工作台`;
}
function stat(label, value, note, ico, cls = '', currency = false) {
  return `<div class="stat-card ${cls}"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon(ico)}</span></div><div class="stat-number">${currency ? '<small>¥</small>' : ''}${value}</div><div class="stat-foot">${note}</div></div>`;
}
function renderOverview() {
  const sum = totals();
  const allTasks = state.projects.flatMap(p => p.tasks);
  const doneTasks = allTasks.filter(t => t.done).length;
  const currentProjects = state.projects.filter(p => p.status === 'active').length;
  const recent = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const projectBody = state.projects.length ? `<div class="panel-body">${state.projects.slice(0, 4).map(p => `<a class="mini-project" href="#projects"><div><h3>${h(p.name)}</h3><p>${p.tasks.filter(t => t.done).length} / ${p.tasks.length} 项任务完成</p></div><span class="badge ${p.status}">${statuses[p.status]}</span></a>`).join('')}</div>` : `<div class="panel-body"><div class="step"><span class="step-number">01</span><div><h3>找到一个适合你的方向</h3><p>浏览资源库，收藏感兴趣的工具与平台。</p></div></div><div class="step"><span class="step-number">02</span><div><h3>把想法拆成具体行动</h3><p>创建第一个项目，列出今天就能做的任务。</p></div></div><div class="step"><span class="step-number">03</span><div><h3>记录投入，看到真实进展</h3><p>记下每一笔收入与支出，持续复盘。</p></div></div></div>`;
  main.innerHTML = pageHeading('聚金工作台', '经营概览', `${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}`, button('新建项目', 'new-project', 'secondary')) +
    `<section class="stat-grid" aria-label="工作空间统计">${stat('累计收入', money(sum.income), '已记录的实际收入', 'in', 'income', true)}${stat('累计支出', money(sum.expense), '已记录的实际投入', 'out', 'expense', true)}${stat('累计净额', money(sum.income - sum.expense), '收入减去支出', 'chart', 'net', true)}${stat('进行中的项目', String(currentProjects).padStart(2, '0'), `${doneTasks} / ${allTasks.length} 项任务完成`, 'project')}</section>` +
    `<section class="dashboard-columns"><div class="panel"><div class="panel-head"><div><h2>${state.projects.length ? '我的项目' : '从这里，开始你的第一个项目'}</h2><p>${state.projects.length ? '让每一步行动都有归属' : '把大的目标，变成可以完成的小步骤'}</p></div><a class="button text" href="#projects">${state.projects.length ? '查看全部' : '开始创建'}${icon('arrow')}</a></div>${projectBody}</div><div class="panel"><div class="panel-head"><div><h2>最近收支</h2><p>投入与回报，清楚记录</p></div><a class="button text" href="#ledger">查看全部${icon('arrow')}</a></div>${recent.length ? `<div class="panel-body">${recent.map(t => `<div class="transaction-mini"><span class="stat-icon">${icon(t.type === 'income' ? 'in' : 'out')}</span><div><h3>${h(t.note || (t.type === 'income' ? '收入' : '支出'))}</h3><p>${h(t.date)}</p></div><span class="amount ${t.type}">${t.type === 'income' ? '+' : '−'} ¥${money(t.amountCents)}</span></div>`).join('')}</div>` : empty('wallet', '第一笔记录，值得被看见', '记下真实发生的收入与支出，慢慢建立你的经营账本。', button('记一笔', 'new-transaction', 'subtle small', 'plus'))}</div></section>` +
    `<section class="catalog-strip"><span class="stat-icon">${icon('library')}</span><div><h3>${state.resources.length} 个资源</h3><p>已收藏 ${resourceFavoriteCount()} 个资源</p></div><a class="button text" href="#resources">打开资源库${icon('arrow')}</a></section>`;
}
const resourceKinds = { repository: 'GitHub 源码', platform: '官方平台', documentation: '官方文档' };
function resourceResults() {
  const query = filters.resourceSearch.trim().toLocaleLowerCase();
  return state.resources.filter(r => (!filters.category || r.category === filters.category) && (!filters.favorites || state.favorites.includes(r.id)) && (!query || [r.repository, r.name, r.description, r.category, r.type, r.licenseNote, ...(r.relatedBusinesses || [])].join(' ').toLocaleLowerCase().includes(query)));
}
function resourceRow(r) {
  const favorite = state.favorites.includes(r.id);
  return `<li class="resource-row"><div class="resource-row-main"><div class="resource-row-title"><a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${h(r.name)} ↗</a><span class="resource-kind">${resourceKinds[r.resourceKind]}</span></div><p>${h(r.resourceDescription || r.description)}</p>${r.upstreamCommitDate ? `<small>最近提交：${h(r.upstreamCommitDate)}</small>` : ''}${Number.isSafeInteger(r.stars) ? `<small> · ★ ${h(r.stars.toLocaleString('zh-CN'))}${r.starGrowth ? ' · '+h(r.starGrowth.period === 'weekly' ? '周榜新增 ' : '日榜新增 ')+h(r.starGrowth.count.toLocaleString('zh-CN')) : ''}（${h(r.checkedAt)} 核验）</small>` : ''}${r.relatedBusinesses?.length ? `<small class="business-fit">${h(r.relatedBusinesses.join(' · '))}</small>` : ''}</div><div class="resource-row-actions">${button('详情', 'resource-detail', 'text small', 'info', `data-id="${h(r.id)}"`)}<button type="button" class="icon-button favorite${favorite ? ' active' : ''}" data-action="favorite" data-id="${h(r.id)}" aria-label="${favorite ? '取消收藏' : '收藏'} ${h(r.name)}" aria-pressed="${favorite}">${icon('star')}</button></div></li>`;
}
function updateResourceResults() {
  const resources = resourceResults();
  document.querySelector('#resource-results-count').innerHTML = `找到 <strong>${resources.length}</strong> 个资源`;
  const categories = [...new Set(resources.map(r => r.category))];
  document.querySelector('#resource-results').innerHTML = resources.length ? categories.map((category, index) => `<section class="resource-directory-group" id="resource-group-${index}"><h2>${h(category)} <span>${resources.filter(r => r.category === category).length}</span></h2><ul>${resources.filter(r => r.category === category).map(resourceRow).join('')}</ul></section>`).join('') : empty('search', '没有匹配的资源', '请尝试其他名称、分类或清除筛选条件。', button('清除筛选', 'clear-resource-filters', 'subtle small', 'search'), true);
}
function renderResources() {
  const categories = [...new Set(state.resources.map(r => r.category))];
  main.innerHTML = pageHeading('我的资源', '资源库', '', '<a class="button secondary" href="/source/resource-directory.md" target="_blank" rel="noopener noreferrer">阅读完整目录 ↗</a>') +
    `<div class="toolbar"><label class="search-box">${icon('search')}<span class="sr-only">搜索资源</span><input id="resource-search" type="search" placeholder="搜索名称、用途、分类或许可证…" value="${h(filters.resourceSearch)}" maxlength="200"></label><label><span class="sr-only">资源分类</span><select class="filter-select" id="resource-category"><option value="">全部分类</option>${categories.map(category => `<option value="${h(category)}" ${filters.category === category ? 'selected' : ''}>${h(category)}</option>`).join('')}</select></label><div class="tabs" aria-label="资源范围"><button type="button" class="tab${!filters.favorites ? ' active' : ''}" data-action="resource-all" aria-pressed="${!filters.favorites}">全部资源</button><button type="button" class="tab${filters.favorites ? ' active' : ''}" data-action="resource-favorites" aria-pressed="${filters.favorites}">资源收藏 ${resourceFavoriteCount()}</button></div></div><div class="results-line"><span id="resource-results-count"></span><span>${state.meta.repositoryCount} 个源码仓库 · ${state.meta.platformCount} 个平台与文档</span></div><div id="resource-results"></div>`;
  updateResourceResults();
}
function ideaCard(r) {
  const favorite = state.favorites.includes(r.id);
  return `<article class="resource-card"><div class="resource-content"><div class="resource-top"><h3>${h(r.name)}</h3><button type="button" class="icon-button favorite${favorite ? ' active' : ''}" data-action="favorite" data-id="${h(r.id)}" aria-label="${favorite ? '取消收藏' : '收藏'}灵感 ${h(r.name)}" aria-pressed="${favorite}">${icon('star')}</button></div><span class="category-badge">${h(r.category)}</span>${r.addedAt ? `<span class="category-badge">新增 · ${h(r.addedAt.slice(5, 10))}</span>` : ''}<p class="resource-description">${h(r.description)}</p><div class="resource-facts"><p><strong>可尝试的收入方式</strong>${h(r.monetization)}</p><p><strong>持续维护</strong>${h(r.maintenance)}</p></div></div><div class="resource-footer">${button('查看方案', 'idea-detail', 'text small', 'info', `data-id="${h(r.id)}"`)}${button('创建项目', 'resource-project', 'subtle small', 'plus', `data-id="${h(r.id)}"`)}</div></article>`;
}
function updateIdeaResults() {
  const query = ideaFilters.search.trim().toLocaleLowerCase();
  const ideas = [...state.inspirations].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || '')).filter(r => (!ideaFilters.category || r.category === ideaFilters.category) && (!ideaFilters.favorites || state.favorites.includes(r.id)) && (!query || [r.name, r.description, r.monetization, r.deliverable].join(' ').toLocaleLowerCase().includes(query)));
  document.querySelector('#idea-results').innerHTML = ideas.length ? `<div class="results-line">${ideas.length} 个项目灵感</div><div class="resource-grid">${ideas.map(ideaCard).join('')}</div>` : empty('search', '暂无匹配的项目灵感', '尝试其他关键词或分类。', '', true);
}
function renderInspirations() {
  const categories = [...new Set(state.inspirations.map(r => r.category))];
  const saved = state.inspirations.filter(r => state.favorites.includes(r.id)).length;
  main.innerHTML = pageHeading('项目探索', '项目灵感', '') +
    `<div class="toolbar"><label class="search-box">${icon('search')}<span class="sr-only">搜索项目灵感</span><input id="idea-search" type="search" placeholder="搜索想做的产品或交付物…" value="${h(ideaFilters.search)}" maxlength="200"></label><label><span class="sr-only">灵感分类</span><select id="idea-category" class="filter-select"><option value="">全部分类</option>${categories.map(c => `<option value="${h(c)}" ${ideaFilters.category === c ? 'selected' : ''}>${h(c)}</option>`).join('')}</select></label><div class="tabs"><button class="tab${!ideaFilters.favorites ? ' active' : ''}" data-action="idea-all">全部灵感</button><button class="tab${ideaFilters.favorites ? ' active' : ''}" data-action="idea-favorites">灵感收藏 ${saved}</button></div></div><div id="idea-results"></div>`;
  updateIdeaResults();
}
function projectCard(p) {
  const resource = allCatalogItems().find(r => r.id === p.resourceId);
  const done = p.tasks.filter(t => t.done).length;
  const percent = p.tasks.length ? Math.round(done / p.tasks.length * 100) : 0;
  return `<article class="project-card"><div class="project-head"><h2 class="project-title">${h(p.name)}</h2><div class="project-controls"><button type="button" class="icon-button" data-action="edit-project" data-id="${h(p.id)}" aria-label="编辑项目 ${h(p.name)}">${icon('edit')}</button><button type="button" class="icon-button danger" data-action="delete-project" data-id="${h(p.id)}" aria-label="删除项目 ${h(p.name)}">${icon('trash')}</button></div></div><div class="project-meta"><span class="badge ${p.status}">${statuses[p.status]}</span>${resource ? `<a href="${safeUrl(resource.url)}" target="_blank" rel="noopener noreferrer" title="关联来源：${h(resource.name)}">${state.resources.some(r => r.id === resource.id) ? '资源' : '灵感'} · ${h(resource.name)} ↗</a>` : ''}</div>${p.description ? `<p class="project-description">${h(p.description)}</p>` : ''}<div class="ai-project-action">${button('AI 拆解任务', 'ai-plan', 'subtle small', 'plus', `data-id="${h(p.id)}"`)}</div><div class="progress-row"><span>任务进度 · ${done} / ${p.tasks.length}</span><span>${percent}%</span></div><div class="progress-track" aria-label="任务完成 ${percent}%"><div class="progress-fill" style="width:${percent}%"></div></div>${p.tasks.length ? `<div class="task-list">${p.tasks.map(t => `<div class="task-row${t.done ? ' done' : ''}"><label><input type="checkbox" data-task-id="${h(t.id)}" data-project-id="${h(p.id)}" ${t.done ? 'checked' : ''}><span>${h(t.title)}${t.stage ? `<small class="task-detail">${h(t.stage)} · 预计 ${h(t.estimatedHours)} 小时<br>验收：${h(t.deliverable)}</small>` : ''}</span></label><button type="button" class="icon-button danger" data-action="delete-task" data-id="${h(t.id)}" data-project-id="${h(p.id)}" aria-label="删除任务 ${h(t.title)}">${icon('close')}</button></div>`).join('')}</div>` : '<p class="project-empty-task">写下一个小任务，开始推进这个项目。</p>'}<form class="task-add" data-project-id="${h(p.id)}"><label class="sr-only" for="task-${h(p.id)}">新任务标题</label><input id="task-${h(p.id)}" name="title" placeholder="添加一项具体任务…" maxlength="200" required autocomplete="off"><button type="submit" class="button subtle small" aria-label="添加任务">${icon('plus')}添加</button></form></article>`;
}
function projectResults() {
  const query = filters.projectSearch.toLocaleLowerCase().trim();
  return state.projects.filter(p => (!filters.projectStatus || p.status === filters.projectStatus) && (!query || [p.name, p.description, ...p.tasks.map(t => t.title)].join(' ').toLocaleLowerCase().includes(query)));
}
function updateProjectResults() {
  const projects = projectResults();
  document.querySelector('#project-results').innerHTML = projects.length ? `<div class="projects-grid">${projects.map(projectCard).join('')}</div>` : empty('project', state.projects.length ? '没有匹配的项目' : '你的第一个项目，从一个想法开始', state.projects.length ? '尝试其他关键词或状态。' : '给项目起个名字，把接下来的行动写成任务。每完成一步，都是一次积累。', button('新建项目', 'new-project', 'primary small'), true);
}
function renderProjects() {
  main.innerHTML = pageHeading('我的项目', '项目与任务', `${state.projects.length} 个项目`, `<div class="heading-actions">${button('模型设置', 'ai-settings', 'secondary', 'edit')}${button('新建项目', 'new-project')}</div>`) +
    `<div class="toolbar"><label class="search-box">${icon('search')}<span class="sr-only">搜索项目或任务</span><input type="search" id="project-search" value="${h(filters.projectSearch)}" placeholder="搜索项目、描述或任务…" maxlength="200"></label><label><span class="sr-only">项目状态</span><select class="filter-select" id="project-status">${statusOptions(filters.projectStatus, true)}</select></label></div><div id="project-results"></div>`;
  updateProjectResults();
}
function ledgerResults() {
  return state.transactions.filter(t => (!filters.ledgerProject || (filters.ledgerProject === '__none' ? !t.projectId : t.projectId === filters.ledgerProject)) && (!filters.ledgerType || t.type === filters.ledgerType)).sort((a, b) => b.date.localeCompare(a.date));
}
function renderLedger() {
  if (filters.ledgerProject && filters.ledgerProject !== '__none' && !state.projects.some(p => p.id === filters.ledgerProject)) filters.ledgerProject = '';
  const transactions = ledgerResults();
  const sum = totals(transactions);
  main.innerHTML = pageHeading('经营账本', '收支记录', '', `<a href="/api/transactions.csv" download class="button secondary">${icon('download')}导出全部 CSV</a>${button('记一笔', 'new-transaction')}`) +
    `<section class="stat-grid ledger-stats" aria-label="当前筛选收支汇总">${stat('收入合计', money(sum.income), '当前筛选范围', 'in', 'income', true)}${stat('支出合计', money(sum.expense), '当前筛选范围', 'out', 'expense', true)}${stat('收支净额', money(sum.income - sum.expense), `共 ${transactions.length} 笔记录`, 'chart', 'net', true)}</section><div class="toolbar"><label><span class="sr-only">按项目筛选收支</span><select class="filter-select" id="ledger-project">${projectOptions(filters.ledgerProject)}<option value="__none" ${filters.ledgerProject === '__none' ? 'selected' : ''}>未关联项目</option></select></label><label><span class="sr-only">收支类型</span><select class="filter-select" id="ledger-type"><option value="">全部类型</option><option value="income" ${filters.ledgerType === 'income' ? 'selected' : ''}>收入</option><option value="expense" ${filters.ledgerType === 'expense' ? 'selected' : ''}>支出</option></select></label><span class="muted" style="font-size:10px;margin-left:auto">${transactions.length} 笔记录 · 按日期排序</span></div>` +
    (transactions.length ? `<div class="table-wrap"><table><caption class="sr-only">收支明细，金额单位人民币</caption><thead><tr><th scope="col">日期</th><th scope="col">类型</th><th scope="col">项目</th><th scope="col">备注与附件</th><th scope="col">金额（元）</th><th scope="col"><span class="sr-only">操作</span></th></tr></thead><tbody>${transactions.map(t => `<tr><td>${h(t.date)}</td><td><span class="badge ${t.type === 'income' ? 'income-badge' : 'expense-badge'}">${t.type === 'income' ? '收入' : '支出'}</span></td><td>${h(state.projects.find(p => p.id === t.projectId)?.name || '未关联项目')}</td><td class="note-cell"><div class="ledger-note">${h(t.note || '—')}</div>${attachmentLinks(t)}</td><td class="amount ${t.type}">${t.type === 'income' ? '+' : '−'} ${money(t.amountCents)}</td><td><div class="ledger-actions"><button type="button" class="icon-button" data-action="edit-transaction" data-id="${h(t.id)}" aria-label="编辑 ${h(t.date)} 收支记录">${icon('edit')}</button><button type="button" class="icon-button danger" data-action="delete-transaction" data-id="${h(t.id)}" aria-label="删除 ${h(t.date)} ${t.type === 'income' ? '收入' : '支出'} ${money(t.amountCents)} 元记录">${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div>` : empty('wallet', state.transactions.length ? '当前筛选下没有收支记录' : '从第一笔真实记录开始', state.transactions.length ? '切换项目或收支类型查看其他记录。' : '无论是一笔工具费用，还是第一份收入，都值得被记录。', button('记录一笔收支', 'new-transaction', 'primary small'), true));
}
function renderBackup() {
  const files = state.transactions.flatMap(row => row.attachments || []);
  main.innerHTML = pageHeading('数据管理', '备份与恢复', '') +
    '<section class="backup-grid"><div class="backup-card"><span class="stat-icon">' + icon('download') + '</span><h2>完整备份 · 记录与附件</h2><p>将项目、任务、收藏、收支和当前关联附件打包为 ZIP。模型密钥不包含在业务备份中。</p><a class="button primary" href="/api/backup.zip" download>' + icon('download') + '下载完整 ZIP 备份</a><p class="backup-secondary"><a class="button secondary small" href="/api/backup" download>仅下载业务记录 JSON</a></p><p class="hint">附件 ' + files.length + ' 个 · ' + fileSize(files.reduce((sum, file) => sum + file.size, 0)) + '。完整 ZIP 最大 512 MB，超过时可复制整个 data 文件夹备份。</p></div><div class="backup-card"><span class="stat-icon">' + icon('backup') + '</span><h2>检查并恢复备份</h2><p>支持完整 ZIP 和旧版 JSON。选择文件后先检查数量与完整性，再确认替换当前业务记录。</p><label class="sr-only" for="backup-file">选择 ZIP 或 JSON 备份文件</label><input type="file" id="backup-file" accept=".zip,.json,application/zip,application/json"><div id="backup-preview" aria-live="polite"></div></div></section><section class="panel backup-details"><div class="panel-head"><h2>当前工作空间</h2><span class="badge active">本地存储</span></div><div class="panel-body"><div class="detail-row"><span>当前数据</span><strong>' + state.projects.length + ' 个项目 · ' + state.projects.reduce((sum, p) => sum + p.tasks.length, 0) + ' 项任务 · ' + state.transactions.length + ' 笔收支 · ' + files.length + ' 个附件</strong></div><div class="detail-row"><span>业务记录</span><strong>data/state.json</strong></div><div class="detail-row"><span>附件文件</span><strong>data/attachments/ · 原始文件保留</strong></div><div class="detail-row"><span>最近保存</span><strong>' + h(state.updatedAt ? new Date(state.updatedAt).toLocaleString('zh-CN') : '尚未产生业务数据') + '</strong></div><div class="detail-row"><span>资源目录</span><strong>' + state.resources.length + ' 个资源 · ' + state.inspirations.length + ' 个灵感</strong></div><div class="detail-row"><span>项目评审</span><strong><a href="/source/project-review.md" target="_blank" rel="noopener noreferrer">查看改进建议 ↗</a></strong></div></div></section><div class="notice">' + icon('info') + '<div>恢复会替换当前项目、任务、收藏与账本。完整 ZIP 会校验附件路径、大小及内容摘要；JSON 不含附件文件，迁移附件请用完整 ZIP。备份包含你的业务内容，请妥善保存。</div></div>';
  if (pendingBackup) renderBackupPreview();
}
function renderBackupPreview() {
  const preview = document.querySelector('#backup-preview');
  if (!preview || !pendingBackup) return;
  const count = pendingBackup.summary;
  preview.innerHTML = '<div class="backup-preview"><h3>' + (pendingBackup.format === 'zip' ? '完整 ZIP 已检查' : 'JSON 记录已读取') + '</h3><p>' + count.projects + ' 个项目 · ' + count.tasks + ' 项任务<br>' + count.transactions + ' 笔收支 · ' + count.favorites + ' 个收藏<br>' + count.attachments + ' 个附件 · ' + fileSize(count.attachmentBytes) + '</p>' + button('确认恢复此备份', 'restore-backup', 'subtle small', 'backup') + '</div>';
}

function render() {
  renderNavigation();
  ({ overview: renderOverview, resources: renderResources, inspirations: renderInspirations, projects: renderProjects, ledger: renderLedger, backup: renderBackup })[route]();
}
function handleHash() {
  const next = window.location.hash.slice(1);
  route = navItems.some(item => item[0] === next) ? next : 'overview';
  if (state) render();
}
let aiDialogVersion = 0;
function openModal(title, body) {
  aiDialogVersion++;
  modal.innerHTML = `<div class="modal-head"><h2 id="modal-title">${title}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="关闭对话框">${icon('close')}</button></div><div class="modal-body">${body}</div>`;
  if (!modal.open) modal.showModal();
}
function showProjectModal(project, resourceId = '') {
  const selectedResourceId = project?.resourceId || resourceId;
  const resource = allCatalogItems().find(r => r.id === selectedResourceId);
  openModal(project ? '编辑项目' : '创建一个新项目', `<form id="project-form" data-id="${h(project?.id || '')}"><div class="form-error" role="alert"></div><div class="form-field"><label for="project-name">项目名称 *</label><input id="project-name" name="name" required maxlength="120" placeholder="例如：制作一套原创电子模板" value="${h(project?.name || (resource ? resource.name : ''))}" autocomplete="off"></div><div class="form-field"><label for="project-description">项目描述</label><textarea id="project-description" name="description" maxlength="2000" placeholder="你想为谁解决什么问题？下一步准备做什么？">${h(project?.description || (resource ? (state.resources.some(item => item.id === resource.id) ? resource.description : [resource.description, '收入方式：' + resource.monetization, '交付物：' + resource.deliverable, '起步步骤：' + (resource.firstSteps || []).join('；'), '持续维护：' + resource.maintenance].join('\n')) : ''))}</textarea></div><div class="form-field"><label for="project-status-field">当前状态</label><select id="project-status-field" name="status">${statusOptions(project?.status || 'idea')}</select></div><div class="form-field"><label for="project-resource">关联来源</label><select id="project-resource" name="resourceId"><option value="">不关联来源</option>${allCatalogItems().map(r => `<option value="${h(r.id)}" ${selectedResourceId === r.id ? 'selected' : ''}>${state.resources.some(item => item.id === r.id) ? '资源 · ' : '灵感 · '}${h(r.name)}</option>`).join('')}</select><span class="hint">可以关联真实资源或项目灵感，也可以独立创建项目。</span></div><div class="modal-actions">${button('取消', 'close-modal', 'secondary', 'close')}<button type="submit" class="button primary">${icon('check')}${project ? '保存修改' : '创建项目'}</button></div></form>`);
}
function fileSize(bytes) {
  return bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : bytes >= 1024 ? (bytes / 1024).toFixed(1) + ' KB' : bytes + ' B';
}
function attachmentLinks(row) {
  return (row.attachments || []).length ? '<div class="ledger-attachments">' + row.attachments.map(file => '<a href="/api/transactions/' + h(row.id) + '/attachments/' + h(file.id) + '" download>' + icon('download') + '<span>' + h(file.name) + '</span><small>' + fileSize(file.size) + '</small></a>').join('') + '</div>' : '';
}
function growNote(element) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = Math.max(110, element.scrollHeight + 2) + 'px';
}
function updateTransactionFiles() {
  const form = document.querySelector('#transaction-form');
  if (!form) return;
  const row = state.transactions.find(t => t.id === form.dataset.id);
  const saved = row?.attachments || [];
  document.querySelector('#saved-attachments').innerHTML = saved.length ? '<p class="hint">已保存 ' + saved.length + ' 个附件</p>' + saved.map(file => '<div class="attachment-item"><a href="/api/transactions/' + h(row.id) + '/attachments/' + h(file.id) + '" download>' + icon('download') + '<span>' + h(file.name) + '</span></a><small>' + fileSize(file.size) + '</small><button type="button" class="button text small danger" data-action="remove-attachment" data-id="' + h(file.id) + '">移除</button></div>').join('') : '';
  document.querySelector('#pending-attachments').innerHTML = transactionUploads.map((file, index) => '<div class="attachment-item"><span>' + h(file.name) + '</span><small>' + fileSize(file.size) + ' · 待上传</small><button type="button" class="icon-button" data-action="remove-pending-file" data-index="' + index + '" aria-label="移除待上传文件 ' + h(file.name) + '">' + icon('close') + '</button></div>').join('');
}
function showTransactionModal(row) {
  transactionUploads = [];
  openModal(row ? '编辑收支与附件' : '记录一笔收支', '<form id="transaction-form" data-id="' + h(row?.id || '') + '"><div class="form-error" role="alert"></div><div class="form-row"><div class="form-field"><label for="transaction-type">类型 *</label><select id="transaction-type" name="type"><option value="income" ' + (row?.type !== 'expense' ? 'selected' : '') + '>收入</option><option value="expense" ' + (row?.type === 'expense' ? 'selected' : '') + '>支出</option></select></div><div class="form-field"><label for="transaction-date">日期 *</label><input type="date" id="transaction-date" name="date" value="' + h(row?.date || today()) + '" required min="1900-01-01" max="9999-12-31"></div></div><div class="form-field"><label for="transaction-amount">金额（人民币元）*</label><input id="transaction-amount" name="amount" value="' + (row ? (row.amountCents / 100).toFixed(2) : '') + '" inputmode="decimal" placeholder="0.00" required maxlength="14" pattern="[0-9]+([.][0-9]{1,2})?"><span class="hint">填写大于 0 的金额，最多两位小数。</span></div><div class="form-field"><label for="transaction-project">关联项目</label><select id="transaction-project" name="projectId">' + projectOptions(row?.projectId || '', '不关联项目') + '</select></div><div class="form-field"><label for="transaction-note">备注</label><textarea id="transaction-note" name="note" rows="4" maxlength="10000" placeholder="记录交易内容、交付说明、结算细节等，可换行输入…">' + h(row?.note || '') + '</textarea><span class="hint">随内容自动增高，最多 10000 字；换行会保留。</span></div><div class="form-field"><label for="transaction-files">附件</label><input type="file" id="transaction-files" multiple><span class="hint">支持压缩包、文档、图片等文件。单个最大 50 MB，每笔最多 10 个、合计 200 MB。选择后点击保存上传。</span><div id="saved-attachments"></div><div id="pending-attachments"></div><p id="transaction-upload-status" class="hint" aria-live="polite"></p></div><div class="modal-actions">' + button('取消', 'close-modal', 'secondary', 'close') + '<button type="submit" class="button primary">' + icon('check') + '保存记录与附件</button></div></form>');
  updateTransactionFiles(); growNote(document.querySelector('#transaction-note'));
}

function confirmModal(title, message, label, handler) {
  openModal(title, `<p>${h(message)}</p><div class="form-error" role="alert"></div><div class="modal-actions">${button('取消', 'close-modal', 'secondary', 'close')}<button type="button" class="button danger" id="confirm-operation">${h(label)}</button></div>`);
  document.querySelector('#confirm-operation').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try { await handler(); modal.close(); }
    catch (error) { modal.querySelector('.form-error').textContent = error.message; }
    finally { const element = document.querySelector('#confirm-operation'); if (element) element.disabled = false; }
  });
}
document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  try {
    if (transactionSaving) { toast('记录与附件正在保存，请稍候。'); return; }
    if (action === 'close-modal') { aiDialogVersion++; modal.close(); }
    else if (action === 'ai-settings') await showAiSettings();
    else if (action === 'ai-plan') await showAiPlan(id);
    else if (action === 'new-project') showProjectModal();
    else if (action === 'edit-project') showProjectModal(state.projects.find(p => p.id === id));
    else if (action === 'resource-detail') showRepositoryDetail(state.resources.find(r => r.id === id));
    else if (action === 'idea-detail') showResourceDetail(state.inspirations.find(r => r.id === id));
    else if (action === 'idea-all' || action === 'idea-favorites') { ideaFilters.favorites = action === 'idea-favorites'; renderInspirations(); }
    else if (action === 'resource-project') showProjectModal(null, id);
    else if (action === 'new-transaction') showTransactionModal();
    else if (action === 'edit-transaction') showTransactionModal(state.transactions.find(t => t.id === id));
    else if (action === 'remove-pending-file') { transactionUploads.splice(Number(target.dataset.index), 1); updateTransactionFiles(); }
    else if (action === 'remove-attachment') {
      if (!target.dataset.confirmed) { target.dataset.confirmed = 'yes'; target.textContent = '确认移除文件'; return; }
      target.disabled = true;
      const form = document.querySelector('#transaction-form');
      await mutate('/api/transactions/' + encodeURIComponent(form.dataset.id) + '/attachments/' + encodeURIComponent(id), 'DELETE', undefined, '附件已移除');
      updateTransactionFiles();
    }
    else if (action === 'favorite') { target.disabled = true; await mutate('/api/favorites', 'POST', { resourceId: id }); }
    else if (action === 'resource-all' || action === 'resource-favorites') { filters.favorites = action === 'resource-favorites'; renderResources(); }
    else if (action === 'clear-resource-filters') { filters.resourceSearch = ''; filters.category = ''; filters.favorites = false; renderResources(); }
    else if (action === 'expand-description') { const element = document.getElementById(`desc-${id}`); const expanded = element.classList.toggle('expanded'); target.textContent = expanded ? '收起描述' : '展开描述'; target.setAttribute('aria-expanded', String(expanded)); }
    else if (action === 'delete-project') {
      const project = state.projects.find(p => p.id === id);
      confirmModal('删除这个项目？', `将删除“${project.name}”及其全部任务。关联收支会保留，并改为“未关联项目”。此操作无法在界面撤销。`, '删除项目', () => mutate(`/api/projects/${encodeURIComponent(id)}`, 'DELETE', undefined, '项目已删除，收支记录已保留'));
    } else if (action === 'delete-task') { target.disabled = true; await mutate(`/api/projects/${encodeURIComponent(target.dataset.projectId)}/tasks/${encodeURIComponent(id)}`, 'DELETE', undefined, '任务已删除'); }
    else if (action === 'delete-transaction') {
      const t = state.transactions.find(item => item.id === id);
      confirmModal('删除这笔收支？', `${t.date} · ${t.type === 'income' ? '收入' : '支出'} ¥${money(t.amountCents)}${t.note ? `\n${t.note}` : ''}\n删除后会重新计算汇总金额，关联附件文件也会删除。`, '删除记录', () => mutate(`/api/transactions/${encodeURIComponent(id)}`, 'DELETE', undefined, '收支记录已删除'));
    } else if (action === 'restore-backup') {
      const snapshot = pendingBackup;
      const count = snapshot.summary;
      confirmModal('用备份替换当前数据？', '即将恢复 ' + count.projects + ' 个项目、' + count.transactions + ' 笔收支和 ' + count.attachments + ' 个附件。当前业务记录将被替换，建议先下载完整 ZIP 备份。', '确认替换数据', async () => {
        if (snapshot.format === 'zip') {
          if (mutationPending) throw new Error('正在保存其他数据，请稍候');
          mutationPending = true;
          try { state = await request('/api/restore-archive', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: snapshot.file }); }
          finally { mutationPending = false; }
          toast('完整备份已恢复');
        } else await mutate('/api/restore', 'POST', snapshot.data, '业务记录已恢复');
        pendingBackup = null; filters.ledgerProject = ''; render();
      });
    }
  } catch (error) { toast(error.message, true); if (target.isConnected) target.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id === 'transaction-note') growNote(event.target);
  if (event.target.id === 'idea-search') { ideaFilters.search = event.target.value; updateIdeaResults(); }
  if (event.target.id === 'resource-search') { filters.resourceSearch = event.target.value; updateResourceResults(); }
  if (event.target.id === 'project-search') { filters.projectSearch = event.target.value; updateProjectResults(); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if (target.id === 'transaction-files') {
    try {
      const form = document.querySelector('#transaction-form');
      const saved = state.transactions.find(t => t.id === form.dataset.id)?.attachments || [];
      const next = [...transactionUploads];
      for (const file of target.files) {
        if (file.size > 50 * 1024 * 1024) throw new Error(file.name + ' 超过 50 MB 上限');
        if (!next.some(item => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) next.push(file);
      }
      if (saved.length + next.length > 10) throw new Error('每笔最多 10 个附件');
      if ([...saved, ...next].reduce((sum, file) => sum + file.size, 0) > 200 * 1024 * 1024) throw new Error('每笔附件合计不能超过 200 MB');
      transactionUploads = next; updateTransactionFiles();
    } catch (error) { toast(error.message, true); }
    target.value = '';
  }
  if (target.id === 'idea-category') { ideaFilters.category = target.value; updateIdeaResults(); }
  if (target.id === 'resource-category') { filters.category = target.value; updateResourceResults(); }
  if (target.id === 'project-status') { filters.projectStatus = target.value; updateProjectResults(); }
  if (target.id === 'ledger-project') { filters.ledgerProject = target.value; renderLedger(); }
  if (target.id === 'ledger-type') { filters.ledgerType = target.value; renderLedger(); }
  if (target.dataset.taskId) {
    target.disabled = true;
    try { await mutate(`/api/projects/${encodeURIComponent(target.dataset.projectId)}/tasks/${encodeURIComponent(target.dataset.taskId)}`, 'PATCH', { done: target.checked }); }
    catch (error) { target.checked = !target.checked; target.disabled = false; toast(error.message, true); }
  }
  if (target.id === 'backup-file') {
    const version = ++backupReadVersion;
    pendingBackup = null;
    const preview = document.querySelector('#backup-preview');
    preview.textContent = '';
    const file = target.files[0];
    if (!file) return;
    try {
      if (/\.zip$/i.test(file.name)) {
        if (file.size > 512 * 1024 * 1024) throw new Error('完整 ZIP 备份最大 512 MB。');
        preview.textContent = '正在检查备份和附件完整性，请稍候…';
        const summary = await request('/api/restore-archive/preview', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file });
        if (version !== backupReadVersion) return;
        pendingBackup = { format: 'zip', file, summary };
      } else {
        if (file.size > 5 * 1024 * 1024) throw new Error('业务记录 JSON 备份最大 5 MB。');
        const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
        if (data.schemaVersion !== 1 || !Array.isArray(data.favorites) || !Array.isArray(data.projects) || !Array.isArray(data.transactions) || data.projects.some(p => !p || !Array.isArray(p.tasks))) throw new Error('请选择聚金工作台导出的 ZIP 或 JSON 备份。');
        if (version !== backupReadVersion) return;
        const files = data.transactions.flatMap(row => row.attachments || []);
        pendingBackup = { format: 'json', data, summary: { projects: data.projects.length, tasks: data.projects.reduce((sum, p) => sum + p.tasks.length, 0), transactions: data.transactions.length, favorites: data.favorites.length, attachments: files.length, attachmentBytes: files.reduce((sum, f) => sum + (f.size || 0), 0) } };
      }
      renderBackupPreview();
    } catch (error) { if (version === backupReadVersion) { preview.textContent = ''; toast(error instanceof SyntaxError ? '无法读取 JSON，请检查备份文件。' : error.message, true); target.value = ''; } }
  }
});
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('#project-form, #transaction-form, .task-add')) return;
  event.preventDefault();
  const submit = form.querySelector('[type=submit]');
  const errorElement = form.querySelector('.form-error');
  if (errorElement) errorElement.textContent = '';
  submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    if (form.id === 'project-form') {
      if (!values.name.trim()) throw new Error('请填写项目名称。');
      const editing = Boolean(form.dataset.id);
      await mutate(editing ? `/api/projects/${encodeURIComponent(form.dataset.id)}` : '/api/projects', editing ? 'PATCH' : 'POST', { name: values.name.trim(), description: values.description.trim(), status: values.status, resourceId: values.resourceId }, editing ? '项目已更新' : '项目已创建');
      modal.close();
      if (!editing) { if (route === 'projects') renderProjects(); else location.hash = '#projects'; }
    } else if (form.id === 'transaction-form') {
      if (!/^\d+(\.\d{1,2})?$/.test(values.amount)) throw new Error('金额应大于 0，最多保留两位小数。');
      const [whole, fraction = ''] = values.amount.split('.');
      const amountCents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new Error('请输入有效的正数金额。');
      transactionSaving = true;
      const controls = [...form.querySelectorAll('input, textarea, select, button')];
      controls.forEach(control => { control.disabled = true; });
      try {
        const editing = Boolean(form.dataset.id);
        await mutate(editing ? '/api/transactions/' + encodeURIComponent(form.dataset.id) : '/api/transactions', editing ? 'PATCH' : 'POST', { type: values.type, date: values.date, amountCents, projectId: values.projectId, note: values.note.trim() });
        if (!editing) form.dataset.id = state.savedTransactionId;
        let uploaded = 0;
        const total = transactionUploads.length;
        while (transactionUploads.length) {
          const file = transactionUploads[0];
          document.querySelector('#transaction-upload-status').textContent = '正在上传 ' + (uploaded + 1) + '/' + total + '：' + file.name;
          try {
            state = await request('/api/transactions/' + encodeURIComponent(form.dataset.id) + '/attachments?name=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
          } catch (error) { throw new Error('收支记录已保存；' + transactionUploads.length + ' 个附件尚未上传。可再次点击保存重试。' + error.message); }
          transactionUploads.shift(); uploaded++; updateTransactionFiles(); render();
        }
        toast('收支记录与附件已保存');
      } finally {
        transactionSaving = false;
        controls.forEach(control => { if (control.isConnected) control.disabled = false; });
        if (document.querySelector('#transaction-upload-status')) document.querySelector('#transaction-upload-status').textContent = transactionUploads.length ? '尚有 ' + transactionUploads.length + ' 个文件待上传，已成功的文件会保留。' : '';
      }
      modal.close();
    } else {
      if (!values.title.trim()) throw new Error('请填写任务标题。');
      await mutate(`/api/projects/${encodeURIComponent(form.dataset.projectId)}/tasks`, 'POST', { title: values.title.trim() }, '任务已添加');
      document.getElementById(`task-${form.dataset.projectId}`)?.focus();
    }
  } catch (error) { if (errorElement) errorElement.textContent = error.message; else toast(error.message, true); }
  finally { if (submit.isConnected) submit.disabled = false; }
});
window.addEventListener('hashchange', handleHash);
async function initialize() {
  try {
    state = await request('/api/state');
    handleHash();
    document.querySelector('#save-state').innerHTML = '<span class="local-dot"></span>数据已保存在本机';
  } catch (error) {
    main.innerHTML = `<div class="error-panel"><h2>暂时无法打开工作台</h2><p>${h(error.message)}。请确认本地服务正在运行，再刷新页面。</p><button type="button" class="button primary" id="retry-load">重新连接</button></div>`;
    document.querySelector('#retry-load').addEventListener('click', initialize);
  }
}
initialize();

function showRepositoryDetail(r) {
  if (!r) return;
  openModal(h(r.repository || r.name), `<div class="resource-detail"><span class="category-badge">${resourceKinds[r.resourceKind]}</span><p>${h(r.resourceDescription || r.description)}</p><h3>资源地址</h3><p><a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${h(r.url)} ↗</a></p>${r.documentationUrl && r.documentationUrl !== r.url ? `<p><a href="${safeUrl(r.documentationUrl)}" target="_blank" rel="noopener noreferrer">阅读使用文档 ↗</a></p>` : ''}${r.existingBusinessFit ? `<h3>业务关联</h3><p>${h(r.existingBusinessFit)}</p>` : ''}${Number.isSafeInteger(r.stars) ? `<h3>GitHub 关注度</h3><p>★ ${h(r.stars.toLocaleString('zh-CN'))} · ${h(r.checkedAt)} 核验</p><p>${h(r.growthNote)}</p>` : ''}<h3>资料核对</h3><p>${r.upstreamCommitDate ? '最近提交：' + h(r.upstreamCommitDate) + '<br>' : ''}核对日期：${h(r.checkedAt)}</p><h3>使用条件</h3><p>${h(r.licenseNote || '以官方平台当前规则为准')}</p><h3>原始资料</h3>${r.sources.map(source => `<p><a href="${safeUrl(source.url)}" target="_blank" rel="noopener noreferrer">${h(source.name)} ↗</a><br>${h(source.note)}</p>`).join('')}</div><div class="modal-actions">${button('关闭', 'close-modal', 'secondary', 'close')}<a class="button primary" href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">打开资源 ↗</a></div>`);
}

function showResourceDetail(r) {
  if (!r) return;
  openModal(h(r.name), `<div class="resource-detail"><span class="category-badge">${h(r.category)} · 面向国内用户</span><p>${h(r.description)}</p>${r.repository ? `<h3>真实仓库与维护情况</h3><p><a href="${safeUrl(r.url)}" target="_blank" rel="noopener noreferrer">${h(r.repository)} ↗</a><br>类型：${h(r.type)}<br>最近提交：${h(r.upstreamCommitDate)}<br>许可条件：${h(r.licenseNote)}</p>` : ''}<h3>可尝试的收入方式</h3><p>${h(r.monetization)}</p><h3>实际交付</h3><p>${h(r.deliverable)}</p><h3>开始的三步</h3><ol>${r.firstSteps.map(s => `<li>${h(s)}</li>`).join('')}</ol><h3>持续维护</h3><p>${h(r.maintenance)}</p>${r.existingBusinessFit ? `<h3>与你现有业务的衔接</h3><p>${h(r.existingBusinessFit)}</p>` : ''}<h3>成本与使用条件</h3><p>${h(r.costNotes)}</p><p>${h(r.requirements)}</p><h3>相关工具与资料</h3>${r.sources.map(s => `<p><a href="${safeUrl(s.url)}" target="_blank" rel="noopener noreferrer">${h(s.name)} ↗</a><small>${h(s.note)}</small></p>`).join('')}<p class="muted">核对日期：${h(r.checkedAt)}</p></div><div class="modal-actions">${button('关闭', 'close-modal', 'secondary', 'close')}${button('创建这个项目', 'resource-project', 'primary', 'plus', `data-id="${h(r.id)}"`)}</div>`);
}

async function showAiSettings() {
  const config = await request('/api/ai/config');
  openModal('第三方模型接口设置', '<form id="ai-config-form"><div class="form-error" role="alert"></div><p>使用第三方 OpenAI 兼容对话接口。保存配置不会发送请求；生成任务时才调用你填写的服务商。</p><div class="form-field"><label for="ai-base-url">接口地址（Base URL）</label><input id="ai-base-url" name="baseUrl" type="url" value="'+h(config.baseUrl || '')+'" required maxlength="2048" placeholder="https://你的服务商域名/v1"><span class="hint">填写服务商提供的基础地址；也可粘贴完整的 /chat/completions 地址。</span></div><div class="form-field"><label for="ai-model">模型名称</label><input id="ai-model" name="model" value="'+h(config.model)+'" maxlength="150" required placeholder="服务商提供的模型标识"></div><div class="form-field"><label for="ai-key">接口密钥</label><input type="password" id="ai-key" name="apiKey" maxlength="1024" autocomplete="off" '+(config.configured ? '' : 'required')+' placeholder="'+(config.configured ? '同一地址可留空保留原密钥；换地址须重新填写' : '填写该服务商的密钥')+'"></div><p>密钥明文保存在本机 data/ai-config.json，不回显、不进入业务备份。生成时会向所填地址发送所选项目资料，并可能产生服务商调用费用。</p><div class="modal-actions">'+button('取消', 'close-modal', 'secondary', 'close')+'<button type="submit" class="button primary">保存配置</button></div></form>');
}
async function showAiPlan(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) throw new Error('项目不存在，请刷新');
  const config = await request('/api/ai/config');
  if (!config.configured) { await showAiSettings(); toast('请先保存模型配置，再点击项目的 AI 拆解任务'); return; }
  openModal('AI 拆解任务', `<form id="ai-plan-form" data-project-id="${h(id)}"><div class="form-error" role="alert"></div><h3>${h(project.name)}</h3><p>已有 ${project.tasks.length} 项任务会保留。AI 将给出阶段、具体任务、预计工时和验收标准，预览后再加入。</p><div class="form-field"><label for="ai-requirements">补充要求与时间安排</label><textarea id="ai-requirements" name="requirements" maxlength="2000" placeholder="例如：30 天完成第一版，每天投入 2 小时，先验证学生需求，再收集学校资料并上线网站。"></textarea></div><p>使用 ${h(config.model)}；向 ${h(config.endpoint)} 发送本项目名称、描述、已有任务和上述要求，可能产生服务商调用费用。预计工时是规划参考，完成进度由你勾选任务更新。</p><div class="modal-actions">${button('取消', 'close-modal', 'secondary', 'close')}<button type="submit" class="button primary">生成任务草案</button></div></form>`);
}
function showAiPreview(projectId, plan) {
  openModal('预览 AI 任务计划', `<p>${h(plan.summary)}</p><p>勾选要加入的任务；已有任务与完成状态会保留。总预计工时：${plan.tasks.reduce((sum, t) => sum + (t.estimatedHours || 0), 0)} 小时。</p><div class="ai-plan-list">${plan.tasks.map((t, i) => `<label class="ai-plan-item"><input type="checkbox" data-plan-index="${i}" checked><span><strong>${h(t.title)}</strong><small>${h(t.stage)} · 预计 ${h(t.estimatedHours)} 小时</small><small>验收：${h(t.deliverable)}</small></span></label>`).join('')}</div><div class="form-error" role="alert"></div><div class="modal-actions">${button('取消', 'close-modal', 'secondary', 'close')}<button type="button" class="button primary" id="ai-add-tasks">加入所选任务</button></div>`);
  document.querySelector('#ai-add-tasks').addEventListener('click', async event => {
    const selected = [...modal.querySelectorAll('[data-plan-index]:checked')].map(el => plan.tasks[Number(el.dataset.planIndex)]);
    if (!selected.length) { modal.querySelector('.form-error').textContent = '请至少选择一项任务'; return; }
    event.currentTarget.disabled = true;
    try {
      await mutate(`/api/projects/${encodeURIComponent(projectId)}/tasks/batch`, 'POST', { planId: plan.planId, tasks: selected }, 'AI 任务已加入；已有任务保持原状');
      modal.close();
    } catch (error) { modal.querySelector('.form-error').textContent = error.message; const button = document.querySelector('#ai-add-tasks'); if (button) button.disabled = false; }
  });
}
document.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('#ai-config-form, #ai-plan-form')) return;
  event.preventDefault();
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  const version = aiDialogVersion;
  const values = Object.fromEntries(new FormData(form));
  const oldLabel = submit.textContent;
  form.querySelector('.form-error').textContent = '';
  try {
    if (form.id === 'ai-config-form') {
      await request('/api/ai/config', { method: 'POST', body: JSON.stringify(values) });
      if (version === aiDialogVersion) { modal.close(); toast('模型配置已保存在本机'); }
    } else {
      submit.textContent = 'AI 正在规划，请稍候…';
      const plan = await request(`/api/projects/${encodeURIComponent(form.dataset.projectId)}/ai-plan`, { method: 'POST', body: JSON.stringify(values) });
      if (version === aiDialogVersion && modal.open) showAiPreview(form.dataset.projectId, plan);
    }
  } catch (error) { if (version === aiDialogVersion) form.querySelector('.form-error').textContent = error.message; }
  finally { if (submit.isConnected) { submit.disabled = false; submit.textContent = oldLabel; } }
});
