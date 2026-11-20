'use strict';

const status = document.querySelector('#catalog-status');
const projects = document.querySelector('#projects');
const count = document.querySelector('#project-count');
const siteRoot = new URL('../', location.href);

function localUrl(path, base = location.href) {
  const url = new URL(path, base);
  if (url.origin !== siteRoot.origin || !url.pathname.startsWith(siteRoot.pathname)) {
    throw new Error('项目链接不在实验室目录内。');
  }
  return url;
}

function projectCard(project) {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.className = 'project';
  link.href = localUrl(project.href).href;
  const visual = document.createElement('span');
  visual.className = 'project-visual';
  const symbol = document.createElement('i');
  symbol.dataset.lucide = project.kind === 'legacy' ? 'flask-conical' : 'box';
  visual.setAttribute('aria-hidden', 'true');
  visual.append(symbol);
  if (project.thumbnail) {
    const img = document.createElement('img');
    img.src = localUrl(project.thumbnail, siteRoot).href;
    img.alt = '';
    img.addEventListener('error', () => img.remove(), { once: true });
    visual.append(img);
  }
  const body = document.createElement('div');
  body.className = 'project-body';
  const title = document.createElement('h2');
  title.textContent = project.title;
  const summary = document.createElement('p');
  summary.textContent = project.summary;
  const arrow = document.createElement('i');
  arrow.dataset.lucide = 'arrow-right';
  arrow.setAttribute('aria-hidden', 'true');
  body.append(title, summary);
  link.append(visual, body, arrow);
  item.append(link);
  return item;
}

async function loadCatalog() {
  const response = await fetch('./catalog.json');
  if (!response.ok) throw new Error('无法读取实验目录。');
  const catalog = await response.json();
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.projects)) {
    throw new Error('无法读取此版本的实验目录。');
  }
  projects.append(...catalog.projects.map(projectCard));
  count.textContent = `${catalog.projects.length} 项`;
  status.textContent = '暂时没有已登记的实验。';
  status.hidden = catalog.projects.length > 0;
}

loadCatalog().catch((error) => {
  status.textContent = `${error.message} 请通过 HTTP 预览地址打开。`;
}).finally(() => window.lucide?.createIcons());
