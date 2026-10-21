'use strict';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const state = { user: null, products: [], currentView: 'dashboard', editingId: null, deletingProduct: null, saving: false };

const currencyFormatter = new Intl.NumberFormat('es-CU', { style: 'currency', currency: 'CUP', maximumFractionDigits: 2 });
const numberFormatter = new Intl.NumberFormat('es-CU', { maximumFractionDigits: 0 });
const dateFormatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const dateAfter = days => { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatMoney(value) { return currencyFormatter.format(Number(value || 0)); }
function formatNumber(value) { return numberFormatter.format(Number(value || 0)); }
function formatDate(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? 'Sin fecha' : dateFormatter.format(parsed).replace('.', '');
}
function initials(value) {
  const parts = String(value || 'Administrador').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0].toLocaleUpperCase('es')).join('') || 'AD';
}
function statusFor(product) {
  if (product.expiration_date && product.expiration_date < today()) return 'expired';
  if (product.expiration_date && product.expiration_date <= dateAfter(7)) return 'soon';
  if (Number(product.quantity) <= Number(product.min_stock)) return 'low';
  return 'ok';
}
function statusBadge(product) {
  const status = statusFor(product);
  const labels = { ok: 'En orden', low: 'Stock bajo', expired: 'Vencido', soon: 'Vence pronto' };
  return `<span class="status-badge status-${status}">${labels[status]}</span>`;
}
function productSymbol(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] || 'PR').slice(0, 2)).toLocaleUpperCase('es');
}
function productCell(product) {
  return `<div class="product-cell"><span class="product-symbol">${escapeHtml(productSymbol(product.name))}</span><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku)}</small></span></div>`;
}
function stockCell(product) {
  const quantity = Number(product.quantity);
  const minStock = Number(product.min_stock);
  const progress = minStock > 0 ? Math.min(100, Math.round(quantity / (minStock * 2) * 100)) : (quantity > 0 ? 100 : 0);
  return `<div class="stock-cell"><strong>${formatNumber(quantity)} uds.</strong><small>Mín. ${formatNumber(minStock)}</small><span class="stock-progress"><span class="${quantity <= minStock ? 'low' : ''}" style="width:${progress}%"></span></span></div>`;
}
function showLogin(message = '') {
  $('#loginView').hidden = false;
  $('#appView').hidden = true;
  $('#loginError').hidden = !message;
  $('#loginError').textContent = message;
  $('#loginButton').disabled = false;
  $('#loginButton').innerHTML = '<span>Entrar al panel</span><span aria-hidden="true">→</span>';
}
function showApp(user) {
  state.user = user;
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  $('#sidebarUsername').textContent = user.username;
  $('#avatarInitials').textContent = initials(user.username);
  setDateLabels();
  loadDashboard();
  loadProducts();
}
function setDateLabels() {
  const date = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  $('#todayLabel').textContent = date.charAt(0).toLocaleUpperCase('es') + date.slice(1);
  $('#currentYear').textContent = new Date().getFullYear();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(body && body.error ? body.error : `Error ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#loginButton');
  button.disabled = true;
  button.innerHTML = '<span>Comprobando acceso…</span><span aria-hidden="true">…</span>';
  $('#loginError').hidden = true;
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value }),
    });
    $('#password').value = '';
    showApp(result.user);
  } catch (error) {
    showLogin(error.message || 'No se pudo iniciar sesión.');
  }
});

$('#togglePassword').addEventListener('click', () => {
  const password = $('#password');
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  $('#togglePassword').textContent = show ? 'Ocultar' : 'Ver';
  $('#togglePassword').setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
});

$('#logoutButton').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* La pantalla de acceso se muestra igualmente. */ }
  state.user = null;
  state.products = [];
  $('#sidebar').classList.remove('open');
  $('#loginForm').reset();
  showLogin();
});

function navigate(view) {
  state.currentView = view === 'products' ? 'products' : 'dashboard';
  $('#dashboardView').hidden = state.currentView !== 'dashboard';
  $('#productsView').hidden = state.currentView !== 'products';
  $('#breadcrumbCurrent').textContent = state.currentView === 'dashboard' ? 'Resumen' : 'Productos';
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.currentView));
  $('#sidebar').classList.remove('open');
  if (state.currentView === 'dashboard') loadDashboard();
  else loadProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.view)));
$$('[data-action="go-products"]').forEach(button => button.addEventListener('click', () => navigate('products')));
$$('[data-action="new-product"]').forEach(button => button.addEventListener('click', () => openProductModal()));
$('#mobileMenuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
document.addEventListener('click', event => {
  if (window.innerWidth <= 720 && $('#sidebar').classList.contains('open') && !$('#sidebar').contains(event.target) && !$('#mobileMenuButton').contains(event.target)) $('#sidebar').classList.remove('open');
});

async function loadDashboard() {
  if (!state.user) return;
  try {
    const data = await api('/api/dashboard');
    $('#dashboardError').hidden = true;
    $('#metricProducts').textContent = formatNumber(data.metrics.totalProducts);
    $('#metricUnits').textContent = formatNumber(data.metrics.units);
    $('#metricValue').textContent = formatMoney(data.metrics.inventoryValue);
    $('#metricLow').textContent = formatNumber(data.metrics.lowStock);
    $('#lowStockCaption').textContent = data.metrics.lowStock === 1 ? '1 referencia por reponer' : 'Referencias que requieren reposición';
    renderAlerts(data.alerts || []);
    renderRecent(data.recent || []);
  } catch (error) {
    if (error.status === 401) return handleExpiredSession();
    $('#dashboardError').textContent = error.message || 'No fue posible cargar el resumen.';
    $('#dashboardError').hidden = false;
  }
}

function renderAlerts(alerts) {
  const list = $('#alertsList');
  $('#alertsCount').textContent = `${alerts.length} ${alerts.length === 1 ? 'alerta' : 'alertas'}`;
  if (!alerts.length) {
    list.innerHTML = '<div class="empty-state compact-empty">No hay alertas pendientes. El inventario está al día.</div>';
    return;
  }
  list.innerHTML = alerts.map(product => {
    const status = product.status || statusFor(product);
    const text = status === 'expired' ? 'Producto vencido' : status === 'low' ? 'Stock por debajo del mínimo' : 'Vencimiento próximo';
    const dateText = product.expiration_date ? formatDate(product.expiration_date) : 'Sin fecha de vencimiento';
    return `<div class="alert-row"><span class="alert-marker ${status === 'expired' ? 'expired' : ''}"><svg viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17.5h.01"/></svg></span><div class="alert-info"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(text)} · <em>${escapeHtml(dateText)}</em></small></div><div class="alert-right"><strong>${formatNumber(product.quantity)} uds.</strong><small>Mín. ${formatNumber(product.min_stock)}</small></div></div>`;
  }).join('');
}

