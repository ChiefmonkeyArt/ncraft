FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

ENV PORT=8080
ENV HOST=0.0.0.0
ENV WNCRAFT_DATA=/data

VOLUME /data
EXPOSE 8080

CMD ["node", "server/index.js"]
