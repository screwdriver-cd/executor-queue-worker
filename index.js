'use strict';

const NodeResque = require('node-resque');
const jobs = require('./lib/jobs');
const helper = require('./lib/helper');
const Redis = require('ioredis');
const winston = require('winston');
const { connectionDetails, queuePrefix } = require('./config/redis');
const redis = new Redis(
    connectionDetails.port, connectionDetails.host, connectionDetails.options);

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
        helper.updateBuildStatus({
            redisInstance: redis,
            buildId: job.args[0].buildId,
            status: 'FAILURE',
            statusMessage: 'Build failed to start due to infrastructure error'
        }, (err, response) => {
            if (!err) {
                winston.error(`worker[${workerId}] ${JSON.stringify(job)} failure ${queue} ${JSON.stringify(job)} >> successfully update build status: ${failure}`);
            } else {
                winston.error(`worker[${workerId}] ${job} failure ${queue} ${JSON.stringify(job)} >> ${failure} ${err} ${JSON.stringify(response)}`);
            }
        }));
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
    process.on('SIGTERM', async () => shutDownAll(multiWorker, scheduler));
}

boot();

module.exports = {
    jobs,
    multiWorker,
    scheduler,
    shutDownAll
};
