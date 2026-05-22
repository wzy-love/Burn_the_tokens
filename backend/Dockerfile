FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run db:generate

EXPOSE 4000

CMD ["sh", "-c", "npm run db:push && npm run start"]
