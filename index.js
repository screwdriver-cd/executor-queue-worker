'use strict';

const NR = require('node-resque');
const jobs = require('./lib/jobs');
const request = require('request');
const winston = require('winston');
const { connectionDetails, queuePrefix } = require('./config/redis');

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
        method: 'PUT',
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

/**
 * Shutdown both worker and scheduler and then exit the process
 * @method shutDownAll
 * @param  {Object}       worker        worker to be ended
 * @param  {Object}       scheduler     scheduler to be ended
 */
function shutDownAll(worker, scheduler) {
    worker.end((error) => {
        if (error) {
            winston.error(`failed to end the worker: ${error}`);
        }

        scheduler.end((err) => {
            if (err) {
                winston.error(`failed to end the scheduler: ${err}`);
                process.exit(128);
            }
            process.exit(0);
        });
    });
}

const supportFunction = { updateBuildStatus, shutDownAll };

/* eslint-disable new-cap, max-len */
const multiWorker = new NR.multiWorker({
    connection: connectionDetails,
    queues: [`${queuePrefix}builds`],
    minTaskProcessors: 1,
    maxTaskProcessors: 10,
    checkTimeout: 1000,
    maxEventLoopDelay: 10,
    toDisconnectProcessors: true
}, jobs);

const scheduler = new NR.scheduler({ connection: connectionDetails });

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
scheduler.connect(() => {
    scheduler.start();
});

// Shut down workers before exit the process
process.on('SIGTERM', () => supportFunction.shutDownAll(multiWorker, scheduler));

module.exports = {
    jobs,
    multiWorker,
    scheduler,
    supportFunction
};
