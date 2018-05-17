'use strict';

const config = require('config');

const redisConfig = config.get('redis');
const connectionDetails = {
    pkg: 'ioredis',
    host: redisConfig.host,
    options: {
        password: redisConfig.password,
        tls: redisConfig.tls
    },
    port: redisConfig.port,
    database: 0
};
const queuePrefix = redisConfig.prefix || '';

// Use for blockedby plugin
const runningJobsPrefix = `${queuePrefix}running_job_`;

module.exports = {
    connectionDetails,
    queuePrefix,
    runningJobsPrefix
};
