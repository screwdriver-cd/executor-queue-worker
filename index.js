'use strict';

const asCallback = require('ascallback');
const config = require('config');
const NR = require('node-resque');
const request = require('request');
const winston = require('winston');

const ecosystem = config.get('ecosystem');
const executorConfig = config.get('executor');
const redisConfig = config.get('redis');

const ExecutorRouter = require('screwdriver-executor-router');
const executorPlugins = Object.keys(executorConfig).reduce((aggregator, keyName) => {
    if (keyName !== 'plugin') {
        aggregator.push(Object.assign({
            name: keyName
        }, executorConfig[keyName]));
    }

    return aggregator;
}, []);
const executor = new ExecutorRouter({
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
            asCallback(executor.start(buildConfig), callback)
    }
};

/**
 * Update build status to FAILURE
 * @method updateBuildStatus
 * @param  {Object}          updateConfig              build config of the job
 * @param  {string}          updateConfig.failure      failure message
 * @param  {Object}          updateConfig.job          job info
 * @param  {Object}          updateConfig.queue        queue of the job
 * @param  {integer}         updateConfig.workerId     id of the workerId
 * @param  {Function}        [callback]                Callback function
 * @return {Object}          err                       Callback with err object
 */
function updateBuildStatus(updateConfig, callback) {
    const { failure, job, queue, workerId } = updateConfig;
    const { apiUri, buildId, token } = updateConfig.job.args[0];

    return request({
        json: true,
        method: 'POST',
        uri: `${apiUri}/v4/builds/${buildId}`,
        payload: {
            status: 'FAILURE'
        },
        auth: {
            bearer: token
        }
    }, (err, response) => {
        if (!err && response.statusCode === 200) {
            // eslint-disable-next-line max-len
            winston.error(`worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> successfully update build status: ${failure}`);
            callback(null);
        } else {
            // eslint-disable-next-line max-len
            winston.error(`worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> ${failure} ${err} ${response}`);
            callback(err);
        }
    });
}

const supportFunction = { updateBuildStatus };

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

multiWorker.on('start', workerId =>
    winston.log(`worker[${workerId}] started`));
multiWorker.on('end', workerId =>
    winston.log(`worker[${workerId}] ended`));
multiWorker.on('cleaning_worker', (workerId, worker, pid) =>
    winston.log(`cleaning old worker ${worker} pid ${pid}`));
multiWorker.on('poll', (workerId, queue) =>
    winston.log(`worker[${workerId}] polling ${queue}`));
multiWorker.on('job', (workerId, queue, job) =>
    winston.log(`worker[${workerId}] working job ${queue} ${JSON.stringify(job)}}`));
multiWorker.on('reEnqueue', (workerId, queue, job, plugin) =>
    winston.log(`worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`));
multiWorker.on('success', (workerId, queue, job, result) =>
    winston.log(`worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`));
multiWorker.on('failure', (workerId, queue, job, failure) =>
    supportFunction.updateBuildStatus({ workerId, queue, job, failure }, () => {}));
multiWorker.on('error', (workerId, queue, job, error) =>
    winston.error(`worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`));
multiWorker.on('pause', workerId =>
    winston.log(`worker[${workerId}] paused`));

// multiWorker emitters
multiWorker.on('internalError', error =>
    winston.error(error));
multiWorker.on('multiWorkerAction', (verb, delay) =>
    winston.log(`*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`));

multiWorker.start();

process.on('SIGTERM', () => {
    multiWorker.end();
    process.exit();
});

module.exports = {
    jobs,
    multiWorker,
    supportFunction
};
