#!/bin/sh
# Start fcgiwrap (for storage CGI)
fcgiwrap -s unix:/var/run/fcgiwrap.socket &
sleep 0.5
chmod 777 /var/run/fcgiwrap.socket

# Start auth service
node /auth/auth.js &

# Start nginx
nginx -g "daemon off;"
