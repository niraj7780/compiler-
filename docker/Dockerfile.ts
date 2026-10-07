FROM node:22-slim
RUN npm install -g typescript@5 \
    && npm cache clean --force
WORKDIR /work
