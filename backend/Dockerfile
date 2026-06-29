FROM node:20-slim

WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

WORKDIR /app
COPY backend ./backend
COPY shared ./shared

WORKDIR /app/backend
RUN npm run build

# Bake the embedding model into the image at build time.
# Hugging Face Spaces disk is NOT persistent, so the model must be
# cached inside node_modules/@huggingface/transformers/.cache at build time.
RUN node -e "import('./dist/backend/src/services/embeddings.js').then((m) => m.warmUpEmbeddings()).then(() => { console.log('Embedding model baked into image.'); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); })"

ENV PORT=7860
EXPOSE 7860

CMD ["npm", "start"]
