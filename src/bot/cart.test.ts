import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeQuantity, removeItem, countItems, cartTotal } from './cart.js';

test('birinchi mahsulot savatga qo‘shiladi', () => {
  const old = {};
  const cart = changeQuantity(old, 'product1', 1);
  assert.deepEqual(cart, { product1: 1 });
  assert.deepEqual(old, {});
});

test('miqdor oshirish va kamaytirish', () => {
  let cart = changeQuantity({}, 'a', 1);
  cart = changeQuantity(cart, 'a', 1);
  assert.equal(countItems(cart), 2);
  cart = changeQuantity(cart, 'a', -1);
  assert.deepEqual(cart, { a: 1 });
  cart = changeQuantity(cart, 'a', -1);
  assert.deepEqual(cart, {});
});

test('bitta mahsulot ko‘pi bilan 30 ta', () => {
  assert.throws(() => changeQuantity({ a: 30 }, 'a', 1), /MAX_QUANTITY/);
});

test('savat ko‘pi bilan 20 xil mahsulot', () => {
  const cart = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`p${i}`, 1]));
  assert.throws(() => changeQuantity(cart, 'another', 1), /CART_FULL/);
});

test('summa narxlar xaritasi asosida hisoblanadi', () => {
  assert.equal(cartTotal({ a: 2, b: 1 }, new Map([['a', 21000], ['b', 35000]])), 77000);
});

test('mahsulot o‘chirilsa, boshqa mahsulotlar o‘zgarmaydi', () => {
  assert.deepEqual(removeItem({ a: 1, b: 3 }, 'a'), { b: 3 });
});
