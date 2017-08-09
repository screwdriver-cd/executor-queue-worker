'use strict';

const NR = require('node-resque');
const asCallback = require('ascallback');
const config = require('config');
const ecosystem = config.get('ecosystem');
const executorConfig = config.get('executor');
const redisConfig = config.get('redis');
const ExecutorPlugin = require('screwdriver-executor-router');
const executorPlugins = Object.keys(executorConfig).reduce((aggregator, keyName) => {
    if (keyName !== 'plugin') {
        aggregator.push(Object.assign({
            name: keyName
        }, executorConfig[keyName]));
    }

    return aggregator;
}, []);
const executor = new ExecutorPlugin({
    defaultPlugin: executorConfig.plugin,
    executor: executorPlugins,
    ecosystem
});
const connectionDetails = {
    pkg: 'ioredis',
    host: redisConfig.REDIS_HOST,
    password: redisConfig.REDIS_PASSWORD,
    port: redisConfig.REDIS_PORT,
    database: 0
};
const jobs = {
    start: {
        /**
         * Call executor.start with the buildConfig
         * @method perform
         * @param {Object}  buildConfig               Configuration
         * @param {Object}  [buildConfig.annotations] Optional key/value object
         * @param {String}  buildConfig.apiUri        Screwdriver's API
         * @param {String}  buildConfig.buildId       Unique ID for a build
         * @param {String}  buildConfig.container     Container for the build to run in
         * @param {String}  buildConfig.token         JWT to act on behalf of the build
         */
        perform: (buildConfig, callback) =>
            asCallback(executor.start(buildConfig), (err) => {
                if (err) {
                    return callback(err);
                }

                return callback(null);
            })
    }
};

// eslint-disable-next-line new-cap
const multiWorker = new NR.multiWorker({
    connection: connectionDetails,
    queues: ['builds'],
    minTaskProcessors: 1,
    maxTaskProcessors: 10,
    checkTimeout: 1000,
    maxEventLoopDelay: 10,
    toDisconnectProcessors: true
}, jobs);

/* eslint-disable no-console */
multiWorker.on('start', workerId =>
    console.log(`worker[${workerId}] started`));
multiWorker.on('end', workerId =>
    console.log(`worker[${workerId}] ended`));
multiWorker.on('cleaning_worker', (workerId, worker, pid) =>
    console.log(`cleaning old worker ${worker} pid ${pid}`));
multiWorker.on('poll', (workerId, queue) =>
    console.log(`worker[${workerId}] polling ${queue}`));
multiWorker.on('job', (workerId, queue, job) =>
    console.log(`worker[${workerId}] working job ${queue} ${JSON.stringify(job)}}`));
multiWorker.on('reEnqueue', (workerId, queue, job, plugin) =>
    console.log(`worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`));
multiWorker.on('success', (workerId, queue, job, result) =>
    console.log(`worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`));
multiWorker.on('failure', (workerId, queue, job, failure) =>
    console.error(`worker[${workerId}] ${job} failure ${queue}
        ${JSON.stringify(job)} >> ${failure}`));
multiWorker.on('error', (workerId, queue, job, error) =>
    console.error(`worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`));
multiWorker.on('pause', workerId =>
    console.log(`worker[${workerId}] paused`));

// multiWorker emitters
multiWorker.on('internalError', error =>
    console.error(error));
multiWorker.on('multiWorkerAction', (verb, delay) =>
    console.log(`*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`));
/* eslint-disable no-console */

multiWorker.start();

module.exports = {
    jobs
};
