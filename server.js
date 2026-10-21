'use strict';

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { shiftDate, seedProducts, validateProduct, safeProductFromBody, getStockStatus } = require('./lib/domain');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const isProduction = NODE_ENV === 'production';

if (isProduction && !process.env.ADMIN_PASSWORD) {
  console.error('Falta ADMIN_PASSWORD. Configura una contraseña segura en las variables de entorno.');
  process.exit(1);
}
if (isProduction && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  console.error('SESSION_SECRET debe tener al menos 32 caracteres en producción.');
  process.exit(1);
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

const devPassword = 'Inventario123!';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || devPassword;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-this-before-deploying';

app.disable('x-powered-by');
if (isProduction) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: isProduction ? [] : null,
    },
  },
}));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(session({
  name: 'inventoryflow.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: isProduction ? '1h' : 0 }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera 15 minutos y vuelve a intentarlo.' },
});

let jsonProducts = [];
let nextId = 1;

async function initStore() {
  if (pool) {
    await pool.query(`CREATE TABLE IF NOT EXISTS products (
      id BIGSERIAL PRIMARY KEY,
      sku VARCHAR(40) NOT NULL UNIQUE,
      name VARCHAR(160) NOT NULL,
      category VARCHAR(80) NOT NULL,
      supplier VARCHAR(160) NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL CHECK (quantity >= 0),
      min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
      price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
      expiration_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM products');
    if (count.rows[0].count === 0) {
      const seeds = seedProducts();
      for (const p of seeds) {
        await pool.query(
          `INSERT INTO products (sku, name, category, supplier, quantity, min_stock, price, expiration_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (sku) DO NOTHING`,
          [p.sku, p.name, p.category, p.supplier, p.quantity, p.min_stock, p.price, p.expiration_date],
        );
      }
    }
    console.log('Almacenamiento PostgreSQL inicializado.');
    return;
  }

  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    jsonProducts = Array.isArray(saved) ? saved : [];
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    jsonProducts = seedProducts();
    await persistJson();
  }
  nextId = Math.max(0, ...jsonProducts.map(p => Number(p.id) || 0)) + 1;
  console.log('Almacenamiento JSON local inicializado.');
}

async function persistJson() {
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(jsonProducts, null, 2), 'utf8');
  await fs.rename(tempFile, DATA_FILE);
}

function normaliseProduct(row) {
  return {
    id: Number(row.id),
    sku: row.sku,
    name: row.name,
    category: row.category,
    supplier: row.supplier || '',
    quantity: Number(row.quantity),
    min_stock: Number(row.min_stock),
    price: Number(row.price),
    expiration_date: row.expiration_date ? String(row.expiration_date).slice(0, 10) : null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function listProducts() {
  if (pool) {
    const result = await pool.query('SELECT * FROM products ORDER BY name ASC');
    return result.rows.map(normaliseProduct);
  }
  return jsonProducts.map(p => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

async function createProduct(product) {
  if (pool) {
    const { rows } = await pool.query(
      `INSERT INTO products (sku,name,category,supplier,quantity,min_stock,price,expiration_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [product.sku, product.name, product.category, product.supplier, product.quantity, product.min_stock, product.price, product.expiration_date],
    );
    return normaliseProduct(rows[0]);
  }
  if (jsonProducts.some(p => p.sku.toLowerCase() === product.sku.toLowerCase())) {
    const err = new Error('Ya existe un producto con ese SKU.'); err.code = '23505'; throw err;
  }
  const newProduct = { id: nextId++, ...product, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  jsonProducts.push(newProduct);
  await persistJson();
  return { ...newProduct };
}

async function updateProduct(id, product) {
  if (pool) {
    const { rows } = await pool.query(
      `UPDATE products SET sku=$1,name=$2,category=$3,supplier=$4,quantity=$5,min_stock=$6,price=$7,expiration_date=$8,updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [product.sku, product.name, product.category, product.supplier, product.quantity, product.min_stock, product.price, product.expiration_date, id],
    );
    return rows[0] ? normaliseProduct(rows[0]) : null;
  }
  if (jsonProducts.some(p => Number(p.id) !== id && p.sku.toLowerCase() === product.sku.toLowerCase())) {
    const err = new Error('Ya existe un producto con ese SKU.'); err.code = '23505'; throw err;
  }
  const index = jsonProducts.findIndex(p => Number(p.id) === id);
  if (index < 0) return null;
  jsonProducts[index] = { ...jsonProducts[index], ...product, updated_at: new Date().toISOString() };
  await persistJson();
  return { ...jsonProducts[index] };
}

async function deleteProduct(id) {
  if (pool) {
    const result = await pool.query('DELETE FROM products WHERE id=$1', [id]);
    return result.rowCount > 0;
  }
  const before = jsonProducts.length;
  jsonProducts = jsonProducts.filter(p => Number(p.id) !== id);
  if (before === jsonProducts.length) return false;
  await persistJson();
  return true;
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Debes iniciar sesión para continuar.' });
  next();
}

app.get('/api/health', async (_req, res) => {
  try {
    if (pool) await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'InventoryFlow', storage: pool ? 'postgresql' : 'json' });
  } catch {
    res.status(503).json({ status: 'error', service: 'InventoryFlow' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const usernameDigest = crypto.createHash('sha256').update(username).digest();
  const expectedUsernameDigest = crypto.createHash('sha256').update(ADMIN_USERNAME).digest();
  const passwordDigest = crypto.createHash('sha256').update(password).digest();
  const expectedPasswordDigest = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  const usernameMatch = username.length <= 160 && crypto.timingSafeEqual(usernameDigest, expectedUsernameDigest);
  const passwordMatch = password.length <= 256 && crypto.timingSafeEqual(passwordDigest, expectedPasswordDigest);
  if (!usernameMatch || !passwordMatch) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'No se pudo iniciar la sesión.' });
    req.session.user = { username: ADMIN_USERNAME };
    req.session.save(saveError => {
      if (saveError) return res.status(500).json({ error: 'No se pudo guardar la sesión.' });
      res.json({ user: { username: ADMIN_USERNAME } });
    });
  });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'No se pudo cerrar la sesión.' });
    res.clearCookie('inventoryflow.sid', { httpOnly: true, sameSite: 'lax', secure: isProduction });
    res.json({ ok: true });
  });
});

app.get('/api/dashboard', requireAuth, async (_req, res, next) => {
  try {
    const products = await listProducts();
    const today = new Date().toISOString().slice(0, 10);
    const inSevenDays = shiftDate(7);
    const metrics = products.reduce((acc, p) => {
      acc.totalProducts += 1;
      acc.units += p.quantity;
      acc.inventoryValue += p.quantity * p.price;
      if (p.quantity <= p.min_stock) acc.lowStock += 1;
      if (p.expiration_date && p.expiration_date < today) acc.expired += 1;
      else if (p.expiration_date && p.expiration_date <= inSevenDays) acc.expiringSoon += 1;
      return acc;
    }, { totalProducts: 0, units: 0, inventoryValue: 0, lowStock: 0, expired: 0, expiringSoon: 0 });
    metrics.inventoryValue = Math.round(metrics.inventoryValue * 100) / 100;
    const alerts = products.filter(p => getStockStatus(p) !== 'ok').map(p => ({ ...p, status: getStockStatus(p) })).slice(0, 8);
    res.json({ metrics, alerts, recent: products.slice(0, 5) });
  } catch (err) { next(err); }
});

app.get('/api/products', requireAuth, async (req, res, next) => {
  try {
    let products = await listProducts();
    const q = typeof req.query.q === 'string' ? req.query.q.trim().toLocaleLowerCase('es') : '';
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    const stock = typeof req.query.stock === 'string' ? req.query.stock : '';
    if (q) products = products.filter(p => [p.sku, p.name, p.category, p.supplier].some(v => String(v || '').toLocaleLowerCase('es').includes(q)));
    if (category) products = products.filter(p => p.category === category);
    if (stock === 'low') products = products.filter(p => getStockStatus(p) === 'low');
    if (stock === 'expired') products = products.filter(p => getStockStatus(p) === 'expired');
    if (stock === 'soon') products = products.filter(p => p.expiration_date && p.expiration_date >= new Date().toISOString().slice(0, 10) && p.expiration_date <= shiftDate(7));
    res.json({ products, total: products.length });
  } catch (err) { next(err); }
});

app.post('/api/products', requireAuth, async (req, res, next) => {
  const validationError = validateProduct(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const product = await createProduct(safeProductFromBody(req.body));
    res.status(201).json({ product });
  } catch (err) { next(err); }
});

app.put('/api/products/:id', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Identificador de producto no válido.' });
  const validationError = validateProduct(req.body);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const product = await updateProduct(id, safeProductFromBody(req.body));
    if (!product) return res.status(404).json({ error: 'El producto no existe.' });
    res.json({ product });
  } catch (err) { next(err); }
});

app.delete('/api/products/:id', requireAuth, async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Identificador de producto no válido.' });
  try {
    const deleted = await deleteProduct(id);
    if (!deleted) return res.status(404).json({ error: 'El producto no existe.' });
    res.status(204).end();
  } catch (err) { next(err); }
});

function csvEscape(value) {
  let s = String(value ?? '');
  // Neutraliza valores de texto que un programa de hojas de cálculo podría interpretar como fórmula.
  if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
app.get('/api/products/export.csv', requireAuth, async (_req, res, next) => {
  try {
    const products = await listProducts();
    const headers = ['SKU', 'Nombre', 'Categoría', 'Proveedor', 'Cantidad', 'Stock mínimo', 'Precio', 'Vencimiento'];
    const rows = products.map(p => [p.sku, p.name, p.category, p.supplier, p.quantity, p.min_stock, p.price.toFixed(2), p.expiration_date || '']);
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventoryflow-productos.csv"');
    res.send(csv);
  } catch (err) { next(err); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));
app.use((err, _req, res, _next) => {
  if (err && err.code === '23505') return res.status(409).json({ error: 'Ya existe un producto con ese SKU.' });
  if (err && err.code === '23514') return res.status(400).json({ error: 'Los valores no cumplen las restricciones del inventario.' });
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error interno. Revisa los registros del servidor.' });
});

async function start() {
  await initStore();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`InventoryFlow disponible en http://0.0.0.0:${PORT}`);
    if (!isProduction && !process.env.ADMIN_PASSWORD) console.log(`Acceso local de desarrollo: admin / ${devPassword}`);
  });
  const shutdown = signal => {
    console.log(`${signal}: cerrando InventoryFlow...`);
    server.close(async () => {
      if (pool) await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch(err => { console.error('No se pudo iniciar InventoryFlow:', err); process.exit(1); });
}

module.exports = { app, start };
