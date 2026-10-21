const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProduct, safeProductFromBody, seedProducts, getStockStatus } = require('../lib/domain');

const validProduct = {
  sku: 'lac-001', name: 'Leche entera', category: 'Lácteos', supplier: 'Proveedor Uno',
  quantity: 12, min_stock: 5, price: 125.5, expiration_date: '2030-12-31',
};

test('acepta un producto válido', () => assert.equal(validateProduct(validProduct), null));
test('rechaza campos de identificación vacíos', () => assert.match(validateProduct({ ...validProduct, name: '  ' }), /name es obligatorio/));
test('rechaza cantidades negativas y unidades fraccionarias', () => {
  assert.match(validateProduct({ ...validProduct, quantity: -1 }), /entero mayor o igual a 0/);
  assert.match(validateProduct({ ...validProduct, quantity: 1.2 }), /entero mayor o igual a 0/);
});
test('rechaza precios negativos', () => assert.match(validateProduct({ ...validProduct, price: -0.01 }), /precio debe ser un número/));
test('normaliza SKU y redondea el precio', () => {
  const product = safeProductFromBody({ ...validProduct, price: 12.345 });
  assert.equal(product.sku, 'LAC-001');
  assert.equal(product.price, 12.35);
});
test('rechaza fechas de calendario imposibles', () => assert.match(validateProduct({ ...validProduct, expiration_date: '2026-02-31' }), /fecha de vencimiento no es válida/));
test('genera registros iniciales con SKU único', () => {
  const products = seedProducts();
  assert.ok(products.length >= 5);
  assert.equal(new Set(products.map(product => product.sku)).size, products.length);
});
test('prioriza vencimiento sobre stock bajo', () => {
  assert.equal(getStockStatus({ quantity: 0, min_stock: 5, expiration_date: '2000-01-01' }), 'expired');
  assert.equal(getStockStatus({ quantity: 2, min_stock: 5, expiration_date: '2999-01-01' }), 'low');
  assert.equal(getStockStatus({ quantity: 8, min_stock: 5, expiration_date: '2999-01-01' }), 'ok');
  const soon = new Date(); soon.setDate(soon.getDate() + 3);
  assert.equal(getStockStatus({ quantity: 80, min_stock: 5, expiration_date: soon.toISOString().slice(0, 10) }), 'soon');
});