function renderRecent(products) {
  const body = $('#recentProductsBody');
  if (!products.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-placeholder">No hay productos registrados todavía.</td></tr>';
    return;
  }
  body.innerHTML = products.map(product => `<tr><td>${productCell(product)}</td><td><span class="category-tag">${escapeHtml(product.category)}</span></td><td>${stockCell(product)}</td><td class="date-cell">${escapeHtml(formatDate(product.expiration_date))}</td><td>${statusBadge(product)}</td></tr>`).join('');
}

async function loadProducts() {
  if (!state.user) return;
  try {
    const result = await api('/api/products');
    state.products = result.products || [];
    $('#footerStorage').textContent = 'Almacenamiento conectado';
    $('#navProductCount').textContent = String(state.products.length);
    fillCategoryFilter();
    renderProducts();
  } catch (error) {
    if (error.status === 401) return handleExpiredSession();
    showToast('No se pudieron cargar los productos', error.message, true);
  }
}

function fillCategoryFilter() {
  const select = $('#categoryFilter');
  const selected = select.value;
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  select.innerHTML = '<option value="">Todas las categorías</option>' + categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('');
  if (categories.includes(selected)) select.value = selected;
}

function currentFilteredProducts() {
  const q = $('#searchInput').value.trim().toLocaleLowerCase('es');
  const category = $('#categoryFilter').value;
  const stock = $('#stockFilter').value;
  return state.products.filter(product => {
    const matchesText = !q || [product.name, product.sku, product.category, product.supplier].some(value => String(value || '').toLocaleLowerCase('es').includes(q));
    const matchesCategory = !category || product.category === category;
    const status = statusFor(product);
    const matchesStock = !stock || (stock === 'low' && status === 'low') || (stock === 'expired' && status === 'expired') || (stock === 'soon' && status === 'soon');
    return matchesText && matchesCategory && matchesStock;
  });
}

