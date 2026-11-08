FROM node:26-alpine

ENV CHROME_BIN="/usr/bin/chromium-browser" \
    PUPPETEER_SKIP_DOWNLOAD="true"
RUN apk update && apk upgrade
RUN apk add --no-cache udev \
    ttf-freefont \
    chromium 
RUN apk add mariadb-client
RUN apk add --no-cache openssl

WORKDIR /var/www/html

CMD [ "npm", "run", "dev" ]