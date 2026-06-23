// ============================================================
// auth.js — Auth + User Management API (Node.js / Express)
// Redis session store, MySQL for users.
// ============================================================

const express          = require('express');
const session          = require('express-session');
const RedisStore       = require('connect-redis').default;
const { createClient } = require('redis');
const mysql            = require('mysql2/promise');
const bcrypt           = require('bcryptjs');
const fs               = require('fs');
const path             = require('path');
const { execFile }     = require('child_process');
const app              = express();

const VIDEOS_ROOT = '/var/www/html/videos';
const ALLOWED_EXT = ['.mp4', '.webm', '.mkv', '.mov', '.avi'];

// ── DB connection pool ───────────────────────────────────────
const dbConfig = {
  host:     process.env.DB_HOST || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'stationtapes',
  user:     process.env.DB_USER || 'stuser',
  password: process.env.DB_PASS || 'stpass123',
};

const pool = mysql.createPool({ ...dbConfig, waitForConnections: true, connectionLimit: 10 });

// ── Redis client & session store ─────────────────────────────
const redisClient = createClient({
  socket: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  }
});
redisClient.connect().catch(e => console.error('[redis] connect error:', e.message));
redisClient.on('error', e => console.error('[redis]', e.message));

const sessionStore = new RedisStore({ client: redisClient, prefix: 'sess:' });

const SESSION_TTL = 8 * 60 * 60 * 1000; // 8 hours

app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: SESSION_TTL, sameSite: 'lax' }
}));

// ── ffprobe duration helper ──────────────────────────────────
function getVideoDuration(filePath) {
  return new Promise(resolve => {
    execFile('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err || !stdout || !stdout.trim()) return resolve(null);
      const secs = parseFloat(stdout.trim());
      resolve(isNaN(secs) ? null : Math.round(secs));
    });
  });
}

// ── Middleware: require login ────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.status(403).json({ error: 'Forbidden' });
}

// ── POST /login ──────────────────────────────────────────────
app.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ ok: true, username: user.username, role: user.role });
  } catch (e) {
    console.error('[login]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /logout ─────────────────────────────────────────────
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── GET /me ──────────────────────────────────────────────────
app.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ ok: true, ...req.session.user });
  } else {
    res.status(401).json({ ok: false });
  }
});

// ── GET /users ───────────────────────────────────────────────
app.get('/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, role, created_at, last_login FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /users ──────────────────────────────────────────────
app.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!['admin', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username.toLowerCase(), hash, role || 'viewer']);
    res.json({ ok: true, message: `User '${username}' created` });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /users/:id ───────────────────────────────────────────
app.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const { password, role } = req.body || {};
  const id = parseInt(req.params.id);
  try {
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hash, id]);
    }
    if (role && ['admin', 'viewer'].includes(role)) {
      await pool.query('UPDATE users SET role = ?, updated_at = NOW() WHERE id = ?', [role, id]);
    }
    res.json({ ok: true, message: 'User updated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /users/:id ────────────────────────────────────────
app.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.session.user.id === id) return res.status(400).json({ error: 'Cannot delete your own account' });
  try {
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true, message: 'User deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /users/:id/password ─────────────────────────────────
app.post('/users/:id/password', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  if (req.session.user.id !== id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const [rows] = await pool.query('SELECT password FROM users WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    if (req.session.user.role !== 'admin') {
      const match = await bcrypt.compare(currentPassword || '', rows[0].password);
      if (!match) return res.status(401).json({ error: 'Current password incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ?, updated_at = NOW() WHERE id = ?', [hash, id]);
    res.json({ ok: true, message: 'Password updated' });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /list/:station ───────────────────────────────────────
app.get('/list/:station', requireAuth, async (req, res) => {
  try {
    const safeStation = path.basename(req.params.station);
    const dir = path.join(VIDEOS_ROOT, safeStation);
    if (!dir.startsWith(VIDEOS_ROOT + '/')) return res.status(403).json({ error: 'Access denied' });

    let files;
    try {
      files = await fs.promises.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return res.json({ files: [] });
      return res.status(500).json({ error: 'Cannot read directory' });
    }

    const videoFiles = files
      .filter(f => ALLOWED_EXT.includes(path.extname(f).toLowerCase()))
      .map(f => {
        try {
          const stat = fs.statSync(path.join(dir, f));
          return { name: f, mtime: stat.mtime.toISOString(), size: stat.size };
        } catch {
          return { name: f, mtime: null, size: 0 };
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ files: videoFiles });
  } catch (e) {
    console.error('[list]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /duration/:station/:filename ─────────────────────────
app.get('/duration/:station/:filename', requireAuth, async (req, res) => {
  try {
    const safeStation  = path.basename(req.params.station);
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(VIDEOS_ROOT, safeStation, safeFilename);
    if (!filePath.startsWith(VIDEOS_ROOT + '/')) return res.status(403).json({ error: 'Access denied' });
    const ext = path.extname(safeFilename).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return res.status(400).json({ error: 'Invalid file type' });
    const duration = await getVideoDuration(filePath);
    res.json({ duration });
  } catch (e) {
    console.error('[duration]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /files ─────────────────────────────────────────────
app.delete('/files', requireAuth, requireAdmin, (req, res) => {
  const { station, filename } = req.body || {};
  if (!station || !filename) return res.status(400).json({ error: 'Missing station or filename' });
  const safeStation  = path.basename(station);
  const safeFilename = path.basename(filename);
  const ext = path.extname(safeFilename).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return res.status(400).json({ error: 'Invalid file type' });
  const filePath = path.join(VIDEOS_ROOT, safeStation, safeFilename);
  if (!filePath.startsWith(VIDEOS_ROOT + '/')) return res.status(403).json({ error: 'Access denied' });
  fs.unlink(filePath, err => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      console.error('[delete]', err.message);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
    console.log(`[delete] ${req.session.user.username} deleted ${filePath}`);
    res.json({ ok: true, message: `Deleted ${safeFilename}` });
  });
});

// ── DELETE /files/bulk ────────────────────────────────────────
app.delete('/files/bulk', requireAuth, requireAdmin, (req, res) => {
  const { station, filenames } = req.body || {};
  if (!station || !Array.isArray(filenames) || filenames.length === 0) {
    return res.status(400).json({ error: 'Missing station or filenames' });
  }
  const safeStation = path.basename(station);
  const stationDir  = path.join(VIDEOS_ROOT, safeStation);
  if (!stationDir.startsWith(VIDEOS_ROOT + '/')) return res.status(403).json({ error: 'Access denied' });

  let deleted = 0;
  const errors = [];
  for (const filename of filenames) {
    const safeFilename = path.basename(filename);
    const ext = path.extname(safeFilename).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) { errors.push({ filename, error: 'Invalid file type' }); continue; }
    const filePath = path.join(stationDir, safeFilename);
    if (!filePath.startsWith(VIDEOS_ROOT + '/')) { errors.push({ filename, error: 'Access denied' }); continue; }
    try {
      fs.unlinkSync(filePath);
      deleted++;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('[bulk-delete]', e.message);
      errors.push({ filename, error: e.code === 'ENOENT' ? 'Not found' : 'Failed' });
    }
  }
  console.log(`[bulk-delete] ${req.session.user.username} deleted ${deleted}/${filenames.length} files from ${safeStation}`);
  res.json({ ok: true, deleted, total: filenames.length, errors });
});

app.listen(3000, '127.0.0.1', () => console.log('[auth] Running on 127.0.0.1:3000'));