function renderProducts() {
  const products = currentFilteredProducts();
  const body = $('#productsBody');
  $('#productSummary').textContent = `${products.length} ${products.length === 1 ? 'producto' : 'productos'}${products.length !== state.products.length ? ` de ${state.products.length}` : ''}`;
  $('#navProductCount').textContent = String(state.products.length);
  $('#emptyProducts').hidden = products.length > 0;
  body.closest('table').hidden = products.length === 0;
  if (!products.length) { body.innerHTML = ''; return; }
  body.innerHTML = products.map(product => `<tr><td>${productCell(product)}</td><td><span class="category-tag">${escapeHtml(product.category)}</span></td><td class="supplier-cell" title="${escapeHtml(product.supplier)}">${escapeHtml(product.supplier || '—')}</td><td>${stockCell(product)}</td><td class="price-cell">${escapeHtml(formatMoney(product.price))}</td><td class="date-cell">${escapeHtml(formatDate(product.expiration_date))}</td><td>${statusBadge(product)}</td><td><div class="row-actions"><button class="row-action" type="button" data-edit-id="${Number(product.id)}" aria-label="Editar ${escapeHtml(product.name)}" title="Editar"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4.5-.9L19 8.6a2.1 2.1 0 0 0-3-3L5.5 16.1z"/></svg></button><button class="row-action delete" type="button" data-delete-id="${Number(product.id)}" aria-label="Eliminar ${escapeHtml(product.name)}" title="Eliminar"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3"/></svg></button></div></td></tr>`).join('');
}

$('#searchInput').addEventListener('input', renderProducts);
$('#categoryFilter').addEventListener('change', renderProducts);
$('#stockFilter').addEventListener('change', renderProducts);
$('#clearFilters').addEventListener('click', () => { $('#searchInput').value = ''; $('#categoryFilter').value = ''; $('#stockFilter').value = ''; renderProducts(); });
$('#productsBody').addEventListener('click', event => {
  const editButton = event.target.closest('[data-edit-id]');
  const deleteButton = event.target.closest('[data-delete-id]');
  if (editButton) {
    const product = state.products.find(p => Number(p.id) === Number(editButton.dataset.editId));
    if (product) openProductModal(product);
  }
  if (deleteButton) {
    const product = state.products.find(p => Number(p.id) === Number(deleteButton.dataset.deleteId));
    if (product) openDeleteDialog(product);
  }
});

function openProductModal(product = null) {
  state.editingId = product ? Number(product.id) : null;
  $('#productForm').reset();
  $('#productFormError').hidden = true;
  $('#modalTitle').textContent = product ? 'Editar producto' : 'Nuevo producto';
  $('#modalDescription').textContent = product ? 'Actualiza los datos de esta referencia.' : 'Completa la información de la nueva referencia.';
  $('#saveProductButton').textContent = product ? 'Guardar cambios' : 'Guardar producto';
  const defaults = { sku: '', name: '', category: '', supplier: '', quantity: 0, min_stock: 5, price: 0, expiration_date: '' };
  const data = product || defaults;
  for (const key of Object.keys(defaults)) {
    const field = $(`#product${key.split('_').map(s => s[0].toUpperCase() + s.slice(1)).join('')}`);
    if (field) field.value = data[key] ?? '';
  }
  $('#productModal').hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#productSku').focus(), 30);
}
function closeProductModal() {
  $('#productModal').hidden = true;
  document.body.style.overflow = '';
  state.editingId = null;
}
$('#closeModalButton').addEventListener('click', closeProductModal);
$('#cancelModalButton').addEventListener('click', closeProductModal);
$('#productModal').addEventListener('click', event => { if (event.target === $('#productModal')) closeProductModal(); });

