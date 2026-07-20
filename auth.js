const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkeyforguestlistapp123!';

async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function requireAuth(allowedRoles = []) {
  return (req, res, next) => {
    let token = null;
    if (req.cookies && req.cookies.token) {
      token = req.cookies.token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' });
      }
      return res.redirect('/login.html');
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
        if (req.path.startsWith('/api/')) {
          return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
        }
        return res.status(403).send('Forbidden: Access denied');
      }

      next();
    } catch (err) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
      }
      res.clearCookie('token');
      return res.redirect('/login.html');
    }
  };
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  requireAuth,
  JWT_SECRET
};
