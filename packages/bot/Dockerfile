FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl ffmpeg tzdata ca-certificates curl \
    libreoffice-writer font-noto-arabic font-dejavu \
    && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_musllinux \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version \
    && soffice --version

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install
RUN npx prisma generate

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
