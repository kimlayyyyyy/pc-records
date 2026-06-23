FROM node:20-alpine AS auth-deps
WORKDIR /auth
COPY package.json .
RUN npm install --production

FROM nginx:alpine

RUN apk add --no-cache fcgiwrap bash nodejs npm ffmpeg

# Copy auth service
COPY --from=auth-deps /auth/node_modules /auth/node_modules
COPY auth.js package.json /auth/

# Copy nginx config and web files
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html login.html users.html style.css script.js /var/www/html/

# Copy CGI scripts
COPY storage.sh /usr/local/bin/storage.sh
RUN chmod +x /usr/local/bin/storage.sh

RUN mkdir -p /var/www/html/videos

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
CMD ["/entrypoint.sh"]
