// PayMora Database - Simple JSON file, no install needed
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const DB_FILE = path.join(__dirname, 'paymora.json');

let data = { users: [], transactions: [], notifications: [], nextUserId: 1, nextTxnId: 1, nextNotifId: 1 };

if (fs.existsSync(DB_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch(e) {}
}
function save() { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }

// Seed Ali
if (!data.users.find(u => u.username === 'ali')) {
  const pinHash = bcrypt.hashSync('1234', 10);
  data.users.push({ id: data.nextUserId++, fullName: 'Ali Ibrahim', username: 'ali', phone: '08031234567', pinHash, accountNumber: '8101234567', balance: 100000, savingsBalance: 0, savingsTarget: 0, savingsGoal: '', cardNumber: '5399 1234 5678 8101', cardFrozen: 0, darkMode: 0, createdAt: new Date().toISOString() });
  save();
  console.log('Seeded Ali - 8101234567 / 1234 / ₦100,000');
}

module.exports = { data, save };