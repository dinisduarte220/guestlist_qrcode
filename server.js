const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const qrcode = require('qrcode');

const pool = require("./db");
const { requireAuth, generateToken, comparePassword, hashPassword } = require("./auth");

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Protected Page Routing
// Serve private HTML files from the 'views' directory, verifying roles via requireAuth
app.get('/my-area', requireAuth(['client']), (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'client.html'));
});

app.get('/promoter', requireAuth(['promoter']), (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'promoter.html'));
});

app.get('/dashboard', requireAuth(['producer']), (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'producer.html'));
});

app.get('/scanner', requireAuth(['producer', 'staff']), (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'scanner.html'));
});

// Serve Public Static Files
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// AUTHENTICATION API
// ==========================================

// Register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const selectedRole = ['client', 'promoter', 'producer', 'staff'].includes(role) ? role : 'client';

  try {
    // Check if user already exists
    const userExist = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const hashedPassword = await hashPassword(password);
    
    // Create User
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, wallet_balance) 
       VALUES ($1, $2, $3, $4, 0.00) RETURNING id, name, email, role`,
      [name, email, hashedPassword, selectedRole]
    );

    const user = newUser.rows[0];

    // If role is producer, create a producer profile
    if (selectedRole === 'producer') {
      await pool.query(
        `INSERT INTO producers (user_id, company_name) VALUES ($1, $2)`,
        [user.id, `${name} Productions`]
      );
    }

    return res.json({ success: true, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT
    const token = generateToken(user);

    // Set cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });

    return res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  return res.json({ success: true });
});

// Get User Profile
app.get('/api/auth/me', requireAuth(), (req, res) => {
  return res.json({ user: req.user });
});


// ==========================================
// EVENTS API
// ==========================================

// Get All Events (with optional filters)
app.get('/api/events', async (req, res) => {
  const { search, style, date } = req.query;
  
  let queryText = `
    SELECT e.*, p.company_name as producer_name 
    FROM events e
    JOIN producers p ON e.producer_id = p.id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;

  if (search) {
    queryText += ` AND (e.title ILIKE $${paramIndex} OR e.location ILIKE $${paramIndex} OR e.description ILIKE $${paramIndex})`;
    params.push(`%${search}%`);
    paramIndex++;
  }

  if (style) {
    queryText += ` AND e.event_style = $${paramIndex}`;
    params.push(style);
    paramIndex++;
  }

  if (date) {
    queryText += ` AND e.date >= $${paramIndex}`;
    params.push(date);
    paramIndex++;
  }

  queryText += ` ORDER BY e.date ASC`;

  try {
    const eventsRes = await pool.query(queryText, params);
    return res.json(eventsRes.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Get Single Event details
app.get('/api/events/:id', async (req, res) => {
  try {
    const eventRes = await pool.query(
      `SELECT e.*, p.company_name FROM events e JOIN producers p ON e.producer_id = p.id WHERE e.id = $1`,
      [req.params.id]
    );
    if (eventRes.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    // Also fetch guestlists for this event
    const glRes = await pool.query(`SELECT * FROM guestlists WHERE event_id = $1`, [req.params.id]);
    
    return res.json({
      event: eventRes.rows[0],
      guestlists: glRes.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch event details' });
  }
});

// Create Event (Producer only)
app.post('/api/events', requireAuth(['producer']), async (req, res) => {
  const { title, description, date, location, event_style, image_url, ticket_price, enabled_in_event_payments } = req.body;

  if (!title || !date || !location) {
    return res.status(400).json({ error: 'Title, date, and location are required' });
  }

  try {
    // Get producer ID for this user
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    if (prodRes.rows.length === 0) {
      return res.status(403).json({ error: 'Producer profile not found' });
    }
    const producerId = prodRes.rows[0].id;

    const newEvent = await pool.query(
      `INSERT INTO events (producer_id, title, description, date, location, event_style, image_url, ticket_price, enabled_in_event_payments) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        producerId,
        title,
        description,
        date,
        location,
        event_style || 'General',
        image_url || 'default_event',
        ticket_price || 0.00,
        enabled_in_event_payments === true || enabled_in_event_payments === 'true'
      ]
    );

    return res.json({ success: true, event: newEvent.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create event' });
  }
});


// ==========================================
// CLIENT WALLET & TICKETING API
// ==========================================

// Recharge Wallet Balance
app.post('/api/wallet/recharge', requireAuth(['client']), async (req, res) => {
  const { amount } = req.body;
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Invalid recharge amount' });
  }

  try {
    const updated = await pool.query(
      `UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2 RETURNING wallet_balance`,
      [parsedAmount, req.user.id]
    );
    return res.json({ success: true, wallet_balance: updated.rows[0].wallet_balance });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to recharge wallet' });
  }
});

// Join Guestlist
app.post('/api/tickets/join-gl', requireAuth(['client']), async (req, res) => {
  const { guestlistId } = req.body;
  if (!guestlistId) {
    return res.status(400).json({ error: 'Guestlist ID is required' });
  }

  try {
    // 1. Get Guestlist details
    const glRes = await pool.query('SELECT * FROM guestlists WHERE id = $1', [guestlistId]);
    if (glRes.rows.length === 0) {
      return res.status(404).json({ error: 'Guestlist not found' });
    }
    const guestlist = glRes.rows[0];

    // 2. Check if user is already in this guestlist
    const entryExist = await pool.query(
      'SELECT id FROM guestlist_entries WHERE guestlist_id = $1 AND user_id = $2',
      [guestlistId, req.user.id]
    );
    if (entryExist.rows.length > 0) {
      return res.status(400).json({ error: 'You are already registered on this Guestlist' });
    }

    // 3. Check current capacity
    const countRes = await pool.query('SELECT COUNT(*) FROM guestlist_entries WHERE guestlist_id = $1', [guestlistId]);
    const currentCount = parseInt(countRes.rows[0].count);
    if (guestlist.max_capacity && currentCount >= guestlist.max_capacity) {
      return res.status(400).json({ error: 'This Guestlist has reached its maximum capacity' });
    }

    // 4. Create Entry with cryptographic QR Code Token
    const qrToken = `GL-${guestlistId}-${req.user.id}-${crypto.randomBytes(8).toString('hex')}`;
    
    await pool.query(
      `INSERT INTO guestlist_entries (guestlist_id, user_id, status, qr_code_data) 
       VALUES ($1, $2, 'Valid', $3)`,
      [guestlistId, req.user.id, qrToken]
    );

    return res.json({ success: true, message: 'Successfully joined Guestlist!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to join guestlist' });
  }
});

// Purchase Ticket
app.post('/api/tickets/purchase', requireAuth(['client']), async (req, res) => {
  const { eventId, promoCode } = req.body;
  if (!eventId) {
    return res.status(400).json({ error: 'Event ID is required' });
  }

  try {
    // 1. Fetch Event
    const eventRes = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (eventRes.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const event = eventRes.rows[0];
    const ticketPrice = parseFloat(event.ticket_price);

    // 2. Fetch User wallet
    const userRes = await pool.query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const currentBalance = parseFloat(userRes.rows[0].wallet_balance);

    if (currentBalance < ticketPrice) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // 3. Validate Promoter Promo Code
    let promoterId = null;
    if (promoCode) {
      const promoRes = await pool.query(
        'SELECT id FROM promoters WHERE promo_code = $1',
        [promoCode.trim().toUpperCase()]
      );
      if (promoRes.rows.length > 0) {
        promoterId = promoRes.rows[0].id;
      }
    }

    // 4. Charge wallet & Create Ticket in Transaction
    await pool.query('BEGIN');
    
    // Deduct balance
    await pool.query(
      'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
      [ticketPrice, req.user.id]
    );

    // Generate unique QR hash
    const qrToken = `TK-${eventId}-${req.user.id}-${crypto.randomBytes(8).toString('hex')}`;

    // Insert Ticket
    await pool.query(
      `INSERT INTO tickets (event_id, user_id, promoter_id, status, qr_code_data) 
       VALUES ($1, $2, $3, 'Valid', $4)`,
      [eventId, req.user.id, promoterId, qrToken]
    );

    // Update Promoter total sales if applicable
    if (promoterId) {
      await pool.query(
        'UPDATE promoters SET total_sales = COALESCE(total_sales, 0) + 1 WHERE id = $1',
        [promoterId]
      );
    }

    await pool.query('COMMIT');
    return res.json({ success: true, message: 'Ticket purchased successfully!' });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Transaction failed' });
  }
});

// Retrieve Active User Tickets & Guestlists (with generated QR code URLs)
app.get('/api/tickets/my', requireAuth(['client']), async (req, res) => {
  try {
    // 1. Fetch tickets
    const ticketsRes = await pool.query(
      `SELECT t.id, t.status, t.qr_code_data, t.purchase_date,
              e.title, e.date, e.location, e.event_style
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       WHERE t.user_id = $1
       ORDER BY e.date ASC`,
      [req.user.id]
    );

    // Generate QR images on-the-fly for tickets
    const tickets = [];
    for (let t of ticketsRes.rows) {
      const qrDataUrl = await qrcode.toDataURL(t.qr_code_data);
      tickets.push({ ...t, qrCodeDataUrl: qrDataUrl });
    }

    // 2. Fetch guestlist entries
    const glRes = await pool.query(
      `SELECT gle.id, gle.status, gle.qr_code_data, gle.created_at,
              gl.name as guestlist_name, gl.conditions,
              e.title, e.date, e.location
       FROM guestlist_entries gle
       JOIN guestlists gl ON gle.guestlist_id = gl.id
       JOIN events e ON gl.event_id = e.id
       WHERE gle.user_id = $1
       ORDER BY e.date ASC`,
      [req.user.id]
    );

    // Generate QR images on-the-fly for guestlists
    const guestlists = [];
    for (let gl of glRes.rows) {
      const qrDataUrl = await qrcode.toDataURL(gl.qr_code_data);
      guestlists.push({ ...gl, qrCodeDataUrl: qrDataUrl });
    }

    // 3. User Wallet details
    const walletRes = await pool.query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);

    return res.json({
      tickets,
      guestlists,
      wallet_balance: walletRes.rows[0].wallet_balance
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to retrieve active passes' });
  }
});


// ==========================================
// IN-EVENT INTERNAL PAYMENTS (RF02 / DB Extension)
// ==========================================

// Get event products list
app.get('/api/events/:id/products', requireAuth(), async (req, res) => {
  try {
    const products = await pool.query(
      'SELECT * FROM event_products WHERE event_id = $1 ORDER BY name ASC',
      [req.params.id]
    );
    return res.json(products.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load products' });
  }
});

// Buy product inside the venue using wallet balance
app.post('/api/events/:id/purchase-product', requireAuth(['client']), async (req, res) => {
  const { productId } = req.body;
  const eventId = req.params.id;

  if (!productId) {
    return res.status(400).json({ error: 'Product ID is required' });
  }

  try {
    // 1. Get Product info
    const prodRes = await pool.query('SELECT * FROM event_products WHERE id = $1 AND event_id = $2', [productId, eventId]);
    if (prodRes.rows.length === 0) {
      return res.status(404).json({ error: 'Product not found in this event' });
    }
    const product = prodRes.rows[0];
    const price = parseFloat(product.price);

    // 2. Fetch User wallet
    const userRes = await pool.query('SELECT wallet_balance FROM users WHERE id = $1', [req.user.id]);
    const balance = parseFloat(userRes.rows[0].wallet_balance);

    if (balance < price) {
      return res.status(400).json({ error: 'Insufficient wallet balance' });
    }

    // 3. Complete Purchase
    await pool.query('BEGIN');
    
    // Deduct
    await pool.query('UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2', [price, req.user.id]);

    // Insert purchase record
    await pool.query(
      `INSERT INTO event_purchases (event_id, user_id, product_id, amount, description) 
       VALUES ($1, $2, $3, $4, $5)`,
      [eventId, req.user.id, productId, price, `Comprado: ${product.name}`]
    );

    await pool.query('COMMIT');
    return res.json({ success: true, message: `Adquirido: ${product.name}!` });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    return res.status(500).json({ error: 'Failed to process internal purchase' });
  }
});


// ==========================================
// PROMOTER API
// ==========================================

app.get('/api/promoters/stats', requireAuth(['promoter']), async (req, res) => {
  try {
    // Find promoter record
    const promoRes = await pool.query(
      `SELECT p.id, p.promo_code, p.total_sales, t.name as team_name
       FROM promoters p
       LEFT JOIN teams t ON p.team_id = t.id
       WHERE p.user_id = $1`,
      [req.user.id]
    );

    if (promoRes.rows.length === 0) {
      return res.status(404).json({ error: 'Promoter profile not found' });
    }
    const promoter = promoRes.rows[0];

    // Get referrals details (tickets sold using code)
    const salesRes = await pool.query(
      `SELECT t.id, t.status, t.purchase_date, e.title as event_title, e.ticket_price, u.name as client_name
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       JOIN users u ON t.user_id = u.id
       WHERE t.promoter_id = $1
       ORDER BY t.purchase_date DESC`,
      [promoter.id]
    );

    // Calculate total earnings (mock commission: 10% of event ticket price)
    let totalEarnings = 0;
    salesRes.rows.forEach(sale => {
      totalEarnings += parseFloat(sale.ticket_price) * 0.10;
    });

    return res.json({
      promo_code: promoter.promo_code,
      team_name: promoter.team_name || 'Individual',
      total_sales: promoter.total_sales,
      earnings: totalEarnings.toFixed(2),
      sales: salesRes.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch promoter stats' });
  }
});


// ==========================================
// PRODUCER DASHBOARD API
// ==========================================

// Aggregate producer stats
app.get('/api/producers/stats', requireAuth(['producer']), async (req, res) => {
  try {
    // Get producer ID
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    if (prodRes.rows.length === 0) {
      return res.status(403).json({ error: 'Producer profile not found' });
    }
    const producerId = prodRes.rows[0].id;

    // Get list of events
    const events = await pool.query(
      `SELECT e.id, e.title, e.date, e.location, e.ticket_price,
              (SELECT COUNT(*) FROM tickets WHERE event_id = e.id) as tickets_sold,
              (SELECT COUNT(*) FROM tickets WHERE event_id = e.id AND status = 'Consumed') as tickets_checked_in,
              (SELECT COUNT(*) FROM guestlist_entries gle JOIN guestlists gl ON gle.guestlist_id = gl.id WHERE gl.event_id = e.id) as gl_entries,
              (SELECT COUNT(*) FROM guestlist_entries gle JOIN guestlists gl ON gle.guestlist_id = gl.id WHERE gl.event_id = e.id AND gle.status = 'Consumed') as gl_checked_in
       FROM events e
       WHERE e.producer_id = $1
       ORDER BY e.date ASC`,
      [producerId]
    );

    // Calculate totals
    let totalTickets = 0;
    let totalRevenue = 0;
    let checkedInCount = 0;

    events.rows.forEach(evt => {
      const sold = parseInt(evt.tickets_sold);
      const price = parseFloat(evt.ticket_price);
      totalTickets += sold;
      totalRevenue += sold * price;
      checkedInCount += parseInt(evt.tickets_checked_in);
    });

    // Promoter Leaderboard
    const promoters = await pool.query(
      `SELECT p.promo_code, u.name as promoter_name, p.total_sales, t.name as team_name
       FROM promoters p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN teams t ON p.team_id = t.id
       WHERE p.producer_id = $1
       ORDER BY p.total_sales DESC`,
      [producerId]
    );

    // Promoter Teams
    const teams = await pool.query(
      `SELECT t.id, t.name, u.name as leader_name,
              (SELECT COUNT(*) FROM promoters WHERE team_id = t.id) as members_count,
              (SELECT COALESCE(SUM(total_sales), 0) FROM promoters WHERE team_id = t.id) as team_sales
       FROM teams t
       LEFT JOIN users u ON t.leader_id = u.id
       WHERE t.producer_id = $1`,
      [producerId]
    );

    // Banned Users List
    const banned = await pool.query(
      `SELECT bu.id, bu.reason, bu.created_at, u.name, u.email
       FROM banned_users bu
       JOIN users u ON bu.user_id = u.id
       WHERE bu.producer_id = $1`,
      [producerId]
    );

    return res.json({
      events: events.rows,
      totals: {
        events_count: events.rows.length,
        tickets_sold: totalTickets,
        revenue: totalRevenue.toFixed(2),
        checked_in: checkedInCount
      },
      promoters: promoters.rows,
      teams: teams.rows,
      banned: banned.rows
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

// Create Promoter Team
app.post('/api/producers/teams', requireAuth(['producer']), async (req, res) => {
  const { name, leaderEmail } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Team name is required' });
  }

  try {
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    const producerId = prodRes.rows[0].id;

    let leaderId = null;
    if (leaderEmail) {
      const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [leaderEmail]);
      if (userRes.rows.length > 0) {
        leaderId = userRes.rows[0].id;
      }
    }

    await pool.query(
      `INSERT INTO teams (producer_id, name, leader_id) VALUES ($1, $2, $3)`,
      [producerId, name, leaderId]
    );

    return res.json({ success: true, message: 'Team created successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create team' });
  }
});

// Add Promoter
app.post('/api/producers/promoters', requireAuth(['producer']), async (req, res) => {
  const { email, promoCode, teamId } = req.body;
  if (!email || !promoCode) {
    return res.status(400).json({ error: 'Email and promo code are required' });
  }

  try {
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    const producerId = prodRes.rows[0].id;

    // Find User
    const userRes = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User with this email does not exist' });
    }
    
    const user = userRes.rows[0];

    // Check if already a promoter
    const promoExist = await pool.query('SELECT id FROM promoters WHERE user_id = $1 AND producer_id = $2', [user.id, producerId]);
    if (promoExist.rows.length > 0) {
      return res.status(400).json({ error: 'User is already a promoter for your organization' });
    }

    // Set user role to promoter if they are a regular client
    if (user.role === 'client') {
      await pool.query("UPDATE users SET role = 'promoter' WHERE id = $1", [user.id]);
    }

    // Insert into promoter
    await pool.query(
      `INSERT INTO promoters (user_id, producer_id, team_id, promo_code, total_sales) 
       VALUES ($1, $2, $3, $4, 0)`,
      [user.id, producerId, teamId || null, promoCode.trim().toUpperCase()]
    );

    return res.json({ success: true, message: 'Promoter added successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to add promoter' });
  }
});

// Create Guestlist
app.post('/api/producers/guestlists', requireAuth(['producer']), async (req, res) => {
  const { eventId, name, conditions, maxCapacity } = req.body;
  if (!eventId || !name) {
    return res.status(400).json({ error: 'Event ID and guestlist name are required' });
  }

  try {
    // Verify event ownership
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    const producerId = prodRes.rows[0].id;

    const eventRes = await pool.query('SELECT id FROM events WHERE id = $1 AND producer_id = $2', [eventId, producerId]);
    if (eventRes.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized event access' });
    }

    await pool.query(
      `INSERT INTO guestlists (event_id, name, conditions, max_capacity) VALUES ($1, $2, $3, $4)`,
      [eventId, name, conditions || '', maxCapacity ? parseInt(maxCapacity) : null]
    );

    return res.json({ success: true, message: 'Guestlist created successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create guestlist' });
  }
});

// Ban User
app.post('/api/producers/ban', requireAuth(['producer']), async (req, res) => {
  const { email, reason } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'User email is required' });
  }

  try {
    const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
    const producerId = prodRes.rows[0].id;

    // Find User
    const userRes = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = userRes.rows[0].id;

    // Check if already banned
    const banExist = await pool.query('SELECT id FROM banned_users WHERE producer_id = $1 AND user_id = $2', [producerId, userId]);
    if (banExist.rows.length > 0) {
      return res.status(400).json({ error: 'User is already banned' });
    }

    await pool.query(
      `INSERT INTO banned_users (producer_id, user_id, reason) VALUES ($1, $2, $3)`,
      [producerId, userId, reason || 'No reason specified']
    );

    return res.json({ success: true, message: 'User banned successfully!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to ban user' });
  }
});


// ==========================================
// SCANNER DOOR VERIFICATION ENGINE (RF04)
// ==========================================

app.post('/api/verify', requireAuth(['producer', 'staff']), async (req, res) => {
  const { qr_code_data } = req.body;
  if (!qr_code_data) {
    return res.status(400).json({ error: 'QR Code data token is required' });
  }

  try {
    // 1. Get the verifier's associated producer ID
    let verifierProducerId = null;
    let isStaff = false;
    let staffEvents = [];

    if (req.user.role === 'producer') {
      const prodRes = await pool.query('SELECT id FROM producers WHERE user_id = $1', [req.user.id]);
      if (prodRes.rows.length > 0) {
        verifierProducerId = prodRes.rows[0].id;
      }
    } else if (req.user.role === 'staff') {
      isStaff = true;
      const adminEvents = await pool.query('SELECT event_id FROM event_admins WHERE user_id = $1', [req.user.id]);
      staffEvents = adminEvents.rows.map(row => row.event_id);
    }

    // 2. Search in tickets
    const ticketQuery = await pool.query(
      `SELECT t.id, t.status, t.event_id, t.user_id, e.title as event_title, e.producer_id, u.name as user_name
       FROM tickets t
       JOIN events e ON t.event_id = e.id
       JOIN users u ON t.user_id = u.id
       WHERE t.qr_code_data = $1`,
      [qr_code_data]
    );

    if (ticketQuery.rows.length > 0) {
      const ticket = ticketQuery.rows[0];

      // Verify authorization
      if (isStaff && !staffEvents.includes(ticket.event_id)) {
        return res.status(403).json({ status: 'UNAUTHORIZED_VERIFIER', error: 'You are not assigned as door operator for this event.' });
      } else if (!isStaff && ticket.producer_id !== verifierProducerId) {
        return res.status(403).json({ status: 'UNAUTHORIZED_VERIFIER', error: 'This ticket belongs to another company events.' });
      }

      // Check if banned
      const banCheck = await pool.query(
        'SELECT reason FROM banned_users WHERE producer_id = $1 AND user_id = $2',
        [ticket.producer_id, ticket.user_id]
      );
      if (banCheck.rows.length > 0) {
        return res.json({
          status: 'BANNED',
          message: `ENTRADA BLOQUEADA: Utilizador banido pela produtora!`,
          details: { name: ticket.user_name, reason: banCheck.rows[0].reason }
        });
      }

      // Check status
      if (ticket.status === 'Consumed') {
        return res.json({
          status: 'ALREADY_CONSUMED',
          message: 'BILHETE JÁ CONSUMIDO: Entrada duplicada!',
          details: { name: ticket.user_name, event: ticket.event_title }
        });
      }

      // Mark consumed
      await pool.query("UPDATE tickets SET status = 'Consumed' WHERE id = $1", [ticket.id]);

      return res.json({
        status: 'SUCCESS',
        message: 'ENTRADA AUTORIZADA (Bilhete)',
        details: { name: ticket.user_name, event: ticket.event_title }
      });
    }

    // 3. Search in guestlist entries
    const glQuery = await pool.query(
      `SELECT gle.id, gle.status, gle.user_id, gl.name as guestlist_name, e.id as event_id, e.title as event_title, e.producer_id, u.name as user_name
       FROM guestlist_entries gle
       JOIN guestlists gl ON gle.guestlist_id = gl.id
       JOIN events e ON gl.event_id = e.id
       JOIN users u ON gle.user_id = u.id
       WHERE gle.qr_code_data = $1`,
      [qr_code_data]
    );

    if (glQuery.rows.length > 0) {
      const entry = glQuery.rows[0];

      // Verify authorization
      if (isStaff && !staffEvents.includes(entry.event_id)) {
        return res.status(403).json({ status: 'UNAUTHORIZED_VERIFIER', error: 'You are not assigned as door operator for this event.' });
      } else if (!isStaff && entry.producer_id !== verifierProducerId) {
        return res.status(403).json({ status: 'UNAUTHORIZED_VERIFIER', error: 'This guestlist belongs to another company events.' });
      }

      // Check if banned
      const banCheck = await pool.query(
        'SELECT reason FROM banned_users WHERE producer_id = $1 AND user_id = $2',
        [entry.producer_id, entry.user_id]
      );
      if (banCheck.rows.length > 0) {
        return res.json({
          status: 'BANNED',
          message: `ENTRADA BLOQUEADA: Utilizador banido pela produtora!`,
          details: { name: entry.user_name, reason: banCheck.rows[0].reason }
        });
      }

      // Check status
      if (entry.status === 'Consumed') {
        return res.json({
          status: 'ALREADY_CONSUMED',
          message: 'GUESTLIST JÁ CONSUMIDA: Entrada duplicada!',
          details: { name: entry.user_name, event: entry.event_title }
        });
      }

      // Mark consumed
      await pool.query("UPDATE guestlist_entries SET status = 'Consumed' WHERE id = $1", [entry.id]);

      return res.json({
        status: 'SUCCESS',
        message: `ENTRADA AUTORIZADA (${entry.guestlist_name})`,
        details: { name: entry.user_name, event: entry.event_title }
      });
    }

    // 4. Invalid token
    return res.status(400).json({
      status: 'INVALID',
      message: 'REGISTO INVÁLIDO: Ingresso falso ou expirado!'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Verification failed' });
  }
});


// Start Server
app.listen(PORT, () => {
  console.log(`\nSERVER CONNECTION: ✅\n\nhttp://localhost:${PORT}\n`);
});

console.log("DATABASE_URL:", process.env.DATABASE_URL);
console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
console.log("SUPABASE_KEY exists:", !!process.env.SUPABASE_KEY);