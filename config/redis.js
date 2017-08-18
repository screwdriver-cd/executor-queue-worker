'use strict';

const config = require('config');

const redisConfig = config.get('redis');
const connectionDetails = {
    pkg: 'ioredis',
    host: redisConfig.host,
    options: {
        password: redisConfig.password
    },
    port: redisConfig.port,
    database: 0
};
const queuePrefix = redisConfig.prefix || '';

module.exports = {
    connectionDetails,
    queuePrefix
};
