FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl ffmpeg tzdata ca-certificates curl unzip \
    libreoffice-writer font-noto-arabic font-dejavu \
    && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && soffice --version \
    && curl -fsSL -o /tmp/xray.zip https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip \
    && unzip -j -o /tmp/xray.zip xray -d /usr/local/bin \
    && chmod +x /usr/local/bin/xray \
    && rm -f /tmp/xray.zip \
    && xray version

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
