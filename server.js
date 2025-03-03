const express = require('express');
const mongoose = require('mongoose');
const PaytmChecksum = require('paytmchecksum');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config(); // .env फाइल लोड करें
const app = express();

app.use(express.json());
app.use(express.static('public'));

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/goalux');

// User Schema
const userSchema = new mongoose.Schema({
  phone: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  referCode: { type: String, required: true },
  personalReferCode: { type: String, unique: true },
  wallet: { type: Number, default: 0 },
  referChain: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  hasPaid: { type: Boolean, default: false }
});

userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
  }
  next();
});

const User = mongoose.model('User', userSchema);

// Withdrawal Schema
const withdrawalSchema = new mongoose.Schema({
  phone: String,
  upiId: String,
  amount: Number,
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Withdrawal = mongoose.model('Withdrawal', withdrawalSchema);

// JWT Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'टोकन आवश्यक है' });
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: 'अमान्य टोकन' });
    req.user = decoded;
    next();
  });
};

// Registration Endpoint
app.post('/register', async (req, res) => {
  const { phone, password, referCode } = req.body;

  if (!phone || !password || !referCode) {
    return res.status(400).json({ message: 'सभी जानकारी भरें' });
  }

  try {
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ message: 'यह फोन नंबर पहले से रजिस्टर्ड है' });
    }

    const referrer = await User.findOne({ personalReferCode: referCode });
    const personalReferCode = `GOALUX${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const newUser = new User({ phone, password, referCode, personalReferCode });
    await newUser.save();

    if (referrer) {
      await updateReferralCommission(referrer.personalReferCode, 0);
    }

    res.status(201).json({ message: 'भगवद्गीता का मार्ग पर रजिस्ट्रेशन सफल', personalReferCode });
  } catch (error) {
    res.status(500).json({ message: 'सर्वर में त्रुटि' });
  }
});

// Login Endpoint
app.post('/login', async (req, res) => {
  const { phone, password } = req.body;

  const user = await User.findOne({ phone });
  if (!user) {
    return res.status(400).json({ message: 'गलत जानकारी' });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(400).json({ message: 'गलत जानकारी' });
  }

  const token = jwt.sign({ phone: user.phone }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ message: 'भगवद्गीता का मार्ग में लॉगिन सफल', token, personalReferCode: user.personalReferCode });
});

// User Data Endpoint (Dashboard के लिए)
app.get('/user/:phone', authMiddleware, async (req, res) => {
  const { phone } = req.params;
  const user = await User.findOne({ phone });
  if (!user) {
    return res.status(404).json({ message: 'यूज़र नहीं मिला' });
  }

  let referralCommission = 0;
  if (user.referChain && user.referChain.length > 0) {
    referralCommission = await calculateReferralCommission(user.personalReferCode);
  }

  res.json({
    wallet: user.wallet || 0,
    referralCommission: referralCommission,
    hasPaid: user.hasPaid || false
  });
});

// Paytm Payment Endpoint (टेस्ट क्रेडेंशियल्स जोड़ने के लिए अभी प्लेसहोल्डर)
app.post('/pay', authMiddleware, async (req, res) => {
  const { phone } = req.user;
  const orderId = `ORDER${Date.now()}`;
  const amount = '100';

  var paytmParams = {
    requestType: 'Payment',
    MID: 'YOUR_TEST_MID', // यहाँ Paytm टेस्ट MID डालें (जब मिले)
    WEBSITE: 'WEBSTAGING',
    ORDER_ID: orderId,
    CUST_ID: phone,
    TXN_AMOUNT: amount,
    CALLBACK_URL: 'http://localhost:3000/callback',
    INDUSTRY_TYPE_ID: 'Retail',
    CHANNEL_ID: 'WEB',
  };

  const checksum = await PaytmChecksum.generateSignature(JSON.stringify(paytmParams), 'YOUR_TEST_KEY'); // यहाँ Paytm टेस्ट KEY डालें
  paytmParams.CHECKSUMHASH = checksum;

  res.json(paytmParams);
});

app.post('/callback', async (req, res) => {
  const { STATUS, TXNID, ORDERID, CUST_ID } = req.body;
  if (STATUS === 'TXN_SUCCESS') {
    const user = await User.findOne({ phone: CUST_ID });
    if (user) {
      user.wallet += 100;
      user.hasPaid = true;
      await user.save();
    }
    res.json({ message: 'पेमेंट सफल', orderId: ORDERID, status: 'Success', phone: CUST_ID });
  } else {
    res.status(400).json({ message: 'पेमेंट विफल', status: 'Failed' });
  }
});

// Referral Commission Functions
async function calculateReferralCommission(referCode) {
  const user = await User.findOne({ personalReferCode: referCode });
  let totalCommission = 0;
  if (user && user.referChain) {
    const commissionRates = [0.25, 0.15, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
    for (let i = 0; i < user.referChain.length && i < 10; i++) {
      totalCommission += 100 * commissionRates[i];
    }
  }
  return totalCommission;
}

async function updateReferralCommission(referCode, level) {
  const user = await User.findOne({ personalReferCode: referCode });
  if (user) {
    const commissionRates = [0.25, 0.15, 0.10, 0.08, 0.06, 0.05, 0.04, 0.03, 0.02, 0.01];
    let currentUser = user;
    let currentLevel = level;

    while (currentUser && currentLevel < 10) {
      const commission = 100 * commissionRates[currentLevel];
      currentUser.wallet += commission;
      await currentUser.save();
      currentUser = await User.findOne({ personalReferCode: currentUser.referCode });
      currentLevel++;
    }
  }
}

// Withdrawal Endpoint
app.post('/withdraw', authMiddleware, async (req, res) => {
  const { phone } = req.user;
  const { upiId, amount } = req.body;
  const user = await User.findOne({ phone });

  if (!user) {
    return res.status(400).json({ message: 'यूज़र नहीं मिला' });
  }

  if (user.wallet < 100 || user.wallet < amount) {
    return res.status(400).json({ message: 'पर्याप्त बैलेंस नहीं' });
  }

  if (!user.hasPaid) {
    return res.status(400).json({ message: 'कृपया बुक खरीदें, फिर निकासी करें' });
  }

  const withdrawal = { phone, upiId, amount, status: 'Pending' };
  await new Withdrawal(withdrawal).save();
  user.wallet -= amount;
  await user.save();

  res.json({ message: 'निकासी रिक्वेस्ट भेजी गई' });
});

// Admin Endpoints
app.get('/admin/withdrawals', authMiddleware, async (req, res) => {
  const withdrawals = await Withdrawal.find().sort({ createdAt: -1 });
  res.json(withdrawals);
});

app.put('/admin/withdrawal/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  await Withdrawal.findByIdAndUpdate(id, { status });
  res.json({ message: 'स्थिति अपडेट हो गई' });
});

app.get('/admin/users', authMiddleware, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  res.json(users.map(user => ({
    phone: user.phone,
    personalReferCode: user.personalReferCode,
    wallet: user.wallet,
    hasPaid: user.hasPaid
  })));
});

app.get('/admin/payments', authMiddleware, async (req, res) => {
  const users = await User.find({ hasPaid: true }).sort({ createdAt: -1 });
  const payments = users.map(user => ({
    phone: user.phone,
    orderId: `ORDER${user.createdAt.getTime()}`,
    amount: 100,
    status: 'Success'
  }));
  res.json(payments);
});

app.get('/admin/referrals', authMiddleware, async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 });
  const referrals = users.map(user => ({
    phone: user.phone,
    personalReferCode: user.personalReferCode,
    referChain: user.referChain ? user.referChain.length : 0,
    referralCommission: user.referralCommission || 0
  }));
  res.json(referrals);
});

app.get('/admin/new-withdrawals', authMiddleware, async (req, res) => {
  const newWithdrawals = await Withdrawal.find({ status: 'Pending' }).sort({ createdAt: -1 });
  res.json(newWithdrawals);
});

// Default Route
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.listen(process.env.PORT || 3000, () => console.log('भगवद्गीता का मार्ग Server running on port ' + (process.env.PORT || 3000)));