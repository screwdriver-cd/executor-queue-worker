FROM node:6

# Screwdriver Executor Queue Worker Version
ARG VERSION=latest

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install Screwdriver Executor Queue Worker
RUN npm install screwdriver-executor-queue-worker@$VERSION
WORKDIR /usr/src/app/node_modules/screwdriver-executor-queue-worker

# Run the service
CMD [ "npm", "start" ]
