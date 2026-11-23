const express = require('express');

const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { data, save } = require('./db');
const app = express();
const path = require('path');
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(express.json());
const JWT_SECRET = 'paymora-secret-123';
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { const d = jwt.verify(token, JWT_SECRET); req.userId = d.userId; next(); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }
}
function genAccNum() {
  let acc;
  do { acc = '81' + Math.floor(10000000 + Math.random() * 89999999).toString().slice(0, 8); }
  while (data.users.find(u => u.accountNumber === acc));
  return acc;
}
function genCardNum(acc) { return '5399 ' + acc.slice(2,6) + ' ' + acc.slice(4,8) + ' ' + acc.slice(6,10); }
function genRef() { return 'PM' + Math.floor(100000000 + Math.random() * 900000000); }
function publicUser(u) { const { pinHash, ...rest } = u; return rest; }

app.post('/api/signup', (req, res) => {
  const { fullName, username, phone, pin } = req.body;
  if (!fullName || !username || !pin) return res.status(400).json({ error: 'Missing fields' });
  if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN must be 4 digits' });
  if (data.users.find(u => u.username === username.toLowerCase())) return res.status(400).json({ error: 'Username already taken' });
  const acc = genAccNum();
  const user = { id: data.nextUserId++, fullName, username: username.toLowerCase(), phone: phone || '', pinHash: bcrypt.hashSync(pin, 10), accountNumber: acc, balance: 0, savingsBalance: 0, savingsTarget: 0, savingsGoal: '', cardNumber: genCardNum(acc), cardFrozen: 0, darkMode: 0, createdAt: new Date().toISOString() };
  data.users.push(user);
  data.notifications.push({ id: data.nextNotifId++, userId: user.id, title: 'Welcome to PayMora Bank', body: `Welcome ${fullName.split(' ')[0]}! Your PayMora account ${acc} is ready.`, icon: 'bell', isRead: 0, date: new Date().toISOString() });
  save();
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});
app.post('/api/login', (req, res) => {
  const { username, pin } = req.body;
  const user = data.users.find(u => u.username === username.toLowerCase());
  if (!user || !bcrypt.compareSync(pin, user.pinHash)) return res.status(401).json({ error: 'Wrong username or PIN' });
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: publicUser(user) });
});
app.get('/api/me', auth, (req, res) => {
  const user = data.users.find(u => u.id === req.userId);
  res.json(publicUser(user));
});
app.get('/api/transactions', auth, (req, res) => {
  res.json(data.transactions.filter(t => t.userId === req.userId).slice().reverse().slice(0,100));
});
app.get('/api/notifications', auth, (req, res) => {
  res.json(data.notifications.filter(n => n.userId === req.userId).slice().reverse().slice(0,50));
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  data.notifications.forEach(n => { if (n.userId === req.userId) n.isRead = 1; });
  save(); res.json({ ok: true });
});
app.get('/api/lookup/:accountNumber', auth, (req, res) => {
  const u = data.users.find(x => x.accountNumber === req.params.accountNumber);
  if (u) return res.json({ name: u.fullName, bank: 'PayMora', isPayMora: true });
  const ext = { '9023456789': { name: 'Fatima Bello', bank: 'PalmPay' }, '7034567890': { name: 'Ibrahim Ali', bank: 'GTBank' } };
  if (ext[req.params.accountNumber]) return res.json({ ...ext[req.params.accountNumber], isPayMora: false });
  res.status(404).json({ error: 'Account not found' });
});
app.post('/api/transfer', auth, (req, res) => {
  const { toAccount, amount, narration } = req.body;
  const amt = parseInt(amount);
  const sender = data.users.find(u => u.id === req.userId);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  if (sender.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });
  const ref = genRef();
  sender.balance -= amt;
  data.transactions.push({ id: data.nextTxnId++, userId: sender.id, type: 'transfer', name: `Transfer to ${toAccount}`, amount: amt, narration: narration || 'Transfer', ref, date: new Date().toISOString() });
  const receiver = data.users.find(u => u.accountNumber === toAccount && u.id !== sender.id);
  if (receiver) {
    receiver.balance += amt;
    data.transactions.push({ id: data.nextTxnId++, userId: receiver.id, type: 'transfer_in', name: `Received from ${sender.fullName}`, amount: -amt, narration: narration || 'Transfer', ref, date: new Date().toISOString() });
    data.notifications.push({ id: data.nextNotifId++, userId: receiver.id, title: 'Money Received', body: `You received ₦${amt.toLocaleString()} from ${sender.fullName}`, icon: 'bell', isRead: 0, date: new Date().toISOString() });
  }
  data.notifications.push({ id: data.nextNotifId++, userId: sender.id, title: 'Transfer Successful', body: `You sent ₦${amt.toLocaleString()} to ${toAccount} • Ref ${ref}`, icon: 'bell', isRead: 0, date: new Date().toISOString() });
  save();
  res.json({ ok: true, ref, newBalance: sender.balance });
});
app.post('/api/pay', auth, (req, res) => {
  const { type, amount, description, narration } = req.body;
  const amt = parseInt(amount);
  const user = data.users.find(u => u.id === req.userId);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });
  const ref = genRef();
  if (type === 'savings_deposit') {
    if (user.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= amt; user.savingsBalance += amt;
  } else if (type === 'savings_withdraw') {
    if (user.savingsBalance < amt) return res.status(400).json({ error: 'Insufficient savings' });
    user.savingsBalance -= amt; user.balance += amt;
  } else {
    if (user.balance < amt) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= amt;
  }
  data.transactions.push({ id: data.nextTxnId++, userId: user.id, type, name: description, amount: type === 'savings_withdraw' ? -amt : amt, narration: narration || description, ref, date: new Date().toISOString() });
  data.notifications.push({ id: data.nextNotifId++, userId: user.id, title: 'Payment Successful', body: `${description} - ₦${amt.toLocaleString()} • Ref ${ref}`, icon: 'bell', isRead: 0, date: new Date().toISOString() });
  save();
  res.json({ ok: true, ref });
});
app.post('/api/change-pin', auth, (req, res) => {
  const { oldPin, newPin } = req.body;
  const user = data.users.find(u => u.id === req.userId);
  if (!bcrypt.compareSync(oldPin, user.pinHash)) return res.status(400).json({ error: 'Old PIN wrong' });
  if (!/^\d{4}$/.test(newPin)) return res.status(400).json({ error: 'New PIN must be 4 digits' });
  user.pinHash = bcrypt.hashSync(newPin, 10); save();
  res.json({ ok: true });
});
app.post('/api/card/freeze', auth, (req, res) => {
  const user = data.users.find(u => u.id === req.userId);
  user.cardFrozen = user.cardFrozen ? 0 : 1; save();
  res.json({ cardFrozen: !!user.cardFrozen });
});
app.post('/api/fund', auth, (req, res) => {
  const amt = parseInt(req.body.amount) || 10000;
  const user = data.users.find(u => u.id === req.userId);
  user.balance += amt; save();
  res.json({ ok: true, added: amt });
});
app.post('/api/savings-goal', auth, (req, res) => {
  const user = data.users.find(u => u.id === req.userId);
  user.savingsGoal = req.body.goal; user.savingsTarget = req.body.target; save();
  res.json({ ok: true });
});
// ===== ADMIN - ONLY FOR YOU (Ali) =====
app.get('/api/admin/stats', (req, res) => {
  if (req.headers['x-admin-key'] !== 'Ibracool') return res.status(403).json({ error: 'Forbidden - Admins Only' });
  const totalUsers = data.users.length;
  const totalBalance = data.users.reduce((s,u)=>s+u.balance,0);
  const totalSavings = data.users.reduce((s,u)=>s+u.savingsBalance,0);
  const totalTxns = data.transactions.length;
  res.json({ totalUsers, totalBalance, totalSavings, totalTxns, totalMoney: totalBalance + totalSavings });
});
app.get('/api/admin/users', (req, res) => {
  if (req.headers['x-admin-key'] !== 'Ibracool') return res.status(403).json({ error: 'Forbidden - Admins Only' });
  const users = data.users.map(u => ({ id: u.id, fullName: u.fullName, username: u.username, phone: u.phone, accountNumber: u.accountNumber, balance: u.balance, savingsBalance: u.savingsBalance, cardNumber: u.cardNumber, createdAt: u.createdAt }));
  res.json(users);
});
app.get('/api/admin/transactions', (req, res) => {
  if (req.headers['x-admin-key'] !== 'Ibracool') return res.status(403).json({ error: 'Forbidden - Admins Only' });
  res.json(data.transactions.slice().reverse().slice(0,100));
});
app.post('/api/admin/fund-user', (req, res) => {
  if (req.headers['x-admin-key'] !== 'Ibracool') return res.status(403).json({ error: 'Forbidden' });
  const { accountNumber, amount } = req.body;
  const user = data.users.find(u => u.accountNumber === accountNumber);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.balance += parseInt(amount);
  save();
  res.json({ ok: true, newBalance: user.balance, user: user.fullName });
});
// Serve Frontend files online
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`PayMora Backend running on http://localhost:${PORT}`));
