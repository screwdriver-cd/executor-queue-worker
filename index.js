'use strict';

const NodeResque = require('node-resque');
const jobs = require('./lib/jobs');
const Redis = require('ioredis');
const request = require('request');
const winston = require('winston');
const { connectionDetails, queuePrefix } = require('./config/redis');
const redis = new Redis(connectionDetails.port, connectionDetails.host, connectionDetails.options);

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
    const { buildId } = updateConfig.job.args[0];

    return redis.hget(`${queuePrefix}buildConfigs`, buildId)
        .then(JSON.parse)
        .then(fullBuildConfig => request({
            json: true,
            method: 'PUT',
            uri: `${fullBuildConfig.apiUri}/v4/builds/${buildId}`,
            payload: {
                status: 'FAILURE',
                statusMessage: 'Build failed to start due to infrastructure error'
            },
            auth: {
                bearer: fullBuildConfig.token
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
        }));
}

/**
 * Shutdown both worker and scheduler and then exit the process
 * @method shutDownAll
 * @param  {Object}       worker        worker to be ended
 * @param  {Object}       scheduler     scheduler to be ended
 */
async function shutDownAll(worker, scheduler) {
    try {
        await worker.end();
    } catch (error) {
        winston.error(`failed to end the worker: ${error}`);
    }

    try {
        await scheduler.end();
        process.exit(0);
    } catch (err) {
        winston.error(`failed to end the scheduler: ${err}`);
        process.exit(128);
    }
}

const supportFunction = { updateBuildStatus, shutDownAll };
const multiWorker = new NodeResque.MultiWorker({
    connection: connectionDetails,
    queues: [`${queuePrefix}builds`],
    minTaskProcessors: 1,
    maxTaskProcessors: 10,
    checkTimeout: 1000,
    maxEventLoopDelay: 10,
    toDisconnectProcessors: true
}, jobs);

const scheduler = new NodeResque.Scheduler({ connection: connectionDetails });

/**
 * Start worker & scheduler
 * @method boot
 * @return {Promise}
 */
async function boot() {
    /* eslint-disable max-len */
    multiWorker.on('start', workerId =>
        winston.info(`worker[${workerId}] started`));
    multiWorker.on('end', workerId =>
        winston.info(`worker[${workerId}] ended`));
    multiWorker.on('cleaning_worker', (workerId, worker, pid) =>
        winston.info(`cleaning old worker ${worker} pid ${pid}`));
    multiWorker.on('poll', (workerId, queue) =>
        winston.info(`worker[${workerId}] polling ${queue}`));
    multiWorker.on('job', (workerId, queue, job) =>
        winston.info(`worker[${workerId}] working job ${queue} ${JSON.stringify(job)}`));
    multiWorker.on('reEnqueue', (workerId, queue, job, plugin) =>
        winston.info(`worker[${workerId}] reEnqueue job (${plugin}) ${queue} ${JSON.stringify(job)}`));
    multiWorker.on('success', (workerId, queue, job, result) =>
        winston.info(`worker[${workerId}] ${job} success ${queue} ${JSON.stringify(job)} >> ${result}`));
    multiWorker.on('failure', (workerId, queue, job, failure) =>
        supportFunction.updateBuildStatus({ workerId, queue, job, failure }, () => {}));
    multiWorker.on('error', (workerId, queue, job, error) =>
        winston.error(`worker[${workerId}] error ${queue} ${JSON.stringify(job)} >> ${error}`));
    multiWorker.on('pause', workerId =>
        winston.info(`worker[${workerId}] paused`));
    /* eslint-enable max-len */

    // multiWorker emitters
    multiWorker.on('internalError', error =>
        winston.error(error));
    multiWorker.on('multiWorkerAction', (verb, delay) =>
        winston.info(`*** checked for worker status: ${verb} (event loop delay: ${delay}ms)`));

    scheduler.on('start', () =>
        winston.info('scheduler started'));
    scheduler.on('end', () =>
        winston.info('scheduler ended'));
    scheduler.on('poll', () =>
        winston.info('scheduler polling'));
    scheduler.on('master', state =>
        winston.info(`scheduler became master ${state}`));
    scheduler.on('error', error =>
        winston.info(`scheduler error >> ${error}`));
    scheduler.on('working_timestamp', timestamp =>
        winston.info(`scheduler working timestamp ${timestamp}`));
    scheduler.on('transferred_job', (timestamp, job) =>
        winston.info(`scheduler enqueuing job timestamp  >>  ${JSON.stringify(job)}`));

    multiWorker.start();

    await scheduler.connect();
    scheduler.start();

    // Shut down workers before exit the process
    process.on('SIGTERM', async () => supportFunction.shutDownAll(multiWorker, scheduler));
}

boot();

module.exports = {
    jobs,
    multiWorker,
    scheduler,
    supportFunction
};