$('#productForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.saving) return;
  const payload = {
    sku: $('#productSku').value.trim(),
    name: $('#productName').value.trim(),
    category: $('#productCategory').value.trim(),
    supplier: $('#productSupplier').value.trim(),
    quantity: Number($('#productQuantity').value),
    min_stock: Number($('#productMinStock').value),
    price: Number($('#productPrice').value),
    expiration_date: $('#productExpiration').value || null,
  };
  state.saving = true;
  const button = $('#saveProductButton');
  button.disabled = true;
  button.textContent = 'Guardando…';
  $('#productFormError').hidden = true;
  try {
    const editingId = state.editingId;
    await api(editingId ? `/api/products/${editingId}` : '/api/products', { method: editingId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    closeProductModal();
    await Promise.all([loadProducts(), loadDashboard()]);
    showToast(editingId ? 'Producto actualizado' : 'Producto registrado', `${payload.name} se guardó correctamente.`);
  } catch (error) {
    if (error.status === 401) { closeProductModal(); return handleExpiredSession(); }
    $('#productFormError').textContent = error.message || 'No se pudo guardar el producto.';
    $('#productFormError').hidden = false;
  } finally {
    state.saving = false;
    button.disabled = false;
    button.textContent = state.editingId ? 'Guardar cambios' : 'Guardar producto';
  }
});

function openDeleteDialog(product) {
  state.deletingProduct = product;
  $('#confirmMessage').textContent = `Se eliminará «${product.name}» (${product.sku}). Esta acción no se puede deshacer.`;
  $('#confirmDialog').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeDeleteDialog() {
  $('#confirmDialog').hidden = true;
  if ($('#productModal').hidden) document.body.style.overflow = '';
  state.deletingProduct = null;
}
$('#cancelDeleteButton').addEventListener('click', closeDeleteDialog);
$('#confirmDialog').addEventListener('click', event => { if (event.target === $('#confirmDialog')) closeDeleteDialog(); });
$('#confirmDeleteButton').addEventListener('click', async () => {
  const product = state.deletingProduct;
  if (!product) return;
  const button = $('#confirmDeleteButton');
  button.disabled = true;
  button.textContent = 'Eliminando…';
  try {
    await api(`/api/products/${product.id}`, { method: 'DELETE' });
    closeDeleteDialog();
    await Promise.all([loadProducts(), loadDashboard()]);
    showToast('Producto eliminado', `${product.name} se eliminó del inventario.`);
  } catch (error) {
    if (error.status === 401) { closeDeleteDialog(); return handleExpiredSession(); }
    showToast('No se pudo eliminar', error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Eliminar producto';
  }
});

function exportCsv() {
  window.location.assign('/api/products/export.csv');
}
$('#exportButton').addEventListener('click', exportCsv);
$('#dashboardExportButton').addEventListener('click', exportCsv);

function showToast(title, message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = isError ? '!' : '✓';
  const copy = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const p = document.createElement('p');
  p.textContent = message || '';
  copy.append(strong, p);
  toast.append(icon, copy);
  $('#toastRegion').append(toast);
  window.setTimeout(() => toast.remove(), 4500);
}

function handleExpiredSession() {
  state.user = null;
  $('#loginForm').reset();
  showLogin('La sesión expiró. Vuelve a iniciar sesión.');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('#productModal').hidden) closeProductModal();
    if (!$('#confirmDialog').hidden) closeDeleteDialog();
    $('#sidebar').classList.remove('open');
  }
});

async function bootstrap() {
  setDateLabels();
  try {
    const session = await api('/api/auth/me');
    if (session.user) showApp(session.user);
    else showLogin();
  } catch {
    showLogin('No se pudo conectar con el servidor. Recarga la página para intentarlo de nuevo.');
  }
}
bootstrap();
