#!/bin/bash
# ============================================================
# Run this script on your Ubuntu server to generate bcrypt
# password hashes, then paste them into auth.js USERS section.
#
# Usage: bash setup-passwords.sh
# ============================================================

if ! command -v node &>/dev/null; then
  echo "Node.js not found. Installing..."
  apt-get install -y nodejs npm
fi

if ! node -e "require('bcryptjs')" 2>/dev/null; then
  npm install -g bcryptjs 2>/dev/null || true
  # fallback: install locally
  mkdir -p /tmp/bcrypt-helper && cd /tmp/bcrypt-helper
  npm init -y >/dev/null 2>&1
  npm install bcryptjs >/dev/null 2>&1
fi

hash_password() {
  local pass="$1"
  node -e "
    try {
      const b = require('bcryptjs');
      console.log(b.hashSync('$pass', 10));
    } catch(e) {
      const b = require('/tmp/bcrypt-helper/node_modules/bcryptjs');
      console.log(b.hashSync('$pass', 10));
    }
  "
}

echo ""
echo "============================================"
echo "  Station Tapes — Password Setup"
echo "============================================"
echo ""

while true; do
  read -p "Enter username (or press ENTER to finish): " username
  [ -z "$username" ] && break
  read -s -p "Enter password for '$username': " password
  echo ""
  hash=$(hash_password "$password")
  echo ""
  echo "  Add this line to auth.js USERS section:"
  echo ""
  echo "  '$username': { password: '$hash', role: 'admin' },"
  echo ""
done

echo "Done. Edit auth.js with the lines above, then rebuild:"
echo "  docker compose up -d --build"
echo ""
