'use strict';

function shiftDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedProducts() {
  return [
    { id: 1, sku: 'LAC-001', name: 'Leche entera UHT', category: 'Lácteos', supplier: 'Lácteos del Norte', quantity: 42, min_stock: 15, price: 125, expiration_date: shiftDate(95) },
    { id: 2, sku: 'YOG-014', name: 'Yogur natural 1 L', category: 'Lácteos', supplier: 'Lácteos del Norte', quantity: 8, min_stock: 12, price: 210, expiration_date: shiftDate(8) },
    { id: 3, sku: 'POL-020', name: 'Pollo troceado congelado', category: 'Carnes', supplier: 'Distribuidora Central', quantity: 27, min_stock: 10, price: 475, expiration_date: shiftDate(160) },
    { id: 4, sku: 'JUG-003', name: 'Jugo de mango 1 L', category: 'Bebidas', supplier: 'Frutas Caribe', quantity: 36, min_stock: 10, price: 180, expiration_date: shiftDate(45) },
    { id: 5, sku: 'PAN-008', name: 'Pan integral', category: 'Panadería', supplier: 'Panificadora Habana', quantity: 5, min_stock: 8, price: 110, expiration_date: shiftDate(-2) },
    { id: 6, sku: 'QUE-009', name: 'Queso semiduro', category: 'Lácteos', supplier: 'Lácteos del Norte', quantity: 14, min_stock: 6, price: 630, expiration_date: shiftDate(18) },
    { id: 7, sku: 'TOM-005', name: 'Tomate fresco', category: 'Vegetales', supplier: 'AgroMercado 12', quantity: 11, min_stock: 10, price: 95, expiration_date: shiftDate(4) },
    { id: 8, sku: 'ARR-010', name: 'Arroz 1 kg', category: 'Abarrotes', supplier: 'Distribuidora Central', quantity: 80, min_stock: 20, price: 145, expiration_date: shiftDate(300) },
  ];
}

function validateProduct(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'El cuerpo de la solicitud no es válido.';
  for (const field of ['sku', 'name', 'category']) {
    if (typeof body[field] !== 'string' || body[field].trim().length === 0) {
      return `El campo ${field} es obligatorio.`;
    }
  }
  if (body.sku.trim().length > 40) return 'El SKU no puede superar 40 caracteres.';
  if (body.name.trim().length > 160) return 'El nombre no puede superar 160 caracteres.';
  if (body.category.trim().length > 80) return 'La categoría no puede superar 80 caracteres.';
  if (typeof body.supplier !== 'string' && body.supplier != null) return 'El proveedor no es válido.';
  if ((body.supplier || '').length > 160) return 'El proveedor no puede superar 160 caracteres.';
  const quantity = Number(body.quantity);
  const minStock = Number(body.min_stock);
  const price = Number(body.price);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000000) return 'La cantidad debe ser un entero mayor o igual a 0.';
  if (!Number.isInteger(minStock) || minStock < 0 || minStock > 100000000) return 'El stock mínimo debe ser un entero mayor o igual a 0.';
  if (!Number.isFinite(price) || price < 0 || price > 1000000000) return 'El precio debe ser un número mayor o igual a 0.';
  if (body.expiration_date) {
    if (typeof body.expiration_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.expiration_date)) return 'La fecha de vencimiento no es válida.';
    const [year, month, day] = body.expiration_date.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return 'La fecha de vencimiento no es válida.';
  }
  return null;
}

function safeProductFromBody(body) {
  return {
    sku: body.sku.trim().toUpperCase(),
    name: body.name.trim(),
    category: body.category.trim(),
    supplier: String(body.supplier || '').trim(),
    quantity: Number(body.quantity),
    min_stock: Number(body.min_stock),
    price: Math.round(Number(body.price) * 100) / 100,
    expiration_date: body.expiration_date || null,
  };
}

function getStockStatus(product) {
  const today = new Date().toISOString().slice(0, 10);
  if (product.expiration_date && product.expiration_date < today) return 'expired';
  if (product.expiration_date && product.expiration_date <= shiftDate(7)) return 'soon';
  if (product.quantity <= product.min_stock) return 'low';
  return 'ok';
}

module.exports = { shiftDate, seedProducts, validateProduct, safeProductFromBody, getStockStatus };
