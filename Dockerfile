FROM node:6

# Screwdriver Store Version
ARG VERSION=latest

# Create our application directory
RUN mkdir -p /usr/src/app
WORKDIR /usr/src/app

# Install Screwdriver API
RUN npm install screwdriver-executor-queue-worker@$VERSION
WORKDIR /usr/src/app/node_modules/screwdriver-executor-queue-worker

# Setup configuration folder
RUN ln -s /usr/src/app/node_modules/screwdriver-executor-queue-worker
/config /config

# Expose the web service port
EXPOSE 80

# Run the service
CMD [ "npm", "start" ]