-- Station Tapes — MySQL init script
-- Runs once when MySQL container is first created.

CREATE TABLE IF NOT EXISTS users (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(64) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,       -- bcrypt hash
  role       ENUM('admin','viewer') NOT NULL DEFAULT 'viewer',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login DATETIME DEFAULT NULL
);

-- Default admin user: admin / Zxcv@123
-- Hash generated with bcrypt cost=10
-- To change: UPDATE users SET password='<new_hash>' WHERE username='admin';
INSERT INTO users (username, password, role) VALUES
  ('admin', '$2b$10$EwATNQKlGmoneoqAEKHauOk/we3RljKiuKq7ri1ZIWrRt3SZ/i8du', 'admin')
ON DUPLICATE KEY UPDATE username=username;

-- Sessions are stored in Redis (connect-redis); no sessions table needed.
